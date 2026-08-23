from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/payment-accounts", tags=["payment-accounts"])


@router.get("", response_model=list[schemas.PaymentAccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(models.PaymentAccount).order_by(models.PaymentAccount.name).all()


@router.post("", response_model=schemas.PaymentAccountOut, status_code=201)
def create_account(payload: schemas.PaymentAccountCreate, db: Session = Depends(get_db)):
    existing = db.query(models.PaymentAccount).filter(models.PaymentAccount.name == payload.name).first()
    if existing:
        raise HTTPException(400, "Account already exists")
    account = models.PaymentAccount(
        name=payload.name, kind=payload.kind,
        opening_balance=payload.opening_balance, current_balance=payload.opening_balance,
        active="active",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}/deactivate", response_model=schemas.PaymentAccountOut)
def deactivate_account(account_id: UUID, db: Session = Depends(get_db)):
    account = db.query(models.PaymentAccount).get(account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    account.active = "inactive"
    db.add(account)
    db.commit()
    db.refresh(account)
    return account