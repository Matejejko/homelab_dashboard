import ipaddress

import pytest

from app import geo, network

from .conftest import HOST_ADDRS, LAN_IFACE, ZT_IFACE, FakeApi, read_fixture

ip = ipaddress.ip_address


def by_ip(response):
    return {peer["ip"]: peer for peer in response["peers"]}


def flow(src, dst, dport=443, sport=40000, proto="tcp", bytes_orig=None, bytes_reply=None):
    return network.Flow(proto, ip(src), ip(dst), sport, dport, bytes_orig, bytes_reply)


class FakeLocator:
    """Stands in for geo.GeoLocator: answers from a table, records what was asked."""

    def __init__(self, table=None):
        self.table = table or {}
        self.asked = []

    def resolve(self, ips):
        self.asked.append(list(ips))
        return {address: self.table.get(address, geo.PENDING) for address in ips}


# ─── Parsing ─────────────────────────────────────────────────────────────────

def test_parses_tcp_ipv4_with_counters():
    parsed = network.parse_line(
        "tcp      6 431997 ESTABLISHED src=203.0.113.9 dst=192.0.2.10 sport=51000 dport=30300 "
        "packets=120 bytes=9000 src=10.42.0.15 dst=10.42.0.1 sport=3000 dport=38412 "
        "packets=110 bytes=250000 [ASSURED] mark=0 use=1"
    )
    assert parsed == network.Flow("tcp", ip("203.0.113.9"), ip("192.0.2.10"), 51000, 30300, 9000, 250000)


def test_parses_udp_ipv4_only_when_assured():
    assured = network.parse_line(
        "udp      17 170 src=192.0.2.10 dst=192.0.2.1 sport=45000 dport=53 packets=4 bytes=280 "
        "src=192.0.2.1 dst=192.0.2.10 sport=53 dport=45000 packets=4 bytes=600 [ASSURED] mark=0 use=1"
    )
    assert assured == network.Flow("udp", ip("192.0.2.10"), ip("192.0.2.1"), 45000, 53, 280, 600)

    unreplied = (
        "udp      17 25 src=192.0.2.10 dst=203.0.113.53 sport=45001 dport=53 packets=1 bytes=70 "
        "[UNREPLIED] src=203.0.113.53 dst=192.0.2.10 sport=53 dport=45001 packets=0 bytes=0 mark=0 use=1"
    )
    replied_not_assured = (
        "udp      17 25 src=203.0.113.54 dst=192.0.2.10 sport=45002 dport=51820 packets=3 bytes=300 "
        "src=192.0.2.10 dst=203.0.113.54 sport=51820 dport=45002 packets=2 bytes=200 mark=0 use=1"
    )
    assert network.parse_line(unreplied) is None
    assert network.parse_line(replied_not_assured) is None


def test_parses_tcp_and_udp_ipv6(flows_v6):
    tcp = [f for f in flows_v6 if f.proto == "tcp" and f.src == ip("2001:db8:ffff::9")]
    udp = [f for f in flows_v6 if f.proto == "udp" and f.dst == ip("2001:db8:ffff::53")]
    assert tcp == [network.Flow("tcp", ip("2001:db8:ffff::9"), ip("2001:db8:a::10"), 51000, 30300, 2000, 7000)]
    assert udp == [network.Flow("udp", ip("2001:db8:a::10"), ip("2001:db8:ffff::53"), 45000, 53, 200, 400)]


def test_tcp_must_be_established(flows_v4):
    seen = {f.src for f in flows_v4} | {f.dst for f in flows_v4}
    assert ip("203.0.113.77") not in seen    # SYN_SENT
    assert ip("203.0.113.78") not in seen    # TIME_WAIT


def test_parses_without_byte_counters(flows_noacct):
    assert len(flows_noacct) == 7            # the UNREPLIED UDP line is dropped
    assert {f.proto for f in flows_noacct} == {"tcp", "udp"}
    assert {f.src.version for f in flows_noacct} == {4, 6}
    assert all(f.bytes_orig is None and f.bytes_reply is None for f in flows_noacct)


def test_parses_proc_nf_conntrack_format():
    flows = network.parse_conntrack(read_fixture("proc_nf_conntrack.txt"))
    assert flows == [
        network.Flow("tcp", ip("203.0.113.9"), ip("192.0.2.10"), 51000, 30300, 9000, 250000),
        network.Flow("udp", ip("2001:db8:a::10"), ip("2001:db8:ffff::53"), 45000, 53, 200, 400),
        network.Flow("tcp", ip("2001:db8:ffff::9"), ip("2001:db8:a::10"), 51000, 30300, 2000, 7000),
    ]


@pytest.mark.parametrize("line", [
    "",
    "conntrack v1.4.8 (conntrack-tools): 12 flow entries have been shown.",
    "icmp     1 29 src=203.0.113.9 dst=192.0.2.10 type=8 code=0 id=1 src=192.0.2.10 dst=203.0.113.9 type=0 code=0 id=1 mark=0 use=1",
    "tcp      6 431999 ESTABLISHED src=not-an-ip dst=192.0.2.10 sport=1 dport=2 src=192.0.2.10 dst=203.0.113.9 sport=2 dport=1 [ASSURED]",
    "tcp      6 431999 ESTABLISHED src=203.0.113.9 dst=192.0.2.10 sport=x dport=2 [ASSURED]",
    "tcp      6 431999 ESTABLISHED src=203.0.113.9 dst=192.0.2.10 [ASSURED]",
])
def test_ignores_unusable_lines(line):
    assert network.parse_line(line) is None


def test_read_flows_falls_back_to_proc(monkeypatch, tmp_path):
    (tmp_path / "net").mkdir()
    (tmp_path / "net" / "nf_conntrack").write_text(read_fixture("proc_nf_conntrack.txt"))
    monkeypatch.setenv("HOST_PROC", str(tmp_path))
    monkeypatch.setattr(network, "_run_conntrack", lambda family: None)
    assert len(network.read_flows()) == 3


def test_read_flows_reads_both_families_from_cli(monkeypatch):
    asked = []

    def fake(family):
        asked.append(family)
        name = "conntrack_v4_acct.txt" if family == "ipv4" else "conntrack_v6_acct.txt"
        return read_fixture(name)

    monkeypatch.setattr(network, "_run_conntrack", fake)
    flows = network.read_flows()
    assert asked == ["ipv4", "ipv6"]
    assert {f.src.version for f in flows} == {4, 6}


# ─── Host description ────────────────────────────────────────────────────────

def test_host_nets_from_interfaces(nets):
    assert ip("192.0.2.10") in nets.local
    assert ip("fe80::1") in nets.local                       # scope id stripped
    assert ip("192.0.2.255") in nets.broadcast
    assert set(nets.lan) == {ipaddress.ip_network("192.0.2.0/24"), ipaddress.ip_network("2001:db8:a::/64")}
    assert nets.zerotier == (ipaddress.ip_network("198.51.100.0/25"),)
    internal = set(nets.internal)
    assert ipaddress.ip_network("10.42.0.0/16") in internal   # pods
    assert ipaddress.ip_network("10.43.0.0/16") in internal   # services
    assert ipaddress.ip_network("198.51.100.128/26") in internal   # docker0
    assert ipaddress.ip_network("198.51.100.192/26") in internal   # br-*
    assert ipaddress.ip_network("2001:db8:d::/64") in internal     # br-* IPv6
    assert ipaddress.ip_network("10.42.0.0/24") in internal        # cni0


# ─── Classification ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("src, dst, expected", [
    # remote -> local / internal: inbound, the peer is the source
    ("203.0.113.9", "192.0.2.10", ("in", "203.0.113.9")),
    ("203.0.113.9", "10.42.0.15", ("in", "203.0.113.9")),
    ("192.0.2.50", "198.51.100.130", ("in", "192.0.2.50")),
    ("2001:db8:ffff::9", "2001:db8:a::10", ("in", "2001:db8:ffff::9")),
    # local / internal -> remote: outbound, the peer is the destination
    ("192.0.2.10", "203.0.113.9", ("out", "203.0.113.9")),
    ("10.42.0.20", "203.0.113.201", ("out", "203.0.113.201")),
    ("198.51.100.130", "203.0.113.200", ("out", "203.0.113.200")),
    ("2001:db8:d::2", "2001:db8:ffff::200", ("out", "2001:db8:ffff::200")),
    # everything else is dropped
    ("192.0.2.10", "192.0.2.10", None),                 # local -> local
    ("192.0.2.10", "100.64.0.1", None),                 # local -> local (other interface)
    ("192.0.2.10", "198.51.100.130", None),             # local -> container
    ("10.42.0.15", "10.42.0.16", None),                 # pod -> pod
    ("10.42.0.15", "10.43.0.1", None),                  # pod -> service
    ("198.51.100.130", "198.51.100.194", None),         # container -> container
    ("203.0.113.99", "203.0.113.100", None),            # remote -> remote
    ("127.0.0.1", "127.0.0.1", None),                   # loopback
    ("::1", "::1", None),
    ("192.0.2.10", "169.254.169.254", None),            # link-local
    ("fe80::aa", "fe80::1", None),
    ("192.0.2.10", "224.0.0.251", None),                # multicast
    ("2001:db8:a::10", "ff02::fb", None),
    ("192.0.2.10", "192.0.2.255", None),                # subnet broadcast
    ("192.0.2.10", "255.255.255.255", None),            # limited broadcast
    ("0.0.0.0", "192.0.2.10", None),                    # unspecified
])
def test_classify_uses_the_original_tuple(nets, src, dst, expected):
    verdict = network.classify(flow(src, dst), nets)
    assert verdict == (expected and (expected[0], ip(expected[1])))


@pytest.mark.parametrize("address, expected", [
    ("198.51.100.20", "zerotier"),          # subnet of the ZeroTier interface
    ("100.64.0.5", "tailscale"),            # 100.64.0.0/10
    ("100.127.255.254", "tailscale"),
    ("fd7a:115c:a1e0::5", "tailscale"),
    ("192.0.2.50", "lan"),                  # subnet of the LAN interface
    ("2001:db8:a::50", "lan"),
    ("10.9.8.7", "lan"),                    # any other private range
    ("172.16.5.5", "lan"),
    ("192.168.77.3", "lan"),
    ("fd00:1::5", "lan"),
    ("203.0.113.9", "wan"),
    ("2001:db8:ffff::9", "wan"),
    ("100.128.0.1", "wan"),                 # just outside the Tailscale range
])
def test_net_type(nets, address, expected):
    assert network.net_type(ip(address), nets) == expected


def test_zerotier_range_comes_from_the_interface_not_a_constant():
    other = network.host_nets(HOST_ADDRS, LAN_IFACE, "")      # no ZeroTier interface configured
    assert network.net_type(ip("198.51.100.20"), other) == "wan"
    assert network.net_type(ip("10.147.17.5"), other) == "lan"   # the old hard-coded range


# ─── Aggregation and response ────────────────────────────────────────────────

def test_response_shape_and_ipv4_peers(flows_v4, nets):
    response = network.build_response(flows_v4, nets, server_location=(48.9, 20.5))
    assert set(response) == {"accounting", "truncated", "total_peers", "peers"}
    assert response["accounting"] is True
    assert response["truncated"] is False
    assert response["total_peers"] == len(response["peers"]) == 8

    peers = by_ip(response)
    assert set(peers) == {
        "203.0.113.9", "192.0.2.50", "192.0.2.1", "100.64.0.5",
        "198.51.100.20", "203.0.113.200", "203.0.113.201", "10.9.8.7",
    }
    for peer in peers.values():
        assert set(peer) == {
            "ip", "net", "name", "direction", "flows", "ports", "services",
            "bytes_in", "bytes_out", "geo", "unlocated_reason",
        }

    wan = peers["203.0.113.9"]
    assert wan["net"] == "wan"
    assert wan["direction"] == "both"
    assert wan["flows"] == 3                    # flows, not distinct ports
    assert wan["ports"] == [443, 30300]
    assert wan["bytes_in"] == 9000 + 1000 + 3300      # toward the server
    assert wan["bytes_out"] == 250000 + 5000 + 700

    assert peers["192.0.2.50"]["direction"] == "in"
    assert (peers["192.0.2.50"]["bytes_in"], peers["192.0.2.50"]["bytes_out"]) == (4000, 800000)
    assert peers["192.0.2.1"]["direction"] == "out"       # UDP, outbound
    assert (peers["192.0.2.1"]["bytes_in"], peers["192.0.2.1"]["bytes_out"]) == (600, 280)
    assert peers["203.0.113.200"]["direction"] == "out"   # reached from a Docker container
    assert peers["203.0.113.201"]["direction"] == "out"   # reached from a pod

    assert {p["net"] for p in peers.values()} == {"wan", "lan", "tailscale", "zerotier"}


def test_docker_and_pod_addresses_are_never_peers(flows_v4, flows_v6, nets):
    response = network.build_response(flows_v4 + flows_v6, nets)
    for address in by_ip(response):
        parsed = ip(address)
        assert not any(parsed in net for net in nets.internal), address
        assert parsed not in nets.local, address


def test_ipv6_peers(flows_v6, nets):
    peers = by_ip(network.build_response(flows_v6, nets, server_location=(48.9, 20.5)))
    assert set(peers) == {
        "2001:db8:ffff::9", "2001:db8:ffff::53", "2001:db8:a::50",
        "fd7a:115c:a1e0::5", "fd00:1::5", "2001:db8:ffff::200",
    }
    assert peers["2001:db8:ffff::9"]["net"] == "wan"
    assert peers["2001:db8:ffff::9"]["direction"] == "in"
    assert peers["2001:db8:ffff::53"]["direction"] == "out"
    assert peers["2001:db8:a::50"]["net"] == "lan"
    assert peers["fd00:1::5"]["net"] == "lan"
    assert peers["fd7a:115c:a1e0::5"]["net"] == "tailscale"
    assert peers["2001:db8:ffff::200"]["direction"] == "out"


def test_without_accounting_bytes_are_null_and_rank_is_by_flows(flows_noacct, nets):
    response = network.build_response(flows_noacct, nets)
    assert response["accounting"] is False
    assert all(p["bytes_in"] is None and p["bytes_out"] is None for p in response["peers"])
    assert response["peers"][0]["ip"] == "203.0.113.9"      # three flows
    assert response["peers"][0]["flows"] == 3
    assert response["peers"][0]["ports"] == [8096, 30300]


def test_rank_is_by_bytes_with_accounting(nets):
    flows = [
        flow("203.0.113.1", "192.0.2.10", bytes_orig=10, bytes_reply=10),
        flow("203.0.113.1", "192.0.2.10", sport=40001, bytes_orig=10, bytes_reply=10),
        flow("203.0.113.1", "192.0.2.10", sport=40002, bytes_orig=10, bytes_reply=10),
        flow("203.0.113.2", "192.0.2.10", bytes_orig=5000, bytes_reply=5000),
    ]
    response = network.build_response(flows, nets)
    assert [p["ip"] for p in response["peers"]] == ["203.0.113.2", "203.0.113.1"]


def test_peer_without_counters_is_null_even_when_accounting_is_on(nets):
    flows = [
        flow("203.0.113.1", "192.0.2.10", bytes_orig=100, bytes_reply=200),
        flow("203.0.113.2", "192.0.2.10"),     # predates nf_conntrack_acct=1
    ]
    response = network.build_response(flows, nets)
    peers = by_ip(response)
    assert response["accounting"] is True
    assert peers["203.0.113.1"]["bytes_in"] == 100
    assert peers["203.0.113.2"]["bytes_in"] is None and peers["203.0.113.2"]["bytes_out"] is None


def test_truncates_to_200_ranked_peers(nets):
    flows = [
        flow(f"203.0.113.{i % 250 + 1}" if i < 250 else f"2001:db8:ffff::{i:x}", "192.0.2.10",
             bytes_orig=i, bytes_reply=0)
        for i in range(260)
    ]
    response = network.build_response(flows, nets)
    assert response["total_peers"] == 260
    assert response["truncated"] is True
    assert len(response["peers"]) == 200
    volumes = [p["bytes_in"] for p in response["peers"]]
    assert volumes == sorted(volumes, reverse=True)
    assert volumes[0] == 259 and volumes[-1] == 60


def test_identical_input_gives_identical_output(flows_v4, flows_v6, nets):
    first = network.build_response(flows_v4 + flows_v6, nets, server_location=(48.9, 20.5))
    second = network.build_response(list(reversed(flows_v4 + flows_v6)), nets, server_location=(48.9, 20.5))
    assert first == second


def test_services_are_named_for_inbound_ports_only(nets):
    flows = [
        flow("192.0.2.50", "192.0.2.10", dport=8096),       # reaches Jellyfin here
        flow("192.0.2.10", "203.0.113.9", dport=8096),      # this host calling out to :8096
    ]
    peers = by_ip(network.build_response(flows, nets, port_names={8096: "Jellyfin"}))
    assert peers["192.0.2.50"]["services"] == ["Jellyfin"]
    assert peers["203.0.113.9"]["services"] == []


# ─── Locations ───────────────────────────────────────────────────────────────

def test_lan_peers_sit_at_the_server_site(flows_v4, nets):
    peers = by_ip(network.build_response(flows_v4, nets, server_location=(48.946, 20.566)))
    assert peers["192.0.2.50"]["geo"] == {
        "lat": 48.946, "lng": 20.566, "city": "", "country": "", "source": "server-site",
    }
    assert peers["192.0.2.50"]["unlocated_reason"] is None


def test_lan_peers_without_a_server_location_are_unlocated(flows_v4, nets):
    peers = by_ip(network.build_response(flows_v4, nets, server_location=(0.0, 0.0)))
    assert peers["192.0.2.50"]["geo"] is None
    assert peers["192.0.2.50"]["unlocated_reason"] == "no_server_location"


def test_wan_peers_are_pending_until_resolved(flows_v4, nets):
    locator = FakeLocator()
    peers = by_ip(network.build_response(flows_v4, nets, locator=locator))
    assert peers["203.0.113.9"]["geo"] is None
    assert peers["203.0.113.9"]["unlocated_reason"] == "pending"

    locator.table["203.0.113.9"] = {"lat": 52.52, "lng": 13.4, "city": "Berlin", "country": "Germany"}
    locator.table["203.0.113.200"] = geo.FAILED
    peers = by_ip(network.build_response(flows_v4, nets, locator=locator))
    assert peers["203.0.113.9"]["geo"] == {
        "lat": 52.52, "lng": 13.4, "city": "Berlin", "country": "Germany", "source": "ip-api",
    }
    assert peers["203.0.113.9"]["unlocated_reason"] is None
    assert peers["203.0.113.200"]["geo"] is None
    assert peers["203.0.113.200"]["unlocated_reason"] == "lookup_failed"


def test_only_wan_addresses_are_sent_for_geolocation_busiest_first(flows_v4, nets):
    locator = FakeLocator()
    network.build_response(flows_v4, nets, locator=locator)
    assert locator.asked == [["203.0.113.9", "203.0.113.200", "203.0.113.201"]]


def test_zerotier_peers_are_never_placed(flows_v4, nets):
    peer = by_ip(network.build_response(flows_v4, nets, server_location=(48.9, 20.5)))["198.51.100.20"]
    assert peer["net"] == "zerotier"
    assert peer["geo"] is None
    assert peer["unlocated_reason"] == "private"


# ─── Tailscale ───────────────────────────────────────────────────────────────

TAILSCALE_STATUS = {
    "BackendState": "Running",
    "Self": {"HostName": "homelab", "TailscaleIPs": ["100.64.0.1", "fd7a:115c:a1e0::1"]},
    "Peer": {
        "nodekey:aaaa": {
            "HostName": "laptop", "DNSName": "laptop.example-tailnet.ts.net.",
            "TailscaleIPs": ["100.64.0.5", "fd7a:115c:a1e0::5"],
            "CurAddr": "203.0.113.7:41641", "Relay": "fra", "PeerRelay": "",
        },
        "nodekey:bbbb": {
            "HostName": "phone", "DNSName": "phone.example-tailnet.ts.net.",
            "TailscaleIPs": ["100.64.0.6"],
            "CurAddr": "", "Relay": "fra", "PeerRelay": "",
        },
        "nodekey:cccc": {
            "HostName": "", "DNSName": "nas.example-tailnet.ts.net.",
            "TailscaleIPs": ["100.64.0.7"],
            "CurAddr": "[2001:db8:ffff::7]:41641", "Relay": "fra",
        },
        "nodekey:dddd": {
            "HostName": "desk", "TailscaleIPs": ["100.64.0.8"],
            "CurAddr": "192.168.1.20:41641", "Relay": "fra",
        },
        "nodekey:eeee": {
            "HostName": "tablet", "TailscaleIPs": ["100.64.0.9"],
            "CurAddr": "", "Relay": "", "PeerRelay": "203.0.113.50:40000:7",
        },
        "nodekey:ffff": {       # Android reports itself as "localhost"
            "HostName": "localhost", "DNSName": "pixel-8.example-tailnet.ts.net.",
            "TailscaleIPs": ["100.64.0.11"],
            "CurAddr": "203.0.113.11:41641", "Relay": "fra",
        },
    },
}


def test_parse_tailscale_status():
    peers = network.parse_tailscale_status(TAILSCALE_STATUS)
    assert peers[ip("100.64.0.5")] == network.TailscalePeer("laptop", ip("203.0.113.7"), False)
    assert peers[ip("fd7a:115c:a1e0::5")].name == "laptop"
    assert peers[ip("100.64.0.6")] == network.TailscalePeer("phone", None, True)
    assert peers[ip("100.64.0.7")] == network.TailscalePeer("nas", ip("2001:db8:ffff::7"), False)
    assert peers[ip("100.64.0.9")] == network.TailscalePeer("tablet", None, True)
    assert network.parse_tailscale_status({}) == {}
    assert network.parse_tailscale_status({"Peer": None}) == {}


def test_tailscale_name_is_the_magicdns_label_not_the_device_hostname():
    peers = network.parse_tailscale_status(TAILSCALE_STATUS)
    assert peers[ip("100.64.0.11")].name == "pixel-8"       # not "localhost"
    assert peers[ip("100.64.0.8")].name == "desk"            # no DNSName: HostName


@pytest.mark.parametrize("raw, expected", [
    ({"DNSName": "nas.example-tailnet.ts.net.", "HostName": "DS920"}, "nas"),
    ({"DNSName": "", "HostName": "desk"}, "desk"),
    ({"HostName": "desk"}, "desk"),
    ({"DNSName": None, "HostName": None}, ""),
    ({"DNSName": 7, "HostName": ["x"]}, ""),
    ({}, ""),
])
def test_tailscale_name_fallbacks(raw, expected):
    assert network._tailscale_name(raw) == expected


def test_tailscale_peers_get_names_and_endpoint_locations(nets):
    flows = [flow(f"100.64.0.{n}", "100.64.0.1", dport=22) for n in (5, 6, 7, 8, 9, 10)]
    locator = FakeLocator({
        "203.0.113.7": {"lat": 50.08, "lng": 14.43, "city": "Prague", "country": "Czechia"},
    })
    response = network.build_response(
        flows, nets, server_location=(48.9, 20.5),
        tailscale=network.parse_tailscale_status(TAILSCALE_STATUS), locator=locator,
    )
    peers = by_ip(response)

    direct = peers["100.64.0.5"]
    assert direct["name"] == "laptop"
    assert direct["geo"] == {
        "lat": 50.08, "lng": 14.43, "city": "Prague", "country": "Czechia",
        "source": "tailscale-endpoint",
    }
    assert direct["unlocated_reason"] is None

    assert peers["100.64.0.6"]["name"] == "phone"
    assert peers["100.64.0.6"]["geo"] is None
    assert peers["100.64.0.6"]["unlocated_reason"] == "relayed"       # DERP
    assert peers["100.64.0.9"]["unlocated_reason"] == "relayed"       # peer relay

    assert peers["100.64.0.7"]["name"] == "nas"
    assert peers["100.64.0.7"]["unlocated_reason"] == "pending"       # endpoint not resolved yet

    assert peers["100.64.0.8"]["unlocated_reason"] == "private"       # direct, but over a private address
    assert peers["100.64.0.10"]["name"] == ""                          # unknown to tailscaled
    assert peers["100.64.0.10"]["unlocated_reason"] == "private"

    # The endpoint is what gets geolocated, never the 100.64.x.x address.
    assert locator.asked == [["203.0.113.7", "2001:db8:ffff::7"]]


def test_tailscale_without_localapi_is_unlocated_not_guessed(flows_v4, nets):
    peer = by_ip(network.build_response(flows_v4, nets, server_location=(48.9, 20.5)))["100.64.0.5"]
    assert peer["name"] == ""
    assert peer["geo"] is None
    assert peer["unlocated_reason"] == "private"


def test_missing_tailscale_socket_is_skipped_silently(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("HOST_ROOT", str(tmp_path))
    with caplog.at_level("INFO"):
        assert network.fetch_tailscale_status() == {}
    assert caplog.records == []


# ─── The real GeoLocator behind build_response ───────────────────────────────
# FakeLocator cannot notice a locator that is never called. These use the real
# class from an empty cache (the state after every restart) and fake only HTTP.

def test_the_first_poll_geolocates_with_the_real_locator(flows_v4, nets):
    api = FakeApi()
    locator = geo.GeoLocator(fetch=api)
    assert locator.cache_size() == 0

    peers = by_ip(network.build_response(flows_v4, nets, locator=locator))
    assert api.calls == [["203.0.113.9", "203.0.113.200", "203.0.113.201"]]
    assert peers["203.0.113.9"]["geo"] == {
        "lat": 50.0, "lng": 14.0, "city": "Prague", "country": "Czechia", "source": "ip-api",
    }
    assert peers["203.0.113.9"]["unlocated_reason"] is None

    # The next poll is answered from the cache.
    peers = by_ip(network.build_response(flows_v4, nets, locator=locator))
    assert len(api.calls) == 1
    assert peers["203.0.113.200"]["geo"]["source"] == "ip-api"


def test_a_tailscale_endpoint_is_geolocated_with_the_real_locator(nets):
    api = FakeApi()
    response = network.build_response(
        [flow("100.64.0.5", "100.64.0.1", dport=22)], nets,
        tailscale=network.parse_tailscale_status(TAILSCALE_STATUS),
        locator=geo.GeoLocator(fetch=api),
    )
    assert api.calls == [["203.0.113.7"]]
    assert by_ip(response)["100.64.0.5"]["geo"] == {
        "lat": 50.0, "lng": 14.0, "city": "Prague", "country": "Czechia",
        "source": "tailscale-endpoint",
    }


def test_no_locator_means_no_lookup_and_pending(flows_v4, nets):
    peers = by_ip(network.build_response(flows_v4, nets, locator=None))
    assert peers["203.0.113.9"]["geo"] is None
    assert peers["203.0.113.9"]["unlocated_reason"] == "pending"


# ─── End to end through get_network() ────────────────────────────────────────

@pytest.fixture
def wired_host(monkeypatch):
    monkeypatch.setenv("DASHBOARD_LAN_IFACE", LAN_IFACE)
    monkeypatch.setenv("DASHBOARD_ZT_IFACE", ZT_IFACE)
    monkeypatch.setenv("DASHBOARD_SERVER_LAT", "48.946")
    monkeypatch.setenv("DASHBOARD_SERVER_LNG", "20.566")
    monkeypatch.setattr(network.psutil, "net_if_addrs", lambda: HOST_ADDRS)
    monkeypatch.setattr(
        network, "_run_conntrack",
        lambda family: read_fixture("conntrack_v4_acct.txt" if family == "ipv4" else "conntrack_v6_acct.txt"),
    )
    monkeypatch.setattr(network.services, "load_services", lambda: [{"name": "Jellyfin", "port": 8096}])
    monkeypatch.setattr(network, "_tailscale", network.services.TTLCache(
        0, lambda: network.parse_tailscale_status(TAILSCALE_STATUS)))


def test_get_network_wires_everything(monkeypatch, wired_host):
    monkeypatch.setattr(network, "_locator", FakeLocator())

    response = network.get_network()
    peers = by_ip(response)
    assert response["total_peers"] == 14
    assert peers["192.0.2.50"]["services"] == ["Jellyfin"]
    assert peers["192.0.2.50"]["geo"]["source"] == "server-site"
    assert peers["198.51.100.20"]["net"] == "zerotier"
    assert peers["100.64.0.5"]["name"] == "laptop"
    assert peers["203.0.113.9"]["unlocated_reason"] == "pending"


def test_the_locator_in_production_is_the_real_one():
    assert type(network._locator) is geo.GeoLocator
    assert network._locator._fetch is geo._http_fetch


def test_get_network_geolocates_from_a_cold_start(monkeypatch, wired_host):
    # Same object get_network() uses in production, minus the HTTP call.
    api = FakeApi()
    monkeypatch.setattr(network, "_locator", geo.GeoLocator(fetch=api))

    peers = by_ip(network.get_network())
    assert len(api.calls) == 1
    assert "203.0.113.9" in api.calls[0] and "203.0.113.7" in api.calls[0]
    assert not any(address.startswith(("100.", "192.0.2.", "198.51.100.", "10.")) for address in api.calls[0])
    assert peers["203.0.113.9"]["geo"]["source"] == "ip-api"
    assert peers["203.0.113.9"]["unlocated_reason"] is None
    assert peers["100.64.0.5"]["geo"]["source"] == "tailscale-endpoint"
