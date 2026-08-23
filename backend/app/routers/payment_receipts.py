from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id

router = APIRouter(prefix="/payment-receipts", tags=["payment-receipts"])

EPSILON = Decimal("0.01")


def _try_uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _resolve_destination(db: Session, payload: schemas.PaymentReceiptCreate):
    """Mirrors unified_sale._resolve_destination — validates and normalizes
    settlement routing. Returns (destination_type, target_plant_id,
    account_row_or_None, account_category_or_None)."""
    destination_type = payload.destination_type or "plant"
    if destination_type == "plant":
        if not payload.target_plant_id:
            raise HTTPException(400, "target_plant_id is required when destination_type is 'plant'")
        if not db.query(models.Company).get(payload.target_plant_id):
            raise HTTPException(404, "Target plant not found")
        return destination_type, payload.target_plant_id, None, None

    if not payload.account_id:
        raise HTTPException(400, "account_id is required when destination_type is 'account'")
    account_uuid = _try_uuid(payload.account_id)
    account_row = db.query(models.PaymentAccount).get(account_uuid) if account_uuid else None
    if account_uuid and not account_row:
        raise HTTPException(404, "Payment account not found")
    account_category = None if account_row else str(payload.account_id)
    return destination_type, None, account_row, account_category


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
    rows = q.order_by(models.Payment.date.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


@router.post("", response_model=schemas.PaymentReceiptOut, status_code=201)
def create_payment_receipt(payload: schemas.PaymentReceiptCreate, db: Session = Depends(get_db)):
    """Records a customer payment and, like a Unified Sale settlement,
    splits it three ways: home_expense_amount / owner_drawings_amount
    bypass every Dowa account; the remainder is routed per destination_type.
    The customer's balance always drops by the full `amount` — routing only
    affects where the *remainder* lands, never what the customer is credited
    for paying."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    bypass_sum = payload.home_expense_amount + payload.owner_drawings_amount
    if bypass_sum > payload.amount + EPSILON:
        raise HTTPException(
            400,
            f"Home expense ({payload.home_expense_amount}) + owner drawings ({payload.owner_drawings_amount}) "
            f"= {bypass_sum} exceeds amount received ({payload.amount}).",
        )
    if payload.home_expense_amount > 0 and not payload.home_expense_category_id:
        raise HTTPException(400, "home_expense_category_id is required when home_expense_amount > 0")
    if payload.home_expense_category_id and not db.query(models.ExpenseCategory).get(payload.home_expense_category_id):
        raise HTTPException(404, "Expense category not found")

    destination_type, target_plant_id, account_row, account_category = _resolve_destination(db, payload)
    net_settlement_amount = payload.amount - payload.home_expense_amount - payload.owner_drawings_amount

    try:
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
            entered_by=payload.entered_by,
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

        if payload.home_expense_amount > 0:
            db.add(models.Expense(
                display_id=next_display_id(db, models.Expense, "EXP", width=6),
                date=payload.date, category_id=payload.home_expense_category_id,
                amount=payload.home_expense_amount, account_id=None, method="cash",
                description=f"Auto-created from Payment Receipt {payment.display_id}",
                status="active", entered_by=payload.entered_by, source_payment_id=payment.id,
            ))

        if payload.owner_drawings_amount > 0:
            db.add(models.OwnerDrawings(
                display_id=next_display_id(db, models.OwnerDrawings, "DRAW", width=6),
                date=payload.date, amount=payload.owner_drawings_amount, account_id=None,
                notes=f"Auto-created from Payment Receipt {payment.display_id}",
                status="active", entered_by=payload.entered_by, source_payment_id=payment.id,
            ))

        if net_settlement_amount > 0:
            if destination_type == "plant":
                company = db.query(models.Company).get(target_plant_id)
                c_excess = net_settlement_amount - company.current_balance
                c_excess_amount = c_excess if c_excess > 0 else None
                db.add(models.CompanyPayment(
                    display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
                    date=payload.date, company_id=target_plant_id, amount=net_settlement_amount,
                    method="direct_settlement", account_id=None,
                    notes=f"3-way settlement via Payment Receipt {payment.display_id} — customer paid plant directly",
                    excess_amount=c_excess_amount, status="active",
                    entered_by=payload.entered_by, source_payment_id=payment.id,
                ))
                company.current_balance = company.current_balance - net_settlement_amount
                company.last_overpayment_amount = c_excess_amount
                company.last_overpayment_date = payload.date if c_excess_amount else None
                if c_excess_amount:
                    company.account_credit = company.account_credit + c_excess_amount
                db.add(company)
            elif account_row:
                account_row.current_balance = account_row.current_balance + net_settlement_amount
                db.add(account_row)
            # else: a category label with no PaymentAccount row (e.g.
            # "office_cash") — nothing to credit, money is only tracked via
            # this payment's own destination_type/account_category fields.

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Payment receipt failed, nothing was saved: {e}")

    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/cancel", response_model=schemas.PaymentReceiptOut)
def cancel_payment_receipt(payment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    payment = db.query(models.Payment).get(payment_id)
    if not payment or payment.destination_type is None:
        raise HTTPException(404, "Payment receipt not found")
    if payment.status != "active":
        raise HTTPException(400, "Payment receipt is already cancelled")

    customer = db.query(models.Customer).get(payment.customer_id)
    customer.current_balance = customer.current_balance + payment.amount
    if payment.excess_amount:
        customer.account_credit = customer.account_credit - payment.excess_amount
    db.add(customer)

    company_payment = (
        db.query(models.CompanyPayment)
        .filter(models.CompanyPayment.source_payment_id == payment.id, models.CompanyPayment.status == "active")
        .first()
    )
    if company_payment:
        company = db.query(models.Company).get(company_payment.company_id)
        company.current_balance = company.current_balance + company_payment.amount
        if company_payment.excess_amount:
            company.account_credit = company.account_credit - company_payment.excess_amount
        db.add(company)
        company_payment.status = "cancelled"
        db.add(company_payment)
    elif payment.account_id and payment.net_settlement_amount:
        account = db.query(models.PaymentAccount).get(payment.account_id)
        if account:
            account.current_balance = account.current_balance - payment.net_settlement_amount
            db.add(account)

    for exp in db.query(models.Expense).filter(
        models.Expense.source_payment_id == payment.id, models.Expense.status == "active"
    ).all():
        exp.status = "cancelled"
        db.add(exp)
    for draw in db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_payment_id == payment.id, models.OwnerDrawings.status == "active"
    ).all():
        draw.status = "cancelled"
        db.add(draw)

    payment.status = "cancelled"
    payment.modified_at = datetime.utcnow()
    payment.modified_by = by
    db.add(payment)

    db.commit()
    db.refresh(payment)
    return payment