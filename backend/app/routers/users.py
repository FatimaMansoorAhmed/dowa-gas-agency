from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_owner, require_csrf

router = APIRouter(
    prefix="/users", tags=["users"],
    dependencies=[Depends(require_owner), Depends(require_csrf)],
)


def _log(db: Session, user_id, action: str, performed_by, reason: str | None = None):
    db.add(models.UserAccessAudit(user_id=user_id, action=action, performed_by=performed_by, reason=reason))


@router.get("", response_model=list[schemas.UserOut])
def list_users(status: str | None = Query(None), db: Session = Depends(get_db)):
    q = db.query(models.User)
    if status:
        q = q.filter(models.User.status == status)
    return q.order_by(models.User.created_at.desc()).all()


@router.get("/{user_id}/audit", response_model=list[schemas.UserAccessAuditOut])
def get_user_audit(user_id: UUID, db: Session = Depends(get_db)):
    return (
        db.query(models.UserAccessAudit)
        .filter(models.UserAccessAudit.user_id == user_id)
        .order_by(models.UserAccessAudit.created_at.desc())
        .all()
    )


@router.patch("/{user_id}/approve", response_model=schemas.UserOut)
def approve_user(
    user_id: UUID, payload: schemas.ApproveUserRequest,
    current_user: models.User = Depends(require_owner), db: Session = Depends(get_db),
):
    """Approving with role="owner" is the only way a second (or further)
    Owner account is ever created (§6 — multiple Owners supported for
    redundancy) — never via the bootstrap script again, never
    self-selected at registration."""
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.status not in ("pending", "rejected"):
        raise HTTPException(400, f"Cannot approve a user with status={user.status}")

    user.status = "active"
    user.role = payload.role
    user.approved_at = datetime.utcnow()
    user.approved_by = current_user.id
    db.add(user)
    _log(db, user.id, "approve", current_user.id, reason=f"role={payload.role}")
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/reject", response_model=schemas.UserOut)
def reject_user(
    user_id: UUID, payload: schemas.RejectSuspendRequest,
    current_user: models.User = Depends(require_owner), db: Session = Depends(get_db),
):
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.status != "pending":
        raise HTTPException(400, f"Cannot reject a user with status={user.status}")

    user.status = "rejected"
    db.add(user)
    _log(db, user.id, "reject", current_user.id, reason=payload.reason)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/suspend", response_model=schemas.UserOut)
def suspend_user(
    user_id: UUID, payload: schemas.RejectSuspendRequest,
    current_user: models.User = Depends(require_owner), db: Session = Depends(get_db),
):
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.status != "active":
        raise HTTPException(400, f"Cannot suspend a user with status={user.status}")

    user.status = "suspended"
    db.add(user)

    # Mass-revoke — EVERY open session for this user, not just one, so
    # access is cut on every device/tab immediately, not just the next
    # login attempt (§ suspension requirement).
    (
        db.query(models.UserSession)
        .filter(models.UserSession.user_id == user.id, models.UserSession.revoked_at.is_(None))
        .update({"revoked_at": datetime.utcnow()}, synchronize_session=False)
    )

    _log(db, user.id, "suspend", current_user.id, reason=payload.reason)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/reactivate", response_model=schemas.UserOut)
def reactivate_user(
    user_id: UUID,
    current_user: models.User = Depends(require_owner), db: Session = Depends(get_db),
):
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.status != "suspended":
        raise HTTPException(400, f"Cannot reactivate a user with status={user.status}")

    user.status = "active"
    db.add(user)
    _log(db, user.id, "reactivate", current_user.id)
    db.commit()
    db.refresh(user)
    return user
