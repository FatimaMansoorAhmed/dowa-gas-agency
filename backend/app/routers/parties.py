from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/parties", tags=["parties"])


@router.get("", response_model=list[schemas.PartyOut])
def list_parties(company_id: UUID | None = Query(None), db: Session = Depends(get_db)):
    q = db.query(models.Party)
    if company_id:
        q = q.filter(models.Party.company_id == company_id)
    return q.order_by(models.Party.name).all()


@router.post("", response_model=schemas.PartyOut, status_code=201)
def create_party(payload: schemas.PartyCreate, db: Session = Depends(get_db)):
    company = db.query(models.Company).get(payload.company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    existing = (
        db.query(models.Party)
        .filter(models.Party.company_id == payload.company_id, models.Party.name == payload.name)
        .first()
    )
    if existing:
        return existing  # idempotent: re-adding the same party name just returns it
    party = models.Party(company_id=payload.company_id, name=payload.name)
    db.add(party)
    db.commit()
    db.refresh(party)
    return party