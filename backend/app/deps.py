"""Auth dependencies (§ Auth Module) — DB-backed session checks, applied at
router level (`APIRouter(..., dependencies=[Depends(require_active_user), ...])`)
across every existing business router, so no individual endpoint signature
needs to change. Every check here is a live DB read on each request — there
is no caching layer and no JWT — so a suspended user is blocked on their
very next request, not just their next login.

Any endpoint that also needs the resolved User object (e.g. to stamp
`entered_by=current_user.name`) must depend on `require_active_user` itself
(not a copy/wrapper) — FastAPI's per-request dependency cache then collapses
the router-level use and the endpoint-level use into a single DB query.
"""
import hashlib
import secrets
from datetime import datetime

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app import models

SESSION_COOKIE_NAME = "dowa_session"
SESSION_TTL_DAYS = 14


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(24)


def get_current_session(request: Request, db: Session = Depends(get_db)) -> models.UserSession:
    """Resolves a live, non-revoked, non-expired session from the cookie —
    deliberately no status check on the user here (a suspended user must
    still be able to hit /auth/logout to clear their own client state;
    require_active_user below is what actually gates business access)."""
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        raise HTTPException(401, "Not authenticated")
    token_hash = hash_token(raw_token)
    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.token_hash == token_hash, models.UserSession.revoked_at.is_(None))
        .first()
    )
    if not session or session.expires_at < datetime.utcnow():
        raise HTTPException(401, "Not authenticated")
    return session


def require_active_user(
    session: models.UserSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> models.User:
    """The one dependency applied to every existing business router. A
    user whose status flips to "suspended"/"rejected" mid-session fails
    this on their very next request — this is a live read, never cached."""
    user = db.query(models.User).get(session.user_id)
    if not user or user.status != "active":
        raise HTTPException(401, "Not authenticated")
    return user


def require_owner(current_user: models.User = Depends(require_active_user)) -> models.User:
    if current_user.role != "owner":
        raise HTTPException(403, "Owner access required")
    return current_user


def require_csrf(request: Request, session: models.UserSession = Depends(get_current_session)) -> None:
    """Cross-origin (Railway + Vercel, SameSite=None) makes CSRF mandatory.
    No-ops for GET/HEAD/OPTIONS (no side effects to forge); every mutating
    request must echo the session's csrf_token — handed to the client only
    in the login/`/auth/me` JSON body, never as a cookie, so a cross-site
    attacker's forged request (which can carry the session cookie but can't
    read that JSON response, per Same-Origin Policy) can't know the right
    value to send. Applied at router level alongside require_active_user on
    every business router — safe to apply uniformly since it's a no-op on
    every GET in that router."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    header_token = request.headers.get("X-CSRF-Token")
    if not header_token or header_token != session.csrf_token:
        raise HTTPException(403, "CSRF token missing or invalid")
