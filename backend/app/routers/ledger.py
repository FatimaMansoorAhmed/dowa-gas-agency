from datetime import datetime
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/ledger", tags=["ledger"])


def _batch_cylinder_totals(db: Session, model, batch_id, products: dict) -> tuple[Decimal, Decimal, Decimal]:
    """Sums 11.8kg / 45.4kg quantities and total KG across every line item
    (Sale or Purchase) of one Unified Sale batch — used to build the single
    aggregated ledger row for that batch, instead of emitting one row per
    line item."""
    items = db.query(model).filter(model.unified_sale_id == batch_id).all()
    q118 = Decimal("0")
    q454 = Decimal("0")
    kg = Decimal("0")
    for it in items:
        kg += it.total_kg or Decimal("0")
        product = products.get(it.product_id)
        if not product:
            continue
        w = float(product.weight_kg)
        if 11.0 <= w <= 12.5:
            q118 += it.quantity
        elif 44.0 <= w <= 47.0:
            q454 += it.quantity
    return q118, q454, kg


@router.get("/customer/{customer_id}", response_model=schemas.CustomerLedgerSummary)
def customer_monthly_ledger(
    customer_id: UUID,
    month: str = Query(..., description="YYYY-MM, e.g. 2026-08"),
    db: Session = Depends(get_db),
):
    """Reproduces the Excel monthly customer page exactly:
    opening balance -> each day's sale/payment -> running balance -> closing
    balance, plus the 11.8/45.4 cylinder and KG totals for the month.

    The month's opening balance is never stored as an editable field — it's
    derived here as (year opening balance) + (everything that happened
    before this month), so it can't drift out of sync with the ledger (§3).
    """
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    month_start = datetime.strptime(month, "%Y-%m")
    year = month_start.year
    mo = month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)

    # Sales/payments that belong to a Unified Sale batch are excluded here —
    # they post as one aggregated row per batch below instead of splitting
    # into SALE-000012 / SALE-000013 / ... (§ ledger aggregation).
    all_sales = (
        db.query(models.Sale)
        .filter(
            models.Sale.customer_id == customer_id,
            models.Sale.status == "active",
            models.Sale.unified_sale_id.is_(None),
        )
        .order_by(models.Sale.date)
        .all()
    )
    all_payments = (
        db.query(models.Payment)
        .filter(
            models.Payment.customer_id == customer_id,
            models.Payment.status == "active",
            models.Payment.unified_sale_id.is_(None),
        )
        .order_by(models.Payment.date)
        .all()
    )
    # Only approved batches ever posted to customer.current_balance
    # (see unified_sale.approve_unified_sale) — pending/cancelled batches
    # must not appear in the ledger either.
    all_batches = (
        db.query(models.UnifiedSaleBatch)
        .filter(models.UnifiedSaleBatch.customer_id == customer_id, models.UnifiedSaleBatch.status == "approved")
        .order_by(models.UnifiedSaleBatch.date)
        .all()
    )

    products = {p.id: p for p in db.query(models.Product).all()}

    # Opening balance for the requested month = year opening balance plus
    # every sale/payment/unified-batch strictly before the 1st of that month.
    # A batch's net effect mirrors approve_unified_sale exactly: + selling - credit.
    opening = customer.opening_balance
    for s in all_sales:
        if s.date < month_start:
            opening += s.total_amount
    for p in all_payments:
        if p.date < month_start:
            opening -= p.amount
    for b in all_batches:
        if b.date < month_start:
            opening += b.total_selling_amount - b.total_credit_received

    month_sales = [s for s in all_sales if month_start <= s.date < next_month]
    month_payments = [p for p in all_payments if month_start <= p.date < next_month]
    month_batches = [b for b in all_batches if month_start <= b.date < next_month]

    events = (
        [{"date": s.date, "kind": "sale", "obj": s} for s in month_sales]
        + [{"date": p.date, "kind": "payment", "obj": p} for p in month_payments]
        + [{"date": b.date, "kind": "unified_sale", "obj": b} for b in month_batches]
    )
    events.sort(key=lambda e: e["date"])

    rows: list[schemas.LedgerRow] = []
    running = opening
    total_sales = Decimal("0")
    total_payments = Decimal("0")
    total_118 = Decimal("0")
    total_454 = Decimal("0")
    total_kg = Decimal("0")

    for e in events:
        if e["kind"] == "sale":
            s: models.Sale = e["obj"]
            running += s.total_amount
            total_sales += s.total_amount
            total_kg += s.total_kg
            product = products.get(s.product_id)
            w = float(product.weight_kg) if product else None
            q118 = s.quantity if w is not None and 11.0 <= w <= 12.5 else Decimal("0")
            q454 = s.quantity if w is not None and 44.0 <= w <= 47.0 else Decimal("0")
            total_118 += q118
            total_454 += q454
            rows.append(schemas.LedgerRow(
                date=s.date, kind="sale", ref_id=s.id, display_id=s.display_id,
                description=f"{product.name if product else 'Product'} × {s.quantity}",
                sale_amount=s.total_amount, payment_amount=0, running_balance=running,
                qty_118=q118, qty_454=q454,
            ))
        elif e["kind"] == "payment":
            p: models.Payment = e["obj"]
            running -= p.amount
            total_payments += p.amount
            rows.append(schemas.LedgerRow(
                date=p.date, kind="payment", ref_id=p.id, display_id=p.display_id,
                description=f"Payment · {p.method}",
                sale_amount=0, payment_amount=p.amount, running_balance=running,
                qty_118=Decimal("0"), qty_454=Decimal("0"),
            ))
        else:
            # One row for the whole Unified Sale batch — never split by line item.
            b: models.UnifiedSaleBatch = e["obj"]
            running += b.total_selling_amount - b.total_credit_received
            total_sales += b.total_selling_amount
            total_payments += b.total_credit_received
            q118, q454, kg = _batch_cylinder_totals(db, models.Sale, b.id, products)
            total_118 += q118
            total_454 += q454
            total_kg += kg
            rows.append(schemas.LedgerRow(
                date=b.approved_at or b.date, kind="unified_sale", ref_id=b.id, display_id=b.display_id,
                description="Unified Sale — sale & settlement",
                sale_amount=b.total_selling_amount, payment_amount=b.total_credit_received,
                running_balance=running, qty_118=q118, qty_454=q454,
            ))

    return schemas.CustomerLedgerSummary(
        customer=customer,
        month=month,
        opening_balance=opening,
        total_sales=total_sales,
        total_payments=total_payments,
        total_118=total_118,
        total_454=total_454,
        total_kg=total_kg,
        total_ton=(total_kg / Decimal("1000")) if total_kg else Decimal("0"),
        total_transactions=len(rows),
        closing_balance=running,
        rows=rows,
    )


@router.get("/company/{company_id}", response_model=schemas.CompanyLedgerSummary)
def company_monthly_ledger(
    company_id: UUID,
    month: str = Query(..., description="YYYY-MM, e.g. 2026-08"),
    db: Session = Depends(get_db),
):
    """Mirrors /ledger/customer/{id} exactly, on the payable side."""
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")

    month_start = datetime.strptime(month, "%Y-%m")
    year = month_start.year
    mo = month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)

    # Purchases/payments that belong to a Unified Sale batch are excluded
    # here — they post as one aggregated row per batch below instead of
    # splitting into PUR-000072 / PUR-000066 / ... (§ ledger aggregation).
    all_purchases = (
        db.query(models.Purchase)
        .filter(
            models.Purchase.company_id == company_id,
            models.Purchase.status == "active",
            models.Purchase.unified_sale_id.is_(None),
        )
        .order_by(models.Purchase.date)
        .all()
    )
    all_payments = (
        db.query(models.CompanyPayment)
        .filter(
            models.CompanyPayment.company_id == company_id,
            models.CompanyPayment.status == "active",
            models.CompanyPayment.unified_sale_id.is_(None),
        )
        .order_by(models.CompanyPayment.date)
        .all()
    )
    # Only approved batches ever posted to company.current_balance
    # (see unified_sale.approve_unified_sale).
    all_batches = (
        db.query(models.UnifiedSaleBatch)
        .filter(models.UnifiedSaleBatch.company_id == company_id, models.UnifiedSaleBatch.status == "approved")
        .order_by(models.UnifiedSaleBatch.date)
        .all()
    )

    products = {p.id: p for p in db.query(models.Product).all()}

    # A batch's net effect mirrors approve_unified_sale exactly:
    # + purchase amount - net plant payment (payments subtract the liability).
    opening = company.opening_balance
    for p in all_purchases:
        if p.date < month_start:
            opening += p.total_amount
    for pay in all_payments:
        if pay.date < month_start:
            opening -= pay.amount
    for b in all_batches:
        if b.date < month_start:
            opening += b.total_purchase_amount - b.net_plant_payment

    month_purchases = [p for p in all_purchases if month_start <= p.date < next_month]
    month_payments = [p for p in all_payments if month_start <= p.date < next_month]
    month_batches = [b for b in all_batches if month_start <= b.date < next_month]

    events = (
        [{"date": p.date, "kind": "purchase", "obj": p} for p in month_purchases]
        + [{"date": p.date, "kind": "payment", "obj": p} for p in month_payments]
        + [{"date": b.date, "kind": "unified_sale", "obj": b} for b in month_batches]
    )
    events.sort(key=lambda e: e["date"])

    rows: list[schemas.CompanyLedgerRow] = []
    running = opening
    total_purchases = Decimal("0")
    total_payments = Decimal("0")
    total_118 = Decimal("0")
    total_454 = Decimal("0")
    total_kg = Decimal("0")

    for e in events:
        if e["kind"] == "purchase":
            pu: models.Purchase = e["obj"]
            running += pu.total_amount
            total_purchases += pu.total_amount
            total_kg += pu.total_kg
            product = products.get(pu.product_id)
            w = float(product.weight_kg) if product else None
            q118 = pu.quantity if w is not None and 11.0 <= w <= 12.5 else Decimal("0")
            q454 = pu.quantity if w is not None and 44.0 <= w <= 47.0 else Decimal("0")
            total_118 += q118
            total_454 += q454
            rows.append(schemas.CompanyLedgerRow(
                date=pu.date, kind="purchase", ref_id=pu.id, display_id=pu.display_id,
                description=f"{product.name if product else 'Product'} × {pu.quantity}"
                + (f" · GP {pu.gate_pass_no}" if pu.gate_pass_no else ""),
                purchase_amount=pu.total_amount, payment_amount=0, running_balance=running,
                qty_118=q118, qty_454=q454,
            ))
        elif e["kind"] == "payment":
            pay: models.CompanyPayment = e["obj"]
            running -= pay.amount
            total_payments += pay.amount
            rows.append(schemas.CompanyLedgerRow(
                date=pay.date, kind="payment", ref_id=pay.id, display_id=pay.display_id,
                description=f"Payment · {pay.method}",
                purchase_amount=0, payment_amount=pay.amount, running_balance=running,
                qty_118=Decimal("0"), qty_454=Decimal("0"),
            ))
        else:
            # One row for the whole Unified Sale batch — never split by line item.
            b: models.UnifiedSaleBatch = e["obj"]
            running += b.total_purchase_amount - b.net_plant_payment
            total_purchases += b.total_purchase_amount
            total_payments += b.net_plant_payment
            q118, q454, kg = _batch_cylinder_totals(db, models.Purchase, b.id, products)
            total_118 += q118
            total_454 += q454
            total_kg += kg
            rows.append(schemas.CompanyLedgerRow(
                date=b.approved_at or b.date, kind="unified_sale", ref_id=b.id, display_id=b.display_id,
                description="Unified Sale — purchase & settlement",
                purchase_amount=b.total_purchase_amount, payment_amount=b.net_plant_payment,
                running_balance=running, qty_118=q118, qty_454=q454,
            ))

    return schemas.CompanyLedgerSummary(
        company=company, month=month, opening_balance=opening,
        total_purchases=total_purchases, total_payments=total_payments,
        total_118=total_118, total_454=total_454, total_kg=total_kg,
        total_ton=(total_kg / Decimal("1000")) if total_kg else Decimal("0"),
        total_transactions=len(rows), closing_balance=running, rows=rows,
    )


@router.get("/companies", response_model=list[schemas.PlantLedgerSummaryRow])
def plant_ledger_summary(
    month: str = Query(..., description="YYYY-MM, e.g. 2026-06"),
    db: Session = Depends(get_db),
):
    """The all-plants monthly summary table — one row per plant, same
    columns as the Excel sheet and the Purchase page sketch."""
    companies = db.query(models.Company).order_by(models.Company.name).all()
    month_start = datetime.strptime(month, "%Y-%m")
    year = month_start.year
    mo = month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)
    products = {p.id: p for p in db.query(models.Product).all()}

    out: list[schemas.PlantLedgerSummaryRow] = []
    for company in companies:
        all_purchases = (
            db.query(models.Purchase)
            .filter(models.Purchase.company_id == company.id, models.Purchase.status == "active")
            .all()
        )
        all_payments = (
            db.query(models.CompanyPayment)
            .filter(models.CompanyPayment.company_id == company.id, models.CompanyPayment.status == "active")
            .all()
        )

        opening = company.opening_balance
        for p in all_purchases:
            if p.date < month_start:
                opening += p.total_amount
        for pay in all_payments:
            if pay.date < month_start:
                opening -= pay.amount

        month_purchases = [p for p in all_purchases if month_start <= p.date < next_month]
        month_payments_ = [p for p in all_payments if month_start <= p.date < next_month]

        total_purchases = sum((p.total_amount for p in month_purchases), start=0)
        total_payments = sum((p.amount for p in month_payments_), start=0)
        total_118 = sum(
            (p.quantity for p in month_purchases if products.get(p.product_id) and float(products[p.product_id].weight_kg) == 11.8),
            start=0,
        )
        total_454 = sum(
            (p.quantity for p in month_purchases if products.get(p.product_id) and float(products[p.product_id].weight_kg) == 45.4),
            start=0,
        )
        total_kg = sum((p.total_kg for p in month_purchases), start=0)
        closing = opening + total_purchases - total_payments

        out.append(schemas.PlantLedgerSummaryRow(
            company=company, opening_balance=opening, total_118=total_118, total_454=total_454,
            total_kg=total_kg, total_purchases=total_purchases, total_payments=total_payments,
            closing_balance=closing,
        ))
    return out