"""
Homelab Dashboard — Backend API (k3s edition)
Reads host system stats via mounted /proc and /sys volumes.
Services are auto-discovered from:
  1. Kubernetes Services (NodePort, LoadBalancer, Ingress-backed)
  2. Docker containers with published ports
  3. ConfigMap / services.json (manual additions)
"""

import ipaddress
import json
import logging
import os
import socket
import time
import asyncio
from pathlib import Path

import psutil
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Homelab Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Path config ──────────────────────────────────────────────────────────────
HOST_PROC = os.environ.get("HOST_PROC", "/proc")
HOST_SYS  = os.environ.get("HOST_SYS",  "/sys")
HOST_ROOT = os.environ.get("HOST_ROOT", "/")

os.environ["PROC_PATH"] = HOST_PROC

SERVICES_FILE = Path(os.environ.get("SERVICES_FILE", "/config/services.json"))
if not SERVICES_FILE.exists():
    SERVICES_FILE = Path(__file__).parent / "services.json"

_ANN = "homelab-dashboard"

# ─── Network config ──────────────────────────────────────────────────────────
# These IPs are returned to the frontend so it can build per-network URLs.
# Set via env vars in 02-backend.yaml or auto-detected.
LAN_IP = os.environ.get("DASHBOARD_LAN_IP", "")
if not LAN_IP:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        LAN_IP = s.getsockname()[0]
        s.close()
    except Exception:
        LAN_IP = "localhost"

ZT_IP = os.environ.get("DASHBOARD_ZT_IP", "")
TS_IP = os.environ.get("DASHBOARD_TS_IP", "")

# Disk filter — comma-separated mount points or device names to show.
# Empty = show all real block devices. Example: "/, /home, /data"
DASHBOARD_DISKS = os.environ.get("DASHBOARD_DISKS", "")

# Server location for the map (latitude, longitude)
SERVER_LAT = float(os.environ.get("DASHBOARD_SERVER_LAT", "0"))
SERVER_LNG = float(os.environ.get("DASHBOARD_SERVER_LNG", "0"))

# ─── Image-based service identification ──────────────────────────────────────
# Maps a keyword found in Docker image names or k8s service names to display info.
# Only used for pretty names and icons — does NOT add phantom services.
KNOWN_IMAGES: dict[str, dict[str, str]] = {
    "jellyfin":       {"name": "Jellyfin",       "icon": "📺"},
    "plex":           {"name": "Plex",           "icon": "🎞️"},
    "sonarr":         {"name": "Sonarr",         "icon": "📡"},
    "radarr":         {"name": "Radarr",         "icon": "🎬"},
    "prowlarr":       {"name": "Prowlarr",       "icon": "🔍"},
    "lidarr":         {"name": "Lidarr",         "icon": "🎵"},
    "readarr":        {"name": "Readarr",        "icon": "📚"},
    "bazarr":         {"name": "Bazarr",         "icon": "💬"},
    "overseerr":      {"name": "Overseerr",      "icon": "🎟️"},
    "tautulli":       {"name": "Tautulli",       "icon": "📊"},
    "transmission":   {"name": "Transmission",   "icon": "⬇️"},
    "qbittorrent":    {"name": "qBittorrent",    "icon": "⬇️"},
    "deluge":         {"name": "Deluge",         "icon": "⬇️"},
    "sabnzbd":        {"name": "SABnzbd",        "icon": "⬇️"},
    "nzbget":         {"name": "NZBGet",         "icon": "⬇️"},
    "jackett":        {"name": "Jackett",        "icon": "🔍"},
    "flaresolverr":   {"name": "FlareSolverr",   "icon": "🔓"},
    "pihole":         {"name": "Pi-hole",        "icon": "🛡️"},
    "adguard":        {"name": "AdGuard Home",   "icon": "🛡️"},
    "nginx":          {"name": "Nginx",          "icon": "🔀"},
    "traefik":        {"name": "Traefik",        "icon": "🔀"},
    "portainer":      {"name": "Portainer",      "icon": "🐳"},
    "grafana":        {"name": "Grafana",        "icon": "📈"},
    "prometheus":     {"name": "Prometheus",     "icon": "🔥"},
    "uptime-kuma":    {"name": "Uptime Kuma",    "icon": "📊"},
    "uptimekuma":     {"name": "Uptime Kuma",    "icon": "📊"},
    "gitea":          {"name": "Gitea",          "icon": "🐙"},
    "homeassistant":  {"name": "Home Assistant", "icon": "🏠"},
    "home-assistant": {"name": "Home Assistant", "icon": "🏠"},
    "node-red":       {"name": "Node-RED",       "icon": "🔴"},
    "nodered":        {"name": "Node-RED",       "icon": "🔴"},
    "nextcloud":      {"name": "Nextcloud",      "icon": "☁️"},
    "vaultwarden":    {"name": "Vaultwarden",    "icon": "🔐"},
    "navidrome":      {"name": "Navidrome",      "icon": "🎵"},
    "immich":         {"name": "Immich",         "icon": "📷"},
    "frigate":        {"name": "Frigate",        "icon": "📷"},
    "photoprism":     {"name": "PhotoPrism",     "icon": "📷"},
    "calibre":        {"name": "Calibre",        "icon": "📚"},
    "paperless":      {"name": "Paperless",      "icon": "📄"},
    "syncthing":      {"name": "Syncthing",      "icon": "🔄"},
    "filebrowser":    {"name": "File Browser",   "icon": "📁"},
    "wireguard":      {"name": "WireGuard",      "icon": "🔒"},
    "minecraft":      {"name": "Minecraft",      "icon": "🎮"},
    "valheim":        {"name": "Valheim",        "icon": "🎮"},
    "terraria":       {"name": "Terraria",       "icon": "🎮"},
    "foundry":        {"name": "Foundry VTT",    "icon": "🎲"},
}

_SKIP_NS  = {"kube-system", "kube-public", "kube-node-lease"}
_SKIP_SVC = {"kubernetes", "kube-dns", "homelab-backend", "homelab-frontend"}


def _match_image(image: str) -> dict[str, str]:
    """Match a Docker image string against known services."""
    img = image.lower()
    for key, meta in KNOWN_IMAGES.items():
        if key in img:
            return meta
    return {}


def _match_name(name: str) -> dict[str, str]:
    """Match a k8s service name against known services."""
    n = name.lower().replace("-", "").replace("_", "")
    for key, meta in KNOWN_IMAGES.items():
        if key.replace("-", "") in n:
            return meta
    return {}


# ─── Service auto-discovery ──────────────────────────────────────────────────

def _services_from_k8s() -> list[dict] | None:
    """Auto-discover from Kubernetes Services + Ingresses."""
    try:
        from kubernetes import client as k8s_client, config as k8s_config
        k8s_config.load_incluster_config()
        v1  = k8s_client.CoreV1Api()
        net = k8s_client.NetworkingV1Api()
    except Exception as exc:
        logger.debug("k8s discovery unavailable: %s", exc)
        return None

    # Build Ingress URL map: "namespace/svc-name" → URL
    ingress_urls: dict[str, str] = {}
    try:
        for ing in net.list_ingress_for_all_namespaces(timeout_seconds=5).items:
            ann = ing.metadata.annotations or {}
            if ann.get(f"{_ANN}/enabled") == "false":
                continue
            scheme = "https" if ing.spec.tls else "http"
            for rule in (ing.spec.rules or []):
                host = rule.host or LAN_IP
                for hp in (rule.http.paths if rule.http else []):
                    be = hp.backend
                    svc_name = be.service.name if be and be.service else None
                    if svc_name:
                        path = ""
                        if hp.path and hp.path not in ("/", "/*"):
                            path = hp.path.rstrip("/*")
                        ingress_urls[f"{ing.metadata.namespace}/{svc_name}"] = f"{scheme}://{host}{path}"
    except Exception:
        pass

    try:
        all_svcs = v1.list_service_for_all_namespaces(timeout_seconds=5)
    except Exception as exc:
        logger.debug("k8s service list failed: %s", exc)
        return None

    results: list[dict] = []
    for svc in all_svcs.items:
        ns   = svc.metadata.namespace
        name = svc.metadata.name
        ann  = svc.metadata.annotations or {}

        if ns in _SKIP_NS or name in _SKIP_SVC:
            continue
        if ann.get(f"{_ANN}/enabled") == "false":
            continue

        ports = svc.spec.ports or []
        port_num = ports[0].port if ports else None
        ext_port = None
        url = ann.get(f"{_ANN}/url")

        if not url:
            key = f"{ns}/{name}"
            if key in ingress_urls:
                url = ingress_urls[key]
            elif svc.spec.type == "NodePort" and ports:
                np = ports[0].node_port
                if np:
                    ext_port = np
                    url = f"http://localhost:{np}"
            elif svc.spec.type == "LoadBalancer":
                lbi = (svc.status.load_balancer.ingress or []) if svc.status and svc.status.load_balancer else []
                if lbi:
                    host = lbi[0].ip or lbi[0].hostname or LAN_IP
                    ext_port = port_num
                    url = f"http://{host}:{port_num or 80}"
            else:
                # ClusterIP without Ingress — internal only, skip
                continue

        if not url:
            continue

        meta = _match_name(name)
        results.append({
            "name":  ann.get(f"{_ANN}/name")  or meta.get("name")  or name,
            "desc":  ann.get(f"{_ANN}/desc")  or "",
            "url":   url,
            "port":  ext_port,
            "group": ann.get(f"{_ANN}/group") or ns,
            "icon":  ann.get(f"{_ANN}/icon")  or meta.get("icon")  or "🔧",
        })

    return results


def _services_from_docker() -> list[dict] | None:
    """Auto-discover running Docker containers with published host ports."""
    sock_path = "/var/run/docker.sock"
    if not Path(sock_path).exists():
        return None
    try:
        transport = httpx.HTTPTransport(uds=sock_path)
        with httpx.Client(transport=transport, base_url="http://docker", timeout=5) as client:
            containers = client.get("/containers/json").json()
    except Exception as exc:
        logger.debug("Docker discovery unavailable: %s", exc)
        return None

    services: list[dict] = []
    for c in containers:
        labels = c.get("Labels") or {}
        if labels.get(f"{_ANN}.enabled") == "false":
            continue

        host_ports = sorted({
            p["PublicPort"]
            for p in (c.get("Ports") or [])
            if p.get("PublicPort") and p.get("IP") in ("0.0.0.0", "::", "127.0.0.1")
        })

        has_label_url = bool(labels.get(f"{_ANN}.url"))
        if not host_ports and not has_label_url:
            continue

        port = host_ports[0] if host_ports else None
        image = c.get("Image", "")
        meta = _match_image(image)
        name_raw = (c.get("Names") or ["/unknown"])[0].lstrip("/")

        services.append({
            "name":  labels.get(f"{_ANN}.name")  or meta.get("name")  or name_raw,
            "desc":  labels.get(f"{_ANN}.desc")  or "",
            "url":   labels.get(f"{_ANN}.url")   or (f"http://localhost:{port}" if port else ""),
            "port":  port,
            "group": labels.get(f"{_ANN}.group") or "Docker",
            "icon":  labels.get(f"{_ANN}.icon")  or meta.get("icon")  or "🐳",
        })

    return services or None


def load_services() -> list[dict]:
    """Merge services from all sources. First occurrence of a name wins."""
    k8s    = _services_from_k8s()    or []
    docker = _services_from_docker() or []
    try:
        with open(SERVICES_FILE) as f:
            file_svcs = json.load(f)
    except Exception:
        file_svcs = []

    seen: set[str] = set()
    merged: list[dict] = []
    for svc in k8s + docker + file_svcs:
        if svc["name"] not in seen:
            seen.add(svc["name"])
            merged.append(svc)
    return merged


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _host_temp() -> float | None:
    for hwmon in sorted(Path(HOST_SYS).glob("class/hwmon/hwmon*")):
        name_file = hwmon / "name"
        name = name_file.read_text().strip() if name_file.exists() else ""
        if name in ("coretemp", "k10temp", "cpu_thermal", "it8686"):
            for temp_input in sorted(hwmon.glob("temp*_input")):
                try:
                    return round(int(temp_input.read_text().strip()) / 1000, 1)
                except (ValueError, OSError):
                    pass
    for zone in sorted(Path(HOST_SYS).glob("class/thermal/thermal_zone*")):
        try:
            return round(int((zone / "temp").read_text().strip()) / 1000, 1)
        except (ValueError, OSError):
            pass
    return None


def _host_disks() -> list[dict]:
    """Read real host filesystems from PID 1 mount table."""
    mounts_path = Path(HOST_PROC) / "1" / "mounts"
    if not mounts_path.exists():
        mounts_path = Path(HOST_PROC) / "mounts"

    skip_fs = {
        "tmpfs", "devtmpfs", "squashfs", "overlay", "aufs", "nsfs",
        "cgroup", "cgroup2", "proc", "sysfs", "devpts", "mqueue",
        "hugetlbfs", "debugfs", "tracefs", "securityfs", "pstore",
        "bpf", "fusectl", "configfs", "ramfs", "rpc_pipefs",
        "nfsd", "efivarfs", "autofs", "fuse.shm", "fuse.snapfuse",
    }

    disks: list[dict] = []
    seen_devs: set[str] = set()

    try:
        lines = mounts_path.read_text().splitlines()
    except OSError:
        return disks

    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        dev, mount, fstype = parts[0], parts[1], parts[2]

        if fstype in skip_fs:
            continue
        if not dev.startswith("/dev/"):
            continue
        if "/loop" in dev:
            continue
        if dev in seen_devs:
            continue
        seen_devs.add(dev)

        # If DASHBOARD_DISKS is set, only include matching mounts or devices
        if DASHBOARD_DISKS:
            allowed = {d.strip() for d in DASHBOARD_DISKS.split(",") if d.strip()}
            if mount not in allowed and dev not in allowed:
                continue

        probe = str(Path(HOST_ROOT) / mount.lstrip("/")) if HOST_ROOT != "/" else mount
        try:
            usage = psutil.disk_usage(probe)
            disks.append({
                "mount":    mount,
                "device":   dev,
                "fstype":   fstype,
                "total_gb": round(usage.total / 1e9, 1),
                "used_gb":  round(usage.used  / 1e9, 1),
                "free_gb":  round(usage.free  / 1e9, 1),
                "pct":      usage.percent,
            })
        except (PermissionError, FileNotFoundError, OSError):
            pass

    return disks


# ─── /api/config ─────────────────────────────────────────────────────────────
@app.get("/api/config")
def get_config():
    """Return network IPs so the frontend can build per-network access URLs."""
    return {
        "lan_ip": LAN_IP, "zt_ip": ZT_IP, "ts_ip": TS_IP,
        "server_lat": SERVER_LAT, "server_lng": SERVER_LNG,
    }


# ─── /api/system ─────────────────────────────────────────────────────────────
@app.get("/api/system")
def get_system():
    cpu_pct     = psutil.cpu_percent(interval=1)
    cpu_freq    = psutil.cpu_freq()
    cpu_cores   = psutil.cpu_count(logical=False)
    cpu_threads = psutil.cpu_count(logical=True)
    try:
        load_avg = [round(x, 2) for x in os.getloadavg()]
    except (AttributeError, OSError):
        load_avg = [0.0, 0.0, 0.0]

    mem = psutil.virtual_memory()
    disks = _host_disks()

    uptime_secs = 0
    try:
        raw = (Path(HOST_PROC) / "uptime").read_text()
        uptime_secs = int(float(raw.split()[0]))
    except Exception:
        uptime_secs = int(time.time() - psutil.boot_time())

    days    = uptime_secs // 86400
    hours   = (uptime_secs % 86400) // 3600
    minutes = (uptime_secs % 3600) // 60

    temp_c = _host_temp()

    n1 = psutil.net_io_counters()
    time.sleep(0.5)
    n2 = psutil.net_io_counters()
    rx = round((n2.bytes_recv - n1.bytes_recv) / 1e6 / 0.5, 2)
    tx = round((n2.bytes_sent - n1.bytes_sent) / 1e6 / 0.5, 2)

    return {
        "cpu": {
            "percent": cpu_pct, "cores": cpu_cores, "threads": cpu_threads,
            "freq_mhz": round(cpu_freq.current) if cpu_freq else None,
            "load_avg": load_avg,
        },
        "ram": {
            "total_gb": round(mem.total / 1e9, 1), "used_gb": round(mem.used / 1e9, 1),
            "free_gb": round(mem.available / 1e9, 1), "percent": mem.percent,
        },
        "disks": disks,
        "uptime": {"days": days, "hours": hours, "minutes": minutes, "total_seconds": uptime_secs},
        "temp_c": temp_c,
        "network": {"rx_mb_s": rx, "tx_mb_s": tx},
    }


# ─── /api/services ───────────────────────────────────────────────────────────
@app.get("/api/services")
async def get_services():
    services = load_services()

    async def check(svc: dict) -> dict:
        url = svc.get("url", "")
        start = time.monotonic()
        status, ping_ms = "offline", None
        if url:
            try:
                async with httpx.AsyncClient(timeout=2.5) as client:
                    r = await client.get(url, follow_redirects=True)
                    if r.status_code < 600:
                        status  = "online"
                        ping_ms = round((time.monotonic() - start) * 1000)
            except Exception:
                pass
        return {**svc, "status": status, "ping_ms": ping_ms}

    return list(await asyncio.gather(*[check(s) for s in services]))


# ─── Device detection ────────────────────────────────────────────────────────

import subprocess

_geo_cache: dict[str, dict] = {}   # ip → {lat, lng, city, country, ts}
_GEO_TTL = 300  # 5 minutes

# k3s internal CIDRs — pods and services, not real clients
_K3S_CIDRS = (
    ipaddress.ip_network("10.42.0.0/16"),  # pod CIDR
    ipaddress.ip_network("10.43.0.0/16"),  # service CIDR
)


def _get_local_ips() -> set[str]:
    """Collect all IPs assigned to local network interfaces."""
    ips = set()
    for _, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family == socket.AF_INET:
                ips.add(addr.address)
    return ips


def _is_client_ip(ip_str: str, local_ips: set[str]) -> bool:
    """Return True if ip_str is a real external/VPN client, not internal."""
    try:
        ip_obj = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if ip_obj.is_loopback or ip_obj.is_link_local:
        return False
    if any(ip_obj in cidr for cidr in _K3S_CIDRS):
        return False
    if ip_str in local_ips:
        return False
    return True


def _parse_conntrack_line(line: str, local_ips: set[str]) -> tuple[str, int] | None:
    """Parse a single conntrack line, return (client_ip, dest_port) or None.
    Only returns inbound connections (src is a client, not our server)."""
    if "ESTABLISHED" not in line or "tcp" not in line:
        return None

    # Extract key=value pairs — first occurrence = original direction
    kv: dict[str, str] = {}
    for token in line.split():
        if "=" in token:
            k, v = token.split("=", 1)
            if k not in kv:
                kv[k] = v

    src = kv.get("src", "")
    dport = kv.get("dport", "")
    if not src or not dport:
        return None
    if not _is_client_ip(src, local_ips):
        return None

    return (src, int(dport))


def _conntrack_from_cli(local_ips: set[str]) -> dict[str, set[int]]:
    """Run `conntrack -L` CLI to get connection tracking entries.
    This is the most reliable method — sees through kube-proxy NAT."""
    result: dict[str, set[int]] = {}
    try:
        proc = subprocess.run(
            ["conntrack", "-L", "-p", "tcp", "--state", "ESTABLISHED"],
            capture_output=True, text=True, timeout=5,
        )
        lines = proc.stdout.splitlines()
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.debug("conntrack CLI not available: %s", exc)
        return result

    for line in lines:
        parsed = _parse_conntrack_line(line, local_ips)
        if parsed:
            src, dport = parsed
            result.setdefault(src, set()).add(dport)

    logger.debug("conntrack CLI found %d client IPs", len(result))
    return result


def _conntrack_from_proc(local_ips: set[str]) -> dict[str, set[int]]:
    """Parse /proc/net/nf_conntrack (fallback for older kernels)."""
    result: dict[str, set[int]] = {}
    for ct_name in ("nf_conntrack", "ip_conntrack"):
        ct_path = Path(HOST_PROC) / "net" / ct_name
        try:
            lines = ct_path.read_text().splitlines()
            break
        except OSError:
            lines = []

    for line in lines:
        parsed = _parse_conntrack_line(line, local_ips)
        if parsed:
            src, dport = parsed
            result.setdefault(src, set()).add(dport)

    return result


def _detect_connections() -> dict[str, set[int]]:
    """Detect inbound client connections via conntrack.

    conntrack is the only reliable way to see through kube-proxy SNAT/DNAT.
    Tries CLI first (newer kernels), then proc file (older kernels).
    """
    local_ips = _get_local_ips()

    # Try conntrack CLI first (works on newer kernels where proc file is gone)
    result = _conntrack_from_cli(local_ips)
    if result:
        return result

    # Fallback: proc file (older kernels)
    result = _conntrack_from_proc(local_ips)
    if result:
        return result

    logger.warning("No conntrack available — device detection will be incomplete")
    return {}


async def _geolocate_ips(ips: list[str]) -> dict[str, dict]:
    """Batch-geolocate public IPs via ip-api.com. Uses in-memory cache."""
    now = time.time()
    results: dict[str, dict] = {}
    to_lookup: list[str] = []

    for ip in ips:
        cached = _geo_cache.get(ip)
        if cached and (now - cached["ts"]) < _GEO_TTL:
            results[ip] = cached
        else:
            to_lookup.append(ip)

    if to_lookup:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(
                    "http://ip-api.com/batch",
                    json=[{"query": ip, "fields": "query,lat,lon,city,country,status"} for ip in to_lookup[:100]],
                )
                for item in r.json():
                    if item.get("status") == "success":
                        entry = {
                            "lat": item["lat"],
                            "lng": item["lon"],
                            "city": item.get("city", ""),
                            "country": item.get("country", ""),
                            "ts": now,
                        }
                        _geo_cache[item["query"]] = entry
                        results[item["query"]] = entry
        except Exception as exc:
            logger.debug("Geolocation failed: %s", exc)

    return results


# Tailscale CGNAT range: 100.64.0.0/10
_TAILSCALE_NET = ipaddress.ip_network("100.64.0.0/10")
# ZeroTier typical range: 10.147.0.0/16 (varies, but common default)
_ZT_NETS = (ipaddress.ip_network("10.147.0.0/16"),)


def _classify_ip(ip_str: str) -> str:
    """Classify a client IP as lan, tailscale, zerotier, or wan."""
    try:
        ip_obj = ipaddress.ip_address(ip_str)
    except ValueError:
        return "wan"
    if ip_obj in _TAILSCALE_NET:
        return "tailscale"
    for net in _ZT_NETS:
        if ip_obj in net:
            return "zerotier"
    if ip_obj.is_private:
        return "lan"
    return "wan"


@app.get("/api/devices")
async def get_devices():
    """Scan TCP connections (via conntrack or /proc/net/tcp) and return connected devices."""
    connections = _detect_connections()
    if not connections:
        return {"devices": [], "total": 0}

    # Map dest ports to service names
    try:
        svcs = load_services()
        port_to_svc = {}
        for s in svcs:
            if s.get("port"):
                port_to_svc[s["port"]] = s["name"]
    except Exception:
        port_to_svc = {}

    devices = []
    public_ips = []

    for ip, ports in connections.items():
        dev_type = _classify_ip(ip)
        svc_names = sorted({port_to_svc[p] for p in ports if p in port_to_svc})

        device = {
            "ip": ip,
            "ports": sorted(ports),
            "connections": len(ports),
            "services": svc_names,
            "type": dev_type,
            "lat": None,
            "lng": None,
            "city": "",
            "country": "",
        }
        devices.append(device)
        if dev_type == "wan":
            public_ips.append(ip)

    # Geolocate public (WAN) IPs
    if public_ips:
        geo = await _geolocate_ips(public_ips)
        for d in devices:
            if d["ip"] in geo:
                g = geo[d["ip"]]
                d["lat"] = g["lat"]
                d["lng"] = g["lng"]
                d["city"] = g["city"]
                d["country"] = g["country"]

    # Sort: wan first (with geolocation), then tailscale/zerotier, then lan
    type_order = {"wan": 0, "tailscale": 1, "zerotier": 2, "lan": 3}
    devices.sort(key=lambda d: (type_order.get(d["type"], 9), -d["connections"]))

    return {"devices": devices, "total": len(devices)}


# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "ts": time.time()}
