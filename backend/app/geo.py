"""IP geolocation through the ip-api.com batch endpoint.

The free endpoint is HTTP only, allows 15 batch requests a minute and reports
its budget in the X-Rl (requests left) and X-Ttl (seconds to reset) headers.
Results are city-level estimates at best.
"""

import ipaddress
import logging
import threading
import time
from collections import OrderedDict

import httpx

logger = logging.getLogger("homelab.geo")

BATCH_URL = "http://ip-api.com/batch?fields=status,message,query,lat,lon,city,country"
BATCH_SIZE = 100
CACHE_TTL = 24 * 3600
CACHE_MAX = 5000
REQUEST_TIMEOUT = 4.0
ERROR_BACKOFF = 60.0

# resolve() results
PENDING = "pending"        # not looked up yet
FAILED = "lookup_failed"   # ip-api could not place it (reserved range, ...)


def _http_fetch(ips: list[str]) -> tuple[int, dict, list]:
    """POST one batch. Returns (status code, headers, parsed body)."""
    with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
        response = client.post(BATCH_URL, json=ips)
    body = response.json() if response.status_code == 200 else []
    return response.status_code, dict(response.headers), body


def _normalise(ip) -> str | None:
    try:
        return str(ipaddress.ip_address(ip))
    except ValueError:
        return None


def _header_int(headers: dict, name: str) -> int | None:
    for key, value in headers.items():
        if key.lower() == name:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None


class GeoLocator:
    """Bounded 24 h cache in front of ip-api.com. Thread-safe."""

    def __init__(self, fetch=_http_fetch, clock=time.time):
        self._fetch = fetch
        self._clock = clock
        self._lock = threading.Lock()
        self._fetching = False
        # ip -> (stored_at, location dict | None for a failed lookup)
        self._cache: OrderedDict[str, tuple[float, dict | None]] = OrderedDict()
        self._blocked_until = 0.0

    # No __len__ on purpose: Python treats an object whose __len__ is 0 as
    # false, and a locator with an empty cache must still pass `if locator`.
    def cache_size(self) -> int:
        with self._lock:
            return len(self._cache)

    def _cached(self, ip: str, now: float):
        """Return (hit, location)."""
        entry = self._cache.get(ip)
        if entry is None:
            return False, None
        if now - entry[0] >= CACHE_TTL:
            del self._cache[ip]
            return False, None
        return True, entry[1]

    def _store(self, ip: str, location: dict | None, now: float) -> None:
        self._cache[ip] = (now, location)
        self._cache.move_to_end(ip)
        while len(self._cache) > CACHE_MAX:
            self._cache.popitem(last=False)

    def resolve(self, ips: list[str]) -> dict[str, dict | str]:
        """Locate `ips`, most important first.

        Sends at most one batch of BATCH_SIZE per call and none while the rate
        limit says to wait. Every IP maps to a location dict, FAILED or PENDING.
        """
        wanted = list(dict.fromkeys(ips))
        with self._lock:
            now = self._clock()
            missing = [ip for ip in wanted if not self._cached(ip, now)[0]]
            batch = missing[:BATCH_SIZE]
            may_fetch = bool(batch) and not self._fetching and now >= self._blocked_until
            if may_fetch:
                self._fetching = True

        if may_fetch:
            try:
                self._run_batch(batch)
            finally:
                with self._lock:
                    self._fetching = False

        results: dict[str, dict | str] = {}
        with self._lock:
            now = self._clock()
            for ip in wanted:
                hit, location = self._cached(ip, now)
                if not hit:
                    results[ip] = PENDING
                elif location is None:
                    results[ip] = FAILED
                else:
                    results[ip] = dict(location)
        return results

    def _run_batch(self, batch: list[str]) -> None:
        try:
            status, headers, body = self._fetch(batch)
        except Exception as exc:
            logger.warning("geolocation request failed: %s", type(exc).__name__)
            with self._lock:
                self._blocked_until = self._clock() + ERROR_BACKOFF
            return

        remaining = _header_int(headers, "x-rl")
        reset_in = _header_int(headers, "x-ttl")

        with self._lock:
            now = self._clock()
            if status == 429 or remaining == 0:
                # Out of budget: stay silent until the window resets.
                self._blocked_until = now + (reset_in if reset_in and reset_in > 0 else ERROR_BACKOFF)
            if status != 200 or not isinstance(body, list):
                if status != 429:
                    logger.warning("geolocation request returned HTTP %s", status)
                    self._blocked_until = max(self._blocked_until, now + ERROR_BACKOFF)
                return

            # The echoed "query" may be spelled differently (IPv6), so compare
            # parsed addresses, never strings.
            asked = {_normalise(ip): ip for ip in batch}
            answered: set[str] = set()
            for item in body:
                if not isinstance(item, dict):
                    continue
                ip = asked.get(_normalise(item.get("query")))
                if ip is None:
                    continue
                answered.add(ip)
                lat, lng = item.get("lat"), item.get("lon")
                if (
                    item.get("status") == "success"
                    and isinstance(lat, (int, float)) and isinstance(lng, (int, float))
                    and not isinstance(lat, bool) and not isinstance(lng, bool)
                    and -90 <= lat <= 90 and -180 <= lng <= 180
                ):
                    self._store(ip, {
                        "lat": float(lat),
                        "lng": float(lng),
                        "city": str(item.get("city") or ""),
                        "country": str(item.get("country") or ""),
                    }, now)
                else:
                    self._store(ip, None, now)
            # An IP the service skipped must not be asked again every poll.
            for ip in batch:
                if ip not in answered:
                    self._store(ip, None, now)
