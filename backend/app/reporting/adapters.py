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
from app.routers.ledger import _batch_cylinder_totals


def _in_range(q, date_col, start: datetime, end: datetime):
    return q.filter(date_col >= start, date_col < end)


def _fetch_sales(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Sale.unified_sale_id is a real foreign key, not a marker for a
    separate transaction type — a Sale created via Unified Sale is still
    just a Sale, with its own real (already partial-payment-correct)
    total_amount, and belongs here like any other. Previously excluded
    (unified_sale_id.is_(None)) only to make room for a separate, now
    retired, netted "Unified Sale" section — that's exactly where the
    total-vs-collected bug (§5) came from. No filter here means no
    double counting: nothing else in this module reports a Sale row.

    Collected/Outstanding note (same style as Shop Sales' description):
    a Unified Sale's total_credit_received/total_selling_amount are
    BATCH-level figures — one batch can have several line-item Sale rows
    (see approve_unified_sale_sale's Customer Balance Adjustment) — so
    this shows the batch's own collected/outstanding on every one of that
    batch's Sale rows, not a fabricated per-line split. The customer's
    actual collection itself is reported once, in customer_payments (a
    real Payment row, tagged unified_sale_id, created by
    approve_unified_sale_sale) — never re-summed here."""
    rows = _in_range(
        db.query(models.Sale).filter(models.Sale.status == "active"),
        models.Sale.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    plants = {c.id: c for c in db.query(models.Company).all()}
    batch_ids = {s.unified_sale_id for s in rows if s.unified_sale_id}
    batches = (
        {b.id: b for b in db.query(models.UnifiedSaleBatch).filter(models.UnifiedSaleBatch.id.in_(batch_ids)).all()}
        if batch_ids else {}
    )
    out = []
    for s in rows:
        customer = customers.get(s.customer_id)
        plant = plants.get(s.company_id) if s.company_id else None
        value_note = ""
        if s.unified_sale_id:
            batch = batches.get(s.unified_sale_id)
            if batch:
                outstanding = batch.total_selling_amount - batch.total_credit_received
                value_note = (
                    f" — Batch {batch.display_id}: Sale Value Rs {batch.total_selling_amount}, "
                    f"Collected Rs {batch.total_credit_received}, Outstanding Rs {outstanding}"
                    if outstanding != 0 else ""
                )
            value_note += " (via Unified Sale)"
        out.append(ReportableTransaction(
            id=s.id, type="sale", date=s.date, display_id=s.display_id,
            description=f"Sale × {s.quantity}{value_note}",
            amount=s.total_amount,
            customer=customer.name if customer else None, plant=plant.name if plant else None,
            reference=s.gate_pass_no or s.vehicle_no, entered_by=s.entered_by, status=s.status,
        ))
    return out


def _fetch_purchases(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Purchase.unified_sale_id is a real foreign key, same reasoning as
    _fetch_sales above — a Purchase created via Unified Sale is still just
    a Purchase, with its own real total_amount, and belongs here like any
    other. Previously excluded (unified_sale_id.is_(None)) for the same
    now-retired "separate Unified Sale section" reason."""
    rows = _in_range(
        db.query(models.Purchase).filter(models.Purchase.status == "active"),
        models.Purchase.date, start, end,
    ).all()
    plants = {c.id: c for c in db.query(models.Company).all()}
    out = []
    for p in rows:
        plant = plants.get(p.company_id)
        out.append(ReportableTransaction(
            id=p.id, type="purchase", date=p.date, display_id=p.display_id,
            description=f"Purchase × {p.quantity}" + (" (via Unified Sale)" if p.unified_sale_id else ""),
            amount=p.total_amount,
            plant=plant.name if plant else None, reference=p.gate_pass_no or p.vehicle_no,
            entered_by=p.entered_by, status=p.status,
        ))
    return out


def _fetch_customer_payments(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Payment.unified_sale_id is a real foreign key — a Payment created via
    Unified Sale's total_credit_received is still just a Payment, with its
    own real amount, and belongs here like any other. See _fetch_sales'
    docstring for why the old unified_sale_id.is_(None) exclusion (and the
    separate netted section it made room for) is retired."""
    rows = _in_range(
        db.query(models.Payment).filter(models.Payment.status == "active"),
        models.Payment.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for p in rows:
        customer = customers.get(p.customer_id)
        out.append(ReportableTransaction(
            id=p.id, type="customer_payment", date=p.date, display_id=p.display_id,
            description=f"Payment · {p.method}" + (" (via Unified Sale)" if p.unified_sale_id else ""),
            amount=p.amount,
            customer=customer.name if customer else None, reference=p.reference_no,
            entered_by=p.entered_by, status=p.status,
        ))
    return out


def _fetch_plant_payments(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """CompanyPayment.unified_sale_id is a real foreign key — the plant
    settlement (net_plant_payment) posted at Unified Sale payment approval
    is still just a CompanyPayment, with its own real amount, and belongs
    here like any other. See _fetch_sales' docstring for why the old
    unified_sale_id.is_(None) exclusion (and the separate netted section
    it made room for) is retired. An account-routed Unified Sale
    settlement (destination_type == 'account') still has no corresponding
    row anywhere — it never created a CompanyPayment to begin with (see
    routers/unified_sale._create_pending_children), a pre-existing gap in
    that data model, not something introduced or fixed here."""
    rows = _in_range(
        db.query(models.CompanyPayment).filter(models.CompanyPayment.status == "active"),
        models.CompanyPayment.date, start, end,
    ).all()
    plants = {c.id: c for c in db.query(models.Company).all()}
    out = []
    for p in rows:
        plant = plants.get(p.company_id)
        out.append(ReportableTransaction(
            id=p.id, type="plant_payment", date=p.date, display_id=p.display_id,
            description=f"Plant Payment · {p.method}" + (" (via Unified Sale)" if p.unified_sale_id else ""),
            amount=p.amount,
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
    # shop_id.is_(None) — a row with shop_id set was dual-written by
    # routers/shops.py's create_shop_expense (§ Dashboard P&L / Shop
    # Expense integration) and is ALREADY counted by _fetch_shop_expenses
    # below (which reads ShopExpenseLine directly, unchanged); without this
    # filter the Daily Report's net_cash_movement would double-count it.
    rows = _in_range(
        db.query(models.Expense).filter(models.Expense.status == "active", models.Expense.shop_id.is_(None)),
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
    # shop_id.is_(None) — mirrors _fetch_expenses above; a shop-tagged row
    # is already counted by _fetch_shop_owner_withdrawals below.
    rows = _in_range(
        db.query(models.OwnerDrawings).filter(models.OwnerDrawings.status == "active", models.OwnerDrawings.shop_id.is_(None)),
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


def _fetch_shop_sales(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Shop retail sales (§ Shop Management) — priced from the Board Rate
    on the sale date, immutable snapshot on the row itself, never
    recomputed here. Loads to a shop are just Sales and already appear in
    the 'sales' section above; this section is the shop's own retail
    activity, a distinct real-world event.

    `amount` here is what was ACTUALLY COLLECTED on this sale
    (amount_received), not the full sale value (total_amount) — a credit
    sale to a Supply Customer is often only partially (or not at all)
    collected on the spot (Inline Settlement, §2), and this section's
    financial_total feeds get_daily_report_data's net_cash_movement, which
    must reflect real cash in, exactly like customer_payments/
    plant_payments already do for the main ledger (never the accrued sale
    value — see _fetch_sales, deliberately excluded from net_cash_movement
    for the same reason). The remainder later collected via a separate
    ShopCustomerPayment is counted once, in ITS OWN section
    (_fetch_shop_customer_payments) — never here, so nothing is double
    counted. The full sale value is never silently dropped: it's still
    shown in the row's own description, along with the same
    received/outstanding split the Shop page's own Transaction History
    already shows for this exact row (routers/shops.py's
    ShopTransactionRow builder)."""
    rows = _in_range(
        db.query(models.ShopSale).filter(models.ShopSale.status == "active"),
        models.ShopSale.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for s in rows:
        shop = customers.get(s.customer_id)
        received = s.amount_received if s.amount_received is not None else s.total_amount
        outstanding = s.total_amount - received
        value_note = (
            f" — Sale Value Rs {s.total_amount}, Collected Rs {received}, Outstanding Rs {outstanding}"
            if outstanding != 0 else ""
        )
        out.append(ReportableTransaction(
            id=s.id, type="shop_sale", date=s.date, display_id=s.display_id,
            description=f"Shop Sale × {s.quantity}{value_note}", amount=received,
            customer=shop.name if shop else None, entered_by=s.entered_by, status=s.status,
        ))
    return out


def _fetch_shop_customer_payments(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Collections from a shop's own Supply Customers (§25) settling a
    credit ShopSale's outstanding balance — models.ShopCustomerPayment, the
    shop-scoped mirror of models.Payment (already covered by
    _fetch_customer_payments, a different model, not this one). Real cash
    into the shop's own account, so this section IS counted in
    net_cash_movement (get_daily_report_data)."""
    rows = _in_range(
        db.query(models.ShopCustomerPayment).filter(models.ShopCustomerPayment.status == "active"),
        models.ShopCustomerPayment.date, start, end,
    ).all()
    shops = {c.id: c for c in db.query(models.Customer).all()}
    supply_customers = {c.id: c for c in db.query(models.ShopSupplyCustomer).all()}
    out = []
    for p in rows:
        shop = shops.get(p.shop_id)
        sc = supply_customers.get(p.supply_customer_id)
        out.append(ReportableTransaction(
            id=p.id, type="shop_customer_payment", date=p.date, display_id=p.display_id,
            description=f"Payment from {sc.name if sc else 'Unknown'} · {p.method}" + (f" ({shop.name})" if shop else ""),
            amount=p.amount, customer=sc.name if sc else None, entered_by=p.entered_by, status=p.status,
        ))
    return out


def _fetch_shop_expenses(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """The genuine BUSINESS-expense lines of a Shop Expenses transaction
    (SHEXP-prefixed, §20-23, models.ShopExpenseTransaction /
    models.ShopExpenseLine) — NOT models.Expense, the older, separate
    plant-level expense system already covered by _fetch_expenses above.
    One row per LINE, not per transaction: a single atomic cash-out can mix
    genuine expense lines with Owner Withdrawal lines (§22-23), and only
    the expense lines belong here — the withdrawal lines are reported by
    _fetch_shop_owner_withdrawals below instead, mirroring exactly how
    routers/shops.py's own _expense_split already classifies line_type
    (never the transaction as a whole) for the shop's own cash summary."""
    txns = _in_range(
        db.query(models.ShopExpenseTransaction).filter(models.ShopExpenseTransaction.status == "active"),
        models.ShopExpenseTransaction.date, start, end,
    ).all()
    if not txns:
        return []
    shops = {c.id: c for c in db.query(models.Customer).all()}
    categories = {c.id: c for c in db.query(models.ExpenseCategory).all()}
    lines = db.query(models.ShopExpenseLine).filter(
        models.ShopExpenseLine.expense_transaction_id.in_([t.id for t in txns])
    ).all()
    txn_by_id = {t.id: t for t in txns}
    out = []
    for l in lines:
        if l.line_type != "expense":
            continue
        t = txn_by_id[l.expense_transaction_id]
        shop = shops.get(t.shop_id)
        category = categories.get(l.category_id)
        out.append(ReportableTransaction(
            id=l.id, type="shop_expense", date=t.date, display_id=t.display_id,
            description=(
                (category.name if category else "Expense")
                + (f" — {l.description}" if l.description else "")
                + (f" ({shop.name})" if shop else "")
            ),
            amount=l.amount, customer=shop.name if shop else None, entered_by=t.entered_by, status=t.status,
        ))
    return out


def _fetch_shop_owner_withdrawals(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """The Owner Withdrawal lines of a Shop Expenses transaction
    (SHEXP-prefixed, §20-23) — personal/home draws that are never a
    business expense even when entered in the same atomic transaction as
    genuine ones (§22-23). NOT models.OwnerDrawings, the older, separate
    system already covered by _fetch_owner_drawings above. See
    _fetch_shop_expenses' docstring for why this is split out by LINE
    rather than reported as part of that section."""
    txns = _in_range(
        db.query(models.ShopExpenseTransaction).filter(models.ShopExpenseTransaction.status == "active"),
        models.ShopExpenseTransaction.date, start, end,
    ).all()
    if not txns:
        return []
    shops = {c.id: c for c in db.query(models.Customer).all()}
    lines = db.query(models.ShopExpenseLine).filter(
        models.ShopExpenseLine.expense_transaction_id.in_([t.id for t in txns])
    ).all()
    txn_by_id = {t.id: t for t in txns}
    out = []
    for l in lines:
        if l.line_type != "owner_withdrawal":
            continue
        t = txn_by_id[l.expense_transaction_id]
        shop = shops.get(t.shop_id)
        out.append(ReportableTransaction(
            id=l.id, type="shop_owner_withdrawal", date=t.date, display_id=t.display_id,
            description="Owner Withdrawal" + (f" — {l.description}" if l.description else "") + (f" ({shop.name})" if shop else ""),
            amount=l.amount, customer=shop.name if shop else None, entered_by=t.entered_by, status=t.status,
        ))
    return out


def _fetch_account_transfers(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Internal money moves between two of the business's own
    PaymentAccount rows (models.AccountTransfer — e.g. a shop's Shop Cash
    -> Office Cash). Always internal to the business (both ends are a
    tracked PaymentAccount, never an outside party — see
    routers/payment_accounts.transfer_between_accounts), so summing every
    transfer's amount as a single in/out total is always exactly 0 in
    aggregate (every amount is simultaneously a debit on one account and a
    credit on another within the SAME total) — never a real source or use
    of company cash. Kept visibility-only (has_financial_total=False,
    matching cylinder_activity's own convention above) and deliberately
    left OUT of net_cash_movement for that reason (see
    get_daily_report_data) rather than added as an always-zero term.
    AccountTransfer has no status column (§ its own docstring: "never
    corrected, only ever a straight record of what moved and when") and no
    display_id, unlike every other model here."""
    rows = _in_range(db.query(models.AccountTransfer), models.AccountTransfer.date, start, end).all()
    accounts = {a.id: a for a in db.query(models.PaymentAccount).all()}
    out = []
    for t in rows:
        from_acc = accounts.get(t.from_account_id)
        to_acc = accounts.get(t.to_account_id)
        out.append(ReportableTransaction(
            id=t.id, type="account_transfer", date=t.date, display_id=f"XFER-{str(t.id)[:8]}",
            description=(
                f"Transfer: {from_acc.name if from_acc else 'Unknown'} → {to_acc.name if to_acc else 'Unknown'}"
                + (f" — {t.notes}" if t.notes else "")
            ),
            amount=t.amount, entered_by=t.entered_by, status="active",
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
register("shop_sales", "Shop Sales", _fetch_shop_sales)
register("shop_customer_payments", "Shop Customer Payments", _fetch_shop_customer_payments)
register("shop_expenses", "Shop Expenses", _fetch_shop_expenses)
register("shop_owner_withdrawals", "Shop Owner Withdrawals", _fetch_shop_owner_withdrawals)
register("account_transfers", "Account Transfers", _fetch_account_transfers, has_financial_total=False)
