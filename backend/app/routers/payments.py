from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("", response_model=list[schemas.PaymentOut])
def list_payments(
    customer_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Payment).filter(models.Payment.status == "active")
    if customer_id:
        q = q.filter(models.Payment.customer_id == customer_id)
    rows = q.order_by(models.Payment.date.desc(), models.Payment.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


def _apply_payment(db: Session, payload: schemas.PaymentCreate, entered_by: str) -> models.Payment:
    """Create-time posting logic, shared by create_payment and
    correct_payment (§1)."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    account = db.query(models.PaymentAccount).get(payload.account_id)
    if not account:
        raise HTTPException(404, "Payment account not found")
    if payload.sale_id:
        sale = db.query(models.Sale).get(payload.sale_id)
        if not sale or sale.customer_id != payload.customer_id:
            raise HTTPException(400, "Sale does not belong to this customer")

    # Overpayment / advance convention (§18, and the same rule used on the
    # Customer page's quick payment action — this is now the single place
    # that logic lives, so both surfaces stay in sync automatically).
    excess = payload.amount - customer.current_balance
    excess_amount = excess if excess > 0 else None

    payment = models.Payment(
        display_id=next_display_id(db, models.Payment, "PAY", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        sale_id=payload.sale_id,
        amount=payload.amount,
        method=payload.method,
        account_id=payload.account_id,
        reference_no=payload.reference_no,
        received_by=payload.received_by,
        notes=payload.notes,
        excess_amount=excess_amount,
        status="active",
        entered_by=entered_by,
    )
    db.add(payment)

    # Customer balance: New Balance = Previous − Payment (§13). Going
    # negative here IS the advance/credit — never clamped to zero.
    customer.current_balance = customer.current_balance - payload.amount
    customer.last_transaction_at = payload.date
    customer.last_overpayment_amount = excess_amount
    customer.last_overpayment_date = payload.date if excess_amount else None
    if excess_amount:
        customer.account_credit = customer.account_credit + excess_amount
    db.add(customer)

    # Cash/Bank ledger: money IN (§8, §12) — a customer payment increases
    # the account it was received into. Never touches an expense account.
    account.current_balance = account.current_balance + payload.amount
    db.add(account)

    return payment


def _reverse_payment(db: Session, payment: models.Payment) -> None:
    """Undoes exactly what _apply_payment posted. Shared by cancel_payment
    and correct_payment (§1)."""
    customer = db.query(models.Customer).get(payment.customer_id)
    customer.current_balance = customer.current_balance + payment.amount
    if payment.excess_amount:
        customer.account_credit = customer.account_credit - payment.excess_amount
    db.add(customer)

    account = db.query(models.PaymentAccount).get(payment.account_id)
    account.current_balance = account.current_balance - payment.amount
    db.add(account)


@router.post("", response_model=schemas.PaymentOut, status_code=201)
def create_payment(payload: schemas.PaymentCreate, db: Session = Depends(get_db)):
    payment = _apply_payment(db, payload, payload.entered_by)
    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/cancel", response_model=schemas.PaymentOut)
def cancel_payment(payment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    payment = db.query(models.Payment).get(payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status != "active":
        raise HTTPException(400, "Payment is already cancelled")

    _reverse_payment(db, payment)

    payment.status = "cancelled"
    payment.modified_at = datetime.utcnow()
    payment.modified_by = by
    db.add(payment)

    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/correct", response_model=schemas.PaymentOut)
def correct_payment(payment_id: UUID, payload: schemas.PaymentCorrect, db: Session = Depends(get_db)):
    """Ledger Correction (§1) — see correct_sale in routers/sales.py for
    the full pattern this mirrors."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.Payment).get(payment_id)
    if not original:
        raise HTTPException(404, "Payment not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active payment can be corrected")

    _reverse_payment(db, original)

    original.status = "corrected"
    original.corrected_by = payload.corrected_by
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_payment(db, payload, payload.corrected_by)
    corrected.corrected_from_id = original.id
    db.add(corrected)

    db.commit()
    db.refresh(corrected)
    return corrected