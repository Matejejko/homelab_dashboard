import json
import logging
import stat

import pytest
from fastapi.testclient import TestClient

from app import auth, main, network, services

BASE = "http://dashboard.test:30300"
ORIGIN = {"Origin": BASE}
NEW_SECRET = "correct horse battery staple"       # 28 characters
DATA_ROUTES = ["/api/system", "/api/services", "/api/config", "/api/network"]


class Clock:
    def __init__(self):
        self.now = 1_700_000_000.0

    def __call__(self):
        return self.now


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHBOARD_DATA_DIR", str(tmp_path / "data"))
    return tmp_path / "data"


@pytest.fixture
def app(data_dir):
    application = main.create_app()
    application.state.auth._clock = Clock()      # every test runs on a controllable clock
    return application


@pytest.fixture
def clock(app):
    return app.state.auth._clock


def make_client(app):
    return TestClient(app, base_url=BASE)


@pytest.fixture
def client(app):
    return make_client(app)


def initial_secret(data_dir) -> str:
    return (data_dir / "initial-admin-password").read_text().strip()


def login(client, secret, username="admin"):
    return client.post("/api/auth/login", json={"username": username, "password": secret}, headers=ORIGIN)


def change(client, current, new):
    return client.post(
        "/api/auth/password", json={"current_password": current, "new_password": new}, headers=ORIGIN,
    )


@pytest.fixture
def ready(client, data_dir):
    """A client that is logged in and past the forced password change."""
    assert login(client, initial_secret(data_dir)).status_code == 204
    assert change(client, initial_secret(data_dir), NEW_SECRET).status_code == 204
    return client


# ─── Enforcement ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", DATA_ROUTES + ["/api/auth/logout", "/api/devices", "/api/unknown"])
def test_api_routes_need_a_session(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated."}


@pytest.mark.parametrize("path", DATA_ROUTES)
def test_a_made_up_cookie_is_not_a_session(client, path):
    client.cookies.set(auth.COOKIE_NAME, "A" * 43)
    assert client.get(path).status_code == 401


def test_health_is_open(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert set(response.json()) == {"ok", "ts"}


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"])
def test_api_docs_are_disabled(client, ready, path):
    assert client.get(path).status_code == 404
    assert ready.get(path).status_code == 404


def test_no_cors_headers(ready):
    response = ready.get("/api/config", headers={"Origin": "http://evil.example"})
    assert not any(name.lower().startswith("access-control-") for name in response.headers)
    preflight = ready.options(
        "/api/config",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert not any(name.lower().startswith("access-control-") for name in preflight.headers)


def test_nothing_outside_api_is_routed(app, ready):
    @app.get("/debug/secrets")
    def leak():
        return {"oops": True}

    assert make_client(app).get("/debug/secrets").status_code == 404
    assert ready.get("/debug/secrets").status_code == 404


# ─── Bootstrap ───────────────────────────────────────────────────────────────

def test_bootstrap_creates_a_random_one_time_secret(app, data_dir):
    secret_file = data_dir / "initial-admin-password"
    auth_file = data_dir / "auth.json"
    secret = initial_secret(data_dir)

    assert len(secret) >= 20
    assert stat.S_IMODE(secret_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(auth_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(data_dir.stat().st_mode) == 0o700

    record = json.loads(auth_file.read_text())
    assert record["username"] == "admin"
    assert record["must_change"] is True
    assert (record["algorithm"], record["n"], record["r"], record["p"]) == ("scrypt", 2 ** 15, 8, 3)
    assert len(bytes.fromhex(record["salt"])) == 16
    assert secret not in auth_file.read_text()
    assert not list(data_dir.glob("*.tmp")) and not list(data_dir.glob(".*.tmp"))


def test_each_bootstrap_generates_a_different_secret(tmp_path, monkeypatch):
    secrets_seen = set()
    for name in ("a", "b", "c"):
        monkeypatch.setenv("DASHBOARD_DATA_DIR", str(tmp_path / name))
        main.create_app()
        secrets_seen.add(initial_secret(tmp_path / name))
    assert len(secrets_seen) == 3


def test_restart_keeps_the_existing_account(app, data_dir, client):
    secret = initial_secret(data_dir)
    before = (data_dir / "auth.json").read_text()
    restarted = make_client(main.create_app())
    assert (data_dir / "auth.json").read_text() == before
    assert initial_secret(data_dir) == secret
    assert login(restarted, secret).status_code == 204


def test_login_then_forced_change_then_data(client, data_dir):
    secret = initial_secret(data_dir)
    assert client.get("/api/auth/session").json() == {
        "authenticated": False, "username": None, "must_change_password": False,
    }

    assert login(client, secret).status_code == 204
    assert client.get("/api/auth/session").json() == {
        "authenticated": True, "username": "admin", "must_change_password": True,
    }

    for path in DATA_ROUTES:
        response = client.get(path)
        assert response.status_code == 403, path
        assert response.json()["code"] == "password_change_required"

    assert change(client, secret, NEW_SECRET).status_code == 204
    assert client.get("/api/auth/session").json() == {
        "authenticated": True, "username": "admin", "must_change_password": False,
    }
    assert client.get("/api/config").status_code == 200

    assert not (data_dir / "initial-admin-password").exists()
    record = json.loads((data_dir / "auth.json").read_text())
    assert record["must_change"] is False
    assert stat.S_IMODE((data_dir / "auth.json").stat().st_mode) == 0o600


def test_unauthenticated_clients_cannot_tell_the_one_time_secret_is_in_use(client):
    assert client.get("/api/auth/session").json()["must_change_password"] is False


# ─── Password change ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("new, code", [
    ("short", "password_too_short"),
    ("x" * 11, "password_too_short"),
    ("x" * 257, "password_too_long"),
])
def test_new_secret_length_is_enforced(client, data_dir, new, code):
    secret = initial_secret(data_dir)
    login(client, secret)
    response = change(client, secret, new)
    assert response.status_code == 400
    assert response.json()["code"] == code
    assert client.get("/api/config").status_code == 403          # still forced
    assert (data_dir / "initial-admin-password").exists()


def test_boundary_lengths_are_accepted(client, data_dir):
    secret = initial_secret(data_dir)
    login(client, secret)
    assert change(client, secret, "x" * 12).status_code == 204
    assert change(client, "x" * 12, "y" * 256).status_code == 204


def test_unchanged_secret_is_rejected(client, data_dir):
    secret = initial_secret(data_dir)
    login(client, secret)
    response = change(client, secret, secret)
    assert response.status_code == 400
    assert response.json()["code"] == "password_unchanged"
    assert client.get("/api/config").status_code == 403


def test_wrong_current_secret_is_rejected(client, data_dir):
    login(client, initial_secret(data_dir))
    response = change(client, "definitely not the one", NEW_SECRET)
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_current_password"
    assert client.get("/api/config").status_code == 403


def test_change_needs_a_session(client, data_dir):
    assert change(client, initial_secret(data_dir), NEW_SECRET).status_code == 401


def test_change_stores_a_new_salt_and_hash(ready, data_dir):
    before = json.loads((data_dir / "auth.json").read_text())
    assert change(ready, NEW_SECRET, NEW_SECRET + "!").status_code == 204
    after = json.loads((data_dir / "auth.json").read_text())
    assert after["salt"] != before["salt"]
    assert after["hash"] != before["hash"]


def test_other_sessions_end_and_this_one_rotates(app, data_dir):
    first, second = make_client(app), make_client(app)
    secret = initial_secret(data_dir)
    login(first, secret)
    login(second, secret)
    old_token = first.cookies.get(auth.COOKIE_NAME)
    assert app.state.auth.session_count() == 2

    assert change(first, secret, NEW_SECRET).status_code == 204

    assert app.state.auth.session_count() == 1
    assert second.get("/api/auth/session").json()["authenticated"] is False
    assert second.get("/api/config").status_code == 401
    assert first.get("/api/config").status_code == 200

    new_token = first.cookies.get(auth.COOKIE_NAME)
    assert new_token and new_token != old_token
    stale = make_client(app)
    stale.cookies.set(auth.COOKIE_NAME, old_token)
    assert stale.get("/api/config").status_code == 401

    # The old secret no longer works; the new one does.
    assert login(make_client(app), secret).status_code == 401
    assert login(make_client(app), NEW_SECRET).status_code == 204


# ─── Login ───────────────────────────────────────────────────────────────────

def test_bad_credentials_get_one_generic_message(client, data_dir):
    secret = initial_secret(data_dir)
    wrong_secret = login(client, "nope")
    wrong_user = login(client, secret, username="root")
    assert wrong_secret.status_code == wrong_user.status_code == 401
    assert wrong_secret.json() == wrong_user.json() == {"detail": "Invalid username or password."}
    assert auth.COOKIE_NAME not in client.cookies


def test_hash_is_computed_even_for_a_wrong_username(client, monkeypatch):
    calls = []
    real = auth._scrypt

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(auth, "_scrypt", counting)
    login(client, "whatever", username="nobody")
    assert len(calls) == 1


def test_sixth_consecutive_failure_is_throttled(client, clock, data_dir):
    for attempt in range(5):
        assert login(client, f"wrong-{attempt}").status_code == 401
    sixth = login(client, "wrong-5")
    assert sixth.status_code == 429
    assert sixth.headers["Retry-After"] == "60"
    # Even the right secret is refused while locked out.
    assert login(client, initial_secret(data_dir)).status_code == 429

    clock.now += 59
    assert login(client, "wrong").status_code == 429
    clock.now += 2
    assert login(client, initial_secret(data_dir)).status_code == 204


def test_lockout_doubles_up_to_fifteen_minutes(client, clock):
    for _ in range(5):
        login(client, "wrong")
    expected = [60, 120, 240, 480, 900, 900]
    for index, delay in enumerate(expected):
        blocked = login(client, "wrong")
        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"] == str(delay), index
        clock.now += delay + 1
        assert login(client, "wrong").status_code == 401      # evaluated, counted, locks again


def test_success_resets_the_failure_count(client, clock, data_dir):
    for _ in range(4):
        assert login(client, "wrong").status_code == 401
    assert login(client, initial_secret(data_dir)).status_code == 204
    for _ in range(4):
        assert login(client, "wrong").status_code == 401
    assert login(client, initial_secret(data_dir)).status_code == 204


def test_throttled_logins_do_not_hash(client, monkeypatch):
    for _ in range(5):
        login(client, "wrong")
    monkeypatch.setattr(auth, "_scrypt", lambda *a, **k: pytest.fail("hashed while locked out"))
    assert login(client, "wrong").status_code == 429


# ─── Sessions and cookie ─────────────────────────────────────────────────────

def test_cookie_attributes(client, data_dir):
    response = login(client, initial_secret(data_dir))
    cookie = response.headers["set-cookie"]
    attributes = {part.strip().lower() for part in cookie.split(";")[1:]}
    assert cookie.startswith(f"{auth.COOKIE_NAME}=")
    assert "httponly" in attributes
    assert "samesite=strict" in attributes
    assert "path=/" in attributes
    assert "secure" not in attributes                 # plain HTTP request
    assert len(response.headers.get_list("set-cookie")) == 1


def test_cookie_is_secure_when_the_request_came_over_https(app, data_dir):
    secret = initial_secret(data_dir)
    forwarded = make_client(app).post(
        "/api/auth/login", json={"username": "admin", "password": secret},
        headers={**ORIGIN, "X-Forwarded-Proto": "https"},
    )
    assert "secure" in {p.strip().lower() for p in forwarded.headers["set-cookie"].split(";")}

    direct = TestClient(app, base_url="https://dashboard.test").post(
        "/api/auth/login", json={"username": "admin", "password": secret},
        headers={"Origin": "https://dashboard.test"},
    )
    assert "secure" in {p.strip().lower() for p in direct.headers["set-cookie"].split(";")}


def test_session_token_is_random_and_stored_only_as_a_digest(app, client, data_dir):
    login(client, initial_secret(data_dir))
    token = client.cookies.get(auth.COOKIE_NAME)
    assert len(token) >= 43                           # token_urlsafe(32)
    stored = list(app.state.auth._sessions)
    assert token not in stored
    assert stored == [auth.hashlib.sha256(token.encode()).hexdigest()]
    assert not list(data_dir.rglob("*session*"))      # never written to disk


def test_idle_sessions_expire_after_12_hours(ready, clock):
    clock.now += 12 * 3600 - 1
    assert ready.get("/api/config").status_code == 200      # activity refreshes the timer
    clock.now += 12 * 3600 - 1
    assert ready.get("/api/config").status_code == 200
    clock.now += 12 * 3600
    assert ready.get("/api/config").status_code == 401


def test_sessions_end_after_7_days_whatever_the_activity(ready, clock):
    for _ in range(27):                                     # 6.75 days, always active
        clock.now += 6 * 3600
        assert ready.get("/api/config").status_code == 200
    clock.now += 6 * 3600
    assert ready.get("/api/config").status_code == 401


def test_logout_ends_the_session(ready):
    token = ready.cookies.get(auth.COOKIE_NAME)
    response = ready.post("/api/auth/logout", headers=ORIGIN)
    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()
    ready.cookies.set(auth.COOKIE_NAME, token)             # replaying the old token fails
    assert ready.get("/api/config").status_code == 401


# ─── CSRF ────────────────────────────────────────────────────────────────────

def test_foreign_origin_post_is_refused(ready):
    for origin in ("http://evil.example", "http://dashboard.test", "http://dashboard.test:8096", "null"):
        response = ready.post("/api/auth/logout", headers={"Origin": origin})
        assert response.status_code == 403, origin
        assert response.json()["code"] == "bad_origin"
    assert ready.get("/api/config").status_code == 200      # the session survived


def test_foreign_origin_login_is_refused(client, data_dir):
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": initial_secret(data_dir)},
        headers={"Origin": "http://evil.example"},
    )
    assert response.status_code == 403
    assert auth.COOKIE_NAME not in client.cookies


def test_post_without_origin_or_referer_is_refused(ready):
    assert ready.post("/api/auth/logout").status_code == 403


def test_matching_referer_is_accepted_when_origin_is_absent(ready):
    assert ready.post("/api/auth/logout", headers={"Referer": f"{BASE}/"}).status_code == 204


def test_origin_must_match_the_port_too(app, data_dir):
    # Reached directly on the host port: Origin and Host both carry :8000.
    direct = TestClient(app, base_url="http://192.0.2.10:8000")
    ok = direct.post(
        "/api/auth/login", json={"username": "admin", "password": initial_secret(data_dir)},
        headers={"Origin": "http://192.0.2.10:8000"},
    )
    assert ok.status_code == 204


# ─── Hardening ───────────────────────────────────────────────────────────────

def test_oversized_bodies_are_refused_before_parsing(client):
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": "x" * 9000}, headers=ORIGIN,
    )
    assert response.status_code == 413


def test_corrupt_auth_file_fails_closed(data_dir, caplog):
    data_dir.mkdir(parents=True)
    (data_dir / "auth.json").write_text("{ this is not json")
    with caplog.at_level(logging.ERROR):
        client = make_client(main.create_app())
    assert "every login will be refused" in caplog.text
    assert login(client, "anything").status_code == 401
    assert not (data_dir / "initial-admin-password").exists()     # no silent re-bootstrap
    assert (data_dir / "auth.json").read_text() == "{ this is not json"


@pytest.mark.parametrize("field, value", [("n", 2 ** 20), ("r", 64), ("p", 1000), ("n", 1000)])
def test_auth_file_cannot_demand_arbitrary_work(app, data_dir, field, value):
    record = json.loads((data_dir / "auth.json").read_text())
    record[field] = value
    (data_dir / "auth.json").write_text(json.dumps(record))
    assert main.create_app().state.auth._record is None


def test_logs_record_events_but_no_secrets(app, client, data_dir, caplog):
    secret = initial_secret(data_dir)
    with caplog.at_level(logging.DEBUG):
        login(client, "a-wrong-guess-typed-here", username="oops-typed-secret-as-user")
        login(client, secret)
        token = client.cookies.get(auth.COOKIE_NAME)
        change(client, secret, NEW_SECRET)
        new_token = client.cookies.get(auth.COOKIE_NAME)

    messages = [r.getMessage() for r in caplog.records if r.name == "homelab.auth"]
    assert any("login failure" in m for m in messages)
    assert any("login success" in m for m in messages)
    assert any("password changed" in m for m in messages)

    record = json.loads((data_dir / "auth.json").read_text())
    forbidden = [
        secret, NEW_SECRET, token, new_token, record["hash"], record["salt"],
        "a-wrong-guess-typed-here", "oops-typed-secret-as-user",
    ]
    for value in forbidden:
        assert value not in caplog.text


def test_bootstrap_log_names_the_file_not_the_secret(data_dir, caplog):
    with caplog.at_level(logging.DEBUG):
        main.create_app()
    assert "initial-admin-password" in caplog.text
    assert initial_secret(data_dir) not in caplog.text


# ─── Data routes once signed in ──────────────────────────────────────────────

def test_data_routes_answer_after_the_change(ready, monkeypatch):
    monkeypatch.setattr(services, "load_services", lambda: [
        {"name": "Nowhere", "desc": "", "url": "", "port": None, "group": "Test", "icon": "🔧"},
    ])
    monkeypatch.setattr(network, "read_flows", lambda: [])

    config = ready.get("/api/config")
    assert config.status_code == 200
    assert set(config.json()) == {"lan_ip", "zt_ip", "ts_ip", "server_lat", "server_lng", "tile_key"}

    svc = ready.get("/api/services")
    assert svc.status_code == 200
    assert svc.json() == [{
        "name": "Nowhere", "desc": "", "url": "", "port": None, "group": "Test", "icon": "🔧",
        "status": "offline", "ping_ms": None,
    }]

    net = ready.get("/api/network")
    assert net.status_code == 200
    assert net.json() == {"accounting": False, "truncated": False, "total_peers": 0, "peers": []}

    system = ready.get("/api/system")
    assert system.status_code == 200
    assert set(system.json()) == {"cpu", "ram", "disks", "uptime", "temp_c", "network"}


def test_tile_key_is_served_only_to_a_signed_in_session(app, ready, data_dir):
    (data_dir / "carto-api-key").write_text("Example-Key_123\n")
    assert ready.get("/api/config").json()["tile_key"] == "Example-Key_123"

    anonymous = make_client(app).get("/api/config")
    assert anonymous.status_code == 401
    assert "Example-Key_123" not in anonymous.text


def test_old_devices_endpoint_is_gone(ready):
    assert ready.get("/api/devices").status_code == 404
