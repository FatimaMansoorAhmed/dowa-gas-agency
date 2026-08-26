from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[schemas.ExpenseOut])
def list_expenses(
    category_id: UUID | None = Query(None),
    account_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Expense).filter(models.Expense.status == "active")
    if category_id:
        q = q.filter(models.Expense.category_id == category_id)
    if account_id:
        q = q.filter(models.Expense.account_id == account_id)
    rows = q.order_by(models.Expense.date.desc(), models.Expense.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]

    # Resolve the customer whose payment funded each customer-funded expense
    # (source_payment_id from a Payment Receipt's home-expense deduction, or
    # unified_sale_id from a Unified Sale's) — batched to avoid N+1 queries.
    payment_ids = {r.source_payment_id for r in rows if r.source_payment_id}
    batch_ids = {r.unified_sale_id for r in rows if r.unified_sale_id}
    payments = (
        {p.id: p for p in db.query(models.Payment).filter(models.Payment.id.in_(payment_ids)).all()}
        if payment_ids else {}
    )
    batches = (
        {b.id: b for b in db.query(models.UnifiedSaleBatch).filter(models.UnifiedSaleBatch.id.in_(batch_ids)).all()}
        if batch_ids else {}
    )
    customer_ids = {p.customer_id for p in payments.values()} | {b.customer_id for b in batches.values()}
    customers = (
        {c.id: c for c in db.query(models.Customer).filter(models.Customer.id.in_(customer_ids)).all()}
        if customer_ids else {}
    )

    out: list[schemas.ExpenseOut] = []
    for r in rows:
        customer = None
        if r.source_payment_id and r.source_payment_id in payments:
            customer = customers.get(payments[r.source_payment_id].customer_id)
        elif r.unified_sale_id and r.unified_sale_id in batches:
            customer = customers.get(batches[r.unified_sale_id].customer_id)
        out.append(schemas.ExpenseOut(
            id=r.id, display_id=r.display_id, date=r.date, category_id=r.category_id,
            amount=r.amount, account_id=r.account_id, method=r.method,
            description=r.description, vendor=r.vendor, reference_no=r.reference_no,
            unified_sale_id=r.unified_sale_id,
            customer_id=customer.id if customer else None,
            customer_name=customer.name if customer else None,
            status=r.status, entered_by=r.entered_by, created_at=r.created_at,
        ))
    return out


@router.post("", response_model=schemas.ExpenseOut, status_code=201)
def create_expense(payload: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    category = db.query(models.ExpenseCategory).get(payload.category_id)
    if not category:
        raise HTTPException(404, "Expense category not found")

    account = None
    if payload.account_id:
        account = db.query(models.PaymentAccount).get(payload.account_id)
        if not account:
            raise HTTPException(404, "Payment account not found")

    expense = models.Expense(
        display_id=next_display_id(db, models.Expense, "EXP", width=6),
        date=payload.date,
        category_id=payload.category_id,
        amount=payload.amount,
        account_id=payload.account_id,
        method=payload.method,
        description=payload.description,
        vendor=payload.vendor,
        reference_no=payload.reference_no,
        status="active",
        entered_by=payload.entered_by,
    )
    db.add(expense)

    # Money OUT (§9, §12) — an expense reduces the paying account only, and
    # only if an account was actually funded. An expense recorded with no
    # account_id was paid directly out of field-collected cash that never
    # touched a Dowa account — nothing to debit (see Unified Sale settlement).
    if account:
        account.current_balance = account.current_balance - payload.amount
        db.add(account)

    db.commit()
    db.refresh(expense)
    return expense