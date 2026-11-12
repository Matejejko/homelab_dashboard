"""Service discovery (Kubernetes, Docker, ConfigMap) and HTTP health checks."""

import asyncio
import json
import logging
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from . import system

logger = logging.getLogger("homelab.services")

_ANN = "homelab-dashboard"
_DOCKER_SOCK = "/var/run/docker.sock"
DISCOVERY_TTL = 10.0       # seconds
HEALTH_TIMEOUT = 2.5       # seconds

# Keyword found in an image or service name -> display name and icon.
# Only used for pretty names; it never adds services that were not discovered.
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
    "opencloud":      {"name": "OpenCloud",      "icon": "☁️"},
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

_SKIP_NS = {"kube-system", "kube-public", "kube-node-lease"}
_SKIP_SVC = {"kubernetes", "kube-dns", "homelab-backend", "homelab-frontend"}


class TTLCache:
    """One cached value. Concurrent callers wait for a single refresh."""

    def __init__(self, ttl: float, loader, clock=time.monotonic):
        self._ttl = ttl
        self._loader = loader
        self._clock = clock
        self._lock = threading.Lock()
        self._loaded_at: float | None = None
        self._value = None

    def get(self):
        with self._lock:
            now = self._clock()
            if self._loaded_at is None or now - self._loaded_at >= self._ttl:
                self._value = self._loader()
                self._loaded_at = self._clock()
            return self._value

    def clear(self) -> None:
        with self._lock:
            self._loaded_at = None
            self._value = None


def safe_url(value) -> str:
    """Return the URL only when it is an absolute http(s) URL, else ""."""
    if not isinstance(value, str):
        return ""
    url = value.strip()
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return ""
    return url


def _match_image(image: str) -> dict[str, str]:
    img = image.lower()
    for key, meta in KNOWN_IMAGES.items():
        if key in img:
            return meta
    return {}


def _match_name(name: str) -> dict[str, str]:
    n = name.lower().replace("-", "").replace("_", "")
    for key, meta in KNOWN_IMAGES.items():
        if key.replace("-", "") in n:
            return meta
    return {}


def _fallback_host() -> str:
    return system.iface_ipv4(system.lan_iface()) or "localhost"


# ─── Kubernetes ──────────────────────────────────────────────────────────────

def _ingress_urls(net_api, custom_api, fallback_host: str) -> dict[str, str]:
    """Map "namespace/service" to the URL its Ingress or IngressRoute serves."""
    urls: dict[str, str] = {}
    try:
        for ing in net_api.list_ingress_for_all_namespaces(timeout_seconds=5).items:
            ann = ing.metadata.annotations or {}
            if ann.get(f"{_ANN}/enabled") == "false":
                continue
            scheme = "https" if ing.spec.tls else "http"
            for rule in (ing.spec.rules or []):
                host = rule.host or fallback_host
                for hp in (rule.http.paths if rule.http else []):
                    be = hp.backend
                    svc_name = be.service.name if be and be.service else None
                    if not svc_name:
                        continue
                    path = ""
                    if hp.path and hp.path not in ("/", "/*"):
                        path = hp.path.rstrip("/*")
                    urls[f"{ing.metadata.namespace}/{svc_name}"] = f"{scheme}://{host}{path}"
    except Exception as exc:
        logger.debug("ingress list failed: %s", exc)

    # Traefik IngressRoute CRDs (k3s ships Traefik)
    for group in ("traefik.io", "traefik.containo.us"):
        try:
            routes = custom_api.list_cluster_custom_object(
                group=group, version="v1alpha1", plural="ingressroutes", timeout_seconds=5,
            )
        except Exception:
            continue
        for route in routes.get("items", []):
            try:
                ns = route["metadata"]["namespace"]
                spec = route.get("spec", {})
                scheme = "https" if "tls" in spec else "http"
                for r in spec.get("routes", []):
                    match = r.get("match", "")
                    if "Host(`" not in match:
                        continue
                    host = match.split("Host(`")[1].split("`)")[0]
                    for svc_ref in r.get("services", []):
                        svc_name = svc_ref.get("name")
                        if svc_name and host:
                            urls.setdefault(f"{ns}/{svc_name}", f"{scheme}://{host}")
            except (KeyError, IndexError, AttributeError, TypeError):
                continue
    return urls


def _services_from_k8s() -> list[dict]:
    try:
        from kubernetes import client as k8s_client, config as k8s_config
        k8s_config.load_incluster_config()
        v1 = k8s_client.CoreV1Api()
        net_api = k8s_client.NetworkingV1Api()
        custom_api = k8s_client.CustomObjectsApi()
    except Exception as exc:
        logger.debug("k8s discovery unavailable: %s", exc)
        return []

    fallback_host = _fallback_host()
    ingress_urls = _ingress_urls(net_api, custom_api, fallback_host)

    try:
        all_svcs = v1.list_service_for_all_namespaces(timeout_seconds=5)
    except Exception as exc:
        logger.debug("k8s service list failed: %s", exc)
        return []

    results: list[dict] = []
    for svc in all_svcs.items:
        ns = svc.metadata.namespace
        name = svc.metadata.name
        ann = svc.metadata.annotations or {}

        if ns in _SKIP_NS or name in _SKIP_SVC:
            continue
        if ann.get(f"{_ANN}/enabled") == "false":
            continue

        ports = svc.spec.ports or []
        port_num = ports[0].port if ports else None
        ext_port = None
        url = safe_url(ann.get(f"{_ANN}/url"))

        if not url:
            key = f"{ns}/{name}"
            if key in ingress_urls:
                url = ingress_urls[key]
            elif svc.spec.type == "NodePort" and ports:
                node_port = ports[0].node_port
                if node_port:
                    ext_port = node_port
                    url = f"http://localhost:{node_port}"
            elif svc.spec.type == "LoadBalancer":
                lb = svc.status.load_balancer if svc.status else None
                ingress = (lb.ingress or []) if lb else []
                if ingress:
                    host = ingress[0].ip or ingress[0].hostname or fallback_host
                    ext_port = port_num
                    url = f"http://{host}:{port_num or 80}"
            else:
                continue   # ClusterIP without an Ingress is internal only

        url = safe_url(url)
        if not url:
            continue

        meta = _match_name(name)
        results.append({
            "name":  ann.get(f"{_ANN}/name")  or meta.get("name") or name,
            "desc":  ann.get(f"{_ANN}/desc")  or "",
            "url":   url,
            "port":  ext_port,
            "group": ann.get(f"{_ANN}/group") or ns,
            "icon":  ann.get(f"{_ANN}/icon")  or meta.get("icon") or "🔧",
        })
    return results


# ─── Docker ──────────────────────────────────────────────────────────────────

def _docker_containers() -> list[dict]:
    if not Path(_DOCKER_SOCK).exists():
        return []
    try:
        transport = httpx.HTTPTransport(uds=_DOCKER_SOCK)
        with httpx.Client(transport=transport, base_url="http://docker", timeout=5) as client:
            data = client.get("/containers/json").json()
    except Exception as exc:
        logger.debug("Docker discovery unavailable: %s", exc)
        return []
    return data if isinstance(data, list) else []


def _services_from_docker(containers: list[dict] | None = None) -> list[dict]:
    """Running containers with a published host port or an explicit URL label."""
    if containers is None:
        containers = _docker_containers()

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
        port = host_ports[0] if host_ports else None

        # A label URL with any other scheme is ignored, not rendered.
        url = safe_url(labels.get(f"{_ANN}.url")) or (f"http://localhost:{port}" if port else "")
        if not url:
            continue

        meta = _match_image(c.get("Image", ""))
        name_raw = (c.get("Names") or ["/unknown"])[0].lstrip("/")
        services.append({
            "name":  labels.get(f"{_ANN}.name")  or meta.get("name") or name_raw,
            "desc":  labels.get(f"{_ANN}.desc")  or "",
            "url":   url,
            "port":  port,
            "group": labels.get(f"{_ANN}.group") or "Docker",
            "icon":  labels.get(f"{_ANN}.icon")  or meta.get("icon") or "🐳",
        })
    return services


# ─── ConfigMap / services.json ───────────────────────────────────────────────

def _services_file() -> Path:
    path = Path(os.environ.get("SERVICES_FILE", "/config/services.json"))
    if not path.exists():
        path = Path(__file__).resolve().parent.parent / "services.json"
    return path


def _services_from_file(path: Path | None = None) -> list[dict]:
    try:
        data = json.loads((path or _services_file()).read_text())
    except (OSError, ValueError):
        return []
    if not isinstance(data, list):
        return []

    services: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        url = safe_url(item.get("url"))
        if item.get("url") and not url:
            logger.warning("service %r: URL ignored, only http and https are accepted", name)
        port = item.get("port")
        if isinstance(port, bool) or not isinstance(port, int) or not 0 < port < 65536:
            port = None
        services.append({
            "name":  name,
            "desc":  str(item.get("desc") or ""),
            "url":   url,
            "port":  port,
            "group": str(item.get("group") or "Uncategorized"),
            "icon":  str(item.get("icon") or "🔧"),
        })
    return services


# ─── Merge + cache ───────────────────────────────────────────────────────────

def discover() -> list[dict]:
    """Merge every source. The first occurrence of a name wins. Blocking."""
    seen: set[str] = set()
    merged: list[dict] = []
    for svc in _services_from_k8s() + _services_from_docker() + _services_from_file():
        if svc["name"] not in seen:
            seen.add(svc["name"])
            merged.append(svc)
    return merged


_catalog = TTLCache(DISCOVERY_TTL, discover)


def load_services() -> list[dict]:
    """Discovered services, cached for DISCOVERY_TTL seconds. Blocking."""
    return [dict(svc) for svc in _catalog.get()]


def port_names(services: list[dict]) -> dict[int, str]:
    """Host port -> service name, for labelling inbound flows."""
    names: dict[int, str] = {}
    for svc in services:
        port = svc.get("port")
        if isinstance(port, int):
            names.setdefault(port, svc["name"])
    return names


# ─── Health ──────────────────────────────────────────────────────────────────

async def _check(client: httpx.AsyncClient, svc: dict) -> dict:
    """Online means the service answered with a status below 500."""
    url = svc.get("url") or ""
    status, ping_ms = "offline", None
    if url:
        started = time.monotonic()
        try:
            # Headers are enough to decide; the body is never downloaded.
            async with client.stream("GET", url, follow_redirects=True) as response:
                if response.status_code < 500:
                    status = "online"
                    ping_ms = round((time.monotonic() - started) * 1000)
        except Exception:
            pass
    return {**svc, "status": status, "ping_ms": ping_ms}


async def check_services(services: list[dict], transport=None) -> list[dict]:
    async with httpx.AsyncClient(timeout=HEALTH_TIMEOUT, transport=transport) as client:
        return list(await asyncio.gather(*(_check(client, svc) for svc in services)))
