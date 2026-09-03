from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.utils import next_display_id

router = APIRouter(prefix="/owner-drawings", tags=["owner-drawings"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.OwnerDrawingsOut])
def list_owner_drawings(
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.OwnerDrawings).filter(models.OwnerDrawings.status == "active")
    rows = q.order_by(models.OwnerDrawings.date.desc(), models.OwnerDrawings.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]

    # Dashboard P&L / Shop Expense integration (§ Dashboard) — resolve the
    # shop name for rows dual-written from a Shop's Record Expense form
    # (an owner_withdrawal line), batched to avoid N+1 queries.
    shop_ids = {r.shop_id for r in rows if r.shop_id}
    shops = (
        {s.id: s for s in db.query(models.Customer).filter(models.Customer.id.in_(shop_ids)).all()}
        if shop_ids else {}
    )
    return [
        schemas.OwnerDrawingsOut(
            id=r.id, display_id=r.display_id, date=r.date, amount=r.amount,
            account_id=r.account_id, notes=r.notes, unified_sale_id=r.unified_sale_id,
            shop_id=r.shop_id, shop_name=shops[r.shop_id].name if r.shop_id in shops else None,
            status=r.status, entered_by=r.entered_by, created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("", response_model=schemas.OwnerDrawingsOut, status_code=201)
def create_owner_drawing(
    payload: schemas.OwnerDrawingsCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
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
        entered_by=current_user.name,
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