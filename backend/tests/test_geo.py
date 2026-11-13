from app import geo


class Clock:
    def __init__(self, now=1_000_000.0):
        self.now = now

    def __call__(self):
        return self.now


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


def test_resolves_and_caches():
    api, clock = FakeApi(fail={"203.0.113.2"}), Clock()
    locator = geo.GeoLocator(fetch=api, clock=clock)

    first = locator.resolve(["203.0.113.1", "203.0.113.2"])
    assert first["203.0.113.1"] == {"lat": 50.0, "lng": 14.0, "city": "Prague", "country": "Czechia"}
    assert first["203.0.113.2"] == geo.FAILED

    assert locator.resolve(["203.0.113.1", "203.0.113.2"]) == first
    assert len(api.calls) == 1               # second call answered from the cache


def test_cache_lasts_24_hours():
    api, clock = FakeApi(), Clock()
    locator = geo.GeoLocator(fetch=api, clock=clock)
    locator.resolve(["203.0.113.1"])

    clock.now += 24 * 3600 - 1
    locator.resolve(["203.0.113.1"])
    assert len(api.calls) == 1

    clock.now += 2
    locator.resolve(["203.0.113.1"])
    assert len(api.calls) == 2


def test_one_batch_of_100_per_call_the_rest_is_pending():
    api, clock = FakeApi(), Clock()
    locator = geo.GeoLocator(fetch=api, clock=clock)
    ips = [f"203.0.113.{i}" for i in range(1, 151)]

    first = locator.resolve(ips)
    assert len(api.calls) == 1
    assert api.calls[0] == ips[:100]                         # most important first
    assert all(isinstance(first[address], dict) for address in ips[:100])
    assert all(first[address] == geo.PENDING for address in ips[100:])    # reported, not dropped

    second = locator.resolve(ips)
    assert api.calls[1] == ips[100:]
    assert all(isinstance(second[address], dict) for address in ips)


def test_honours_x_rl_and_x_ttl():
    api, clock = FakeApi(headers={"X-Rl": "0", "X-Ttl": "42"}), Clock()
    locator = geo.GeoLocator(fetch=api, clock=clock)

    assert isinstance(locator.resolve(["203.0.113.1"])["203.0.113.1"], dict)   # this answer still counts
    assert locator.resolve(["203.0.113.2"]) == {"203.0.113.2": geo.PENDING}
    assert len(api.calls) == 1               # budget exhausted: no request

    clock.now += 41
    locator.resolve(["203.0.113.2"])
    assert len(api.calls) == 1

    clock.now += 2
    api.headers = {"X-Rl": "14", "X-Ttl": "60"}
    assert isinstance(locator.resolve(["203.0.113.2"])["203.0.113.2"], dict)
    assert len(api.calls) == 2


def test_http_429_backs_off_for_x_ttl():
    api, clock = FakeApi(status=429, headers={"X-Rl": "0", "X-Ttl": "30"}), Clock()
    locator = geo.GeoLocator(fetch=api, clock=clock)

    assert locator.resolve(["203.0.113.1"]) == {"203.0.113.1": geo.PENDING}
    locator.resolve(["203.0.113.1"])
    assert len(api.calls) == 1

    clock.now += 31
    api.status = 200
    assert isinstance(locator.resolve(["203.0.113.1"])["203.0.113.1"], dict)


def test_network_error_backs_off_and_stays_pending():
    api, clock = FakeApi(), Clock()
    api.error = OSError("unreachable")
    locator = geo.GeoLocator(fetch=api, clock=clock)

    assert locator.resolve(["203.0.113.1"]) == {"203.0.113.1": geo.PENDING}
    locator.resolve(["203.0.113.1"])
    assert len(api.calls) == 1

    clock.now += geo.ERROR_BACKOFF + 1
    api.error = None
    assert isinstance(locator.resolve(["203.0.113.1"])["203.0.113.1"], dict)


def test_cache_is_bounded_to_5000_entries():
    api, clock = FakeApi(), Clock()
    locator = geo.GeoLocator(fetch=api, clock=clock)
    for block in range(52):
        locator.resolve([f"2001:db8:ffff:{block:x}::{host:x}" for host in range(1, 101)])
    assert len(api.calls) == 52
    assert len(locator) == geo.CACHE_MAX == 5000

    # The oldest entries were evicted, the newest kept.
    assert locator.resolve(["2001:db8:ffff:33::1"]) != {"2001:db8:ffff:33::1": geo.PENDING}
    assert len(api.calls) == 52
    locator.resolve(["2001:db8:ffff:0::1"])
    assert len(api.calls) == 53


def test_ipv6_answers_match_even_when_spelled_differently():
    def api(ips):
        return 200, {}, [{
            "status": "success", "query": "2001:0db8:ffff:0000:0000:0000:0000:0009",
            "lat": 1.5, "lon": 2.5, "city": "X", "country": "Y",
        }]

    locator = geo.GeoLocator(fetch=api, clock=Clock())
    assert locator.resolve(["2001:db8:ffff::9"])["2001:db8:ffff::9"]["lat"] == 1.5


def test_unanswered_and_malformed_entries_become_failures_not_retries():
    calls = []

    def api(ips):
        calls.append(list(ips))
        return 200, {}, [
            {"status": "success", "query": "203.0.113.1", "lat": "north", "lon": 2.0},
            "garbage",
        ]

    locator = geo.GeoLocator(fetch=api, clock=Clock())
    result = locator.resolve(["203.0.113.1", "203.0.113.2"])
    assert result == {"203.0.113.1": geo.FAILED, "203.0.113.2": geo.FAILED}
    locator.resolve(["203.0.113.1", "203.0.113.2"])
    assert len(calls) == 1
