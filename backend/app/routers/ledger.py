from datetime import datetime
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
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


def _settles_here(b: models.UnifiedSaleBatch, company_id) -> bool:
    """True only when this batch's settlement money actually lands on
    company_id's payable — i.e. destination_type == 'plant' and the target
    (defaulting to the purchase plant) is this company."""
    return b.destination_type == "plant" and (b.target_plant_id is None or b.target_plant_id == company_id)


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
    # Only sale-approved batches ever posted to customer.current_balance
    # (see unified_sale.approve_unified_sale_sale — total_selling_amount and
    # total_credit_received both post there; the plant payment/settlement
    # side never touches the customer's balance) — pending/cancelled
    # batches must not appear in the ledger either.
    all_batches = (
        db.query(models.UnifiedSaleBatch)
        .filter(models.UnifiedSaleBatch.customer_id == customer_id, models.UnifiedSaleBatch.sale_status == "approved")
        .order_by(models.UnifiedSaleBatch.date)
        .all()
    )
    all_empty_cylinder_sales = (
        db.query(models.EmptyCylinderSale)
        .filter(models.EmptyCylinderSale.customer_id == customer_id, models.EmptyCylinderSale.status == "active")
        .order_by(models.EmptyCylinderSale.date)
        .all()
    )
    # Standalone cylinder movements only (sale_id.is_(None)) — a Sale's own
    # linked CylinderTransaction is already reflected via the "sale" row's
    # cyl_out above, so including it again here would double-count it.
    all_cylinder_txns = (
        db.query(models.CylinderTransaction)
        .filter(
            models.CylinderTransaction.customer_id == customer_id,
            models.CylinderTransaction.status == "active",
            models.CylinderTransaction.sale_id.is_(None),
        )
        .order_by(models.CylinderTransaction.date)
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
    for ecs in all_empty_cylinder_sales:
        if ecs.date < month_start:
            opening += ecs.amount

    month_sales = [s for s in all_sales if month_start <= s.date < next_month]
    month_payments = [p for p in all_payments if month_start <= p.date < next_month]
    month_batches = [b for b in all_batches if month_start <= b.date < next_month]
    month_empty_cylinder_sales = [e for e in all_empty_cylinder_sales if month_start <= e.date < next_month]
    month_cylinder_txns = [t for t in all_cylinder_txns if month_start <= t.date < next_month]

    events = (
        [{"date": s.date, "kind": "sale", "obj": s} for s in month_sales]
        + [{"date": p.date, "kind": "payment", "obj": p} for p in month_payments]
        + [{"date": b.date, "kind": "unified_sale", "obj": b} for b in month_batches]
        + [{"date": e.date, "kind": "empty_cylinder_sale", "obj": e} for e in month_empty_cylinder_sales]
        + [{"date": t.date, "kind": "cylinder_transaction", "obj": t} for t in month_cylinder_txns]
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
                qty_118=q118, qty_454=q454, cyl_out=s.quantity,
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
        elif e["kind"] == "unified_sale":
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
                date=b.sale_approved_at or b.date, kind="unified_sale", ref_id=b.id, display_id=b.display_id,
                description="Unified Sale — sale & settlement",
                sale_amount=b.total_selling_amount, payment_amount=b.total_credit_received,
                running_balance=running, qty_118=q118, qty_454=q454, cyl_out=q118 + q454,
            ))
        elif e["kind"] == "empty_cylinder_sale":
            ecs: models.EmptyCylinderSale = e["obj"]
            running += ecs.amount
            total_sales += ecs.amount
            size_label = "45.4" if ecs.cylinder_size == "454" else "11.8"
            type_label = f" {ecs.cylinder_type.upper()}" if ecs.cylinder_type else ""
            rows.append(schemas.LedgerRow(
                date=ecs.date, kind="empty_cylinder_sale", ref_id=ecs.id, display_id=ecs.display_id,
                description=f"Empty Cylinders Sold ({size_label} KG{type_label}) × {ecs.quantity}",
                sale_amount=ecs.amount, payment_amount=0, running_balance=running,
                qty_empty=ecs.quantity, cyl_in=ecs.quantity,
            ))
        else:
            # Standalone cylinder movement (e.g. "Cyl Return/Entry") — no
            # cash amount, so `running` is untouched; shown purely for its
            # Cyl Out / Cyl In columns.
            t: models.CylinderTransaction = e["obj"]
            product = products.get(t.product_id)
            rows.append(schemas.LedgerRow(
                date=t.date, kind="cylinder_transaction", ref_id=t.id, display_id=t.display_id,
                description=f"Cylinder {t.transaction_type} — {product.name if product else 'Cylinder'}",
                sale_amount=0, payment_amount=0, running_balance=running,
                cyl_out=t.qty_out, cyl_in=t.qty_in,
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
        flagged=running > opening,
        # Rows are built oldest-first above (required for the running-balance
        # accumulation); reverse only for display — Global Sorting Standard
        # is latest-first (§ Global Sorting Standard).
        rows=list(reversed(rows)),
    )


def _bulk_month_opening_closing(
    db: Session, month_start: datetime, next_month: datetime
) -> dict:
    """Same opening/closing accounting as customer_monthly_ledger above,
    computed for every customer at once via batched queries (no N+1) —
    powers the Dashboard's Flagged Accounts widget and the ledger
    sidebar's flags. Opening balance rolls over automatically: it's
    always (year opening) + (everything before month_start), which by
    construction equals the prior month's closing balance."""
    sales_by_customer: dict = {}
    for s in db.query(models.Sale).filter(models.Sale.status == "active", models.Sale.unified_sale_id.is_(None)).all():
        sales_by_customer.setdefault(s.customer_id, []).append(s)
    payments_by_customer: dict = {}
    for p in db.query(models.Payment).filter(models.Payment.status == "active", models.Payment.unified_sale_id.is_(None)).all():
        payments_by_customer.setdefault(p.customer_id, []).append(p)
    batches_by_customer: dict = {}
    for b in db.query(models.UnifiedSaleBatch).filter(models.UnifiedSaleBatch.sale_status == "approved").all():
        batches_by_customer.setdefault(b.customer_id, []).append(b)
    ecs_by_customer: dict = {}
    for e in db.query(models.EmptyCylinderSale).filter(models.EmptyCylinderSale.status == "active").all():
        ecs_by_customer.setdefault(e.customer_id, []).append(e)

    result: dict = {}
    for customer in db.query(models.Customer).all():
        opening = customer.opening_balance
        for s in sales_by_customer.get(customer.id, []):
            if s.date < month_start:
                opening += s.total_amount
        for p in payments_by_customer.get(customer.id, []):
            if p.date < month_start:
                opening -= p.amount
        for b in batches_by_customer.get(customer.id, []):
            if b.date < month_start:
                opening += b.total_selling_amount - b.total_credit_received
        for e in ecs_by_customer.get(customer.id, []):
            if e.date < month_start:
                opening += e.amount

        closing = opening
        for s in sales_by_customer.get(customer.id, []):
            if month_start <= s.date < next_month:
                closing += s.total_amount
        for p in payments_by_customer.get(customer.id, []):
            if month_start <= p.date < next_month:
                closing -= p.amount
        for b in batches_by_customer.get(customer.id, []):
            if month_start <= b.date < next_month:
                closing += b.total_selling_amount - b.total_credit_received
        for e in ecs_by_customer.get(customer.id, []):
            if month_start <= e.date < next_month:
                closing += e.amount

        result[customer.id] = (opening, closing)
    return result


@router.get("/customers/flags", response_model=list[schemas.CustomerFlagOut])
def customer_flags(
    month: str = Query(..., description="YYYY-MM, e.g. 2026-08"),
    db: Session = Depends(get_db),
):
    """Flag Rule (§ Monthly Rollover & Flag Rule): a customer is Flagged
    when this month's Closing Balance exceeds this month's Opening Balance
    (itself rolled over from the prior month's closing) — Closing <=
    Opening stays Normal. Powers the Dashboard's Flagged Accounts widget."""
    month_start = datetime.strptime(month, "%Y-%m")
    year = month_start.year
    mo = month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)

    customers = db.query(models.Customer).order_by(models.Customer.name).all()
    balances = _bulk_month_opening_closing(db, month_start, next_month)

    out: list[schemas.CustomerFlagOut] = []
    for customer in customers:
        opening, closing = balances.get(customer.id, (customer.opening_balance, customer.opening_balance))
        out.append(schemas.CustomerFlagOut(
            customer=customer, month=month,
            opening_balance=opening, closing_balance=closing,
            flagged=closing > opening,
        ))
    return out


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
    # A batch posts to company.current_balance in two independent pieces
    # (see unified_sale.approve_unified_sale_sale /
    # approve_unified_sale_payment): the purchase amount posts on
    # sale_status=='approved', the settlement (this plant being the
    # destination) posts on payment_status=='approved'. Either can be true
    # without the other, so batches are pulled in whenever at least one
    # side has posted — _purchase_amt/_settle_amt below zero out whichever
    # side hasn't posted yet.
    all_batches = (
        db.query(models.UnifiedSaleBatch)
        .filter(
            models.UnifiedSaleBatch.company_id == company_id,
            or_(models.UnifiedSaleBatch.sale_status == "approved", models.UnifiedSaleBatch.payment_status == "approved"),
        )
        .order_by(models.UnifiedSaleBatch.date)
        .all()
    )

    def _purchase_amt(b) -> Decimal:
        return b.total_purchase_amount if b.sale_status == "approved" else Decimal("0")

    def _settle_amt(b, cid) -> Decimal:
        return b.net_plant_payment if (_settles_here(b, cid) and b.payment_status == "approved") else Decimal("0")

    # Batches purchased from a DIFFERENT plant but settled to this one — these
    # never show up in the query above (it filters on company_id, the purchase
    # plant). They post only a payment here, never a purchase amount, since the
    # purchase amount was already posted to the original plant's payable.
    incoming_settlements = (
        db.query(models.UnifiedSaleBatch)
        .filter(
            models.UnifiedSaleBatch.target_plant_id == company_id,
            models.UnifiedSaleBatch.company_id != company_id,
            models.UnifiedSaleBatch.destination_type == "plant",
            models.UnifiedSaleBatch.payment_status == "approved",
        )
        .order_by(models.UnifiedSaleBatch.date)
        .all()
    )

    products = {p.id: p for p in db.query(models.Product).all()}
    all_companies = {c.id: c for c in db.query(models.Company).all()}

    # A batch's net effect mirrors the two approval endpoints exactly:
    # + purchase amount (sale-side) - net plant payment (payment-side).
    opening = company.opening_balance
    for p in all_purchases:
        if p.date < month_start:
            opening += p.total_amount
    for pay in all_payments:
        if pay.date < month_start:
            opening -= pay.amount
    for b in all_batches:
        if b.date < month_start:
            opening += _purchase_amt(b) - _settle_amt(b, company_id)
    for b in incoming_settlements:
        if b.date < month_start:
            opening -= b.net_plant_payment

    month_purchases = [p for p in all_purchases if month_start <= p.date < next_month]
    month_payments = [p for p in all_payments if month_start <= p.date < next_month]
    month_batches = [b for b in all_batches if month_start <= b.date < next_month]
    month_incoming = [b for b in incoming_settlements if month_start <= b.date < next_month]

    events = (
        [{"date": p.date, "kind": "purchase", "obj": p} for p in month_purchases]
        + [{"date": p.date, "kind": "payment", "obj": p} for p in month_payments]
        + [{"date": b.date, "kind": "unified_sale", "obj": b} for b in month_batches]
        + [{"date": b.payment_approved_at or b.date, "kind": "unified_sale_incoming", "obj": b} for b in month_incoming]
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
                qty_118=q118, qty_454=q454, vehicle_no=pu.vehicle_no,
            ))
        elif e["kind"] == "payment":
            pay: models.CompanyPayment = e["obj"]
            running -= pay.amount
            total_payments += pay.amount
            # Plant Settlement Ledger source label (§ Re-Investment / Owner
            # Capital) — a CompanyPayment auto-created by a Direct Plant
            # Payment re-investment always carries method="owner_capital".
            description = (
                "Owner Capital (Direct)" if pay.method == "owner_capital" else f"Payment · {pay.method}"
            )
            rows.append(schemas.CompanyLedgerRow(
                date=pay.date, kind="payment", ref_id=pay.id, display_id=pay.display_id,
                description=description,
                purchase_amount=0, payment_amount=pay.amount, running_balance=running,
                qty_118=Decimal("0"), qty_454=Decimal("0"),
            ))
        elif e["kind"] == "unified_sale":
            # One row for the whole Unified Sale batch — never split by line
            # item. purchase_amt/settle are independently gated (see
            # _purchase_amt/_settle_amt above) — a batch whose sale is
            # approved but payment is still pending shows the purchase
            # amount only, and vice versa.
            b: models.UnifiedSaleBatch = e["obj"]
            purchase_amt = _purchase_amt(b)
            settle = _settle_amt(b, company_id)
            if purchase_amt == 0 and settle == 0:
                continue  # nothing from this batch has posted yet
            running += purchase_amt - settle
            total_purchases += purchase_amt
            total_payments += settle
            if purchase_amt:
                q118, q454, kg = _batch_cylinder_totals(db, models.Purchase, b.id, products)
            else:
                q118, q454, kg = Decimal("0"), Decimal("0"), Decimal("0")
            total_118 += q118
            total_454 += q454
            total_kg += kg
            target_plant = all_companies.get(b.target_plant_id)
            target_name = target_plant.name if target_plant else b.target_plant_id
            if purchase_amt and settle:
                description = "Unified Sale — purchase & settlement"
            elif purchase_amt:
                # Settlement not reflected here either because it hasn't
                # been approved yet, or because it's routed to a different plant.
                description = "Unified Sale — purchase" + (
                    f" (settled elsewhere: {target_name})" if not _settles_here(b, company_id) else " (settlement pending)"
                )
            else:
                description = "Unified Sale — settlement (purchase pending)"
            rows.append(schemas.CompanyLedgerRow(
                date=b.payment_approved_at or b.sale_approved_at or b.date, kind="unified_sale", ref_id=b.id, display_id=b.display_id,
                description=description,
                purchase_amount=purchase_amt, payment_amount=settle,
                running_balance=running, qty_118=q118, qty_454=q454, vehicle_no=b.vehicle_no,
            ))
        else:
            # Purchased from a different plant, settled to this one — payment only.
            b: models.UnifiedSaleBatch = e["obj"]
            running -= b.net_plant_payment
            total_payments += b.net_plant_payment
            source_plant = all_companies.get(b.company_id)
            source_name = source_plant.name if source_plant else "Unknown Plant"
            rows.append(schemas.CompanyLedgerRow(
                date=b.payment_approved_at or b.date, kind="unified_sale", ref_id=b.id, display_id=b.display_id,
                description=f"Unified Sale settlement received (purchased from {source_name})",
                purchase_amount=Decimal("0"), payment_amount=b.net_plant_payment,
                running_balance=running, qty_118=Decimal("0"), qty_454=Decimal("0"),
            ))

    return schemas.CompanyLedgerSummary(
        company=company, month=month, opening_balance=opening,
        total_purchases=total_purchases, total_payments=total_payments,
        total_118=total_118, total_454=total_454, total_kg=total_kg,
        total_ton=(total_kg / Decimal("1000")) if total_kg else Decimal("0"),
        total_transactions=len(rows), closing_balance=running,
        # Rows are built oldest-first above (required for the running-balance
        # accumulation); reverse only for display (§ Global Sorting Standard).
        rows=list(reversed(rows)),
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

        # Vehicle from the most recent purchase this plant received this
        # month — never a second, independently-entered value (§13
        # Purchases — Plant Summary Vehicle).
        vehicle_no = None
        dated_purchases = [p for p in month_purchases if p.vehicle_no]
        if dated_purchases:
            vehicle_no = max(dated_purchases, key=lambda p: p.date).vehicle_no

        out.append(schemas.PlantLedgerSummaryRow(
            company=company, opening_balance=opening, total_118=total_118, total_454=total_454,
            total_kg=total_kg, total_purchases=total_purchases, total_payments=total_payments,
            closing_balance=closing, vehicle_no=vehicle_no,
        ))
    return out