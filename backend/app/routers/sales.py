from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id, adjust_cylinder_balance

router = APIRouter(prefix="/sales", tags=["sales"])


def _log(db: Session, entity_type: str, entity_id, action: str, by: str, field=None, old=None, new=None):
    db.add(models.AuditLog(
        entity_type=entity_type, entity_id=entity_id, action=action,
        field=field, old_value=str(old) if old is not None else None,
        new_value=str(new) if new is not None else None, performed_by=by,
    ))


@router.get("", response_model=list[schemas.SaleOut])
def list_sales(
    customer_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM, filters by sale.date"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Sale).filter(models.Sale.status == "active")
    if customer_id:
        q = q.filter(models.Sale.customer_id == customer_id)
    rows = q.order_by(models.Sale.date.desc()).all()
    if month:
        # Filtered in Python rather than SQL so this behaves identically on
        # SQLite (local dev) and Postgres (production) without dialect-specific date functions.
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


@router.post("", response_model=schemas.SaleOut, status_code=201)
def create_sale(payload: schemas.SaleCreate, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if payload.company_id:
        company = db.query(models.Company).get(payload.company_id)
        if not company:
            raise HTTPException(404, "Company not found")

    total_kg = payload.quantity * product.weight_kg
    total_amount = payload.quantity * payload.rate_per_cylinder
    rate_per_kg = round(float(payload.rate_per_cylinder) / float(product.weight_kg), 2) if product.weight_kg else None

    sale = models.Sale(
        display_id=next_display_id(db, models.Sale, "SALE", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        product_id=payload.product_id,
        company_id=payload.company_id,
        quantity=payload.quantity,
        weight_per_cylinder=product.weight_kg,
        total_kg=total_kg,
        rate_per_kg=rate_per_kg,
        rate_per_cylinder=payload.rate_per_cylinder,
        total_amount=total_amount,
        gate_pass_no=payload.gate_pass_no,
        vehicle_no=payload.vehicle_no,
        notes=payload.notes,
        status="active",
        entered_by=payload.entered_by,
    )
    db.add(sale)
    db.flush()  # assigns sale.id so the audit log row can reference it

    # Core formula (§13): New Customer Balance = Previous + Sale − Payment.
    # A sale alone only ever adds to what's owed.
# Line 73-75 in sales.py
    customer.current_balance = customer.current_balance + total_amount
    customer.last_transaction_at = payload.date
    db.add(customer)

    _log(db, "sale", sale.id, "create", payload.entered_by, new=str(total_amount))

    # Every sale dispatches filled cylinders and, optionally, takes back
    # empties on the spot — recorded as a linked CylinderTransaction so the
    # per-customer/per-product cylinder balance never has to be reconciled
    # by hand (§3, critical edge case).
    cylinder_txn = models.CylinderTransaction(
        display_id=next_display_id(db, models.CylinderTransaction, "CYL", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        product_id=payload.product_id,
        sale_id=sale.id,
        qty_out=payload.quantity,
        qty_in=payload.cylinders_returned,
        status="active",
        entered_by=payload.entered_by,
    )
    db.add(cylinder_txn)
    adjust_cylinder_balance(db, payload.customer_id, payload.product_id, payload.quantity - payload.cylinders_returned)

    db.commit()
    db.refresh(sale)
    return sale


@router.patch("/{sale_id}/cancel", response_model=schemas.SaleOut)
def cancel_sale(sale_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    """Voids a sale without deleting it (§16) and reverses its effect on the
    customer's balance so the ledger stays correct."""
    sale = db.query(models.Sale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Sale not found")
    if sale.status != "active":
        raise HTTPException(400, "Sale is already cancelled")

    customer = db.query(models.Customer).get(sale.customer_id)
    customer.current_balance = customer.current_balance - sale.total_amount
    db.add(customer)

    sale.status = "cancelled"
    sale.modified_at = datetime.utcnow()
    sale.modified_by = by
    db.add(sale)

    # Reverse the linked cylinder movement too, so a cancelled sale never
    # leaves a phantom cylinder balance behind.
    cylinder_txn = (
        db.query(models.CylinderTransaction)
        .filter(models.CylinderTransaction.sale_id == sale.id, models.CylinderTransaction.status == "active")
        .first()
    )
    if cylinder_txn:
        adjust_cylinder_balance(db, cylinder_txn.customer_id, cylinder_txn.product_id, -(cylinder_txn.qty_out - cylinder_txn.qty_in))
        cylinder_txn.status = "cancelled"
        cylinder_txn.modified_at = datetime.utcnow()
        cylinder_txn.modified_by = by
        db.add(cylinder_txn)

    _log(db, "sale", sale.id, "cancel", by, old="active", new="cancelled")

    db.commit()
    db.refresh(sale)
    return sale