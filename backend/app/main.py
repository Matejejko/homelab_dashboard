"""Homelab Dashboard backend API.

Run with:  uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
"""

import logging
import time

from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool

from . import network, services, system


def create_app() -> FastAPI:
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    app = FastAPI(title="Homelab Dashboard API")

    # Plain `def` handlers run in Starlette's thread pool, so their blocking
    # work (psutil sampling, conntrack, sockets) never stalls the event loop.

    @app.get("/api/health")
    async def health():
        return {"ok": True, "ts": time.time()}

    @app.get("/api/config")
    def get_config():
        return system.get_config()

    @app.get("/api/system")
    def get_system():
        return system.get_system()

    @app.get("/api/services")
    async def get_services():
        discovered = await run_in_threadpool(services.load_services)
        return await services.check_services(discovered)

    @app.get("/api/network")
    def get_network():
        return network.get_network()

    return app
