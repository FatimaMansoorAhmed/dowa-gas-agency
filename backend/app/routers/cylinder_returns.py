from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.utils import (
    next_display_id, resolve_settlement_destination, apply_settlement_routing, reverse_payment_receipt,
)

router = APIRouter(prefix="/cylinder-returns", tags=["cylinder-returns"], dependencies=[Depends(require_active_user), Depends(require_csrf)])

EPSILON = Decimal("0.01")


def _size_attr(cylinder_size: str) -> str:
    return "empty_cylinders_454" if cylinder_size == "454" else "empty_cylinders_118"


def _type_attr(cylinder_size: str, cylinder_type: str) -> str:
    return f"empty_cylinders_{cylinder_size}_{cylinder_type}"


def _shift_balance(customer: models.Customer, cylinder_size: str, cylinder_type: Optional[str], delta: Decimal) -> None:
    """Moves `delta` (+/-) through the same 2 columns sell_empty_cylinders
    (routers/customers.py) maintains: the size total and the undifferentiated
    running total. Also moves the type-specific column when cylinder_type is
    given — omitted means the untyped legacy balance, exactly like the Sell
    Empty Cylinders flow."""
    size_attr = _size_attr(cylinder_size)
    setattr(customer, size_attr, (getattr(customer, size_attr) or 0) + delta)
    if cylinder_type:
        type_attr = _type_attr(cylinder_size, cylinder_type)
        setattr(customer, type_attr, (getattr(customer, type_attr) or 0) + delta)
    customer.empty_cylinders = (customer.empty_cylinders or 0) + delta


def _available_balance(customer: models.Customer, cylinder_size: str, cylinder_type: Optional[str]) -> Decimal:
    if cylinder_type:
        return getattr(customer, _type_attr(cylinder_size, cylinder_type)) or 0
    return getattr(customer, _size_attr(cylinder_size)) or 0


@router.get("", response_model=list[schemas.CylinderReturnOut])
def list_cylinder_returns(
    customer_id: Optional[UUID] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.CylinderReturn).filter(models.CylinderReturn.status == "active")
    if customer_id:
        q = q.filter(models.CylinderReturn.customer_id == customer_id)
    rows = q.order_by(models.CylinderReturn.date.desc(), models.CylinderReturn.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


@router.post("", response_model=schemas.CylinderReturnOut, status_code=201)
def create_cylinder_return(
    payload: schemas.CylinderReturnCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """One endpoint for all 3 Return/Add Empty Cylinder modes
    (§ models.CylinderReturn):
      - "transfer": pure cylinder-count move to another customer, zero money.
      - "cash": converts the quantity to a cash value routed EXACTLY like a
        Payment Receipt (see utils.resolve_settlement_destination/
        apply_settlement_routing, the same functions POST /payment-receipts
        uses) — the customer is credited (current_balance drops) exactly as
        if they'd handed over that amount in cash.
      - "manual_add": pure count increase, no balance/money effect at all.
    """
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be greater than 0")

    date = payload.date or datetime.utcnow()

    # "manual_add" only ever increases a balance — nothing to check.
    if payload.mode != "manual_add":
        available = _available_balance(customer, payload.cylinder_size, payload.cylinder_type)
        if payload.quantity > available:
            size_label = "45.4" if payload.cylinder_size == "454" else "11.8"
            type_label = f" {payload.cylinder_type.upper()}" if payload.cylinder_type else ""
            raise HTTPException(
                400,
                f"Quantity exceeds the customer's available {size_label} KG{type_label} empty cylinder balance",
            )

    to_customer = None
    destination_type = target_plant_id = account_row = account_category = None
    net_settlement_amount = None

    if payload.mode == "transfer":
        if not payload.to_customer_id:
            raise HTTPException(400, "to_customer_id is required when mode is 'transfer'")
        if payload.to_customer_id == payload.customer_id:
            raise HTTPException(400, "Cannot transfer cylinders to the same customer")
        to_customer = db.query(models.Customer).get(payload.to_customer_id)
        if not to_customer:
            raise HTTPException(404, "Destination customer not found")

    elif payload.mode == "cash":
        if not payload.amount or payload.amount <= 0:
            raise HTTPException(400, "amount is required and must be greater than 0 when mode is 'cash'")
        bypass_sum = payload.home_expense_amount + payload.owner_drawings_amount
        if bypass_sum > payload.amount + EPSILON:
            raise HTTPException(
                400,
                f"Home expense ({payload.home_expense_amount}) + owner drawings ({payload.owner_drawings_amount}) "
                f"= {bypass_sum} exceeds the cylinder cash amount ({payload.amount}).",
            )
        if payload.home_expense_amount > 0 and not payload.home_expense_category_id:
            raise HTTPException(400, "home_expense_category_id is required when home_expense_amount > 0")
        if payload.home_expense_category_id and not db.query(models.ExpenseCategory).get(payload.home_expense_category_id):
            raise HTTPException(404, "Expense category not found")

        net_settlement_amount = payload.amount - payload.home_expense_amount - payload.owner_drawings_amount
        destination_type, target_plant_id, account_row, account_category = resolve_settlement_destination(
            db, payload.destination_type, payload.target_plant_id, payload.account_id, net_settlement_amount
        )

    cret_display_id = next_display_id(db, models.CylinderReturn, "CRET", width=6)

    try:
        payment_id = None

        if payload.mode == "transfer":
            _shift_balance(customer, payload.cylinder_size, payload.cylinder_type, -payload.quantity)
            _shift_balance(to_customer, payload.cylinder_size, payload.cylinder_type, payload.quantity)
            db.add(customer)
            db.add(to_customer)

        elif payload.mode == "cash":
            excess = payload.amount - customer.current_balance
            excess_amount = excess if excess > 0 else None

            payment = models.Payment(
                display_id=next_display_id(db, models.Payment, "PAY", width=6),
                date=date,
                customer_id=payload.customer_id,
                amount=payload.amount,
                method=payload.method,
                account_id=account_row.id if account_row else None,
                reference_no=payload.reference_no,
                notes=payload.notes or f"Cylinder Return {cret_display_id}",
                excess_amount=excess_amount,
                destination_type=destination_type,
                target_plant_id=target_plant_id,
                account_category=account_category,
                net_settlement_amount=net_settlement_amount,
                status="active",
                entered_by=current_user.name,
            )
            db.add(payment)
            db.flush()
            payment_id = payment.id

            # Customer balance: returning cylinders settles what they owe
            # exactly like handing over cash (§ Return Cylinder — Convert to
            # Cash), same advance/overpayment convention as /payment-receipts.
            customer.current_balance = customer.current_balance - payload.amount
            customer.last_transaction_at = date
            customer.last_overpayment_amount = excess_amount
            customer.last_overpayment_date = date if excess_amount else None
            if excess_amount:
                customer.account_credit = customer.account_credit + excess_amount
            db.add(customer)

            _shift_balance(customer, payload.cylinder_size, payload.cylinder_type, -payload.quantity)
            db.add(customer)

            apply_settlement_routing(
                db, date, payload.home_expense_amount, payload.home_expense_category_id,
                payload.owner_drawings_amount, destination_type, target_plant_id, account_row,
                net_settlement_amount, current_user.name, payment.id, f"Cylinder Return {cret_display_id}",
            )

        else:  # manual_add
            _shift_balance(customer, payload.cylinder_size, payload.cylinder_type, payload.quantity)
            db.add(customer)

        cyl_return = models.CylinderReturn(
            display_id=cret_display_id,
            date=date,
            customer_id=payload.customer_id,
            cylinder_size=payload.cylinder_size,
            cylinder_type=payload.cylinder_type,
            quantity=payload.quantity,
            mode=payload.mode,
            to_customer_id=payload.to_customer_id if payload.mode == "transfer" else None,
            payment_id=payment_id,
            notes=payload.notes,
            status="active",
            entered_by=current_user.name,
        )
        db.add(cyl_return)

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Cylinder return failed, nothing was saved: {e}")

    db.refresh(cyl_return)
    return cyl_return


@router.patch("/{cylinder_return_id}/cancel", response_model=schemas.CylinderReturnOut)
def cancel_cylinder_return(cylinder_return_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    cyl_return = db.query(models.CylinderReturn).get(cylinder_return_id)
    if not cyl_return:
        raise HTTPException(404, "Cylinder return not found")
    if cyl_return.status != "active":
        raise HTTPException(400, "Already cancelled")

    customer = db.query(models.Customer).get(cyl_return.customer_id)

    try:
        if cyl_return.mode == "transfer":
            to_customer = db.query(models.Customer).get(cyl_return.to_customer_id)
            _shift_balance(customer, cyl_return.cylinder_size, cyl_return.cylinder_type, cyl_return.quantity)
            db.add(customer)
            if to_customer:
                _shift_balance(to_customer, cyl_return.cylinder_size, cyl_return.cylinder_type, -cyl_return.quantity)
                db.add(to_customer)

        elif cyl_return.mode == "cash":
            payment = db.query(models.Payment).get(cyl_return.payment_id) if cyl_return.payment_id else None
            if payment and payment.status == "active":
                reverse_payment_receipt(db, payment)
                payment.status = "cancelled"
                payment.modified_at = datetime.utcnow()
                payment.modified_by = by
                db.add(payment)
            _shift_balance(customer, cyl_return.cylinder_size, cyl_return.cylinder_type, cyl_return.quantity)
            db.add(customer)

        else:  # manual_add
            _shift_balance(customer, cyl_return.cylinder_size, cyl_return.cylinder_type, -cyl_return.quantity)
            db.add(customer)

        cyl_return.status = "cancelled"
        cyl_return.modified_at = datetime.utcnow()
        cyl_return.modified_by = by
        db.add(cyl_return)

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Cancel failed, nothing was changed: {e}")

    db.refresh(cyl_return)
    return cyl_return
