"""Shared fixtures.

Every address that can be a documentation address is one (RFC 5737:
192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24; RFC 3849: 2001:db8::/32).
The exceptions are ranges the classifier itself is defined by: the k3s pod and
service CIDRs, Tailscale's 100.64.0.0/10 and fd7a:115c:a1e0::/48, and RFC 1918
/ ULA addresses used to exercise the "any other private range" rule.
"""

import socket
from collections import namedtuple
from pathlib import Path

import pytest

from app import network

FIXTURES = Path(__file__).parent / "fixtures"

Addr = namedtuple("Addr", "family address netmask broadcast ptp")

LAN_IFACE = "enp7s0"
TS_IFACE = "tailscale0"
ZT_IFACE = "ztsjsl3deb"


def v4(address, netmask, broadcast=None):
    return Addr(socket.AF_INET, address, netmask, broadcast, None)


def v6(address, netmask):
    return Addr(socket.AF_INET6, address, netmask, None, None)


def mac(address):
    return Addr(socket.AF_PACKET, address, None, "ff:ff:ff:ff:ff:ff", None)


# What psutil.net_if_addrs() returns on the imaginary host under test.
HOST_ADDRS = {
    "lo": [v4("127.0.0.1", "255.0.0.0"), v6("::1", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")],
    LAN_IFACE: [
        v4("192.0.2.10", "255.255.255.0", "192.0.2.255"),
        v6("2001:db8:a::10", "ffff:ffff:ffff:ffff::"),
        v6("fe80::1%enp7s0", "ffff:ffff:ffff:ffff::"),
        mac("00:00:5e:00:53:01"),
    ],
    TS_IFACE: [
        v4("100.64.0.1", "255.255.255.255"),
        v6("fd7a:115c:a1e0::1", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"),
    ],
    ZT_IFACE: [v4("198.51.100.1", "255.255.255.128", "198.51.100.127")],
    "docker0": [v4("198.51.100.129", "255.255.255.192", "198.51.100.191")],
    "br-0a1b2c3d4e5f": [
        v4("198.51.100.193", "255.255.255.192", "198.51.100.255"),
        v6("2001:db8:d::1", "ffff:ffff:ffff:ffff::"),
    ],
    "cni0": [v4("10.42.0.1", "255.255.255.0", "10.42.0.255")],
    "flannel.1": [v4("10.42.0.0", "255.255.255.255")],
    "wlan-ipv6-only": [v6("2001:db8:b::10", "ffff:ffff:ffff:ffff::")],
}


class FakeApi:
    """ip-api.com batch endpoint double."""

    def __init__(self, status=200, headers=None, fail=()):
        self.calls = []
        self.status = status
        self.headers = headers if headers is not None else {"X-Rl": "14", "X-Ttl": "60"}
        self.fail = set(fail)
        self.error = None

    def __call__(self, ips):
        self.calls.append(list(ips))
        if self.error:
            raise self.error
        if self.status != 200:
            return self.status, self.headers, []
        body = []
        for address in ips:
            if address in self.fail:
                body.append({"status": "fail", "message": "reserved range", "query": address})
            else:
                body.append({
                    "status": "success", "query": address,
                    "lat": 50.0, "lon": 14.0, "city": "Prague", "country": "Czechia",
                })
        return 200, self.headers, body


def read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


@pytest.fixture
def nets():
    return network.host_nets(HOST_ADDRS, LAN_IFACE, ZT_IFACE)


@pytest.fixture
def flows_v4():
    return network.parse_conntrack(read_fixture("conntrack_v4_acct.txt"))


@pytest.fixture
def flows_v6():
    return network.parse_conntrack(read_fixture("conntrack_v6_acct.txt"))


@pytest.fixture
def flows_noacct():
    return network.parse_conntrack(read_fixture("conntrack_noacct.txt"))
