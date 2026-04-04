"""
Homelab Dashboard — Backend API (k3s edition)
Reads host system stats via mounted /proc and /sys volumes.
Services config is loaded from /config/services.json (a ConfigMap mount).
"""

import json
import os
import time
import asyncio
from pathlib import Path

import psutil
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Homelab Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ─── Path config ──────────────────────────────────────────────────────────────
# In k3s the pod mounts:
#   hostPath /proc → container /host/proc
#   hostPath /sys  → container /host/sys
#   hostPath /     → container /host/root   (for disk stats)
#
# We point psutil at the host paths via environment variables.
# When running locally (non-k3s) these default to the real paths.
HOST_PROC = os.environ.get("HOST_PROC", "/proc")
HOST_SYS  = os.environ.get("HOST_SYS",  "/sys")
HOST_ROOT = os.environ.get("HOST_ROOT", "/")      # base for disk partitions

# Tell psutil to use our (possibly remapped) /proc
os.environ["PROC_PATH"] = HOST_PROC   # psutil respects this on Linux

# Services list comes from a ConfigMap mounted at /config/services.json
# Fall back to a local file for development
SERVICES_FILE = Path(os.environ.get("SERVICES_FILE", "/config/services.json"))
if not SERVICES_FILE.exists():
    SERVICES_FILE = Path(__file__).parent / "services.json"

def load_services() -> list[dict]:
    with open(SERVICES_FILE) as f:
        return json.load(f)

# ─── Helpers ──────────────────────────────────────────────────────────────────
def _read_host_file(rel_path: str) -> str | None:
    """Read a file from the host-mounted /proc or /sys tree."""
    for base in (HOST_PROC, HOST_SYS):
        p = Path(base) / rel_path
        if p.exists():
            try:
                return p.read_text().strip()
            except OSError:
                pass
    return None

def _host_temp() -> float | None:
    """Read CPU temp from the host /sys tree."""
    # Try hwmon sensors first (most common on x86 / Pi)
    for hwmon in sorted(Path(HOST_SYS).glob("class/hwmon/hwmon*")):
        name_file = hwmon / "name"
        name = name_file.read_text().strip() if name_file.exists() else ""
        if name in ("coretemp", "k10temp", "cpu_thermal", "it8686"):
            for temp_input in sorted(hwmon.glob("temp*_input")):
                try:
                    millideg = int(temp_input.read_text().strip())
                    return round(millideg / 1000, 1)
                except (ValueError, OSError):
                    pass
    # Fallback: acpitz / thermal_zone
    for zone in sorted(Path(HOST_SYS).glob("class/thermal/thermal_zone*")):
        try:
            temp_file = zone / "temp"
            return round(int(temp_file.read_text().strip()) / 1000, 1)
        except (ValueError, OSError):
            pass
    return None

# ─── /api/system ─────────────────────────────────────────────────────────────
@app.get("/api/system")
def get_system():
    # ── CPU ──────────────────────────────────────────────────────────────────
    cpu_pct     = psutil.cpu_percent(interval=1)
    cpu_freq    = psutil.cpu_freq()
    cpu_cores   = psutil.cpu_count(logical=False)
    cpu_threads = psutil.cpu_count(logical=True)
    try:
        load_avg = [round(x, 2) for x in os.getloadavg()]
    except (AttributeError, OSError):
        load_avg = [0.0, 0.0, 0.0]

    # ── RAM ───────────────────────────────────────────────────────────────────
    mem = psutil.virtual_memory()

    # ── Disks ─────────────────────────────────────────────────────────────────
    disks = []
    skip_fs = {"tmpfs", "devtmpfs", "squashfs", "overlay", "aufs", "nsfs"}
    for part in psutil.disk_partitions(all=False):
        if any(s in part.fstype for s in skip_fs):
            continue
        # Remap mount point to host root when running in k3s
        mount = part.mountpoint
        if HOST_ROOT != "/":
            probe = str(Path(HOST_ROOT) / mount.lstrip("/"))
        else:
            probe = mount
        try:
            usage = psutil.disk_usage(probe)
            disks.append({
                "mount":    mount,
                "device":   part.device,
                "fstype":   part.fstype,
                "total_gb": round(usage.total / 1e9, 1),
                "used_gb":  round(usage.used  / 1e9, 1),
                "free_gb":  round(usage.free  / 1e9, 1),
                "pct":      usage.percent,
            })
        except (PermissionError, FileNotFoundError):
            pass

    # ── Uptime ────────────────────────────────────────────────────────────────
    # Read from host /proc/uptime directly for accuracy
    uptime_secs = 0
    try:
        raw = (Path(HOST_PROC) / "uptime").read_text()
        uptime_secs = int(float(raw.split()[0]))
    except Exception:
        uptime_secs = int(time.time() - psutil.boot_time())

    days    = uptime_secs // 86400
    hours   = (uptime_secs % 86400) // 3600
    minutes = (uptime_secs % 3600) // 60

    # ── Temperature ───────────────────────────────────────────────────────────
    temp_c = _host_temp()

    # ── Network I/O ───────────────────────────────────────────────────────────
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
