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
    rows = q.order_by(models.Expense.date.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


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