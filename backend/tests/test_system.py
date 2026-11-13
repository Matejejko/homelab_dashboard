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
    assert set(data["cpu"]) == {"percent", "cores", "threads", "freq_mhz", "load_avg", "model"}
    assert isinstance(data["cpu"]["model"], str)
    assert set(data["ram"]) == {"total_gb", "used_gb", "free_gb", "percent"}
    assert set(data["uptime"]) == {"days", "hours", "minutes", "total_seconds"}
    assert set(data["network"]) == {"rx_mb_s", "tx_mb_s", "iface"}
    assert data["network"]["rx_mb_s"] >= 0 and data["network"]["tx_mb_s"] >= 0
    assert isinstance(data["disks"], list)
    for disk in data["disks"]:
        assert set(disk) == {"mount", "device", "fstype", "total_gb", "used_gb", "free_gb", "pct"}


# ─── CPU model and per-interface throughput (for the graph cards) ────────────

@pytest.fixture
def fresh_cpu_model(monkeypatch):
    monkeypatch.setattr(system, "_cpu_model", None)


@pytest.mark.parametrize("cpuinfo, expected", [
    ("processor\t: 0\nvendor_id\t: GenuineIntel\nmodel\t\t: 94\nmodel name\t: Intel(R) Core(TM) i5-6500T CPU @ 2.50GHz\n",
     "Intel Core i5-6500T CPU @ 2.50GHz"),
    ("processor\t: 0\nBogoMIPS\t: 108.00\n\nHardware\t: BCM2835\nModel\t\t: Raspberry Pi 4 Model B Rev 1.4\n",
     "Raspberry Pi 4 Model B Rev 1.4"),
    ("processor\t: 0\nBogoMIPS\t: 50.00\n", ""),
    ("", ""),
])
def test_cpu_model_is_read_from_host_cpuinfo(tmp_path, monkeypatch, fresh_cpu_model, cpuinfo, expected):
    (tmp_path / "cpuinfo").write_text(cpuinfo)
    monkeypatch.setenv("HOST_PROC", str(tmp_path))
    assert system.cpu_model() == expected


def test_cpu_model_without_cpuinfo_is_empty_and_retried(tmp_path, monkeypatch, fresh_cpu_model):
    monkeypatch.setenv("HOST_PROC", str(tmp_path))
    assert system.cpu_model() == ""
    (tmp_path / "cpuinfo").write_text("model name : Example CPU\n")
    assert system.cpu_model() == "Example CPU"


class FakeCounters:
    def __init__(self, recv, sent):
        self.bytes_recv, self.bytes_sent = recv, sent


def test_network_rate_is_measured_on_the_lan_interface(monkeypatch):
    calls = []

    def counters(pernic=False):
        calls.append(pernic)
        step = (len(calls) - 1) * 1_000_000          # +1 MB on the LAN NIC between the two reads
        per_nic = {
            LAN_IFACE: FakeCounters(5_000_000 + step, 2_000_000 + step // 2),
            "cni0": FakeCounters(900_000_000 + 50 * step, 900_000_000 + 50 * step),
            "lo": FakeCounters(10**12, 10**12),
        }
        return per_nic if pernic else FakeCounters(10**12, 10**12)

    monkeypatch.setenv("DASHBOARD_LAN_IFACE", LAN_IFACE)
    monkeypatch.setattr(system.psutil, "net_io_counters", counters)
    monkeypatch.setattr(system.psutil, "cpu_percent", lambda interval: 12.5)
    monkeypatch.setattr(system.time, "monotonic", iter([100.0, 101.0]).__next__)

    network = system.get_system()["network"]
    assert network == {"rx_mb_s": 1.0, "tx_mb_s": 0.5, "iface": LAN_IFACE}
    assert calls == [True, True]


def test_network_rate_falls_back_to_every_interface(monkeypatch):
    def counters(pernic=False):
        return {"eth9": FakeCounters(0, 0)} if pernic else FakeCounters(7_000_000, 3_000_000)

    monkeypatch.setenv("DASHBOARD_LAN_IFACE", "not-there0")
    monkeypatch.setattr(system.psutil, "net_io_counters", counters)
    monkeypatch.setattr(system.psutil, "cpu_percent", lambda interval: 1.0)
    network = system.get_system()["network"]
    assert network["iface"] == ""
    assert (network["rx_mb_s"], network["tx_mb_s"]) == (0.0, 0.0)
