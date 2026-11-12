"""Single-account authentication: password store, sessions, throttle, middleware.

Standard library only. Nothing in here logs a password, a hash or a token.
"""

import hashlib
import hmac
import json
import logging
import math
import os
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("homelab.auth")

USERNAME = "admin"
COOKIE_NAME = "homelab_session"

# scrypt, OWASP Password Storage Cheat Sheet: N=2^15 (32 MiB), r=8, p=3
SCRYPT_N = 2 ** 15
SCRYPT_R = 8
SCRYPT_P = 3
SCRYPT_DKLEN = 32
SALT_BYTES = 16
# OpenSSL refuses anything above its 32 MiB default once per-block overhead is
# added, so the ceiling sits above the 32 MiB the parameters actually use.
SCRYPT_MAXMEM = 64 * 1024 * 1024

PASSWORD_MIN = 12
PASSWORD_MAX = 256

SESSION_IDLE = 12 * 3600
SESSION_ABSOLUTE = 7 * 24 * 3600
MAX_SESSIONS = 64

THROTTLE_AFTER = 5           # consecutive failures before the first lockout
THROTTLE_BASE = 60           # seconds
THROTTLE_MAX = 15 * 60       # seconds

MAX_BODY_BYTES = 8 * 1024

OPEN_PATHS = frozenset({"/api/health", "/api/auth/login", "/api/auth/session"})
AUTH_PREFIX = "/api/auth/"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p,
        dklen=SCRYPT_DKLEN, maxmem=SCRYPT_MAXMEM,
    )


def _write_private(path: Path, data: bytes) -> None:
    """Atomically write `data` to `path` with mode 0600."""
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass


@dataclass
class Session:
    created: float
    last_seen: float


class Throttled(Exception):
    def __init__(self, retry_after: float):
        self.retry_after = max(1, math.ceil(retry_after))


class PasswordRejected(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message


class AuthManager:
    """Owns auth.json, the in-memory sessions and the login throttle."""

    def __init__(self, data_dir: Path, clock=time.monotonic):
        self.data_dir = Path(data_dir)
        self.auth_file = self.data_dir / "auth.json"
        self.initial_password_file = self.data_dir / "initial-admin-password"
        # Monotonic: sessions and lockouts live in memory only, and a wall-clock
        # step must neither extend nor cut them short.
        self._clock = clock
        self._lock = threading.Lock()           # sessions and stored record
        # Serialises login and password change: one 32 MiB hash at a time, and
        # throttle check + verify + count happen as a single step.
        self._login_lock = threading.Lock()
        self._record: dict | None = None
        self._sessions: dict[str, Session] = {}
        self._failures = 0
        self._locked_until = 0.0

    # ── Password store ────────────────────────────────────────────────────

    def bootstrap(self) -> None:
        """Load auth.json, or create the account with a random one-time password."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.data_dir, 0o700)
        except OSError:
            pass

        if self.auth_file.exists():
            self._record = self._load()
            if self._record is None:
                logger.error(
                    "auth.json is unreadable or invalid: every login will be refused. "
                    "Delete it and restart to reset the account."
                )
            elif not self._record["must_change"]:
                self._remove_initial_password_file()    # left over from a failed delete
            return

        initial = secrets.token_urlsafe(18)     # 24 characters, 144 bits
        # Plaintext first: a crash in between leaves no account, never an
        # account whose password was not written down anywhere.
        _write_private(self.initial_password_file, (initial + "\n").encode("ascii"))
        self._record = self._make_record(initial, must_change=True)
        self._save()
        logger.info(
            "created account %r with a one-time password, stored in %s",
            USERNAME, self.initial_password_file,
        )

    def _make_record(self, password: str, must_change: bool) -> dict:
        salt = secrets.token_bytes(SALT_BYTES)
        return {
            "version": 1,
            "username": USERNAME,
            "algorithm": "scrypt",
            "n": SCRYPT_N, "r": SCRYPT_R, "p": SCRYPT_P,
            "salt": salt.hex(),
            "hash": _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P).hex(),
            "must_change": must_change,
        }

    def _load(self) -> dict | None:
        try:
            record = json.loads(self.auth_file.read_text())
            if record.get("algorithm") != "scrypt" or record.get("username") != USERNAME:
                return None
            n, r, p = record["n"], record["r"], record["p"]
            if not all(isinstance(v, int) and not isinstance(v, bool) for v in (n, r, p)):
                return None
            # Never let a file ask for more work than this module would write.
            if not (2 <= n <= SCRYPT_N and n & (n - 1) == 0 and 1 <= r <= SCRYPT_R and 1 <= p <= 16):
                return None
            if len(bytes.fromhex(record["salt"])) < SALT_BYTES or not bytes.fromhex(record["hash"]):
                return None
            if not isinstance(record.get("must_change"), bool):
                return None
            return record
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return None

    def _save(self) -> None:
        _write_private(self.auth_file, (json.dumps(self._record, indent=2) + "\n").encode("ascii"))

    @property
    def must_change(self) -> bool:
        record = self._record
        return bool(record and record["must_change"])

    def _verify(self, username: str, password: str) -> bool:
        """Constant-shape check: always one scrypt, whatever the username."""
        record = self._record
        if record is None:
            salt, expected = b"\x00" * SALT_BYTES, None
            n, r, p = SCRYPT_N, SCRYPT_R, SCRYPT_P
        else:
            salt, expected = bytes.fromhex(record["salt"]), bytes.fromhex(record["hash"])
            n, r, p = record["n"], record["r"], record["p"]
        try:
            digest = _scrypt(password, salt, n, r, p)
        except (ValueError, MemoryError):
            return False
        password_ok = expected is not None and hmac.compare_digest(digest, expected)
        username_ok = hmac.compare_digest(username.encode("utf-8"), USERNAME.encode("utf-8"))
        return password_ok and username_ok

    # ── Throttle (global: behind the NodePort every client shares one IP) ──

    def _check_throttle(self) -> None:
        remaining = self._locked_until - self._clock()
        if remaining > 0:
            raise Throttled(remaining)

    def _record_failure(self) -> None:
        self._failures += 1
        if self._failures >= THROTTLE_AFTER:
            doublings = min(self._failures - THROTTLE_AFTER, 8)
            delay = min(THROTTLE_BASE * 2 ** doublings, THROTTLE_MAX)
            self._locked_until = self._clock() + delay

    def _record_success(self) -> None:
        self._failures = 0
        self._locked_until = 0.0

    # ── Sessions ──────────────────────────────────────────────────────────

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _new_session(self) -> str:
        token = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            self._drop_expired(now)
            while len(self._sessions) >= MAX_SESSIONS:
                oldest = min(self._sessions, key=lambda k: self._sessions[k].last_seen)
                del self._sessions[oldest]
            self._sessions[self._digest(token)] = Session(created=now, last_seen=now)
        return token

    def _drop_expired(self, now: float) -> None:
        dead = [
            key for key, s in self._sessions.items()
            if now - s.last_seen >= SESSION_IDLE or now - s.created >= SESSION_ABSOLUTE
        ]
        for key in dead:
            del self._sessions[key]

    def session_valid(self, token: str | None) -> bool:
        """True when the token names a live session. Refreshes its idle timer."""
        if not token:
            return False
        key = self._digest(token)
        now = self._clock()
        with self._lock:
            session = self._sessions.get(key)
            if session is None:
                return False
            if now - session.last_seen >= SESSION_IDLE or now - session.created >= SESSION_ABSOLUTE:
                del self._sessions[key]
                return False
            session.last_seen = now
            return True

    def session_count(self) -> int:
        with self._lock:
            return len(self._sessions)

    # ── Operations ────────────────────────────────────────────────────────

    def login(self, username: str, password: str) -> str | None:
        """Return a new session token, None for bad credentials. Raises Throttled."""
        # Requests queued behind the hash cannot slip past a lockout that an
        # earlier one triggered.
        with self._login_lock:
            self._check_throttle()
            if not self._verify(username, password):
                self._record_failure()
                return None
            self._record_success()
        return self._new_session()

    def logout(self, token: str | None) -> None:
        if token:
            with self._lock:
                self._sessions.pop(self._digest(token), None)

    def change_password(self, current: str, new: str) -> str:
        """Replace the password. Returns the token of the one surviving session.

        Raises PasswordRejected or Throttled.
        """
        if len(new) < PASSWORD_MIN:
            raise PasswordRejected(
                "password_too_short", f"The new password must be at least {PASSWORD_MIN} characters.")
        if len(new) > PASSWORD_MAX:
            raise PasswordRejected(
                "password_too_long", f"The new password must be at most {PASSWORD_MAX} characters.")
        if hmac.compare_digest(new.encode("utf-8"), current.encode("utf-8")):
            raise PasswordRejected(
                "password_unchanged", "The new password must differ from the current one.")

        with self._login_lock:
            self._check_throttle()
            if not self._verify(USERNAME, current):
                self._record_failure()
                raise PasswordRejected("invalid_current_password", "The current password is incorrect.")
            self._record_success()
            record = self._make_record(new, must_change=False)
            with self._lock:
                self._record = record
                self._save()
                self._sessions.clear()          # ends every session, this one included

        self._remove_initial_password_file()
        return self._new_session()              # the caller's replacement session

    def _remove_initial_password_file(self) -> None:
        try:
            self.initial_password_file.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.error("could not delete the initial password file: %s", type(exc).__name__)


# ─── HTTP layer ──────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    username: str
    password: str


class PasswordBody(BaseModel):
    current_password: str
    new_password: str


def _is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    # A TLS-terminating proxy in front (Traefik) announces the original scheme.
    # A client that forges this only breaks its own cookie.
    forwarded = request.headers.get("x-forwarded-proto", "")
    return forwarded.split(",")[0].strip().lower() == "https"


def _set_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        httponly=True, samesite="strict", path="/", secure=_is_https(request),
    )


def _clear_cookie(request: Request, response: Response) -> None:
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True, samesite="strict", secure=_is_https(request),
    )


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _error(status: int, detail: str, code: str | None = None, headers: dict | None = None) -> JSONResponse:
    body = {"detail": detail}
    if code:
        body["code"] = code
    return JSONResponse(body, status_code=status, headers=headers)


def _same_origin(request: Request) -> bool:
    """True when Origin (or, without it, Referer) names the host being addressed."""
    host = request.headers.get("host", "").strip().lower()
    source = request.headers.get("origin")
    if source is None:
        source = request.headers.get("referer")
    if not host or not source:
        return False
    try:
        parts = urlsplit(source.strip())
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and parts.netloc.lower() == host


async def auth_middleware(request: Request, call_next):
    """Origin check, body cap, session and forced-password-change enforcement."""
    auth: AuthManager = request.app.state.auth
    method = request.method.upper()
    path = request.url.path

    # CSRF: a cross-site page cannot forge Origin, and SameSite alone does not
    # separate two services that share this host on different ports.
    if method != "GET":
        has_origin = "origin" in request.headers
        if (has_origin or method not in SAFE_METHODS) and not _same_origin(request):
            return _error(403, "Cross-origin request refused.", "bad_origin")

    if method not in SAFE_METHODS:
        length = request.headers.get("content-length")
        if length is None or not length.isdigit():
            return _error(411, "Content-Length required.")
        if int(length) > MAX_BODY_BYTES:
            return _error(413, "Request body too large.")

    # Deny by default: nothing outside /api/ is ever routed, so a route added
    # there by mistake cannot become a public one.
    if not path.startswith("/api/"):
        return _error(404, "Not Found")

    if path not in OPEN_PATHS:
        if not auth.session_valid(request.cookies.get(COOKIE_NAME)):
            return _error(401, "Not authenticated.")
        if auth.must_change and not path.startswith(AUTH_PREFIX):
            return _error(403, "The password must be changed first.", "password_change_required")

    return await call_next(request)


router = APIRouter(prefix="/api/auth")


@router.post("/login", status_code=204)
async def login(body: LoginBody, request: Request):
    auth: AuthManager = request.app.state.auth
    try:
        token = await run_in_threadpool(auth.login, body.username, body.password)
    except Throttled as exc:
        logger.warning("login refused: throttled (client=%s)", _client(request))
        return _error(
            429, "Too many failed logins. Try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        )
    if token is None:
        logger.warning("login failure (client=%s)", _client(request))
        return _error(401, "Invalid username or password.")
    logger.info("login success (user=%s client=%s)", USERNAME, _client(request))
    response = Response(status_code=204)
    _set_cookie(request, response, token)
    return response


@router.post("/logout", status_code=204)
async def logout(request: Request):
    auth: AuthManager = request.app.state.auth
    auth.logout(request.cookies.get(COOKIE_NAME))
    response = Response(status_code=204)
    _clear_cookie(request, response)
    return response


@router.get("/session")
async def session(request: Request):
    auth: AuthManager = request.app.state.auth
    authenticated = auth.session_valid(request.cookies.get(COOKIE_NAME))
    return {
        "authenticated": authenticated,
        "username": USERNAME if authenticated else None,
        # Only a logged-in client learns whether the one-time password is still in use.
        "must_change_password": authenticated and auth.must_change,
    }


@router.post("/password", status_code=204)
async def change_password(body: PasswordBody, request: Request):
    auth: AuthManager = request.app.state.auth
    try:
        token = await run_in_threadpool(auth.change_password, body.current_password, body.new_password)
    except Throttled as exc:
        return _error(
            429, "Too many failed attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        )
    except PasswordRejected as exc:
        if exc.code == "invalid_current_password":
            logger.warning("password change refused: wrong current password (client=%s)", _client(request))
        return _error(400, exc.message, exc.code)
    logger.info("password changed (user=%s client=%s)", USERNAME, _client(request))
    response = Response(status_code=204)
    _set_cookie(request, response, token)
    return response
