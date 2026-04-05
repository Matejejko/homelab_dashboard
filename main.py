"""
Homelab Dashboard — Backend API (k3s edition)
Reads host system stats via mounted /proc and /sys volumes.
Services are auto-discovered from:
  1. Kubernetes Services (NodePort, LoadBalancer, ClusterIP)
  2. Docker containers with published ports
  3. ConfigMap / services.json (manual additions)
"""

import json
import logging
import os
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
    allow_methods=["GET"],
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

_ANN = "homelab-dashboard"  # annotation / label prefix

# Well-known ports → (display name, icon, group, description)
KNOWN_PORTS: dict[int, tuple[str, str, str, str]] = {
    80:    ("Web Server",     "🌐", "Network",    "HTTP server"),
    81:    ("Nginx PM",       "🔀", "Network",    "Reverse proxy"),
    443:   ("HTTPS",          "🔒", "Network",    "HTTPS server"),
    1880:  ("Node-RED",       "🔴", "Home",       "Automation flows"),
    3000:  ("Grafana",        "📊", "Monitoring", "Metrics dashboard"),
    3001:  ("Uptime Kuma",    "📊", "Monitoring", "Status monitoring"),
    4533:  ("Navidrome",      "🎵", "Media",      "Music server"),
    5055:  ("Overseerr",      "🎟️", "Media",      "Request manager"),
    6767:  ("Bazarr",         "💬", "Media",      "Subtitle manager"),
    6789:  ("NZBGet",         "⬇️", "Download",   "NZB downloader"),
    7878:  ("Radarr",         "🎬", "Media",      "Movie manager"),
    8080:  ("qBittorrent",    "⬇️", "Download",   "Torrent client"),
    8083:  ("Calibre Web",    "📚", "Media",      "E-book library"),
    8096:  ("Jellyfin",       "📺", "Media",      "Media server"),
    8123:  ("Home Assistant", "🏠", "Home",       "Smart home hub"),
    8181:  ("Tautulli",       "📊", "Media",      "Plex analytics"),
    8191:  ("FlareSolverr",   "🔓", "Media",      "Captcha solver"),
    8686:  ("Lidarr",         "🎵", "Media",      "Music manager"),
    8787:  ("Readarr",        "📚", "Media",      "Book manager"),
    8989:  ("Sonarr",         "📡", "Media",      "TV show manager"),
    9000:  ("Portainer",      "🐳", "Dev",        "Docker manager"),
    9091:  ("Transmission",   "⬇️", "Download",   "Torrent client"),
    9117:  ("Jackett",        "🔍", "Media",      "Indexer proxy"),
    9696:  ("Prowlarr",       "🔍", "Media",      "Indexer manager"),
    32400: ("Plex",           "🎞️", "Media",      "Media server"),
}

# Namespaces and service names to skip in k8s auto-discovery
_SKIP_NS = {"kube-system", "kube-public", "kube-node-lease"}
_SKIP_SVC = {"kubernetes", "kube-dns", "homelab-backend", "homelab-frontend"}


# ─── Service auto-discovery ──────────────────────────────────────────────────

def _services_from_k8s() -> list[dict] | None:
    """
    Auto-discover services from Kubernetes Services and Ingresses.
    Scans all namespaces, returns reachable services with their ports.
    """
    try:
        from kubernetes import client as k8s_client, config as k8s_config
        k8s_config.load_incluster_config()
        v1 = k8s_client.CoreV1Api()
        net = k8s_client.NetworkingV1Api()
    except Exception as exc:
        logger.debug("k8s discovery unavailable: %s", exc)
        return None

    # Build Ingress URL map: namespace/svc-name → URL
    ingress_urls: dict[str, str] = {}
    try:
        for ing in net.list_ingress_for_all_namespaces(timeout_seconds=5).items:
            ann = ing.metadata.annotations or {}
            if ann.get(f"{_ANN}/enabled") == "false":
                continue
            scheme = "https" if ing.spec.tls else "http"
            for rule in (ing.spec.rules or []):
                host = rule.host or "localhost"
                for hp in (rule.http.paths if rule.http else []):
                    svc_name = hp.backend.service.name if hp.backend and hp.backend.service else None
                    if svc_name:
                        path = ""
                        if hp.path and hp.path not in ("/", "/*"):
                            path = hp.path.rstrip("/*")
                        ingress_urls[f"{ing.metadata.namespace}/{svc_name}"] = f"{scheme}://{host}{path}"
    except Exception:
        pass

    # Scan all Services
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

        # Determine URL
        url = ann.get(f"{_ANN}/url")
        ports = svc.spec.ports or []
        port_num = ports[0].port if ports else None

        if not url:
            key = f"{ns}/{name}"
            if key in ingress_urls:
                url = ingress_urls[key]
            elif svc.spec.type == "NodePort" and ports:
                np = ports[0].node_port
                if np:
                    url = f"http://localhost:{np}"
            elif svc.spec.type == "LoadBalancer":
                lbi = (svc.status.load_balancer.ingress or []) if svc.status and svc.status.load_balancer else []
                if lbi:
                    lb_host = lbi[0].ip or lbi[0].hostname or "localhost"
                    url = f"http://{lb_host}:{port_num or 80}"
            elif port_num:
                url = f"http://{name}.{ns}.svc:{port_num}"

        if not url:
            continue

        known = KNOWN_PORTS.get(port_num, ("", "🔧", "", ""))
        results.append({
            "name":  ann.get(f"{_ANN}/name")  or known[0] or name,
            "desc":  ann.get(f"{_ANN}/desc")  or known[3] or "",
            "url":   url,
            "group": ann.get(f"{_ANN}/group") or known[2] or ns,
            "icon":  ann.get(f"{_ANN}/icon")  or known[1] or "🔧",
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
        known = KNOWN_PORTS.get(port, ("", "🔧", "Docker", ""))
        name_raw = (c.get("Names") or ["/unknown"])[0].lstrip("/")

        services.append({
            "name":  labels.get(f"{_ANN}.name")  or known[0] or name_raw,
            "desc":  labels.get(f"{_ANN}.desc")  or known[3] or "",
            "url":   labels.get(f"{_ANN}.url")   or (f"http://localhost:{port}" if port else ""),
            "group": labels.get(f"{_ANN}.group") or known[2] or "Docker",
            "icon":  labels.get(f"{_ANN}.icon")  or known[1] or "🐳",
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
    """Read CPU temp from the host /sys tree."""
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
    """
    Read the real host filesystems from /host/proc/1/mounts (PID 1 = host init).
    This bypasses the container mount namespace and shows actual host partitions.
    """
    # PID 1 mounts give us the host's real mount table
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

        # Probe usage through the host-root mount
        if HOST_ROOT != "/":
            probe = str(Path(HOST_ROOT) / mount.lstrip("/"))
        else:
            probe = mount

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
            "percent":  cpu_pct,
            "cores":    cpu_cores,
            "threads":  cpu_threads,
            "freq_mhz": round(cpu_freq.current) if cpu_freq else None,
            "load_avg": load_avg,
        },
        "ram": {
            "total_gb": round(mem.total      / 1e9, 1),
            "used_gb":  round(mem.used       / 1e9, 1),
            "free_gb":  round(mem.available  / 1e9, 1),
            "percent":  mem.percent,
        },
        "disks":  disks,
        "uptime": {"days": days, "hours": hours, "minutes": minutes, "total_seconds": uptime_secs},
        "temp_c": temp_c,
        "network": {"rx_mb_s": rx, "tx_mb_s": tx},
    }


# ─── /api/services ───────────────────────────────────────────────────────────
@app.get("/api/services")
async def get_services():
    services = load_services()

    async def check(svc: dict) -> dict:
        url   = svc.get("url", f"http://localhost:{svc.get('port', 80)}")
        start = time.monotonic()
        status, ping_ms = "offline", None
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


# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "ts": time.time()}
