import logging

import pytest

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


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHBOARD_DATA_DIR", str(tmp_path))
    return tmp_path


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
        "server_lat": 48.946, "server_lng": 20.566, "tile_key": "",
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
        "lan_ip": "", "zt_ip": "", "ts_ip": "", "server_lat": 0.0, "server_lng": 0.0, "tile_key": "",
    }


# ─── Map tile key file ───────────────────────────────────────────────────────

SAMPLE_KEY = "Abc123_exampleKey-xyz.789"       # made up; CARTO keys are case-sensitive


def test_tile_key_is_empty_without_the_file():
    assert system.tile_key() == ""
    assert system.get_config()["tile_key"] == ""


def test_tile_key_is_read_from_the_data_dir_and_keeps_its_case(data_dir):
    (data_dir / "carto-api-key").write_text(f"  {SAMPLE_KEY}\n\n")
    assert system.tile_key() == SAMPLE_KEY
    assert system.get_config()["tile_key"] == SAMPLE_KEY


def test_tile_key_changes_are_picked_up_without_a_restart(data_dir):
    path = data_dir / "carto-api-key"
    path.write_text("first-key\n")
    assert system.tile_key() == "first-key"
    path.write_text("second-key\n")
    assert system.tile_key() == "second-key"
    path.unlink()
    assert system.tile_key() == ""


@pytest.mark.parametrize("content", [
    "",
    "\n\n",
    "two words",
    "key-one\nkey-two\n",
    "kľúč-with-non-ascii",
    "tab\tseparated",
    "x" * 513,
])
def test_unusable_tile_key_files_are_ignored(data_dir, content):
    (data_dir / "carto-api-key").write_text(content, encoding="utf-8")
    assert system.tile_key() == ""


def test_tile_key_is_never_logged(data_dir, caplog):
    path = data_dir / "carto-api-key"
    with caplog.at_level(logging.DEBUG):
        path.write_text(f"{SAMPLE_KEY}\n")
        system.get_config()
        path.write_text(f"{SAMPLE_KEY} trailing-word\n")       # unusable: warns once
        system.get_config()
        system.get_config()
    assert SAMPLE_KEY not in caplog.text
    warnings = [r for r in caplog.records if r.name == "homelab.system"]
    assert len(warnings) == 1 and "carto-api-key is ignored" in warnings[0].getMessage()


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
