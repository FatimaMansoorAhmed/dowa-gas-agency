from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/customers", tags=["customers"])


def _current_month() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _roll_month_if_needed(customer: models.Customer, db: Session):
    """Opening balance resets every calendar month to that month's starting
    balance, so the 'balance growing this month' flag re-evaluates monthly
    rather than staying pinned to whenever the customer was created."""
    month = _current_month()
    if customer.opening_balance_month != month:
        customer.opening_balance = customer.current_balance
        customer.opening_balance_month = month
        db.add(customer)
        db.commit()
        db.refresh(customer)
    return customer


@router.get("", response_model=list[schemas.CustomerOut])
def list_customers(
    search: str | None = Query(None, description="Matches name or mobile"),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.Customer)
    if status:
        q = q.filter(models.Customer.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter((models.Customer.name.ilike(like)) | (models.Customer.mobile.ilike(like)))
    customers = q.order_by(models.Customer.name).all()
    return [_roll_month_if_needed(c, db) for c in customers]


@router.post("", response_model=schemas.CustomerOut, status_code=201)
def create_customer(payload: schemas.CustomerCreate, db: Session = Depends(get_db)):
    customer = models.Customer(
        name=payload.name,
        mobile=payload.mobile,
        address=payload.address,
        opening_balance=payload.opening_balance,
        current_balance=payload.opening_balance,
        status="active",
        opening_balance_month=_current_month(),
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.patch("/{customer_id}/adjust", response_model=schemas.CustomerOut)
def adjust_customer(customer_id: UUID, payload: schemas.CustomerAdjust, db: Session = Depends(get_db)):
    """Records a payment or a charge against a customer's running balance.

    Advance-payment convention: current_balance going negative means the
    customer has paid ahead — never treat it as debt.
    Overpayment: if a payment exceeds what's currently owed, the excess is
    stored separately as last_overpayment_* so the UI can highlight it as
    credit-in-hand rather than a silent balance drop.
    """
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    amount = payload.amount
    if payload.kind == "payment":
        excess = amount - customer.current_balance
        customer.current_balance = customer.current_balance - amount
        if excess > 0:
            customer.last_overpayment_amount = excess
            customer.last_overpayment_date = datetime.utcnow()
        else:
            customer.last_overpayment_amount = None
            customer.last_overpayment_date = None
    else:  # charge
        customer.current_balance = customer.current_balance + amount

    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.patch("/{customer_id}/status", response_model=schemas.CustomerOut)
def set_customer_status(customer_id: UUID, status: str = Query(..., pattern="^(active|inactive)$"), db: Session = Depends(get_db)):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    customer.status = status
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer
