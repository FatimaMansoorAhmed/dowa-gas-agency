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
    rows = q.order_by(models.Sale.date.desc(), models.Sale.created_at.desc()).all()
    if month:
        # Filtered in Python rather than SQL so this behaves identically on
        # SQLite (local dev) and Postgres (production) without dialect-specific date functions.
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


def _apply_sale(db: Session, payload: schemas.SaleCreate, entered_by: str) -> models.Sale:
    """Create-time posting logic: builds the Sale row, posts it to the
    customer's balance, and creates its linked CylinderTransaction. Shared
    by create_sale and correct_sale (§1) so both post identically."""
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
        entered_by=entered_by,
    )
    db.add(sale)
    db.flush()  # assigns sale.id so the audit log row / cylinder txn can reference it

    # Core formula (§13): New Customer Balance = Previous + Sale − Payment.
    # A sale alone only ever adds to what's owed.
    customer.current_balance = customer.current_balance + total_amount
    customer.last_transaction_at = payload.date
    db.add(customer)

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
        entered_by=entered_by,
    )
    db.add(cylinder_txn)
    adjust_cylinder_balance(db, payload.customer_id, payload.product_id, payload.quantity - payload.cylinders_returned)

    # Shop Management (§ Shop spec, "one transaction, no duplication"): a
    # Load is ALWAYS just an ordinary Sale — when the recipient is a shop,
    # this is the ONLY place a stock batch is ever created, atomically with
    # the Sale itself. There is no separate "enter a shop load" endpoint.
    if customer.customer_type == "shop":
        batch = models.ShopStockBatch(
            customer_id=customer.id,
            product_id=product.id,
            source_sale_id=sale.id,
            transaction_date=payload.date,
            quantity_received=payload.quantity,
            quantity_remaining=payload.quantity,
            load_rate_per_kg=(payload.rate_per_cylinder / product.weight_kg) if product.weight_kg else 0,
            status="active",
            entered_by=entered_by,
        )
        db.add(batch)

    return sale


def _reverse_sale(db: Session, sale: models.Sale, by: str) -> None:
    """Undoes exactly what _apply_sale posted — the customer balance and
    the linked CylinderTransaction — without touching sale.status itself
    (the caller decides "cancelled" vs "corrected"). Shared by cancel_sale
    and correct_sale (§1)."""
    customer = db.query(models.Customer).get(sale.customer_id)
    customer.current_balance = customer.current_balance - sale.total_amount
    db.add(customer)

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

    # Shop Management — reverse the batch this Load created, if any. Stock
    # must never go negative: refuse if any of it has already been sold
    # (a Shop Sale consumed from it, so quantity_remaining < quantity_received).
    batch = (
        db.query(models.ShopStockBatch)
        .filter(models.ShopStockBatch.source_sale_id == sale.id, models.ShopStockBatch.status == "active")
        .first()
    )
    if batch:
        if batch.quantity_remaining < batch.quantity_received:
            raise HTTPException(
                400,
                "This Load's stock has already been partially or fully sold — "
                "correct/cancel the related Shop Sale(s) first before cancelling or correcting this Load",
            )
        batch.status = "cancelled"
        db.add(batch)


@router.post("", response_model=schemas.SaleOut, status_code=201)
def create_sale(payload: schemas.SaleCreate, db: Session = Depends(get_db)):
    sale = _apply_sale(db, payload, payload.entered_by)
    _log(db, "sale", sale.id, "create", payload.entered_by, new=str(sale.total_amount))
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

    _reverse_sale(db, sale, by)

    sale.status = "cancelled"
    sale.modified_at = datetime.utcnow()
    sale.modified_by = by
    db.add(sale)

    _log(db, "sale", sale.id, "cancel", by, old="active", new="cancelled")

    db.commit()
    db.refresh(sale)
    return sale


@router.patch("/{sale_id}/correct", response_model=schemas.SaleOut)
def correct_sale(sale_id: UUID, payload: schemas.SaleCorrect, db: Session = Depends(get_db)):
    """Ledger Correction (§1): reverses this sale's effect, marks it
    "corrected" (kept forever, never deleted), and posts a brand-new Sale
    with the corrected values — traceable back via corrected_from_id."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.Sale).get(sale_id)
    if not original:
        raise HTTPException(404, "Sale not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active sale can be corrected")

    _reverse_sale(db, original, payload.corrected_by)

    original.status = "corrected"
    original.corrected_by = payload.corrected_by
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_sale(db, payload, payload.corrected_by)
    corrected.corrected_from_id = original.id
    db.add(corrected)

    _log(db, "sale", original.id, "correct", payload.corrected_by, old=str(original.total_amount), new=str(corrected.total_amount))

    db.commit()
    db.refresh(corrected)
    return corrected