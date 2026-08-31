"""One adapter per existing transaction type (§8 mapping table). Each just
queries its model over [start, end) and maps rows into ReportableTransaction
— no accounting formula is computed here, every `amount` is a field that
already exists on the model (§5 "use existing ledger/accounting
calculations"). Registered at import time; app.reporting.daily imports this
module once (for its side effects) before reading ADAPTERS.
"""
from datetime import datetime
from decimal import Decimal
from sqlalchemy.orm import Session

from app import models
from app.reporting.registry import register
from app.reporting.types import ReportableTransaction
from app.routers.ledger import _settles_here, _batch_cylinder_totals


def _in_range(q, date_col, start: datetime, end: datetime):
    return q.filter(date_col >= start, date_col < end)


def _fetch_sales(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.Sale).filter(models.Sale.status == "active", models.Sale.unified_sale_id.is_(None)),
        models.Sale.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    plants = {c.id: c for c in db.query(models.Company).all()}
    out = []
    for s in rows:
        customer = customers.get(s.customer_id)
        plant = plants.get(s.company_id) if s.company_id else None
        out.append(ReportableTransaction(
            id=s.id, type="sale", date=s.date, display_id=s.display_id,
            description=f"Sale × {s.quantity}", amount=s.total_amount,
            customer=customer.name if customer else None, plant=plant.name if plant else None,
            reference=s.gate_pass_no or s.vehicle_no, entered_by=s.entered_by, status=s.status,
        ))
    return out


def _fetch_purchases(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.Purchase).filter(models.Purchase.status == "active", models.Purchase.unified_sale_id.is_(None)),
        models.Purchase.date, start, end,
    ).all()
    plants = {c.id: c for c in db.query(models.Company).all()}
    out = []
    for p in rows:
        plant = plants.get(p.company_id)
        out.append(ReportableTransaction(
            id=p.id, type="purchase", date=p.date, display_id=p.display_id,
            description=f"Purchase × {p.quantity}", amount=p.total_amount,
            plant=plant.name if plant else None, reference=p.gate_pass_no or p.vehicle_no,
            entered_by=p.entered_by, status=p.status,
        ))
    return out


def _fetch_customer_payments(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.Payment).filter(models.Payment.status == "active", models.Payment.unified_sale_id.is_(None)),
        models.Payment.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for p in rows:
        customer = customers.get(p.customer_id)
        out.append(ReportableTransaction(
            id=p.id, type="customer_payment", date=p.date, display_id=p.display_id,
            description=f"Payment · {p.method}", amount=p.amount,
            customer=customer.name if customer else None, reference=p.reference_no,
            entered_by=p.entered_by, status=p.status,
        ))
    return out


def _fetch_plant_payments(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.CompanyPayment).filter(models.CompanyPayment.status == "active", models.CompanyPayment.unified_sale_id.is_(None)),
        models.CompanyPayment.date, start, end,
    ).all()
    plants = {c.id: c for c in db.query(models.Company).all()}
    out = []
    for p in rows:
        plant = plants.get(p.company_id)
        out.append(ReportableTransaction(
            id=p.id, type="plant_payment", date=p.date, display_id=p.display_id,
            description=f"Plant Payment · {p.method}", amount=p.amount,
            plant=plant.name if plant else None, reference=p.reference_no,
            entered_by=p.entered_by, status=p.status,
        ))
    return out


def _fetch_owner_capital(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.OwnerCapital).filter(models.OwnerCapital.status == "active"),
        models.OwnerCapital.date, start, end,
    ).all()
    plants = {c.id: c for c in db.query(models.Company).all()}
    out = []
    for c in rows:
        plant = plants.get(c.target_plant_id) if c.target_plant_id else None
        out.append(ReportableTransaction(
            id=c.id, type="owner_capital", date=c.date, display_id=c.display_id,
            description=f"Owner Capital ({c.destination_type})", amount=c.amount,
            plant=plant.name if plant else None, entered_by=c.entered_by, status=c.status,
        ))
    return out


def _fetch_expenses(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.Expense).filter(models.Expense.status == "active"),
        models.Expense.date, start, end,
    ).all()
    categories = {c.id: c for c in db.query(models.ExpenseCategory).all()}
    out = []
    for e in rows:
        category = categories.get(e.category_id)
        out.append(ReportableTransaction(
            id=e.id, type="expense", date=e.date, display_id=e.display_id,
            description=f"{category.name if category else 'Expense'}" + (f" — {e.description}" if e.description else ""),
            amount=e.amount, reference=e.reference_no, entered_by=e.entered_by, status=e.status,
        ))
    return out


def _fetch_owner_drawings(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.OwnerDrawings).filter(models.OwnerDrawings.status == "active"),
        models.OwnerDrawings.date, start, end,
    ).all()
    return [
        ReportableTransaction(
            id=d.id, type="owner_drawings", date=d.date, display_id=d.display_id,
            description="Owner Drawings", amount=d.amount, entered_by=d.entered_by, status=d.status,
        )
        for d in rows
    ]


def _fetch_cylinder_activity(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    # Standalone movements only (sale_id.is_(None)) — a Sale's own linked
    # CylinderTransaction is already reported inside that Sale row, exactly
    # mirroring routers/ledger.py's convention (no double counting).
    rows = _in_range(
        db.query(models.CylinderTransaction).filter(
            models.CylinderTransaction.status == "active", models.CylinderTransaction.sale_id.is_(None)
        ),
        models.CylinderTransaction.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for t in rows:
        customer = customers.get(t.customer_id)
        out.append(ReportableTransaction(
            id=t.id, type="cylinder_transaction", date=t.date, display_id=t.display_id,
            description=f"Cylinder {t.transaction_type} — out {t.qty_out} / in {t.qty_in}",
            customer=customer.name if customer else None, entered_by=t.entered_by, status=t.status,
        ))
    return out


def _fetch_empty_cylinder_sales(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    rows = _in_range(
        db.query(models.EmptyCylinderSale).filter(models.EmptyCylinderSale.status == "active"),
        models.EmptyCylinderSale.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for e in rows:
        customer = customers.get(e.customer_id)
        out.append(ReportableTransaction(
            id=e.id, type="empty_cylinder_sale", date=e.date, display_id=e.display_id,
            description=f"Empty Cylinders Sold ({e.cylinder_size} KG) × {e.quantity}",
            amount=e.amount, customer=customer.name if customer else None,
            entered_by=e.entered_by, status=e.status,
        ))
    return out


def _fetch_unified_sales(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    from sqlalchemy import or_

    rows = db.query(models.UnifiedSaleBatch).filter(
        or_(models.UnifiedSaleBatch.sale_status == "approved", models.UnifiedSaleBatch.payment_status == "approved"),
        models.UnifiedSaleBatch.date >= start, models.UnifiedSaleBatch.date < end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    plants = {c.id: c for c in db.query(models.Company).all()}
    products = {p.id: p for p in db.query(models.Product).all()}
    out = []
    for b in rows:
        customer = customers.get(b.customer_id)
        plant = plants.get(b.company_id)
        purchase_amt = b.total_purchase_amount if b.sale_status == "approved" else Decimal("0")
        settle_amt = b.net_plant_payment if (_settles_here(b, b.company_id) and b.payment_status == "approved") else Decimal("0")
        amount = (b.total_selling_amount if b.sale_status == "approved" else Decimal("0")) - settle_amt
        approval = f"sale: {b.sale_status}, payment: {b.payment_status}"
        out.append(ReportableTransaction(
            id=b.id, type="unified_sale", date=b.date, display_id=b.display_id,
            description="Unified Sale — sale & settlement",
            amount=amount, customer=customer.name if customer else None, plant=plant.name if plant else None,
            reference=b.vehicle_no or b.gate_pass_no, entered_by=b.entered_by,
            approval_info=approval, status=b.status,
        ))
    return out


def _fetch_shop_sales(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Shop retail sales (§ Shop Management) — priced from the Board Rate
    on the sale date, immutable snapshot on the row itself, never
    recomputed here. Loads to a shop are just Sales and already appear in
    the 'sales' section above; this section is the shop's own retail
    activity, a distinct real-world event."""
    rows = _in_range(
        db.query(models.ShopSale).filter(models.ShopSale.status == "active"),
        models.ShopSale.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for s in rows:
        shop = customers.get(s.customer_id)
        out.append(ReportableTransaction(
            id=s.id, type="shop_sale", date=s.date, display_id=s.display_id,
            description=f"Shop Sale × {s.quantity}", amount=s.total_amount,
            customer=shop.name if shop else None, entered_by=s.entered_by, status=s.status,
        ))
    return out


register("sales", "Sales", _fetch_sales)
register("purchases", "Purchases", _fetch_purchases)
register("customer_payments", "Customer Payments", _fetch_customer_payments)
register("plant_payments", "Plant Payments / Settlements", _fetch_plant_payments)
register("investments", "Investments / Re-investments", _fetch_owner_capital)
register("expenses", "Expenses", _fetch_expenses)
register("owner_drawings", "Owner Drawings", _fetch_owner_drawings)
register("cylinder_activity", "Cylinder Activity", _fetch_cylinder_activity, has_financial_total=False)
register("empty_cylinder_sales", "Empty Cylinder Sales", _fetch_empty_cylinder_sales)
register("unified_sales", "Unified Sale", _fetch_unified_sales)
register("shop_sales", "Shop Sales", _fetch_shop_sales)
