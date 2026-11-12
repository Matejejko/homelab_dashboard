"""Host metrics and server identity.

The pod runs with hostNetwork/hostPID and the host's /proc, /sys and / mounted
in, so psutil and the files below describe the node, not the container.
"""

import logging
import os
import socket
import time
from pathlib import Path

import psutil

logger = logging.getLogger("homelab.system")


def host_proc() -> Path:
    return Path(os.environ.get("HOST_PROC", "/proc"))


def host_sys() -> Path:
    return Path(os.environ.get("HOST_SYS", "/sys"))


def host_root() -> Path:
    return Path(os.environ.get("HOST_ROOT", "/"))


def data_dir() -> Path:
    """Persistent state: the account file and, optionally, the map tile key."""
    return Path(os.environ.get("DASHBOARD_DATA_DIR", "/data"))


# ─── Server identity ─────────────────────────────────────────────────────────

def iface_ipv4(name: str, addrs: dict | None = None) -> str:
    """IPv4 address of a named interface, or "" when it is missing or has none.

    `addrs` is the psutil.net_if_addrs() mapping; it is read live when omitted.
    """
    if not name:
        return ""
    if addrs is None:
        addrs = psutil.net_if_addrs()
    for addr in addrs.get(name, ()):
        if addr.family == socket.AF_INET and addr.address:
            return addr.address
    return ""


def lan_iface() -> str:
    return os.environ.get("DASHBOARD_LAN_IFACE", "").strip()


def ts_iface() -> str:
    return os.environ.get("DASHBOARD_TS_IFACE", "").strip()


def zt_iface() -> str:
    return os.environ.get("DASHBOARD_ZT_IFACE", "").strip()


def _coord(env_name: str, limit: float) -> float:
    try:
        value = float(os.environ.get(env_name, "0") or "0")
    except ValueError:
        return 0.0
    return value if -limit <= value <= limit else 0.0


def server_location() -> tuple[float, float]:
    """Configured (lat, lng). (0, 0) means "not configured"."""
    return _coord("DASHBOARD_SERVER_LAT", 90.0), _coord("DASHBOARD_SERVER_LNG", 180.0)


TILE_KEY_FILE = "carto-api-key"
TILE_KEY_MAX = 512
_warned_bad_tile_key = False


def tile_key() -> str:
    """CARTO Basemaps API key from $DASHBOARD_DATA_DIR/carto-api-key, or "".

    The file is read on every call, so saving a new key needs no restart. The
    key lives outside the repository and the manifests on purpose, and it is
    never logged.
    """
    global _warned_bad_tile_key
    try:
        with (data_dir() / TILE_KEY_FILE).open("r", encoding="utf-8", errors="replace") as handle:
            text = handle.read(4096)
    except OSError:
        return ""

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    key = lines[0]
    # One line of visible ASCII. The case is kept: CARTO keys are case-sensitive.
    if len(lines) > 1 or len(key) > TILE_KEY_MAX or not all("!" <= ch <= "~" for ch in key):
        if not _warned_bad_tile_key:
            _warned_bad_tile_key = True
            logger.warning(
                "%s is ignored: it must hold the key alone, on one line, without spaces", TILE_KEY_FILE,
            )
        return ""
    _warned_bad_tile_key = False
    return key


def get_config() -> dict:
    """Server addresses, resolved from the named interfaces on every call."""
    addrs = psutil.net_if_addrs()
    lat, lng = server_location()
    return {
        "lan_ip": iface_ipv4(lan_iface(), addrs),
        "zt_ip": iface_ipv4(zt_iface(), addrs),
        "ts_ip": iface_ipv4(ts_iface(), addrs),
        "server_lat": lat,
        "server_lng": lng,
        "tile_key": tile_key(),
    }


# ─── Host metrics ────────────────────────────────────────────────────────────

_TEMP_SENSORS = ("coretemp", "k10temp", "cpu_thermal", "it8686")

_SKIP_FS = {
    "tmpfs", "devtmpfs", "squashfs", "overlay", "aufs", "nsfs",
    "cgroup", "cgroup2", "proc", "sysfs", "devpts", "mqueue",
    "hugetlbfs", "debugfs", "tracefs", "securityfs", "pstore",
    "bpf", "fusectl", "configfs", "ramfs", "rpc_pipefs",
    "nfsd", "efivarfs", "autofs", "fuse.shm", "fuse.snapfuse",
}


def _host_temp() -> float | None:
    sys_root = host_sys()
    for hwmon in sorted(sys_root.glob("class/hwmon/hwmon*")):
        try:
            name = (hwmon / "name").read_text().strip()
        except OSError:
            name = ""
        if name in _TEMP_SENSORS:
            for temp_input in sorted(hwmon.glob("temp*_input")):
                try:
                    return round(int(temp_input.read_text().strip()) / 1000, 1)
                except (ValueError, OSError):
                    pass
    for zone in sorted(sys_root.glob("class/thermal/thermal_zone*")):
        try:
            return round(int((zone / "temp").read_text().strip()) / 1000, 1)
        except (ValueError, OSError):
            pass
    return None


def _host_disks() -> list[dict]:
    """Real host filesystems, read from PID 1's mount table."""
    proc = host_proc()
    root = host_root()
    mounts_path = proc / "1" / "mounts"
    if not mounts_path.exists():
        mounts_path = proc / "mounts"

    wanted = {
        d.strip() for d in os.environ.get("DASHBOARD_DISKS", "").split(",") if d.strip()
    }

    try:
        lines = mounts_path.read_text().splitlines()
    except OSError:
        return []

    disks: list[dict] = []
    seen_devs: set[str] = set()
    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        dev, mount, fstype = parts[0], parts[1], parts[2]
        if fstype in _SKIP_FS or not dev.startswith("/dev/") or "/loop" in dev:
            continue
        if dev in seen_devs:
            continue
        seen_devs.add(dev)
        if wanted and mount not in wanted and dev not in wanted:
            continue

        probe = str(root / mount.lstrip("/")) if str(root) != "/" else mount
        try:
            usage = psutil.disk_usage(probe)
        except OSError:
            continue
        disks.append({
            "mount":    mount,
            "device":   dev,
            "fstype":   fstype,
            "total_gb": round(usage.total / 1e9, 1),
            "used_gb":  round(usage.used  / 1e9, 1),
            "free_gb":  round(usage.free  / 1e9, 1),
            "pct":      usage.percent,
        })
    return disks


def get_system() -> dict:
    """Blocking (samples for one second). Call it off the event loop."""
    net_before = psutil.net_io_counters()
    started = time.monotonic()
    cpu_pct = psutil.cpu_percent(interval=1)
    net_after = psutil.net_io_counters()
    elapsed = max(time.monotonic() - started, 1e-3)

    cpu_freq = psutil.cpu_freq()
    try:
        load_avg = [round(x, 2) for x in os.getloadavg()]
    except (AttributeError, OSError):
        load_avg = [0.0, 0.0, 0.0]

    mem = psutil.virtual_memory()

    try:
        raw = (host_proc() / "uptime").read_text()
        uptime_secs = int(float(raw.split()[0]))
    except (OSError, ValueError, IndexError):
        uptime_secs = int(time.time() - psutil.boot_time())

    return {
        "cpu": {
            "percent": cpu_pct,
            "cores": psutil.cpu_count(logical=False),
            "threads": psutil.cpu_count(logical=True),
            "freq_mhz": round(cpu_freq.current) if cpu_freq else None,
            "load_avg": load_avg,
        },
        "ram": {
            "total_gb": round(mem.total / 1e9, 1),
            "used_gb": round(mem.used / 1e9, 1),
            "free_gb": round(mem.available / 1e9, 1),
            "percent": mem.percent,
        },
        "disks": _host_disks(),
        "uptime": {
            "days": uptime_secs // 86400,
            "hours": (uptime_secs % 86400) // 3600,
            "minutes": (uptime_secs % 3600) // 60,
            "total_seconds": uptime_secs,
        },
        "temp_c": _host_temp(),
        "network": {
            "rx_mb_s": round((net_after.bytes_recv - net_before.bytes_recv) / 1e6 / elapsed, 2),
            "tx_mb_s": round((net_after.bytes_sent - net_before.bytes_sent) / 1e6 / elapsed, 2),
        },
    }
