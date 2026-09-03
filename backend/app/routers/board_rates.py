from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf

router = APIRouter(prefix="/board-rates", tags=["board-rates"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


def resolve_board_rate(db: Session, on_date: datetime) -> models.BoardRate:
    """The Board Rate in effect on `on_date` — the latest row with
    effective_date <= on_date, identical "latest as-of" resolution to
    RateEntry's own /latest endpoint. Used server-side by Shop Sale
    pricing (§4) — never resolved client-side, so the price snapshot is
    always trustworthy regardless of what the client sends."""
    rate = (
        db.query(models.BoardRate)
        .filter(models.BoardRate.effective_date <= on_date)
        .order_by(models.BoardRate.effective_date.desc(), models.BoardRate.created_at.desc())
        .first()
    )
    if not rate:
        raise HTTPException(400, "No Board Rate has been set on or before this date yet")
    return rate


@router.get("", response_model=list[schemas.BoardRateOut])
def list_board_rates(db: Session = Depends(get_db)):
    return db.query(models.BoardRate).order_by(models.BoardRate.effective_date.desc()).all()


@router.get("/latest", response_model=schemas.BoardRateOut)
def latest_board_rate(date: datetime | None = Query(None, description="Defaults to now"), db: Session = Depends(get_db)):
    return resolve_board_rate(db, date or datetime.utcnow())


@router.post("", response_model=schemas.BoardRateOut, status_code=201)
def create_board_rate(
    payload: schemas.BoardRateCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    rate = models.BoardRate(
        effective_date=payload.effective_date,
        rate_per_kg=payload.rate_per_kg,
        entered_by=current_user.name,
    )
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate
