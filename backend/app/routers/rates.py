from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf

router = APIRouter(prefix="/rates", tags=["rates"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


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
    """The single most recent rate entry per (company, party) — what the Rate
    Dashboard and Executive Dashboard both surface as 'the rate right now'.
    Grouped by company_id + party_id together, not party_id alone — a plain
    GROUP BY party_id collapses every no-party company's rows into one SQL
    NULL group, silently hiding every no-party plant but the most recently
    updated one (§ Party optional)."""
    subq = (
        db.query(
            models.RateEntry.company_id,
            models.RateEntry.party_id,
            func.max(models.RateEntry.timestamp).label("max_ts"),
        )
        .group_by(models.RateEntry.company_id, models.RateEntry.party_id)
        .subquery()
    )
    rows = (
        db.query(models.RateEntry)
        .join(
            subq,
            (models.RateEntry.company_id == subq.c.company_id)
            # Plain `==` on two NULLs evaluates to NULL (never TRUE) in SQL,
            # so a no-party row would never join its own group — is_distinct_from
            # treats NULL == NULL as a match, same as party_id's GROUP BY above.
            & (~models.RateEntry.party_id.is_distinct_from(subq.c.party_id))
            & (models.RateEntry.timestamp == subq.c.max_ts),
        )
        .order_by(models.RateEntry.timestamp.desc())
        .all()
    )
    return rows


@router.post("", response_model=schemas.RateOut, status_code=201)
def create_rate(
    payload: schemas.RateCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    # Only look up/validate a Party when one was actually given — party_id
    # is optional (§ Party optional), None means "no party", nothing to check.
    if payload.party_id is not None:
        party = db.query(models.Party).get(payload.party_id)
        if not party or party.company_id != payload.company_id:
            raise HTTPException(400, "Party does not belong to the given company")

    rate_454 = round(float(payload.rate_118) * models.RateEntry.RATIO, 2)
    entry = models.RateEntry(
        company_id=payload.company_id,
        party_id=payload.party_id,
        rate_118=payload.rate_118,
        rate_454=rate_454,
        entered_by=current_user.name,
        timestamp=payload.timestamp or datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry