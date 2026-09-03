from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.utils import next_display_id

router = APIRouter(prefix="/purchases", tags=["purchases"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.PurchaseOut])
def list_purchases(
    company_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM, filters by purchase.date"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Purchase).filter(models.Purchase.status == "active")
    if company_id:
        q = q.filter(models.Purchase.company_id == company_id)
    rows = q.order_by(models.Purchase.date.desc(), models.Purchase.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


def _apply_purchase(db: Session, payload: schemas.PurchaseCreate, entered_by: str) -> models.Purchase:
    """Create-time posting logic, shared by create_purchase and
    correct_purchase (§1)."""
    company = db.query(models.Company).get(payload.company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    total_kg = payload.quantity * product.weight_kg
    cylinder_amount = payload.quantity * payload.rate_per_cylinder
    total_amount = cylinder_amount + payload.additional_charges + payload.transport_charges + payload.other_charges
    rate_per_kg = round(float(payload.rate_per_cylinder) / float(product.weight_kg), 2) if product.weight_kg else None

    purchase = models.Purchase(
        display_id=next_display_id(db, models.Purchase, "PUR", width=6),
        date=payload.date,
        company_id=payload.company_id,
        product_id=payload.product_id,
        quantity=payload.quantity,
        weight_per_cylinder=product.weight_kg,
        total_kg=total_kg,
        rate_per_kg=rate_per_kg,
        rate_per_cylinder=payload.rate_per_cylinder,
        additional_charges=payload.additional_charges,
        transport_charges=payload.transport_charges,
        other_charges=payload.other_charges,
        total_amount=total_amount,
        gate_pass_no=payload.gate_pass_no,
        vehicle_no=payload.vehicle_no,
        driver_name=payload.driver_name,
        driver_contact=payload.driver_contact,
        notes=payload.notes,
        status="active",
        entered_by=entered_by,
    )
    db.add(purchase)
    db.flush()

    # Same formula as Customer, mirrored for the payable side:
    # New Company Balance = Previous + Purchase − Payment.
    company.current_balance = company.current_balance + total_amount
    db.add(company)

    return purchase


def _reverse_purchase(db: Session, purchase: models.Purchase) -> None:
    """Undoes exactly what _apply_purchase posted. Shared by cancel_purchase
    and correct_purchase (§1)."""
    company = db.query(models.Company).get(purchase.company_id)
    company.current_balance = company.current_balance - purchase.total_amount
    db.add(company)


@router.post("", response_model=schemas.PurchaseOut, status_code=201)
def create_purchase(
    payload: schemas.PurchaseCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    purchase = _apply_purchase(db, payload, current_user.name)
    db.commit()
    db.refresh(purchase)
    return purchase


@router.patch("/{purchase_id}/cancel", response_model=schemas.PurchaseOut)
def cancel_purchase(purchase_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    purchase = db.query(models.Purchase).get(purchase_id)
    if not purchase:
        raise HTTPException(404, "Purchase not found")
    if purchase.status != "active":
        raise HTTPException(400, "Purchase is already cancelled")

    _reverse_purchase(db, purchase)

    purchase.status = "cancelled"
    purchase.modified_at = datetime.utcnow()
    purchase.modified_by = by
    db.add(purchase)

    db.commit()
    db.refresh(purchase)
    return purchase


@router.patch("/{purchase_id}/correct", response_model=schemas.PurchaseOut)
def correct_purchase(
    purchase_id: UUID, payload: schemas.PurchaseCorrect, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Ledger Correction (§1) — see correct_sale in routers/sales.py for
    the full pattern this mirrors."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.Purchase).get(purchase_id)
    if not original:
        raise HTTPException(404, "Purchase not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active purchase can be corrected")

    _reverse_purchase(db, original)

    original.status = "corrected"
    original.corrected_by = current_user.name
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_purchase(db, payload, current_user.name)
    corrected.corrected_from_id = original.id
    db.add(corrected)

    db.commit()
    db.refresh(corrected)
    return corrected