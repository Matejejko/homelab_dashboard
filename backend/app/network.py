"""Peers of this host, derived from the kernel connection-tracking table.

Every flow is classified by its ORIGINAL tuple (the direction the first packet
travelled), which is what survives kube-proxy and Docker NAT.
"""

import fnmatch
import ipaddress
import logging
import socket
import subprocess
from dataclasses import dataclass, field

import httpx
import psutil

from . import geo, services, system

logger = logging.getLogger("homelab.network")

MAX_PEERS = 200
CONNTRACK_TIMEOUT = 5      # seconds, per address family
TAILSCALE_TTL = 10.0       # seconds

# k3s defaults: pod CIDR and service CIDR
K3S_CIDRS = (
    ipaddress.ip_network("10.42.0.0/16"),
    ipaddress.ip_network("10.43.0.0/16"),
)
# Interfaces whose subnets hold containers, not clients
INTERNAL_IFACE_PATTERNS = ("docker0", "br-*", "cni*", "flannel*")

# Tailscale address space (net/tsaddr: CGNATRange and TailscaleULARange)
TAILSCALE_NETS = (
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("fd7a:115c:a1e0::/48"),
)
# RFC 1918 and IPv6 unique local addresses
PRIVATE_NETS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("fc00::/7"),
)
_LIMITED_BROADCAST = ipaddress.ip_address("255.255.255.255")

# unlocated_reason values
REASON_PRIVATE = "private"                  # overlay or private address, no known public endpoint
REASON_RELAYED = "relayed"                  # Tailscale peer reached through a relay
REASON_NO_SERVER_LOCATION = "no_server_location"


# ─── conntrack parsing ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class Flow:
    proto: str                    # "tcp" | "udp"
    src: ipaddress.IPv4Address | ipaddress.IPv6Address
    dst: ipaddress.IPv4Address | ipaddress.IPv6Address
    sport: int
    dport: int
    bytes_orig: int | None        # original direction; None without accounting
    bytes_reply: int | None


def _to_int(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def parse_line(line: str) -> Flow | None:
    """Parse one line of `conntrack -L` or /proc/net/nf_conntrack.

    Keeps TCP flows in state ESTABLISHED and UDP flows marked [ASSURED].
    The first src/dst/sport/dport/bytes are the original tuple, the second the reply.
    """
    head: list[str] = []
    orig: dict[str, str] = {}
    reply: dict[str, str] = {}
    assured = False
    for token in line.split():
        if token.startswith("["):
            assured = assured or token == "[ASSURED]"
            continue
        key, sep, value = token.partition("=")
        if not sep:
            if not orig:
                head.append(token)
            continue
        if key not in orig:
            orig[key] = value
        elif key not in reply:
            reply[key] = value

    if "tcp" in head:
        if "ESTABLISHED" not in head:
            return None
        proto = "tcp"
    elif "udp" in head:
        if not assured:
            return None
        proto = "udp"
    else:
        return None

    try:
        src = ipaddress.ip_address(orig["src"])
        dst = ipaddress.ip_address(orig["dst"])
        sport = int(orig["sport"])
        dport = int(orig["dport"])
    except (KeyError, ValueError):
        return None

    bytes_orig = _to_int(orig.get("bytes"))
    bytes_reply = _to_int(reply.get("bytes"))
    if bytes_orig is None or bytes_reply is None:
        bytes_orig = bytes_reply = None
    return Flow(proto, src, dst, sport, dport, bytes_orig, bytes_reply)


def parse_conntrack(text: str) -> list[Flow]:
    return [flow for line in text.splitlines() if (flow := parse_line(line)) is not None]


def _run_conntrack(family: str) -> str | None:
    try:
        proc = subprocess.run(
            ["conntrack", "-L", "-f", family],
            capture_output=True, text=True, errors="replace", timeout=CONNTRACK_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.debug("conntrack -f %s failed: %s", family, exc)
        return None
    return proc.stdout if proc.returncode == 0 else None


_warned_no_conntrack = False


def read_flows() -> list[Flow]:
    """Read the conntrack table. Blocking.

    Uses the conntrack CLI for IPv4 and IPv6 and falls back to
    /proc/net/nf_conntrack when the CLI cannot be used.
    """
    global _warned_no_conntrack
    outputs = [out for family in ("ipv4", "ipv6") if (out := _run_conntrack(family)) is not None]
    if outputs:
        return [flow for out in outputs for flow in parse_conntrack(out)]

    for name in ("nf_conntrack", "ip_conntrack"):
        try:
            text = (system.host_proc() / "net" / name).read_text(errors="replace")
        except OSError:
            continue
        return parse_conntrack(text)

    if not _warned_no_conntrack:
        _warned_no_conntrack = True
        logger.warning("conntrack is unavailable: no peers can be reported")
    return []


# ─── Host addressing ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class HostNets:
    local: frozenset = frozenset()        # every address on a host interface
    broadcast: frozenset = frozenset()
    internal: tuple = K3S_CIDRS           # pod, service and container-bridge subnets
    lan: tuple = ()                       # subnets of the LAN interface
    zerotier: tuple = ()                  # subnets of the ZeroTier interface


def _network(ip, netmask: str | None):
    host = ipaddress.ip_network(ip)
    if not netmask:
        return host
    try:
        if ip.version == 4:
            return ipaddress.ip_network(f"{ip}/{netmask}", strict=False)
        prefix = bin(int(ipaddress.IPv6Address(netmask))).count("1")
        return ipaddress.ip_network(f"{ip}/{prefix}", strict=False)
    except ValueError:
        return host


def host_nets(addrs: dict | None = None, lan_iface: str = "", zt_iface: str = "") -> HostNets:
    """Describe the host from a psutil.net_if_addrs() mapping (read live when omitted)."""
    if addrs is None:
        addrs = psutil.net_if_addrs()

    local, broadcast = set(), set()
    internal, lan, zerotier = list(K3S_CIDRS), [], []
    for name, entries in addrs.items():
        is_internal = any(fnmatch.fnmatchcase(name, pat) for pat in INTERNAL_IFACE_PATTERNS)
        for entry in entries:
            if entry.family not in (socket.AF_INET, socket.AF_INET6):
                continue
            try:
                ip = ipaddress.ip_address(entry.address.split("%", 1)[0])
            except ValueError:
                continue
            local.add(ip)
            if entry.broadcast:
                try:
                    broadcast.add(ipaddress.ip_address(entry.broadcast))
                except ValueError:
                    pass
            if ip.is_loopback or ip.is_link_local:
                continue
            net = _network(ip, entry.netmask)
            if net.prefixlen == 0:
                continue
            if is_internal:
                internal.append(net)
            elif name == lan_iface:
                lan.append(net)
            elif name == zt_iface:
                zerotier.append(net)
    return HostNets(
        local=frozenset(local), broadcast=frozenset(broadcast),
        internal=tuple(internal), lan=tuple(lan), zerotier=tuple(zerotier),
    )


def _in_any(ip, nets) -> bool:
    return any(ip in net for net in nets)


def _role(ip, nets: HostNets) -> str:
    if (
        ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified
        or ip == _LIMITED_BROADCAST or ip in nets.broadcast
    ):
        return "drop"
    if ip in nets.local:
        return "local"
    if _in_any(ip, nets.internal):
        return "internal"
    return "remote"


def classify(flow: Flow, nets: HostNets):
    """Return ("in" | "out", peer address), or None when the flow is not a peer flow."""
    src, dst = _role(flow.src, nets), _role(flow.dst, nets)
    if src == "remote" and dst in ("local", "internal"):
        return "in", flow.src
    if src in ("local", "internal") and dst == "remote":
        return "out", flow.dst
    return None


def net_type(ip, nets: HostNets) -> str:
    if _in_any(ip, nets.zerotier):
        return "zerotier"
    if _in_any(ip, TAILSCALE_NETS):
        return "tailscale"
    if _in_any(ip, nets.lan) or _in_any(ip, PRIVATE_NETS):
        return "lan"
    return "wan"


def _is_public(ip) -> bool:
    return not (
        ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified
        or _in_any(ip, PRIVATE_NETS) or _in_any(ip, TAILSCALE_NETS)
    )


# ─── Aggregation ─────────────────────────────────────────────────────────────

@dataclass
class Peer:
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address
    net: str
    flows_in: int = 0
    flows_out: int = 0
    ports: set = field(default_factory=set)           # original destination ports
    inbound_ports: set = field(default_factory=set)   # ports of this host the peer reached
    bytes_in: int = 0                                 # toward this host
    bytes_out: int = 0
    counted: bool = False                             # at least one flow carried counters

    @property
    def flows(self) -> int:
        return self.flows_in + self.flows_out

    @property
    def direction(self) -> str:
        if self.flows_in and self.flows_out:
            return "both"
        return "in" if self.flows_in else "out"


def aggregate(flows: list[Flow], nets: HostNets) -> tuple[dict, bool]:
    """Group flows by peer. Returns (peers by address, accounting enabled)."""
    peers: dict = {}
    accounting = False
    for flow in flows:
        if flow.bytes_orig is not None:
            accounting = True
        verdict = classify(flow, nets)
        if verdict is None:
            continue
        direction, ip = verdict
        peer = peers.get(ip)
        if peer is None:
            peer = peers[ip] = Peer(ip=ip, net=net_type(ip, nets))
        peer.ports.add(flow.dport)
        if direction == "in":
            peer.flows_in += 1
            peer.inbound_ports.add(flow.dport)
        else:
            peer.flows_out += 1
        if flow.bytes_orig is not None:
            peer.counted = True
            if direction == "in":
                peer.bytes_in += flow.bytes_orig
                peer.bytes_out += flow.bytes_reply
            else:
                peer.bytes_out += flow.bytes_orig
                peer.bytes_in += flow.bytes_reply
    return peers, accounting


def rank(peers, accounting: bool) -> list[Peer]:
    """Busiest first: by bytes with accounting, by flows without. Stable across polls."""
    def key(peer: Peer):
        volume = peer.bytes_in + peer.bytes_out if accounting else 0
        return (-volume, -peer.flows, peer.ip.version, int(peer.ip))
    return sorted(peers, key=key)


# ─── Tailscale ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TailscalePeer:
    name: str
    endpoint: ipaddress.IPv4Address | ipaddress.IPv6Address | None   # direct path in use
    relayed: bool


def _endpoint_ip(addr: str):
    """"203.0.113.7:41641" or "[2001:db8::7]:41641" -> address, else None."""
    if not isinstance(addr, str) or ":" not in addr:
        return None
    host = addr.rsplit(":", 1)[0].strip("[]")
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def parse_tailscale_status(status: dict) -> dict:
    """Index ipnstate.Status peers by Tailscale address.

    Fields (tailscale.com/ipn/ipnstate PeerStatus): HostName, DNSName,
    TailscaleIPs, CurAddr (direct endpoint, empty when not direct), Relay
    (DERP region) and PeerRelay. `tailscale status` reports a peer as direct
    when CurAddr is set, and as relayed otherwise.
    """
    peers: dict = {}
    raw_peers = status.get("Peer") if isinstance(status, dict) else None
    if not isinstance(raw_peers, dict):
        return peers
    for raw in raw_peers.values():
        if not isinstance(raw, dict):
            continue
        name = raw.get("HostName") or str(raw.get("DNSName") or "").split(".")[0]
        endpoint = _endpoint_ip(raw.get("CurAddr") or "")
        relayed = endpoint is None and bool(raw.get("PeerRelay") or raw.get("Relay"))
        info = TailscalePeer(name=str(name or ""), endpoint=endpoint, relayed=relayed)
        for ip_text in raw.get("TailscaleIPs") or []:
            try:
                peers[ipaddress.ip_address(ip_text)] = info
            except ValueError:
                continue
    return peers


def fetch_tailscale_status() -> dict:
    """GET /localapi/v0/status from tailscaled's unix socket. {} when unavailable.

    tailscaled rejects LocalAPI requests that carry an Origin or Referer header
    or a Host other than "local-tailscaled.sock".
    """
    sock = system.host_root() / "run" / "tailscale" / "tailscaled.sock"
    try:
        if not sock.exists():
            return {}
        transport = httpx.HTTPTransport(uds=str(sock))
        with httpx.Client(
            transport=transport, base_url="http://local-tailscaled.sock", timeout=2,
        ) as client:
            response = client.get("/localapi/v0/status")
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.debug("Tailscale LocalAPI unavailable: %s", exc)
        return {}
    return data if isinstance(data, dict) else {}


# ─── Response ────────────────────────────────────────────────────────────────

def _located(result, source: str):
    """Turn a GeoLocator result into (geo, unlocated_reason)."""
    if isinstance(result, dict):
        return {**result, "source": source}, None
    return None, result or geo.PENDING


def build_response(
    flows: list[Flow],
    nets: HostNets,
    *,
    server_location: tuple[float, float] = (0.0, 0.0),
    port_names: dict | None = None,
    tailscale: dict | None = None,
    locator: geo.GeoLocator | None = None,
    limit: int = MAX_PEERS,
) -> dict:
    port_names = port_names or {}
    tailscale = tailscale or {}
    peers, accounting = aggregate(flows, nets)
    ranked = rank(peers.values(), accounting)
    shown = ranked[:limit]

    def direct_endpoint(peer: Peer):
        info = tailscale.get(peer.ip)
        if info and info.endpoint is not None and _is_public(info.endpoint):
            return info.endpoint
        return None

    # Addresses worth geolocating, busiest peer first.
    lookups: list[str] = []
    for peer in shown:
        if peer.net == "wan":
            lookups.append(str(peer.ip))
        elif peer.net == "tailscale" and (endpoint := direct_endpoint(peer)) is not None:
            lookups.append(str(endpoint))
    located = locator.resolve(lookups) if (locator and lookups) else {}

    lat, lng = server_location
    has_site = bool(lat or lng)

    out: list[dict] = []
    for peer in shown:
        name, place, reason = "", None, None
        if peer.net == "wan":
            place, reason = _located(located.get(str(peer.ip)), "ip-api")
        elif peer.net == "lan":
            if has_site:
                place = {"lat": lat, "lng": lng, "city": "", "country": "", "source": "server-site"}
            else:
                reason = REASON_NO_SERVER_LOCATION
        elif peer.net == "tailscale":
            info = tailscale.get(peer.ip)
            name = info.name if info else ""
            endpoint = direct_endpoint(peer)
            if endpoint is not None:
                place, reason = _located(located.get(str(endpoint)), "tailscale-endpoint")
            elif info and info.relayed:
                reason = REASON_RELAYED
            else:
                reason = REASON_PRIVATE
        else:
            # ZeroTier: no verified mapping from a managed IP to a physical endpoint.
            reason = REASON_PRIVATE

        out.append({
            "ip": str(peer.ip),
            "net": peer.net,
            "name": name,
            "direction": peer.direction,
            "flows": peer.flows,
            "ports": sorted(peer.ports),
            "services": sorted({port_names[p] for p in peer.inbound_ports if p in port_names}),
            "bytes_in": peer.bytes_in if peer.counted else None,
            "bytes_out": peer.bytes_out if peer.counted else None,
            "geo": place,
            "unlocated_reason": reason,
        })

    return {
        "accounting": accounting,
        "truncated": len(ranked) > limit,
        "total_peers": len(ranked),
        "peers": out,
    }


_locator = geo.GeoLocator()
_tailscale = services.TTLCache(
    TAILSCALE_TTL, lambda: parse_tailscale_status(fetch_tailscale_status()),
)


def get_network() -> dict:
    """Everything behind GET /api/network. Blocking: run it off the event loop."""
    nets = host_nets(psutil.net_if_addrs(), system.lan_iface(), system.zt_iface())
    flows = read_flows()
    try:
        names = services.port_names(services.load_services())
    except Exception as exc:
        logger.debug("service names unavailable: %s", exc)
        names = {}
    return build_response(
        flows, nets,
        server_location=system.server_location(),
        port_names=names,
        tailscale=_tailscale.get(),
        locator=_locator,
    )
