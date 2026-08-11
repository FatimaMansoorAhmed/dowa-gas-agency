from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/rates", tags=["rates"])


@router.get("", response_model=list[schemas.RateOut])
def list_rates(
    company_id: UUID | None = Query(None),
    party_id: UUID | None = Query(None),
    since: datetime | None = Query(None, description="Only entries at/after this timestamp"),
    db: Session = Depends(get_db),
):
    q = db.query(models.RateEntry)
    if company_id:
        q = q.filter(models.RateEntry.company_id == company_id)
    if party_id:
        q = q.filter(models.RateEntry.party_id == party_id)
    if since:
        q = q.filter(models.RateEntry.timestamp >= since)
    return q.order_by(models.RateEntry.timestamp.desc()).all()


@router.get("/latest", response_model=list[schemas.RateOut])
def latest_rates(db: Session = Depends(get_db)):
    """The single most recent rate entry per Party — what the Rate Dashboard
    and Executive Dashboard both surface as 'the rate right now'."""
    subq = (
        db.query(
            models.RateEntry.party_id,
            func.max(models.RateEntry.timestamp).label("max_ts"),
        )
        .group_by(models.RateEntry.party_id)
        .subquery()
    )
    rows = (
        db.query(models.RateEntry)
        .join(
            subq,
            (models.RateEntry.party_id == subq.c.party_id)
            & (models.RateEntry.timestamp == subq.c.max_ts),
        )
        .order_by(models.RateEntry.timestamp.desc())
        .all()
    )
    return rows


@router.post("", response_model=schemas.RateOut, status_code=201)
def create_rate(payload: schemas.RateCreate, db: Session = Depends(get_db)):
    party = db.query(models.Party).get(payload.party_id)
    if not party or party.company_id != payload.company_id:
        raise HTTPException(400, "Party does not belong to the given company")

    rate_454 = round(float(payload.rate_118) * models.RateEntry.RATIO, 2)
    entry = models.RateEntry(
        company_id=payload.company_id,
        party_id=payload.party_id,
        rate_118=payload.rate_118,
        rate_454=rate_454,
        entered_by=payload.entered_by,
        timestamp=payload.timestamp or datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
