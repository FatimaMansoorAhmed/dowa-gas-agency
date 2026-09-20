from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.utils import next_display_id, resolve_settlement_destination, apply_settlement_routing, reverse_payment_receipt

router = APIRouter(prefix="/payment-receipts", tags=["payment-receipts"], dependencies=[Depends(require_active_user), Depends(require_csrf)])

EPSILON = Decimal("0.01")


def _attach_bypass_amounts(db: Session, rows: list[models.Payment]) -> list[models.Payment]:
    """Resolves each receipt's home_expense_amount/owner_drawings_amount from
    the linked Expense/OwnerDrawings child (source_payment_id) — not real
    Payment columns, see schemas.PaymentReceiptOut. Sets them as plain
    instance attributes (never flushed/committed) so from_attributes=True
    serialization picks them up. § Part B — lets the Payment Register show
    the real destination instead of a misleading "Rs 0 Received"."""
    payment_ids = [r.id for r in rows]
    if not payment_ids:
        return rows
    expenses = db.query(models.Expense).filter(
        models.Expense.source_payment_id.in_(payment_ids), models.Expense.status != "cancelled",
    ).all()
    drawings = db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_payment_id.in_(payment_ids), models.OwnerDrawings.status != "cancelled",
    ).all()
    expense_by_payment = {e.source_payment_id: e.amount for e in expenses}
    drawing_by_payment = {d.source_payment_id: d.amount for d in drawings}
    for r in rows:
        r.home_expense_amount = expense_by_payment.get(r.id, Decimal("0"))
        r.owner_drawings_amount = drawing_by_payment.get(r.id, Decimal("0"))
    return rows


@router.get("", response_model=list[schemas.PaymentReceiptOut])
def list_payment_receipts(
    customer_id: Optional[UUID] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    # destination_type is only ever set by this router — plain /payments
    # quick-pay rows leave it null, so this filter keeps the two registers
    # separate even though they share one table.
    q = db.query(models.Payment).filter(
        models.Payment.status == "active",
        models.Payment.destination_type.isnot(None),
    )
    if customer_id:
        q = q.filter(models.Payment.customer_id == customer_id)
    rows = q.order_by(models.Payment.date.desc(), models.Payment.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return _attach_bypass_amounts(db, rows)


def _validate_payment_receipt(db: Session, payload):
    """Shared by create and correct (§ Bug Fix — Correction Modal Routing)
    — every check that must pass before anything is written, whichever
    caller it is. Returns (destination_type, target_plant_id, account_row,
    account_category, net_settlement_amount)."""
    if payload.home_expense_amount > 0 and not payload.home_expense_category_id:
        raise HTTPException(400, "home_expense_category_id is required when home_expense_amount > 0")
    if payload.home_expense_category_id and not db.query(models.ExpenseCategory).get(payload.home_expense_category_id):
        raise HTTPException(404, "Expense category not found")

    bypass_sum = payload.home_expense_amount + payload.owner_drawings_amount
    if bypass_sum > payload.amount + EPSILON:
        raise HTTPException(
            400,
            f"Expense ({payload.home_expense_amount}) + owner drawings ({payload.owner_drawings_amount}) "
            f"= {bypass_sum} exceeds amount received ({payload.amount}).",
        )

    net_settlement_amount = payload.amount - payload.home_expense_amount - payload.owner_drawings_amount
    destination_type, target_plant_id, account_row, account_category = resolve_settlement_destination(
        db, payload.destination_type, payload.target_plant_id, payload.account_id, net_settlement_amount
    )
    return destination_type, target_plant_id, account_row, account_category, net_settlement_amount


def _apply_payment_receipt(
    db: Session, payload, entered_by: str,
    destination_type, target_plant_id, account_row, account_category, net_settlement_amount,
) -> models.Payment:
    """Create-time posting logic, shared by create_payment_receipt and
    correct_payment_receipt (§ Bug Fix — Correction Modal Routing) — mirrors
    routers/payments.py's _apply_payment/_reverse_payment split. No commit —
    caller owns the transaction."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    excess = payload.amount - customer.current_balance
    excess_amount = excess if excess > 0 else None

    payment = models.Payment(
        display_id=next_display_id(db, models.Payment, "PAY", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        amount=payload.amount,
        method=payload.method,
        account_id=account_row.id if account_row else None,
        reference_no=payload.reference_no,
        notes=payload.notes,
        excess_amount=excess_amount,
        destination_type=destination_type,
        target_plant_id=target_plant_id,
        account_category=account_category,
        net_settlement_amount=net_settlement_amount,
        status="active",
        entered_by=entered_by,
    )
    db.add(payment)
    db.flush()

    # Customer balance: money received reduces the receivable — same
    # advance/overpayment convention as /payments (§18).
    customer.current_balance = customer.current_balance - payload.amount
    customer.last_transaction_at = payload.date
    customer.last_overpayment_amount = excess_amount
    customer.last_overpayment_date = payload.date if excess_amount else None
    if excess_amount:
        customer.account_credit = customer.account_credit + excess_amount
    db.add(customer)

    apply_settlement_routing(
        db, payload.date, payload.home_expense_amount, payload.home_expense_category_id,
        payload.owner_drawings_amount, destination_type, target_plant_id, account_row,
        net_settlement_amount, entered_by, payment.id, f"Payment Receipt {payment.display_id}",
    )
    return payment


@router.post("", response_model=schemas.PaymentReceiptOut, status_code=201)
def create_payment_receipt(
    payload: schemas.PaymentReceiptCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Records a customer payment and, like a Unified Sale settlement,
    splits it three ways: home_expense_amount / owner_drawings_amount
    bypass every Dowa account; the remainder is routed per destination_type.
    The customer's balance always drops by the full `amount` — routing only
    affects where the *remainder* lands, never what the customer is credited
    for paying."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    destination_type, target_plant_id, account_row, account_category, net_settlement_amount = _validate_payment_receipt(db, payload)

    try:
        payment = _apply_payment_receipt(
            db, payload, current_user.name,
            destination_type, target_plant_id, account_row, account_category, net_settlement_amount,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Payment receipt failed, nothing was saved: {e}")

    db.refresh(payment)
    # Known directly from this request — no need to re-query the Expense/
    # OwnerDrawings rows just created (see _attach_bypass_amounts, used by
    # the list/cancel endpoints instead, which don't have the payload).
    payment.home_expense_amount = payload.home_expense_amount
    payment.owner_drawings_amount = payload.owner_drawings_amount
    return payment


@router.patch("/{payment_id}/correct", response_model=schemas.PaymentReceiptOut)
def correct_payment_receipt(
    payment_id: UUID, payload: schemas.PaymentReceiptCorrect, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """§ Bug Fix — Correction Modal Routing, Case 1 (Payment-Receipt-
    sourced — destination_type set directly on the row). Reverses exactly
    what the original posted (customer balance, plant payable/account
    credit, linked Expense/OwnerDrawings) via the same reverse_payment_
    receipt used by cancel_payment_receipt, marks the original "corrected"
    (kept forever in history — never mutated), then posts a brand-new
    replacement Payment with the corrected amount/destination. Mirrors
    routers/payments.py::correct_payment's reverse-then-repost shape."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.Payment).get(payment_id)
    if not original or original.destination_type is None:
        raise HTTPException(404, "Payment receipt not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active payment receipt can be corrected")

    destination_type, target_plant_id, account_row, account_category, net_settlement_amount = _validate_payment_receipt(db, payload)

    try:
        reverse_payment_receipt(db, original)

        original.status = "corrected"
        original.corrected_by = current_user.name
        original.corrected_at = datetime.utcnow()
        original.correction_reason = payload.correction_reason
        db.add(original)
        db.flush()

        corrected = _apply_payment_receipt(
            db, payload, current_user.name,
            destination_type, target_plant_id, account_row, account_category, net_settlement_amount,
        )
        corrected.corrected_from_id = original.id
        db.add(corrected)
        db.flush()

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Correction failed, nothing was changed: {e}")

    db.refresh(corrected)
    corrected.home_expense_amount = payload.home_expense_amount
    corrected.owner_drawings_amount = payload.owner_drawings_amount
    return corrected


@router.patch("/{payment_id}/cancel", response_model=schemas.PaymentReceiptOut)
def cancel_payment_receipt(payment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    payment = db.query(models.Payment).get(payment_id)
    if not payment or payment.destination_type is None:
        raise HTTPException(404, "Payment receipt not found")
    if payment.status != "active":
        raise HTTPException(400, "Payment receipt is already cancelled")

    reverse_payment_receipt(db, payment)

    payment.status = "cancelled"
    payment.modified_at = datetime.utcnow()
    payment.modified_by = by
    db.add(payment)

    db.commit()
    db.refresh(payment)
    _attach_bypass_amounts(db, [payment])
    return payment