import asyncio
import json

import httpx
import pytest

from app import services


@pytest.mark.parametrize("value, expected", [
    ("http://192.0.2.10:8096", "http://192.0.2.10:8096"),
    ("https://jellyfin.example.com/web", "https://jellyfin.example.com/web"),
    ("  HTTPS://Example.com  ", "HTTPS://Example.com"),
    ("javascript:alert(1)", ""),
    ("JaVaScRiPt:alert(1)", ""),
    ("data:text/html,<script>alert(1)</script>", ""),
    ("vbscript:msgbox(1)", ""),
    ("file:///etc/passwd", ""),
    ("ftp://example.com", ""),
    ("//example.com", ""),
    ("example.com:8096", ""),
    ("http://", ""),
    ("http://[::1", ""),
    ("", ""),
    (None, ""),
    (8096, ""),
])
def test_safe_url_accepts_only_http_and_https(value, expected):
    assert services.safe_url(value) == expected


def test_docker_label_url_with_a_bad_scheme_is_not_used():
    containers = [
        {
            "Names": ["/evil"], "Image": "example/evil:1",
            "Labels": {"homelab-dashboard.url": "javascript:alert(document.cookie)"},
            "Ports": [{"PublicPort": 8080, "IP": "0.0.0.0"}],
        },
        {
            "Names": ["/label-only"], "Image": "example/x:1",
            "Labels": {"homelab-dashboard.url": "data:text/html,boom"},
            "Ports": [],
        },
        {
            "Names": ["/media"], "Image": "jellyfin/jellyfin:latest",
            "Labels": {"homelab-dashboard.url": "https://media.example.com"},
            "Ports": [{"PublicPort": 8096, "IP": "0.0.0.0"}],
        },
        {
            "Names": ["/hidden"], "Image": "example/y:1",
            "Labels": {"homelab-dashboard.enabled": "false"},
            "Ports": [{"PublicPort": 9000, "IP": "0.0.0.0"}],
        },
    ]
    found = services._services_from_docker(containers)
    assert [(s["name"], s["url"], s["port"]) for s in found] == [
        ("evil", "http://localhost:8080", 8080),          # fell back to the published port
        ("Jellyfin", "https://media.example.com", 8096),
    ]
    for svc in found:
        assert set(svc) == {"name", "desc", "url", "port", "group", "icon"}


def test_file_services_are_validated(tmp_path):
    path = tmp_path / "services.json"
    path.write_text(json.dumps([
        {"name": "NAS", "url": "http://192.0.2.20:5000", "port": 5000, "group": "Storage", "icon": "💾"},
        {"name": "Bad link", "url": "javascript:alert(1)"},
        {"name": ""},
        {"url": "http://192.0.2.21"},
        "not an object",
        {"name": "Odd port", "url": "https://example.com", "port": "80"},
    ]))
    assert services._services_from_file(path) == [
        {"name": "NAS", "desc": "", "url": "http://192.0.2.20:5000", "port": 5000, "group": "Storage", "icon": "💾"},
        {"name": "Bad link", "desc": "", "url": "", "port": None, "group": "Uncategorized", "icon": "🔧"},
        {"name": "Odd port", "desc": "", "url": "https://example.com", "port": None, "group": "Uncategorized", "icon": "🔧"},
    ]


def test_file_services_tolerate_a_missing_or_broken_file(tmp_path):
    assert services._services_from_file(tmp_path / "missing.json") == []
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert services._services_from_file(broken) == []
    obj = tmp_path / "object.json"
    obj.write_text('{"name": "x"}')
    assert services._services_from_file(obj) == []


def test_discovery_is_cached_for_ten_seconds():
    now = [100.0]
    calls = []

    def loader():
        calls.append(now[0])
        return [{"name": "svc"}]

    cache = services.TTLCache(services.DISCOVERY_TTL, loader, clock=lambda: now[0])
    assert services.DISCOVERY_TTL == 10
    cache.get(); cache.get()
    now[0] += 9.9
    cache.get()
    assert len(calls) == 1
    now[0] += 0.2
    cache.get()
    assert len(calls) == 2


def test_load_services_returns_copies(monkeypatch):
    monkeypatch.setattr(services, "_catalog", services.TTLCache(10, lambda: [{"name": "svc", "port": 1}]))
    first = services.load_services()
    first[0]["name"] = "mutated"
    assert services.load_services()[0]["name"] == "svc"


def test_port_names():
    assert services.port_names([
        {"name": "A", "port": 80}, {"name": "B", "port": None}, {"name": "C", "port": 80},
    ]) == {80: "A"}


def test_health_is_online_below_500_and_offline_otherwise():
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "down.example":
            raise httpx.ConnectError("refused")
        if host == "slow.example":
            raise httpx.ReadTimeout("timed out")
        return httpx.Response(int(host.split(".")[0][1:]))

    svcs = [
        {"name": "ok", "url": "http://s200.example"},
        {"name": "auth", "url": "http://s401.example"},
        {"name": "missing", "url": "http://s404.example"},
        {"name": "edge", "url": "http://s499.example"},
        {"name": "error", "url": "http://s500.example"},
        {"name": "gateway", "url": "http://s502.example"},
        {"name": "weird", "url": "http://s599.example"},
        {"name": "down", "url": "http://down.example"},
        {"name": "slow", "url": "http://slow.example"},
        {"name": "nourl", "url": ""},
    ]
    results = asyncio.run(services.check_services(svcs, transport=httpx.MockTransport(handler)))
    status = {r["name"]: r["status"] for r in results}
    assert status == {
        "ok": "online", "auth": "online", "missing": "online", "edge": "online",
        "error": "offline", "gateway": "offline", "weird": "offline",
        "down": "offline", "slow": "offline", "nourl": "offline",
    }
    for result in results:
        assert set(result) == {"name", "url", "status", "ping_ms"}
        assert (result["ping_ms"] is not None) == (result["status"] == "online")
