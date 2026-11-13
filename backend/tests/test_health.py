"""Health checks against real sockets on loopback: TCP, UDP, HTTP and TLS.

Nothing here is mocked. The first version of the health check was only ever
tested against a fake HTTP transport, and reported every game server and every
self-signed HTTPS service as offline.
"""

import asyncio
import shutil
import socket
import ssl
import subprocess
from types import SimpleNamespace as NS

import pytest

from app import services

PUBLIC_KEYS = {"name", "desc", "url", "port", "group", "icon", "status", "ping_ms"}


@pytest.fixture(autouse=True)
def fast_and_clean(monkeypatch):
    monkeypatch.setattr(services, "HEALTH_TIMEOUT", 0.5)
    services._plain_tcp.clear()
    yield
    services._plain_tcp.clear()


def closed_port(kind=socket.SOCK_STREAM) -> int:
    """A loopback port with nothing listening on it."""
    with socket.socket(socket.AF_INET, kind) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def port_svc(name, port, proto="tcp"):
    return {
        "name": name, "desc": "", "url": f"http://localhost:{port}", "port": port, "group": "g", "icon": "x",
        "_probe": {"kind": "port", "host": "127.0.0.1", "port": port, "proto": proto},
    }


def web_svc(name, url, address=None):
    svc = {"name": name, "desc": "", "url": url, "port": None, "group": "g", "icon": "x"}
    if address:
        svc["_probe"] = {"kind": "web", "address": address}     # an Ingress published at `address`
    return svc


class Listener:
    """A TCP server whose behaviour per connection is one of a few scripts."""

    def __init__(self, behaviour, status=200, location=None):
        self.behaviour, self.status, self.connections = behaviour, status, 0
        self.location, self.hosts, self.paths = location, [], []

    async def start(self, tls=None):
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0, ssl=tls)
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def _handle(self, reader, writer):
        self.connections += 1
        try:
            if self.behaviour == "http":
                head = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1")
                self.paths.append(head.split(" ")[1])
                self.hosts += [line.split(":", 1)[1].strip() for line in head.split("\r\n") if line.lower().startswith("host:")]
                extra = f"Location: {self.location}\r\n" if self.location else ""
                writer.write(f"HTTP/1.1 {self.status} X\r\n{extra}Content-Length: 0\r\nConnection: close\r\n\r\n".encode())
                await writer.drain()
            elif self.behaviour == "garbage":            # a game protocol answering nonsense
                writer.write(b"\x00\x13\x37 not http at all\n")
                await writer.drain()
            elif self.behaviour == "slam":               # a proxy whose backend is gone
                pass
            elif self.behaviour == "banner":             # SSH-style: greets first
                writer.write(b"SSH-2.0-example\r\n")
                await writer.drain()
                await reader.read(65536)
            elif self.behaviour == "silent":             # accepts, then waits for its own protocol
                await reader.read(65536)
                await asyncio.sleep(5)
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    async def stop(self):
        self.server.close()


class UdpServer(asyncio.DatagramProtocol):
    def __init__(self, reply):
        self.reply, self.received = reply, 0

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        self.received += 1
        if self.reply:
            self.transport.sendto(b"pong", addr)


async def udp_server(reply):
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(lambda: UdpServer(reply), local_addr=("127.0.0.1", 0))
    return transport, protocol, transport.get_extra_info("sockname")[1]


def check(*svcs):
    async def run():
        return await services.check_services(list(svcs))
    return asyncio.run(run())


# ─── TCP ports ───────────────────────────────────────────────────────────────

def test_tcp_port_that_speaks_http_is_online_with_latency():
    async def run():
        server = await Listener("http", 200).start()
        result = (await services.check_services([port_svc("web", server.port)]))[0]
        await server.stop()
        return result

    result = asyncio.run(run())
    assert result["status"] == "online"
    assert isinstance(result["ping_ms"], int)
    assert set(result) == PUBLIC_KEYS                       # the probe is not part of the answer


@pytest.mark.parametrize("status, expected", [(200, "online"), (404, "online"), (499, "online"), (500, "offline"), (503, "offline")])
def test_http_5xx_on_an_open_port_is_still_offline(status, expected):
    async def run():
        server = await Listener("http", status).start()
        result = (await services.check_services([port_svc("web", server.port)]))[0]
        await server.stop()
        return result

    assert asyncio.run(run())["status"] == expected


@pytest.mark.parametrize("behaviour", ["silent", "garbage"])
def test_tcp_port_that_is_not_http_is_online(behaviour):
    """Minecraft, Vintage Story: the port accepts connections but never answers HTTP."""
    async def run():
        server = await Listener(behaviour).start()
        first = (await services.check_services([port_svc("game", server.port)]))[0]
        after_first = server.connections
        started = asyncio.get_running_loop().time()
        second = (await services.check_services([port_svc("game", server.port)]))[0]
        took = asyncio.get_running_loop().time() - started
        await server.stop()
        return first, second, after_first, server.connections, took

    first, second, after_first, total, took = asyncio.run(run())
    assert first["status"] == second["status"] == "online"
    assert isinstance(first["ping_ms"], int) and isinstance(second["ping_ms"], int)
    assert after_first == 2                                  # one connect, one HTTP attempt
    assert total == 3                                        # remembered: no HTTP request the second time
    assert took < 0.3


def test_port_that_accepts_and_hangs_up_at_once_is_offline():
    """Docker's userland proxy, or any forwarder, in front of a dead backend."""
    async def run():
        server = await Listener("slam").start()
        result = (await services.check_services([port_svc("ghost", server.port)]))[0]
        await server.stop()
        return result

    result = asyncio.run(run())
    assert (result["status"], result["ping_ms"]) == ("offline", None)


def test_server_that_greets_first_is_online():
    async def run():
        server = await Listener("banner").start()
        result = (await services.check_services([port_svc("ssh", server.port)]))[0]
        await server.stop()
        return result

    assert asyncio.run(run())["status"] == "online"


def test_closed_tcp_port_is_offline():
    """Minecraft in CrashLoopBackOff: nothing accepts the connection."""
    result = check(port_svc("mc", closed_port()))[0]
    assert (result["status"], result["ping_ms"]) == ("offline", None)


def test_a_port_that_starts_speaking_http_again_is_noticed():
    async def run():
        server = await Listener("silent").start()
        port = server.port
        await services.check_services([port_svc("x", port)])
        assert ("127.0.0.1", port) in services._plain_tcp
        services._plain_tcp[("127.0.0.1", port)] = 0.0       # the memo has expired
        server.behaviour, server.status = "http", 503
        result = (await services.check_services([port_svc("x", port)]))[0]
        await server.stop()
        return result, port

    result, port = asyncio.run(run())
    assert result["status"] == "offline"                     # now a web app that answers 503
    assert ("127.0.0.1", port) not in services._plain_tcp


# ─── UDP ports ───────────────────────────────────────────────────────────────

def test_silent_udp_server_is_online_without_latency():
    """Valheim, Unturned: a healthy UDP server ignores packets it does not understand."""
    async def run():
        transport, protocol, port = await udp_server(reply=False)
        result = (await services.check_services([port_svc("valheim", port, "udp")]))[0]
        transport.close()
        return result, protocol.received

    result, received = asyncio.run(run())
    assert (result["status"], result["ping_ms"]) == ("online", None)
    assert received >= 1


def test_udp_server_that_answers_is_online_with_latency():
    async def run():
        transport, _, port = await udp_server(reply=True)
        result = (await services.check_services([port_svc("dns", port, "udp")]))[0]
        transport.close()
        return result

    result = asyncio.run(run())
    assert result["status"] == "online" and isinstance(result["ping_ms"], int)


def test_refused_udp_port_is_offline():
    """No process, or a Service without ready pods: ICMP port unreachable comes back."""
    result = check(port_svc("dead", closed_port(socket.SOCK_DGRAM), "udp"))[0]
    assert (result["status"], result["ping_ms"]) == ("offline", None)


def test_unresolvable_host_is_offline():
    svc = port_svc("x", 9, "udp")
    svc["_probe"]["host"] = "no-such-host.invalid"
    tcp = port_svc("y", 9)
    tcp["_probe"]["host"] = "no-such-host.invalid"
    assert [r["status"] for r in check(svc, tcp)] == ["offline", "offline"]


# ─── Web URLs ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def self_signed(tmp_path_factory):
    if not shutil.which("openssl"):
        pytest.skip("openssl CLI not available")
    directory = tmp_path_factory.mktemp("tls")
    key, cert = directory / "key.pem", directory / "cert.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-subj", "/CN=rancher.example.test", "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    context.server_names = []                      # what clients asked for (SNI)
    context.sni_callback = lambda sock, name, ctx: ctx.server_names.append(name)
    return context


def test_self_signed_https_service_is_online(self_signed):
    """Rancher, OpenCloud behind an Ingress: the certificate is not from a public CA."""
    async def run():
        server = await Listener("http", 200).start(tls=self_signed)
        result = (await services.check_services([web_svc("rancher", f"https://127.0.0.1:{server.port}/")]))[0]
        await server.stop()
        return result

    result = asyncio.run(run())
    assert result["status"] == "online" and isinstance(result["ping_ms"], int)


# ─── Ingress: checked where it is published, not where DNS points ───────────

def test_ingress_is_reached_at_its_published_address_without_dns(self_signed):
    """Rancher at https://<node-ip>.sslip.io: the name need not resolve from the node."""
    async def run():
        server = await Listener("http", 200).start(tls=self_signed)
        url = f"https://rancher.does-not-resolve.invalid:{server.port}/dashboard/?setup=1"
        result = (await services.check_services([web_svc("rancher", url, address="127.0.0.1")]))[0]
        await server.stop()
        return result, server

    self_signed.server_names.clear()
    result, server = asyncio.run(run())
    assert result["status"] == "online" and isinstance(result["ping_ms"], int)
    assert server.hosts == [f"rancher.does-not-resolve.invalid:{server.port}"]     # Host header: the Ingress host
    assert self_signed.server_names == ["rancher.does-not-resolve.invalid"]        # TLS server name too
    assert server.paths == ["/dashboard/?setup=1"]
    assert set(result) == PUBLIC_KEYS


def test_ingress_redirect_counts_as_up_and_is_not_followed():
    """A 302 to the host name would need DNS again; the answer itself is enough."""
    async def run():
        server = await Listener("http", 302, location="https://opencloud.does-not-resolve.invalid/login").start()
        url = f"http://opencloud.does-not-resolve.invalid:{server.port}"
        result = (await services.check_services([web_svc("opencloud", url, address="127.0.0.1")]))[0]
        await server.stop()
        return result, server.connections

    result, connections = asyncio.run(run())
    assert result["status"] == "online"
    assert connections == 1


@pytest.mark.parametrize("status, expected", [(404, "online"), (500, "offline"), (503, "offline")])
def test_ingress_answer_decides_and_5xx_is_offline(status, expected):
    """Traefik answers 503 when the Service behind a route has no ready pod."""
    async def run():
        server = await Listener("http", status).start()
        url = f"http://app.does-not-resolve.invalid:{server.port}/"
        result = (await services.check_services([web_svc("app", url, address="127.0.0.1")]))[0]
        await server.stop()
        return result

    assert asyncio.run(run())["status"] == expected


def test_falls_back_to_the_url_when_nothing_answers_at_the_address():
    """The guess "the ingress controller is on this node" can be wrong."""
    async def run():
        server = await Listener("http", 200).start()
        url = f"http://127.0.0.1:{server.port}/"
        dead = "127.0.0.2"                               # loopback, but nothing listens there
        result = (await services.check_services([web_svc("elsewhere", url, address=dead)]))[0]
        gone = (await services.check_services([web_svc("gone", f"http://x.does-not-resolve.invalid:{server.port}/", address=dead)]))[0]
        await server.stop()
        return result, gone

    result, gone = asyncio.run(run())
    assert result["status"] == "online"
    assert gone["status"] == "offline"


def test_ingress_urls_carry_the_published_address():
    ingress = NS(
        metadata=NS(namespace="cattle-system", annotations=None),
        spec=NS(tls=[NS()], rules=[NS(host="192.0.2.10.sslip.io", http=NS(paths=[
            NS(path="/", backend=NS(service=NS(name="rancher"))),
        ]))]),
        status=NS(load_balancer=NS(ingress=[NS(ip="192.0.2.10", hostname=None)])),
    )
    unpublished = NS(
        metadata=NS(namespace="apps", annotations=None),
        spec=NS(tls=None, rules=[NS(host="wiki.example.test", http=NS(paths=[
            NS(path="/docs/*", backend=NS(service=NS(name="wiki"))),
        ]))]),
        status=NS(load_balancer=NS(ingress=None)),
    )
    net_api = NS(list_ingress_for_all_namespaces=lambda timeout_seconds: NS(items=[ingress, unpublished]))

    def routes(group, version, plural, timeout_seconds):
        if group != "traefik.io":
            raise RuntimeError("no such CRD")
        return {"items": [{
            "metadata": {"namespace": "opencloud"},
            "spec": {"tls": {}, "routes": [{"match": "Host(`cloud.example.test`)", "services": [{"name": "opencloud"}]}]},
        }]}

    found = services._ingress_urls(net_api, NS(list_cluster_custom_object=routes), "192.0.2.10")
    assert found == {
        "cattle-system/rancher": {"url": "https://192.0.2.10.sslip.io", "address": "192.0.2.10"},
        "apps/wiki": {"url": "http://wiki.example.test/docs", "address": None},
        "opencloud/opencloud": {"url": "https://cloud.example.test", "address": None},
    }


def test_a_web_url_must_really_answer_http():
    """For a URL that claims to be a web page, an open port alone is not enough."""
    async def run():
        silent = await Listener("silent").start()
        down = await Listener("http", 502).start()
        results = await services.check_services([
            web_svc("hung", f"http://127.0.0.1:{silent.port}/"),
            web_svc("bad-gateway", f"http://127.0.0.1:{down.port}/"),
            web_svc("refused", f"http://127.0.0.1:{closed_port()}/"),
            web_svc("no-url", ""),
        ])
        await silent.stop()
        await down.stop()
        return results

    assert [r["status"] for r in asyncio.run(run())] == ["offline"] * 4


def test_many_services_are_checked_concurrently():
    async def run():
        servers = [await Listener("silent").start() for _ in range(8)]
        started = asyncio.get_running_loop().time()
        results = await services.check_services([port_svc(f"s{i}", s.port) for i, s in enumerate(servers)])
        took = asyncio.get_running_loop().time() - started
        for server in servers:
            await server.stop()
        return results, took

    results, took = asyncio.run(run())
    assert all(r["status"] == "online" for r in results)
    assert took < 1.5                                        # eight 0.5 s waits side by side, not in a row


# ─── Discovery carries the protocol ──────────────────────────────────────────

def k8s_service(name, namespace, kind, port, protocol="TCP", node_port=None, lb_ip=None, annotations=None):
    return NS(
        metadata=NS(name=name, namespace=namespace, annotations=annotations),
        spec=NS(type=kind, ports=[NS(port=port, protocol=protocol, node_port=node_port)]),
        status=NS(load_balancer=NS(ingress=[NS(ip=lb_ip, hostname=None)] if lb_ip else None)),
    )


@pytest.fixture
def lan(monkeypatch):
    monkeypatch.setattr(services, "_node_host", lambda: "192.0.2.10")


def test_node_host_is_the_lan_address_or_loopback(monkeypatch):
    monkeypatch.setattr(services.system, "iface_ipv4", lambda name, addrs=None: "192.0.2.10")
    assert services._node_host() == "192.0.2.10"
    monkeypatch.setattr(services.system, "iface_ipv4", lambda name, addrs=None: "")
    assert services._node_host() == "127.0.0.1"


def test_k8s_services_like_the_ones_that_were_wrongly_offline(lan):
    ingress_urls = {
        "cattle-system/rancher": {"url": "https://192.0.2.10.sslip.io", "address": "192.0.2.77"},
        "opencloud/opencloud": {"url": "https://cloud.example.test", "address": None},
    }
    entry = lambda svc: services._k8s_entry(svc, ingress_urls, "192.0.2.10")     # noqa: E731

    booklore = entry(k8s_service("booklore", "booklore", "NodePort", 6060, node_port=30606))
    assert booklore["_probe"] == {"kind": "port", "host": "192.0.2.10", "port": 30606, "proto": "tcp"}   # the node's LAN address
    assert (booklore["url"], booklore["port"]) == ("http://localhost:30606", 30606)

    unturned = entry(k8s_service("unturned", "unturned", "NodePort", 27015, "UDP", node_port=27015))
    assert unturned["_probe"] == {"kind": "port", "host": "192.0.2.10", "port": 27015, "proto": "udp"}

    vintage = entry(k8s_service("vintage-story", "vintage-story-server", "NodePort", 42420, node_port=32420))
    assert vintage["_probe"] == {"kind": "port", "host": "192.0.2.10", "port": 32420, "proto": "tcp"}

    valheim = entry(k8s_service("valheim-server", "valheim-server", "LoadBalancer", 2456, "UDP", lb_ip="192.0.2.10"))
    assert valheim["_probe"] == {"kind": "port", "host": "192.0.2.10", "port": 2456, "proto": "udp"}
    assert (valheim["name"], valheim["port"]) == ("Valheim", 2456)

    minecraft = entry(k8s_service("mc-n01-server-service", "minecraft-no-01", "LoadBalancer", 25565, lb_ip="192.0.2.10"))
    assert minecraft["_probe"] == {"kind": "port", "host": "192.0.2.10", "port": 25565, "proto": "tcp"}

    rancher = entry(k8s_service("rancher", "cattle-system", "ClusterIP", 80))
    assert (rancher["url"], rancher["port"]) == ("https://192.0.2.10.sslip.io", None)
    assert rancher["_probe"] == {"kind": "web", "address": "192.0.2.77"}      # where the Ingress says it is

    opencloud = entry(k8s_service("opencloud", "opencloud", "ClusterIP", 9200))
    assert opencloud["url"] == "https://cloud.example.test"
    assert opencloud["_probe"] == {"kind": "web", "address": "192.0.2.10"}    # IngressRoute: assume this node

    annotated = entry(k8s_service("x", "apps", "NodePort", 80, node_port=30080,
                                  annotations={"homelab-dashboard/url": "https://x.example.test"}))
    assert annotated["url"] == "https://x.example.test" and "_probe" not in annotated

    for svc in (booklore, unturned, vintage, valheim, minecraft, rancher, opencloud, annotated):
        assert {k for k in svc if not k.startswith("_")} == {"name", "desc", "url", "port", "group", "icon"}


def test_k8s_services_that_are_skipped():
    entry = lambda svc: services._k8s_entry(svc, {}, "192.0.2.10")              # noqa: E731
    assert entry(k8s_service("internal", "apps", "ClusterIP", 80)) is None
    assert entry(k8s_service("kube-dns", "kube-system", "NodePort", 53, "UDP", node_port=30053)) is None
    assert entry(k8s_service("homelab-frontend", "homelab", "NodePort", 3000, node_port=30300)) is None
    assert entry(k8s_service("pending", "apps", "LoadBalancer", 80)) is None    # no address assigned yet
    assert entry(k8s_service("hidden", "apps", "NodePort", 80, node_port=30081,
                             annotations={"homelab-dashboard/enabled": "false"})) is None
    assert entry(k8s_service("js", "apps", "ClusterIP", 80,
                             annotations={"homelab-dashboard/url": "javascript:alert(1)"})) is None


def test_docker_udp_port_is_probed_as_udp(lan):
    found = services._services_from_docker([{
        "Names": ["/valheim"], "Image": "example/valheim:1", "Labels": {},
        "Ports": [{"PublicPort": 2456, "IP": "0.0.0.0", "Type": "udp"}, {"PublicPort": 2457, "IP": "0.0.0.0", "Type": "udp"}],
    }, {
        "Names": ["/local-only"], "Image": "example/x:1", "Labels": {},
        "Ports": [{"PublicPort": 9000, "IP": "127.0.0.1", "Type": "tcp"}],
    }])
    assert found[0]["_probe"] == {"kind": "port", "host": "192.0.2.10", "port": 2456, "proto": "udp"}
    assert found[1]["_probe"] == {"kind": "port", "host": "127.0.0.1", "port": 9000, "proto": "tcp"}     # loopback only


def test_port_names_ignore_the_probe():
    assert services.port_names([port_svc("Jellyfin", 8096)]) == {8096: "Jellyfin"}
