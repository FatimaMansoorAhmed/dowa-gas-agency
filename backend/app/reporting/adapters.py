"""One adapter per existing transaction type (§8 mapping table). Each just
queries its model over [start, end) and maps rows into ReportableTransaction
— no accounting formula is computed here, every `amount` is a field that
already exists on the model (§5 "use existing ledger/accounting
calculations"). Registered at import time; app.reporting.daily imports this
module once (for its side effects) before reading ADAPTERS.
"""
from datetime import datetime
from decimal import Decimal
from sqlalchemy import func
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
    # Denominator for the per-line GST allocation below — the batch's own
    # child Sale rows' total_amount, NOT batch.total_selling_amount (which
    # is total_amount + delivery_charges, per
    # routers/unified_sale.py's total_selling_amount computation).
    # delivery_charges isn't attributable to any single line, so including
    # it in the denominator understated every line's share and made the
    # allocated amounts undercount batch.grand_total by more than just the
    # delivery charge itself (§ GST allocation fix regression). Queried
    # fresh (not summed from `rows`) so it's correct even if a batch's
    # lines span a date-range boundary.
    batch_line_totals = (
        dict(
            db.query(models.Sale.unified_sale_id, func.sum(models.Sale.total_amount))
            .filter(models.Sale.unified_sale_id.in_(batch_ids), models.Sale.status == "active")
            .group_by(models.Sale.unified_sale_id)
            .all()
        )
        if batch_ids else {}
    )
    out = []
    for s in rows:
        customer = customers.get(s.customer_id)
        plant = plants.get(s.company_id) if s.company_id else None
        value_note = ""
        # GST-inclusive line amount (§ GST on Sale) — for a standalone Sale,
        # grand_total already IS this line's real invoiced value. A
        # Unified-Sale-linked Sale is different: GST lives only on the
        # BATCH (models.UnifiedSaleBatch.gst_amount), never per line — its
        # own grand_total always equals its own total_amount (see
        # routers/unified_sale.py._create_pending_children), so using it
        # here would silently drop that line's share of the batch's GST,
        # and summing every line (this function's amount= feeds
        # get_daily_report_data's section/day totals) would undercount the
        # day's true invoiced value by the whole batch's GST amount. Fixed
        # by allocating this line its proportional share of the batch's
        # GST (by its share of the batch's OWN child Sale rows' total_amount,
        # batch_line_totals above — NOT batch.total_selling_amount, which
        # also folds in delivery_charges and isn't attributable to any one
        # line) — display-only, never written back to the row. This makes
        # every line in the batch sum back to batch.grand_total minus
        # delivery_charges (delivery isn't a product line, so it's excluded
        # from this day-book total the same way Dashboard's revenue figure
        # excludes it — see the Dashboard/P&L note below).
        # Emergency Transfer Out (§ Shop — Emergency Transfer) — same Sale
        # model, same day-book math below; only the label/description
        # changes so it reads as clearly distinct from an ordinary sale —
        # mirrors how the Customer Ledger already flags this
        # (routers/ledger.py:294-299) and the Shop page's Recent
        # Transactions now does too (routers/shops.py::get_shop_detail).
        # Never overlaps with the unified_sale_id branch below — Emergency
        # Transfer is only ever reachable via the direct /sales flow, never
        # Unified Sale (see routers/unified_sale.py, which never sets
        # emergency_transfer_shop_id).
        label = "Sale"
        line_amount = s.grand_total
        if s.unified_sale_id:
            batch = batches.get(s.unified_sale_id)
            if batch:
                batch_total_amount = batch_line_totals.get(s.unified_sale_id)
                if batch.gst_enabled and batch_total_amount:
                    allocated_gst = (s.total_amount / batch_total_amount) * batch.gst_amount
                    line_amount = (s.total_amount + allocated_gst).quantize(Decimal("0.01"))
                # grand_total (incl. GST when present) — matches the
                # customer ledger's GST-inclusive treatment (§ GST on Sale).
                outstanding = batch.grand_total - batch.total_credit_received
                value_note = (
                    f" — Batch {batch.display_id}: Sale Value Rs {batch.grand_total}, "
                    f"Collected Rs {batch.total_credit_received}, Outstanding Rs {outstanding}"
                    if outstanding != 0 else ""
                )
                if batch.gst_enabled:
                    value_note += f" (GST {batch.gst_rate}%: Rs {batch.gst_amount})"
            value_note += " (via Unified Sale)"
        elif s.emergency_transfer_shop_id:
            label = "Emergency Transfer"
            shop = customers.get(s.emergency_transfer_shop_id)
            value_note = f" (from {shop.name if shop else 'shop'})"
            if s.gst_enabled:
                value_note += f" (GST {s.gst_rate}%: Rs {s.gst_amount})"
        elif s.gst_enabled:
            # Standalone (non-Unified-Sale) GST sale (§ GST on Sale) — the
            # day-book's amount is already grand_total-inclusive below;
            # this just surfaces how much of it was tax without opening
            # the invoice.
            value_note += f" (GST {s.gst_rate}%: Rs {s.gst_amount})"
        out.append(ReportableTransaction(
            id=s.id, type="sale", date=s.date, display_id=s.display_id,
            description=f"{label} × {s.quantity}{value_note}",
            # GST-inclusive (see line_amount above) — this is the day-book's
            # real invoiced/collectible value, matching the customer ledger
            # treatment (§ GST on Sale). Dashboard/P&L revenue figures are
            # computed separately, straight off Sale.total_amount, and are
            # unaffected by this.
            amount=line_amount,
            customer=customer.name if customer else None, plant=plant.name if plant else None,
            reference=s.gate_pass_no or s.vehicle_no, entered_by=s.entered_by, status=s.status,
        ))
    return out


def _fetch_delivery_charges(db: Session, start: datetime, end: datetime) -> list[ReportableTransaction]:
    """Delivery Charges are real collected money — folded into a Unified
    Sale batch's own total_selling_amount/grand_total (see
    routers/unified_sale.py) — but _fetch_sales above deliberately excludes
    them from every Sale line's own allocated amount (§ GST allocation
    fix), since delivery isn't attributable to any single product line.
    Surfaced here instead as its own section/total, one row per batch, so
    the money isn't invisible: this section's total is exactly
    batch.grand_total minus what _fetch_sales already counted for that
    batch's lines (see that function's own comment).

    Gated the same way _fetch_sales gates a batch as "reportable for this
    day" — at least one of its own child Sale rows is active and dated in
    range — so a cancelled/still-pending batch's delivery charge never
    shows up here either."""
    sale_rows = _in_range(
        db.query(models.Sale).filter(
            models.Sale.status == "active",
            models.Sale.unified_sale_id.isnot(None),
        ),
        models.Sale.date, start, end,
    ).all()
    if not sale_rows:
        return []
    first_line_date: dict = {}
    for s in sale_rows:
        if s.unified_sale_id not in first_line_date or s.date < first_line_date[s.unified_sale_id]:
            first_line_date[s.unified_sale_id] = s.date
    batches = (
        db.query(models.UnifiedSaleBatch)
        .filter(
            models.UnifiedSaleBatch.id.in_(first_line_date.keys()),
            models.UnifiedSaleBatch.delivery_charges > 0,
        )
        .all()
    )
    customers = {c.id: c for c in db.query(models.Customer).all()}
    out = []
    for b in batches:
        customer = customers.get(b.customer_id)
        out.append(ReportableTransaction(
            id=b.id, type="delivery_charge", date=first_line_date[b.id], display_id=b.display_id,
            description=f"Delivery Charges — Batch {b.display_id} (via Unified Sale)",
            amount=b.delivery_charges,
            customer=customer.name if customer else None, plant=None,
            reference=b.vehicle_no or b.gate_pass_no, entered_by=b.entered_by, status=b.status,
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
    separate netted section it made room for) is retired.

    One real exclusion: a Payment created by a "Sell Cylinder" cash-mode
    CylinderReturn (origin="sell_cylinder") is deliberately left out — that
    money is reported once, under empty_cylinder_sales
    (_fetch_empty_cylinder_sales below), not here too. An ordinary Return
    Cylinder — Cash Mode Payment (origin="return_cylinder") is unaffected
    and still reported here, exactly as before."""
    sell_cylinder_payment_ids = {
        r.payment_id for r in db.query(models.CylinderReturn.payment_id).filter(
            models.CylinderReturn.origin == "sell_cylinder", models.CylinderReturn.payment_id.isnot(None),
        ).all()
    }
    payment_q = db.query(models.Payment).filter(models.Payment.status == "active")
    if sell_cylinder_payment_ids:
        payment_q = payment_q.filter(models.Payment.id.notin_(sell_cylinder_payment_ids))
    rows = _in_range(payment_q, models.Payment.date, start, end).all()
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
    # mirroring routers/ledger.py's convention (no double counting). This is
    # WHY the section is registered below as "Cylinder Activity (Not From a
    # Sale)" rather than plain "Cylinder Activity" — a day whose only
    # cylinder movement came from a Sale legitimately shows 0 rows here
    # while the Daily Summary's Cylinders Out/In (get_daily_report_data,
    # which counts every CylinderTransaction regardless of sale_id) is
    # still nonzero; the qualified label is what stops that from reading as
    # a contradiction.
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
    """Two sources, reported together as one section since they're the same
    real-world action:
      - models.EmptyCylinderSale: the retired flat-amount flow (routers/
        customers.py's old POST .../empty-cylinders/sell). No new rows are
        ever written here — kept only so historical sales keep reporting.
      - models.CylinderReturn rows with mode="cash", origin="sell_cylinder":
        the current flow — the Empty Cylinders page's "Sell Cylinder"
        button now reuses Return Cylinder — Cash Mode's own endpoint
        (POST /cylinder-returns) unchanged. The amount lives on the linked
        Payment, not on the CylinderReturn row itself; that Payment is
        deliberately excluded from customer_payments
        (_fetch_customer_payments above) so it's reported exactly once."""
    legacy_rows = _in_range(
        db.query(models.EmptyCylinderSale).filter(models.EmptyCylinderSale.status == "active"),
        models.EmptyCylinderSale.date, start, end,
    ).all()
    sell_returns = _in_range(
        db.query(models.CylinderReturn).filter(
            models.CylinderReturn.status == "active",
            models.CylinderReturn.mode == "cash",
            models.CylinderReturn.origin == "sell_cylinder",
        ),
        models.CylinderReturn.date, start, end,
    ).all()
    customers = {c.id: c for c in db.query(models.Customer).all()}
    payment_ids = [r.payment_id for r in sell_returns if r.payment_id]
    payments = (
        {p.id: p for p in db.query(models.Payment).filter(models.Payment.id.in_(payment_ids)).all()}
        if payment_ids else {}
    )

    out = []
    for e in legacy_rows:
        customer = customers.get(e.customer_id)
        out.append(ReportableTransaction(
            id=e.id, type="empty_cylinder_sale", date=e.date, display_id=e.display_id,
            description=f"Empty Cylinders Sold ({e.cylinder_size} KG) × {e.quantity}",
            amount=e.amount, customer=customer.name if customer else None,
            entered_by=e.entered_by, status=e.status,
        ))
    for r in sell_returns:
        customer = customers.get(r.customer_id)
        payment = payments.get(r.payment_id)
        type_label = f" {r.cylinder_type.upper()}" if r.cylinder_type else ""
        out.append(ReportableTransaction(
            id=r.id, type="empty_cylinder_sale", date=r.date, display_id=r.display_id,
            description=f"Empty Cylinders Sold ({r.cylinder_size} KG{type_label}) × {r.quantity}",
            amount=payment.amount if payment else None, customer=customer.name if customer else None,
            entered_by=r.entered_by, status=r.status,
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
register("delivery_charges", "Delivery Charges", _fetch_delivery_charges)
register("purchases", "Purchases", _fetch_purchases)
register("customer_payments", "Customer Payments", _fetch_customer_payments)
register("plant_payments", "Plant Payments / Settlements", _fetch_plant_payments)
register("investments", "Investments / Re-investments", _fetch_owner_capital)
register("expenses", "Expenses", _fetch_expenses)
register("owner_drawings", "Owner Drawings", _fetch_owner_drawings)
register("cylinder_activity", "Cylinder Activity (Not From a Sale)", _fetch_cylinder_activity, has_financial_total=False)
register("empty_cylinder_sales", "Empty Cylinder Sales", _fetch_empty_cylinder_sales)
register("shop_sales", "Shop Sales", _fetch_shop_sales)
register("shop_customer_payments", "Shop Customer Payments", _fetch_shop_customer_payments)
register("shop_expenses", "Shop Expenses", _fetch_shop_expenses)
register("shop_owner_withdrawals", "Shop Owner Withdrawals", _fetch_shop_owner_withdrawals)
register("account_transfers", "Account Transfers", _fetch_account_transfers, has_financial_total=False)
