"""
Homelab Dashboard — Backend API
Reads real system stats via psutil and checks service health via HTTP.
"""

import json
import time
import asyncio
from pathlib import Path

import psutil
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ─── App Setup ────────────────────────────────────────────────────────────────
app = FastAPI(title="Homelab Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten this to your LAN if you want
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ─── Load services config ─────────────────────────────────────────────────────
SERVICES_FILE = Path(__file__).parent / "services.json"

def load_services():
    with open(SERVICES_FILE) as f:
        return json.load(f)

# ─── /api/system ─────────────────────────────────────────────────────────────
@app.get("/api/system")
def get_system():
    # CPU (1-second blocking sample for accuracy)
    cpu_pct = psutil.cpu_percent(interval=1)
    cpu_freq = psutil.cpu_freq()
    cpu_cores = psutil.cpu_count(logical=False)
    cpu_threads = psutil.cpu_count(logical=True)
    load_avg = [round(x, 2) for x in psutil.getloadavg()]

    # RAM
    mem = psutil.virtual_memory()

    # Disks — only real mounted filesystems, skip tmpfs/devtmpfs/etc.
    disks = []
    for part in psutil.disk_partitions(all=False):
        if any(skip in part.fstype for skip in ("tmpfs", "devtmpfs", "squashfs", "overlay")):
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                "mount":  part.mountpoint,
                "device": part.device,
                "fstype": part.fstype,
                "total":  round(usage.total / 1e9, 1),   # GB
                "used":   round(usage.used  / 1e9, 1),
                "free":   round(usage.free  / 1e9, 1),
                "pct":    usage.percent,
            })
        except PermissionError:
            pass

    # Uptime
    boot_ts = psutil.boot_time()
    uptime_secs = int(time.time() - boot_ts)
    days    = uptime_secs // 86400
    hours   = (uptime_secs % 86400) // 3600
    minutes = (uptime_secs % 3600) // 60
    seconds = uptime_secs % 60

    # Temperature (best-effort — not all systems expose this)
    temp_c = None
    try:
        temps = psutil.sensors_temperatures()
        # Try common sensor names in priority order
        for sensor_name in ("coretemp", "cpu_thermal", "k10temp", "acpitz", "it8686"):
            if sensor_name in temps and temps[sensor_name]:
                temp_c = round(temps[sensor_name][0].current, 1)
                break
    except (AttributeError, NotImplementedError):
        pass  # Windows or unsupported platform

    # Network I/O (delta over 1 second)
    net1 = psutil.net_io_counters()
    time.sleep(0.5)
    net2 = psutil.net_io_counters()
    rx_mb = round((net2.bytes_recv - net1.bytes_recv) / 1e6 / 0.5, 2)
    tx_mb = round((net2.bytes_sent - net1.bytes_sent) / 1e6 / 0.5, 2)

    return {
        "cpu": {
            "percent": cpu_pct,
            "cores":   cpu_cores,
            "threads": cpu_threads,
            "freq_mhz": round(cpu_freq.current) if cpu_freq else None,
            "load_avg": load_avg,
        },
        "ram": {
            "total_gb": round(mem.total / 1e9, 1),
            "used_gb":  round(mem.used  / 1e9, 1),
            "free_gb":  round(mem.available / 1e9, 1),
            "percent":  mem.percent,
        },
        "disks": disks,
        "uptime": {
            "days": days, "hours": hours, "minutes": minutes, "seconds": seconds,
            "total_seconds": uptime_secs,
        },
        "temp_c": temp_c,
        "network": {
            "rx_mb_s": rx_mb,
            "tx_mb_s": tx_mb,
        },
    }

# ─── /api/services ───────────────────────────────────────────────────────────
@app.get("/api/services")
async def get_services():
    services = load_services()

    async def check(svc: dict) -> dict:
        url = svc.get("url", f"http://localhost:{svc.get('port', 80)}")
        start = time.monotonic()
        status = "offline"
        ping_ms = None
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                r = await client.get(url, follow_redirects=True)
                # Any HTTP response (even 401/403) means the service is up
                if r.status_code < 600:
                    status = "online"
                    ping_ms = round((time.monotonic() - start) * 1000)
        except Exception:
            pass
        return {**svc, "status": status, "ping_ms": ping_ms}

    results = await asyncio.gather(*[check(s) for s in services])
    return list(results)

# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "ts": time.time()}
