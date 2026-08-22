from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/companies", tags=["companies"])


def _current_month() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _roll_month_if_needed(company: models.Company, db: Session):
    """Same monthly rollover as Customer: opening balance for the payable
    resets to whatever the running balance was at month start, so the
    Plant Ledger's monthly view is always internally consistent."""
    month = _current_month()
    if company.opening_balance_month != month:
        company.opening_balance = company.current_balance
        company.opening_balance_month = month
        db.add(company)
        db.commit()
        db.refresh(company)
    return company


@router.get("", response_model=list[schemas.CompanyOut])
def list_companies(db: Session = Depends(get_db)):
    companies = db.query(models.Company).order_by(models.Company.name).all()
    return [_roll_month_if_needed(c, db) for c in companies]


@router.get("/{company_id}", response_model=schemas.CompanyOut)
def get_company(company_id: UUID, db: Session = Depends(get_db)):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    return _roll_month_if_needed(company, db)


@router.post("", response_model=schemas.CompanyOut, status_code=201)
def create_company(payload: schemas.CompanyCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Company).filter(models.Company.name == payload.name).first()
    if existing:
        raise HTTPException(400, "Company already exists")
    company = models.Company(
        name=payload.name,
        mobile=payload.mobile,
        opening_balance=payload.opening_balance,
        opening_balance_date=payload.opening_balance_date or datetime.utcnow(),
        current_balance=payload.opening_balance,
        opening_balance_month=_current_month(),
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return company
