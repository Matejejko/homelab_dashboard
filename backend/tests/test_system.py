from app import system

from .conftest import HOST_ADDRS, LAN_IFACE, TS_IFACE, ZT_IFACE


def test_iface_ipv4_resolves_named_interfaces():
    assert system.iface_ipv4(LAN_IFACE, HOST_ADDRS) == "192.0.2.10"
    assert system.iface_ipv4(TS_IFACE, HOST_ADDRS) == "100.64.0.1"
    assert system.iface_ipv4(ZT_IFACE, HOST_ADDRS) == "198.51.100.1"


def test_iface_ipv4_is_empty_for_a_missing_interface():
    assert system.iface_ipv4("eth-does-not-exist", HOST_ADDRS) == ""


def test_iface_ipv4_is_empty_without_an_ipv4_address():
    assert system.iface_ipv4("wlan-ipv6-only", HOST_ADDRS) == ""


def test_iface_ipv4_is_empty_for_an_empty_name():
    assert system.iface_ipv4("", HOST_ADDRS) == ""


def test_config_is_resolved_from_env_named_interfaces_on_every_call(monkeypatch):
    current = dict(HOST_ADDRS)
    monkeypatch.setattr(system.psutil, "net_if_addrs", lambda: current)
    monkeypatch.setenv("DASHBOARD_LAN_IFACE", LAN_IFACE)
    monkeypatch.setenv("DASHBOARD_TS_IFACE", TS_IFACE)
    monkeypatch.setenv("DASHBOARD_ZT_IFACE", "zt-not-there")
    monkeypatch.setenv("DASHBOARD_SERVER_LAT", "48.946")
    monkeypatch.setenv("DASHBOARD_SERVER_LNG", "20.566")

    assert system.get_config() == {
        "lan_ip": "192.0.2.10", "zt_ip": "", "ts_ip": "100.64.0.1",
        "server_lat": 48.946, "server_lng": 20.566,
    }

    # The interface comes up later / changes address: the next call sees it.
    current[TS_IFACE] = [HOST_ADDRS[TS_IFACE][0]._replace(address="100.64.0.99")]
    del current[LAN_IFACE]
    config = system.get_config()
    assert config["ts_ip"] == "100.64.0.99"
    assert config["lan_ip"] == ""


def test_config_without_any_env(monkeypatch):
    for name in ("DASHBOARD_LAN_IFACE", "DASHBOARD_TS_IFACE", "DASHBOARD_ZT_IFACE",
                 "DASHBOARD_SERVER_LAT", "DASHBOARD_SERVER_LNG"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(system.psutil, "net_if_addrs", lambda: HOST_ADDRS)
    assert system.get_config() == {
        "lan_ip": "", "zt_ip": "", "ts_ip": "", "server_lat": 0.0, "server_lng": 0.0,
    }


def test_bad_coordinates_fall_back_to_unset(monkeypatch):
    monkeypatch.setenv("DASHBOARD_SERVER_LAT", "north")
    monkeypatch.setenv("DASHBOARD_SERVER_LNG", "720")
    assert system.server_location() == (0.0, 0.0)


def test_system_shape():
    data = system.get_system()
    assert set(data) == {"cpu", "ram", "disks", "uptime", "temp_c", "network"}
    assert set(data["cpu"]) == {"percent", "cores", "threads", "freq_mhz", "load_avg"}
    assert set(data["ram"]) == {"total_gb", "used_gb", "free_gb", "percent"}
    assert set(data["uptime"]) == {"days", "hours", "minutes", "total_seconds"}
    assert set(data["network"]) == {"rx_mb_s", "tx_mb_s"}
    assert isinstance(data["disks"], list)
    for disk in data["disks"]:
        assert set(disk) == {"mount", "device", "fstype", "total_gb", "used_gb", "free_gb", "pct"}
