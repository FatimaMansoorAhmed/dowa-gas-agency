from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.utils import next_display_id, adjust_cylinder_balance

router = APIRouter(prefix="/cylinder-transactions", tags=["cylinder-transactions"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.CylinderTransactionOut])
def list_cylinder_transactions(
    customer_id: UUID | None = Query(None),
    product_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM, filters by date"),
    db: Session = Depends(get_db),
):
    q = db.query(models.CylinderTransaction).filter(models.CylinderTransaction.status == "active")
    if customer_id:
        q = q.filter(models.CylinderTransaction.customer_id == customer_id)
    if product_id:
        q = q.filter(models.CylinderTransaction.product_id == product_id)
    rows = q.order_by(models.CylinderTransaction.date.desc(), models.CylinderTransaction.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


@router.get("/balances", response_model=list[schemas.CylinderBalanceOut])
def list_balances(customer_id: UUID | None = Query(None), db: Session = Depends(get_db)):
    q = db.query(models.CustomerCylinderBalance)
    if customer_id:
        q = q.filter(models.CustomerCylinderBalance.customer_id == customer_id)
    return q.all()


@router.post("", response_model=schemas.CylinderTransactionOut, status_code=201)
def create_cylinder_transaction(
    payload: schemas.CylinderTransactionCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Standalone entry — a customer dropping off empties or collecting
    filled cylinders outside of a sale. Sales create their own linked row
    via POST /sales; this endpoint always leaves sale_id null."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if payload.qty_out < 0 or payload.qty_in < 0:
        raise HTTPException(400, "Quantities cannot be negative")
    if payload.qty_out == 0 and payload.qty_in == 0:
        raise HTTPException(400, "Enter a quantity out or in")

    txn = models.CylinderTransaction(
        display_id=next_display_id(db, models.CylinderTransaction, "CYL", width=6),
        date=payload.date or datetime.utcnow(),
        customer_id=payload.customer_id,
        product_id=payload.product_id,
        qty_out=payload.qty_out,
        qty_in=payload.qty_in,
        notes=payload.notes,
        status="active",
        entered_by=current_user.name,
    )
    db.add(txn)
    adjust_cylinder_balance(db, payload.customer_id, payload.product_id, payload.qty_out - payload.qty_in)

    db.commit()
    db.refresh(txn)
    return txn


@router.patch("/{txn_id}/cancel", response_model=schemas.CylinderTransactionOut)
def cancel_cylinder_transaction(txn_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    txn = db.query(models.CylinderTransaction).get(txn_id)
    if not txn:
        raise HTTPException(404, "Cylinder transaction not found")
    if txn.status != "active":
        raise HTTPException(400, "Already cancelled")
    if txn.sale_id:
        raise HTTPException(400, "This entry was created by a sale — cancel the sale instead")

    adjust_cylinder_balance(db, txn.customer_id, txn.product_id, -(txn.qty_out - txn.qty_in))

    txn.status = "cancelled"
    txn.modified_at = datetime.utcnow()
    txn.modified_by = by
    db.add(txn)

    db.commit()
    db.refresh(txn)
    return txn