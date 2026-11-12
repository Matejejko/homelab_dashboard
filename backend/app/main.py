"""Homelab Dashboard backend API.

Run with:  uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000

The pod uses hostNetwork, so port 8000 is reachable from the LAN without going
through the frontend's nginx. Every protection therefore lives here.
"""

import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool

from . import auth, network, services, system


def create_app() -> FastAPI:
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    # No interactive docs and no schema: they describe the API to anyone who asks.
    app = FastAPI(title="Homelab Dashboard API", docs_url=None, redoc_url=None, openapi_url=None)

    manager = auth.AuthManager(Path(os.environ.get("DASHBOARD_DATA_DIR", "/data")))
    manager.bootstrap()
    app.state.auth = manager
    app.middleware("http")(auth.auth_middleware)
    app.include_router(auth.router)

    # Plain `def` handlers run in Starlette's thread pool, so their blocking
    # work (psutil sampling, conntrack, sockets) never stalls the event loop
    # or the health probe.

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
