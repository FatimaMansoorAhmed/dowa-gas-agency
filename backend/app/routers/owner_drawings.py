from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id

router = APIRouter(prefix="/owner-drawings", tags=["owner-drawings"])


@router.get("", response_model=list[schemas.OwnerDrawingsOut])
def list_owner_drawings(
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.OwnerDrawings).filter(models.OwnerDrawings.status == "active")
    rows = q.order_by(models.OwnerDrawings.date.desc(), models.OwnerDrawings.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


@router.post("", response_model=schemas.OwnerDrawingsOut, status_code=201)
def create_owner_drawing(payload: schemas.OwnerDrawingsCreate, db: Session = Depends(get_db)):
    account = None
    if payload.account_id:
        account = db.query(models.PaymentAccount).get(payload.account_id)
        if not account:
            raise HTTPException(404, "Payment account not found")

    drawing = models.OwnerDrawings(
        display_id=next_display_id(db, models.OwnerDrawings, "DRAW", width=6),
        date=payload.date,
        amount=payload.amount,
        account_id=payload.account_id,
        notes=payload.notes,
        status="active",
        entered_by=payload.entered_by,
    )
    db.add(drawing)

    # Same rule as Expense: only debit an account if one was actually
    # funded. Excluded from P&L everywhere it's reported — see spec §2.
    if account:
        account.current_balance = account.current_balance - payload.amount
        db.add(account)

    db.commit()
    db.refresh(drawing)
    return drawing