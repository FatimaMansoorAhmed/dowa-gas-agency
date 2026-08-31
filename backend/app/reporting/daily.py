"""Daily report aggregator (§5, §8) — the ONE function both the Daily PDF
and the Daily Activity screen call, so they can never drift apart. Walks
every registered adapter (app.reporting.registry.ADAPTERS) over one Asia/
Karachi business day and sums each section's financial total the same way
the section's own model already computes it — no new formula is invented
here, only straight sums of existing fields.
"""
from decimal import Decimal
from sqlalchemy.orm import Session

# Imported for its registration side effects — every adapter in this module
# calls register(...) at import time.
from app.reporting import adapters  # noqa: F401
from app.reporting.registry import ADAPTERS
from app.timezone import karachi_day_bounds
from app import models, schemas


def _to_row_out(t) -> "schemas.ReportableTransactionOut":
    return schemas.ReportableTransactionOut(
        id=t.id, type=t.type, date=t.date, display_id=t.display_id, description=t.description,
        amount=t.amount, customer=t.customer, plant=t.plant, reference=t.reference,
        entered_by=t.entered_by, approval_info=t.approval_info, status=t.status,
    )


def get_daily_report_data(db: Session, business_date: str) -> "schemas.DailyReportDataOut":
    start, end = karachi_day_bounds(business_date)

    sections: list[schemas.ReportSectionOut] = []
    by_key: dict[str, list] = {}
    for adapter in ADAPTERS.values():
        rows = adapter.fetch(db, start, end)
        by_key[adapter.key] = rows
        total = sum((r.amount for r in rows if r.amount is not None), start=Decimal("0")) if adapter.has_financial_total else None
        sections.append(schemas.ReportSectionOut(
            key=adapter.key, label=adapter.label,
            rows=[_to_row_out(r) for r in rows],
            financial_total=total,
        ))

    def _sum(key: str) -> Decimal:
        return sum((r.amount for r in by_key.get(key, []) if r.amount is not None), start=Decimal("0"))

    total_sales = _sum("sales")
    total_purchases = _sum("purchases")
    total_customer_payments = _sum("customer_payments")
    total_plant_payments = _sum("plant_payments")
    total_investments = _sum("investments")
    total_expenses = _sum("expenses")
    total_owner_drawings = _sum("owner_drawings")

    # Physical cylinder movement for the day — unlike the Cylinder Activity
    # SECTION above (which deliberately excludes sale-linked rows so a
    # delivery isn't listed twice, once under Sales and once here), this
    # SUMMARY total is a single number, not a transaction list, so it
    # includes every CylinderTransaction (sale-linked + standalone) plus
    # empty-cylinder sales, exactly mirroring routers/ledger.py's own
    # cyl_out/cyl_in treatment (EmptyCylinderSale counts as cyl_in there too).
    cylinder_txns = (
        db.query(models.CylinderTransaction)
        .filter(models.CylinderTransaction.status == "active",
                models.CylinderTransaction.date >= start, models.CylinderTransaction.date < end)
        .all()
    )
    total_cylinders_out = sum((t.qty_out for t in cylinder_txns), start=Decimal("0"))
    total_cylinders_in = sum((t.qty_in for t in cylinder_txns), start=Decimal("0"))
    empty_sales_qty = sum(
        (e.quantity for e in db.query(models.EmptyCylinderSale).filter(
            models.EmptyCylinderSale.status == "active",
            models.EmptyCylinderSale.date >= start, models.EmptyCylinderSale.date < end,
        ).all()),
        start=Decimal("0"),
    )
    total_cylinders_in += empty_sales_qty

    summary = schemas.DailySummaryOut(
        total_sales=total_sales,
        total_purchases=total_purchases,
        total_customer_payments=total_customer_payments,
        total_plant_payments=total_plant_payments,
        total_investments=total_investments,
        total_expenses=total_expenses,
        total_owner_drawings=total_owner_drawings,
        net_cash_movement=(
            total_customer_payments - total_plant_payments - total_expenses - total_owner_drawings + total_investments
        ),
        total_cylinders_out=total_cylinders_out,
        total_cylinders_in=total_cylinders_in,
    )

    return schemas.DailyReportDataOut(business_date=business_date, sections=sections, summary=summary)
