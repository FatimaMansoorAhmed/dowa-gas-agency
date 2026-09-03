import os
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import (
    SESSION_COOKIE_NAME, SESSION_TTL_DAYS,
    generate_session_token, generate_csrf_token, hash_token, get_current_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_hasher = PasswordHasher()
# Precomputed once so a login against a nonexistent email still pays the
# same Argon2 verify cost as a real one — otherwise a timing side-channel
# would reveal account existence even though the response body doesn't.
_DUMMY_HASH = _hasher.hash("dowa-dummy-password-for-timing-safety")

COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
PER_IP_LIMIT = 20
PER_IP_WINDOW_MINUTES = 1


def _log(db: Session, user_id, action: str, performed_by=None, reason: str | None = None, ip_address: str | None = None):
    db.add(models.UserAccessAudit(
        user_id=user_id, action=action, performed_by=performed_by, reason=reason, ip_address=ip_address,
    ))


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_session_cookie(response: Response, raw_token: str):
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="none" if COOKIE_SECURE else "lax",  # SameSite=None requires Secure — falls back to Lax for plain-http local dev
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )


@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "A valid email is required")
    if len(payload.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(400, "An account with this email already exists")

    user = models.User(
        name=payload.name.strip(),
        email=email,
        password_hash=_hasher.hash(payload.password),
        role="staff",  # never client-selectable — see bootstrap_owner.py / the approve-as-owner flow
        status="pending",
    )
    db.add(user)
    db.flush()
    _log(db, user.id, "register")
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=schemas.LoginOut)
def login(payload: schemas.LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    generic_error = HTTPException(401, "Invalid email or password")

    # Per-IP rate limit — DB-backed (not slowapi's in-memory default) so it
    # stays correct regardless of worker/replica count (§4). Checked before
    # any password verification.
    recent_failures = (
        db.query(models.UserAccessAudit)
        .filter(
            models.UserAccessAudit.action == "login_failed",
            models.UserAccessAudit.ip_address == ip,
            models.UserAccessAudit.created_at > datetime.utcnow() - timedelta(minutes=PER_IP_WINDOW_MINUTES),
        )
        .count()
    )
    if recent_failures >= PER_IP_LIMIT:
        raise HTTPException(429, "Too many login attempts — try again shortly")

    email = payload.email.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()

    if user and user.locked_until and user.locked_until > datetime.utcnow():
        # Same generic error even while locked — do not disclose lockout state.
        _log(db, user.id, "login_failed", ip_address=ip)
        db.commit()
        raise generic_error

    try:
        _hasher.verify(user.password_hash if user else _DUMMY_HASH, payload.password)
        password_ok = user is not None
    except VerifyMismatchError:
        password_ok = False

    # Status check folded into the SAME generic error as a wrong password —
    # pending/suspended/rejected must be indistinguishable from "wrong
    # password" to an unauthenticated caller (§3).
    if not user or not password_ok or user.status != "active":
        if user:
            user.failed_login_count = (user.failed_login_count or 0) + 1
            if user.failed_login_count >= MAX_FAILED_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
            db.add(user)
        _log(db, user.id if user else None, "login_failed", ip_address=ip)
        db.commit()
        raise generic_error

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = datetime.utcnow()
    db.add(user)

    raw_token = generate_session_token()
    csrf_token = generate_csrf_token()
    session = models.UserSession(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        csrf_token=csrf_token,
        expires_at=datetime.utcnow() + timedelta(days=SESSION_TTL_DAYS),
        user_agent=request.headers.get("user-agent"),
        ip_address=ip,
    )
    db.add(session)
    _log(db, user.id, "login", ip_address=ip)
    db.commit()
    db.refresh(user)

    _set_session_cookie(response, raw_token)
    return schemas.LoginOut(user=schemas.UserOut.model_validate(user), csrf_token=csrf_token)


@router.post("/logout")
def logout(response: Response, session: models.UserSession = Depends(get_current_session), db: Session = Depends(get_db)):
    session.revoked_at = datetime.utcnow()
    db.add(session)
    _log(db, session.user_id, "logout")
    db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=schemas.MeOut)
def me(request: Request, db: Session = Depends(get_db)):
    """Never 401 — this endpoint IS the auth check. Returns
    {authenticated: false} for no/invalid/expired session."""
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        return schemas.MeOut(authenticated=False)
    session = (
        db.query(models.UserSession)
        .filter(models.UserSession.token_hash == hash_token(raw_token), models.UserSession.revoked_at.is_(None))
        .first()
    )
    if not session or session.expires_at < datetime.utcnow():
        return schemas.MeOut(authenticated=False)
    user = db.query(models.User).get(session.user_id)
    if not user or user.status != "active":
        return schemas.MeOut(authenticated=False)
    return schemas.MeOut(authenticated=True, user=schemas.UserOut.model_validate(user), csrf_token=session.csrf_token)
