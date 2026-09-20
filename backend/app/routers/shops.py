import json
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf, require_owner
from app.reporting.invoice_pdf import render_shop_sale_invoice_pdf, render_shop_statement_pdf, render_supply_customer_statement_pdf
from app.utils import next_display_id, get_or_create_shop_account, log_audit, resolve_settlement_destination, apply_settlement_routing, apply_salary_expense_if_needed, is_salary_category, compute_sale_totals

from app.timezone import KARACHI_TZ, karachi_day_bounds, karachi_today_str
from app.routers.board_rates import resolve_board_rate
from app.routers.ledger import _customer_corrections, _opening_balance_corrections, customer_monthly_ledger
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

router = APIRouter(prefix="/shops", tags=["shops"], dependencies=[Depends(require_active_user), Depends(require_csrf)])

# Fixed physical->saleable conversion for a Shop's board-rate cylinder
# pricing (§7/§9 of the Shop spec): a physical cylinder always loses a
# fixed 0.4kg to wastage before it's sellable — never user-editable, never
# hard-coded per product (the physical figure always comes from
# Product.weight_kg, only this constant is fixed). For the current 45.4kg
# product this yields the spec's 45kg saleable figure; it applies the same
# way to any other cylinder size added later.
FIXED_WASTAGE_KG = Decimal("0.4")

_ph = PasswordHasher()

SHOP_DELETE_PASSWORD_KEY = "shop_delete_password_hash"


@router.get("/delete-password/status")
def shop_delete_password_status(db: Session = Depends(get_db)):
    row = db.query(models.AppSetting).get(SHOP_DELETE_PASSWORD_KEY)
    return {"is_set": row is not None}


@router.post("/delete-password/set")
def set_shop_delete_password(
    payload: schemas.ShopDeletePasswordSet,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    if not payload.new_password or len(payload.new_password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")

    row = db.query(models.AppSetting).get(SHOP_DELETE_PASSWORD_KEY)
    if row:
        if not payload.current_password:
            raise HTTPException(400, "Current password is required to change it")
        try:
            _ph.verify(row.value, payload.current_password)
        except VerifyMismatchError:
            raise HTTPException(400, "Current password is incorrect")
        row.value = _ph.hash(payload.new_password)
        row.updated_at = datetime.utcnow()
        db.add(row)
    else:
        db.add(models.AppSetting(key=SHOP_DELETE_PASSWORD_KEY, value=_ph.hash(payload.new_password)))

    db.commit()
    return {"status": "ok"}


@router.delete("/{shop_id}")
def delete_shop(
    shop_id: UUID,
    payload: schemas.ShopDeleteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    shop_name = shop.name

    pw_row = db.query(models.AppSetting).get(SHOP_DELETE_PASSWORD_KEY)
    if not pw_row:
        raise HTTPException(400, "No Shop Deletion password has been set yet — set one first")
    try:
        _ph.verify(pw_row.value, payload.password)
    except VerifyMismatchError:
        raise HTTPException(403, "Incorrect password")

    # Order matters — children before parents to avoid FK constraint errors
    shop_account = db.query(models.PaymentAccount).filter(models.PaymentAccount.shop_id == shop_id).first()

    expense_txns = db.query(models.ShopExpenseTransaction).filter(models.ShopExpenseTransaction.shop_id == shop_id).all()
    expense_txn_ids = [t.id for t in expense_txns]
    sales = db.query(models.ShopSale).filter(models.ShopSale.customer_id == shop_id).all()
    sale_ids = [s.id for s in sales]
    transfers = db.query(models.ShopCashTransfer).filter(models.ShopCashTransfer.shop_id == shop_id).all()
    transfer_ids = [t.id for t in transfers]
    customer_payments = db.query(models.ShopCustomerPayment).filter(models.ShopCustomerPayment.shop_id == shop_id).all()
    scp_ids = [p.id for p in customer_payments]

    # Real money that already moved OUT of this shop — a plant's payable
    # reduced, an account's balance credited (Home Expense / Owner
    # Drawings / plant-or-account settlement, or a genuine Shop Expense/
    # Withdrawal) — must never be deleted or reversed here, only the
    # shop-side back-links that are about to dangle once ShopSale/
    # ShopCashTransfer/ShopCustomerPayment/ShopExpenseTransaction and the
    # shop itself are gone. See models.Expense.shop_origin_label's
    # docstring: this snapshot is what replaces those FKs' informational
    # value forever, with zero dangling-reference risk regardless of
    # whether Postgres happens to enforce the FK today.
    def _origin_label(row) -> str:
        sale_id = getattr(row, "source_shop_sale_id", None)
        if sale_id:
            match = next((s for s in sales if s.id == sale_id), None)
            if match:
                return f"Shop Sale {match.display_id} ({shop_name})"
        transfer_id = getattr(row, "source_shop_cash_transfer_id", None)
        if transfer_id:
            match = next((t for t in transfers if t.id == transfer_id), None)
            if match:
                return f"Shop Cash Transfer {match.display_id} ({shop_name})"
        scp_id = getattr(row, "source_shop_customer_payment_id", None)
        if scp_id:
            match = next((p for p in customer_payments if p.id == scp_id), None)
            if match:
                return f"Shop Customer Payment {match.display_id} ({shop_name})"
        exp_txn_id = getattr(row, "source_shop_expense_transaction_id", None)
        if exp_txn_id:
            match = next((t for t in expense_txns if t.id == exp_txn_id), None)
            if match:
                return f"Shop Expense {match.display_id} ({shop_name})"
        return f"Shop {shop_name}"

    surviving_by_id: dict = {}
    for query, filters in (
        (models.Expense, [models.Expense.shop_id == shop_id]),
        (models.Expense, [models.Expense.source_shop_sale_id.in_(sale_ids)] if sale_ids else None),
        (models.Expense, [models.Expense.source_shop_cash_transfer_id.in_(transfer_ids)] if transfer_ids else None),
        (models.Expense, [models.Expense.source_shop_customer_payment_id.in_(scp_ids)] if scp_ids else None),
        (models.OwnerDrawings, [models.OwnerDrawings.shop_id == shop_id]),
        (models.OwnerDrawings, [models.OwnerDrawings.source_shop_sale_id.in_(sale_ids)] if sale_ids else None),
        (models.OwnerDrawings, [models.OwnerDrawings.source_shop_cash_transfer_id.in_(transfer_ids)] if transfer_ids else None),
        (models.OwnerDrawings, [models.OwnerDrawings.source_shop_customer_payment_id.in_(scp_ids)] if scp_ids else None),
        (models.CompanyPayment, [models.CompanyPayment.source_shop_sale_id.in_(sale_ids)] if sale_ids else None),
        (models.CompanyPayment, [models.CompanyPayment.source_shop_cash_transfer_id.in_(transfer_ids)] if transfer_ids else None),
        (models.CompanyPayment, [models.CompanyPayment.source_shop_customer_payment_id.in_(scp_ids)] if scp_ids else None),
    ):
        if filters is None:
            continue
        for row in db.query(query).filter(*filters).all():
            surviving_by_id[(query, row.id)] = row

    for row in surviving_by_id.values():
        row.shop_origin_label = _origin_label(row)
        if hasattr(row, "shop_id"):
            row.shop_id = None
        row.source_shop_sale_id = None
        row.source_shop_cash_transfer_id = None
        row.source_shop_customer_payment_id = None
        if hasattr(row, "source_shop_expense_transaction_id"):
            row.source_shop_expense_transaction_id = None
        # account_id here (Expense/OwnerDrawings only — CompanyPayment's is
        # always null for a routed row) can point at the SHOP'S OWN account
        # being hard-deleted below (the Shop Expense dual-write path
        # defaults to it) — never a Plant/global-Account, which this never
        # touches. Cleared silently, same as every other field-collected/
        # untied row already using account_id=None throughout this app.
        if hasattr(row, "account_id") and shop_account and row.account_id == shop_account.id:
            row.account_id = None
        db.add(row)

    # Flush the label/FK-nulling UPDATEs above before any hard-delete below
    # — deliberately not left to implicit flush-ordering, since one of them
    # (account_id) is the one column here with a real enforced FK to
    # payment_accounts, and shop_account is deleted further down.
    db.flush()

    if expense_txn_ids:
        db.query(models.ShopExpenseLine).filter(models.ShopExpenseLine.expense_transaction_id.in_(expense_txn_ids)).delete(synchronize_session=False)
        db.query(models.ShopExpenseTransaction).filter(models.ShopExpenseTransaction.id.in_(expense_txn_ids)).delete(synchronize_session=False)

    if sale_ids:
        db.query(models.ShopSaleBatchConsumption).filter(models.ShopSaleBatchConsumption.shop_sale_id.in_(sale_ids)).delete(synchronize_session=False)

    db.query(models.ShopCustomerPayment).filter(models.ShopCustomerPayment.shop_id == shop_id).delete(synchronize_session=False)
    db.query(models.ShopSale).filter(models.ShopSale.customer_id == shop_id).delete(synchronize_session=False)
    db.query(models.ShopCashTransfer).filter(models.ShopCashTransfer.shop_id == shop_id).delete(synchronize_session=False)
    db.query(models.ShopSupplyCustomer).filter(models.ShopSupplyCustomer.shop_id == shop_id).delete(synchronize_session=False)
    db.query(models.ShopStockBatch).filter(models.ShopStockBatch.customer_id == shop_id).delete(synchronize_session=False)

    # CylinderTransaction / CustomerCylinderBalance (§ Delete Shop bug fix)
    # — every Load is an ordinary Sale to this shop (routers/sales.py), and
    # every such Sale creates a linked CylinderTransaction plus upserts a
    # CustomerCylinderBalance row via adjust_cylinder_balance, both FK'd to
    # this shop's own Customer row (and the former also to the Sale being
    # deleted below). Unlike Expense/OwnerDrawings/CompanyPayment, these
    # are pure movement/derived-balance records with no money attached —
    # a shop should already be at zero cylinders outstanding before
    # deletion is even attempted, so there is nothing worth preserving via
    # a shop_origin_label-style snapshot. Hard-deleted here, same
    # treatment as ShopStockBatch/ShopSaleBatchConsumption above.
    db.query(models.CylinderTransaction).filter(models.CylinderTransaction.customer_id == shop_id).delete(synchronize_session=False)
    db.query(models.CustomerCylinderBalance).filter(models.CustomerCylinderBalance.customer_id == shop_id).delete(synchronize_session=False)

    db.query(models.Payment).filter(models.Payment.customer_id == shop_id).delete(synchronize_session=False)
    db.query(models.Sale).filter(models.Sale.customer_id == shop_id).delete(synchronize_session=False)

    if shop_account:
        db.delete(shop_account)

    db.delete(shop)
    db.commit()
    return {"status": "deleted"}


def _saleable_kg(physical_weight_kg) -> Decimal:
    """Saleable KG for one physical cylinder = physical weight - fixed
    wastage, floored at 0 so a hypothetically tiny product can never price
    negative. This is the ONLY figure a Shop Sale / Board Rate price is
    ever computed from — never the raw physical weight."""
    physical = Decimal(str(physical_weight_kg))
    return max(physical - FIXED_WASTAGE_KG, Decimal("0"))


def _get_shop(db: Session, shop_id: UUID) -> models.Customer:
    shop = db.query(models.Customer).get(shop_id)
    if not shop or shop.customer_type != "shop":
        raise HTTPException(404, "Shop not found")
    return shop


# ---------- Stock summary (derived, never stored — §1/§7) ----------

def _compute_stock_summary(db: Session, shop_id, business_date: str) -> schemas.ShopStockSummary:
    day_start, day_end = karachi_day_bounds(business_date)
    on_date = day_end - timedelta(microseconds=1)  # "as of" this business date, any time-of-day

    products = {p.id: p for p in db.query(models.Product).all()}

    all_batches = db.query(models.ShopStockBatch).filter(
        models.ShopStockBatch.customer_id == shop_id, models.ShopStockBatch.status == "active"
    ).all()
    all_sales = db.query(models.ShopSale).filter(
        models.ShopSale.customer_id == shop_id, models.ShopSale.status == "active"
    ).all()
    # Emergency Transfer (§ Shop — Emergency Transfer) draws physical stock
    # from this same shop's FIFO batches (see _consume_shop_stock_for_
    # emergency_transfer in routers/sales.py) but posts as a Sale against
    # the real customer's ledger, never as a ShopSale — so it must be
    # subtracted here too, or this summary (opening/closing/hero "Closing
    # Stock Inventory" card, and the price/stock preview Record Shop Sale
    # reads its stockProducts from) silently overstates remaining stock by
    # exactly what Emergency Transfer already took, while the live FIFO
    # check at actual sale time (which reads ShopStockBatch.quantity_
    # remaining directly) correctly does not.
    all_transfers = db.query(models.Sale).filter(
        models.Sale.emergency_transfer_shop_id == shop_id, models.Sale.status == "active"
    ).all()

    product_ids = {b.product_id for b in all_batches} | {s.product_id for s in all_sales} | {t.product_id for t in all_transfers}

    try:
        board_rate = resolve_board_rate(db, on_date)
    except HTTPException:
        board_rate = None

    rows: list[schemas.ShopProductStockSummary] = []
    totals = {"opening": Decimal("0"), "load": Decimal("0"), "sales": Decimal("0"), "closing": Decimal("0"), "sales_amount": Decimal("0")}

    for pid in product_ids:
        product = products.get(pid)
        if not product:
            continue
        batches = [b for b in all_batches if b.product_id == pid]
        sales = [s for s in all_sales if s.product_id == pid]
        transfers = [t for t in all_transfers if t.product_id == pid]

        opening = (
            sum((b.quantity_received for b in batches if b.transaction_date < day_start), start=Decimal("0"))
            - sum((s.quantity for s in sales if s.date < day_start), start=Decimal("0"))
            - sum((t.quantity for t in transfers if t.date < day_start), start=Decimal("0"))
        )
        day_load = sum((b.quantity_received for b in batches if day_start <= b.transaction_date < day_end), start=Decimal("0"))
        # "sales" (both the returned field and what closing is derived from)
        # is stock LEAVING the shop, so it includes Emergency Transfer
        # quantities too — closing must stay exactly opening + load - sales,
        # with no hidden term, or the two numbers silently stop reconciling.
        day_sales = sum((s.quantity for s in sales if day_start <= s.date < day_end), start=Decimal("0")) + sum(
            (t.quantity for t in transfers if day_start <= t.date < day_end), start=Decimal("0")
        )
        # Emergency Transfer revenue posts to the real customer's ledger,
        # never the shop's own sales reporting — todays_sales_amount stays
        # ShopSale-only on purpose; only the STOCK quantity gap is fixed above.
        day_sales_amount = sum((s.total_amount for s in sales if day_start <= s.date < day_end), start=Decimal("0"))
        closing = opening + day_load - day_sales

        cylinder_weight = product.weight_kg
        saleable_kg = _saleable_kg(cylinder_weight)
        sale_rate = (board_rate.rate_per_kg * saleable_kg) if board_rate else None

        rows.append(schemas.ShopProductStockSummary(
            product_id=pid, product_name=product.name,
            opening_stock=opening, new_load=day_load, sales=day_sales, closing_stock=closing,
            board_rate_per_kg=board_rate.rate_per_kg if board_rate else None,
            cylinder_weight=cylinder_weight, wastage_kg=FIXED_WASTAGE_KG, saleable_kg=saleable_kg,
            sale_rate_per_cylinder=sale_rate,
            todays_sales_amount=day_sales_amount,
        ))

        totals["opening"] += opening
        totals["load"] += day_load
        totals["sales"] += day_sales
        totals["closing"] += closing
        totals["sales_amount"] += day_sales_amount

    rows.sort(key=lambda r: r.product_name)

    return schemas.ShopStockSummary(
        business_date=business_date,
        products=rows,
        total_opening_stock=totals["opening"],
        total_new_load=totals["load"],
        total_sales=totals["sales"],
        total_closing_stock=totals["closing"],
        total_sales_amount=totals["sales_amount"],
    )


# ---------- Shop Cash summary (a derived HISTORICAL VIEW, §24 — reconciles
# against but is distinct from the shop's real PaymentAccount.current_balance,
# which every money movement below actually posts to; see
# schemas.ShopCashSummary's docstring for the Customer-Ledger-vs-
# Customer.current_balance analogy this mirrors) ----------

def _compute_cash_summary_range(db: Session, shop: models.Customer, range_start: datetime, range_end: datetime) -> schemas.ShopCashSummary:
    """Same derive-from-history Shop Cash math as _compute_cash_summary,
    generalized to an arbitrary [range_start, range_end) window instead of
    one business day — a single day IS just a range, so _compute_cash_summary
    below is now a thin wrapper around this. Added for the Shop Statement's
    month-scoped Shop Cash summary tile (§ Shop Statement — Dowa Payable vs
    Shop Cash), which needs this exact same proven math over a whole month
    instead of one day, rather than a separately-written approximation.
    `business_date` on the returned row is left blank — meaningless for a
    multi-day range; callers that need it (the single-day wrapper) set it
    themselves."""
    shop_account = get_or_create_shop_account(db, shop)

    # Every term below is filtered to the transactions that actually posted
    # to THIS shop's own account — a Shop Sale/collection/expense entered
    # with a different destination/source account (§2/§1: "should allow the
    # same account choices as elsewhere") never touches Shop Cash, only
    # whichever account was actually chosen does.
    #
    # § Shop Cash settlement-routing gap (found while adding the Shop
    # Statement's Shop Cash tile) — destination_account_id is ONLY ever set
    # on the legacy plain-account path (_apply_shop_sale's `elif
    # amount_received > 0` branch below); a Shop Sale routed via the 3-way
    # Settlement Routing form (destination_type set — the standard path for
    # every current Shop Sale form) instead sets settlement_account_id,
    # even when the chosen destination IS this shop's own Shop Cash
    # ("shop_cash" resolves to get_or_create_shop_account, i.e.
    # settlement_account_id == shop_account.id). A query matching
    # destination_account_id alone silently missed every settlement-routed
    # collection into Shop Cash — this OR was missing entirely before now,
    # so Shop Cash's derived opening/closing figures (both here and on the
    # existing Shop Detail page's daily tile, which shares this function)
    # undercounted real money that had actually posted to the account.
    all_sales = (
        db.query(models.ShopSale)
        .filter(
            models.ShopSale.customer_id == shop.id, models.ShopSale.status == "active",
            or_(
                models.ShopSale.destination_account_id == shop_account.id,
                models.ShopSale.settlement_account_id == shop_account.id,
            ),
        )
        .all()
    )
    # Home Expense / Owner Drawings bypass totals (§ Shop Cash Flow —
    # Sale/Transfer Deductions chip) — purely informational, so unlike
    # all_sales above this is EVERY active Shop Sale regardless of where its
    # net settlement was routed: the bypassed amount never touches any
    # PaymentAccount (see utils.apply_settlement_routing), so it's the same
    # "money that left the till before ever being deposited" fact no matter
    # which destination the remainder went to.
    all_sales_for_deductions = (
        db.query(models.ShopSale)
        .filter(models.ShopSale.customer_id == shop.id, models.ShopSale.status == "active")
        .all()
    )
    # Same settlement-routing gap as all_sales above, for Payment Only
    # collections (ShopCustomerPayment.account_id is the same legacy-only
    # field; settlement_account_id is where a Payment Only collection
    # routed to "shop_cash" actually lands).
    collections = (
        db.query(models.ShopCustomerPayment)
        .filter(
            models.ShopCustomerPayment.shop_id == shop.id, models.ShopCustomerPayment.status == "active",
            or_(
                models.ShopCustomerPayment.account_id == shop_account.id,
                models.ShopCustomerPayment.settlement_account_id == shop_account.id,
            ),
        )
        .all()
    )
    expense_txns = (
        db.query(models.ShopExpenseTransaction)
        .filter(
            models.ShopExpenseTransaction.shop_id == shop.id, models.ShopExpenseTransaction.status == "active",
            models.ShopExpenseTransaction.account_id == shop_account.id,
        )
        .all()
    )
    # Only Dowa payments actually funded FROM this shop's own account count
    # against Shop Cash — one paid from a different account (e.g. Office
    # Cash) never touches Shop Cash at all.
    dowa_payments = (
        db.query(models.Payment)
        .filter(models.Payment.customer_id == shop.id, models.Payment.status == "active", models.Payment.source_account_id == shop_account.id)
        .all()
    )
    # Shop Cash Transfer (§ Shop Cash Transfer) — always debits this shop's
    # own account by construction (see _apply_shop_cash_transfer), unlike
    # dowa_payments above which only counts if funded from Shop Cash.
    cash_transfers = (
        db.query(models.ShopCashTransfer)
        .filter(models.ShopCashTransfer.shop_id == shop.id, models.ShopCashTransfer.status == "active")
        .all()
    )
    transfers_in_rows = (
        db.query(models.AccountTransfer).filter(models.AccountTransfer.to_account_id == shop_account.id).all()
    )
    transfers_out_rows = (
        db.query(models.AccountTransfer).filter(models.AccountTransfer.from_account_id == shop_account.id).all()
    )

    lines_by_txn: dict = {}
    if expense_txns:
        lines = db.query(models.ShopExpenseLine).filter(
            models.ShopExpenseLine.expense_transaction_id.in_([t.id for t in expense_txns])
        ).all()
        for l in lines:
            lines_by_txn.setdefault(l.expense_transaction_id, []).append(l)

    def _expense_split(txns) -> tuple[Decimal, Decimal]:
        expense_total = Decimal("0")
        withdrawal_total = Decimal("0")
        for t in txns:
            for l in lines_by_txn.get(t.id, []):
                if l.line_type == "owner_withdrawal":
                    withdrawal_total += l.amount
                else:
                    expense_total += l.amount
        return expense_total, withdrawal_total

    before = lambda rows, attr: [r for r in rows if getattr(r, attr) < range_start]
    within = lambda rows, attr: [r for r in rows if range_start <= getattr(r, attr) < range_end]

    before_expense, before_withdrawal = _expense_split(before(expense_txns, "date"))
    period_expense, period_withdrawal = _expense_split(within(expense_txns, "date"))

    def _received(sales) -> Decimal:
        return sum((s.amount_received if s.amount_received is not None else Decimal("0")) for s in sales) or Decimal("0")

    opening_cash = (
        shop_account.opening_balance
        + _received(before(all_sales, "date"))
        + sum((p.amount for p in before(collections, "date")), start=Decimal("0"))
        + sum((t.amount for t in before(transfers_in_rows, "date")), start=Decimal("0"))
        - before_expense - before_withdrawal
        - sum((p.amount for p in before(dowa_payments, "date")), start=Decimal("0"))
        - sum((t.amount for t in before(transfers_out_rows, "date")), start=Decimal("0"))
        - sum((c.gross_amount for c in before(cash_transfers, "date")), start=Decimal("0"))
    )

    period_cash_sales = _received(within(all_sales, "date"))
    period_collections = sum((p.amount for p in within(collections, "date")), start=Decimal("0"))
    period_dowa_payments = sum((p.amount for p in within(dowa_payments, "date")), start=Decimal("0"))
    period_transfers_in = sum((t.amount for t in within(transfers_in_rows, "date")), start=Decimal("0"))
    period_transfers_out = sum((t.amount for t in within(transfers_out_rows, "date")), start=Decimal("0"))
    period_cash_transfers_out = sum((c.gross_amount for c in within(cash_transfers, "date")), start=Decimal("0"))

    # Sale/Transfer Deductions (§ Shop Cash Flow chip) — purely informational,
    # deliberately NOT folded into closing_cash below: this money never
    # touched Shop Cash to begin with (same reasoning as the existing
    # dowa_payments/transfers_out/cash_transfers_out bypass amounts above —
    # it's cash that left the till directly via Expense/OwnerDrawings,
    # account_id=None, before ever being deposited).
    period_settlement_home_expense = sum(
        (
            (s.settlement_home_expense_amount or Decimal("0")) for s in within(all_sales_for_deductions, "date")
        ), start=Decimal("0"),
    ) + sum((c.settlement_home_expense_amount for c in within(cash_transfers, "date")), start=Decimal("0"))
    period_settlement_owner_drawings = sum(
        (
            (s.settlement_owner_drawings_amount or Decimal("0")) for s in within(all_sales_for_deductions, "date")
        ), start=Decimal("0"),
    ) + sum((c.settlement_owner_drawings_amount for c in within(cash_transfers, "date")), start=Decimal("0"))

    closing_cash = (
        opening_cash + period_cash_sales + period_collections + period_transfers_in
        - period_expense - period_withdrawal - period_dowa_payments - period_transfers_out - period_cash_transfers_out
    )

    return schemas.ShopCashSummary(
        business_date="",
        opening_cash=opening_cash,
        cash_retail_sales=period_cash_sales,
        supply_customer_collections=period_collections,
        expenses=period_expense,
        owner_withdrawals=period_withdrawal,
        dowa_payments=period_dowa_payments,
        transfers_in=period_transfers_in,
        transfers_out=period_transfers_out,
        cash_transfers_out=period_cash_transfers_out,
        settlement_home_expense_total=period_settlement_home_expense,
        settlement_owner_drawings_total=period_settlement_owner_drawings,
        closing_cash=closing_cash,
    )


def _compute_cash_summary(db: Session, shop: models.Customer, business_date: str) -> schemas.ShopCashSummary:
    """Shop Cash for one business day — thin wrapper around
    _compute_cash_summary_range (a single day IS just a range). Behavior
    unchanged for every existing caller (Shop Detail's daily cash tile,
    etc.) — this is a pure extraction, not a formula change."""
    day_start, day_end = karachi_day_bounds(business_date)
    summary = _compute_cash_summary_range(db, shop, day_start, day_end)
    summary.business_date = business_date
    return summary


# ---------- FIFO consumption / reversal for Shop Sales ----------

def _apply_shop_sale(db: Session, shop: models.Customer, payload: schemas.ShopSaleCreate, entered_by: str) -> models.ShopSale:
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be positive")

    # Supply Customers (§25) — a credit sale must name whose receivable it
    # is; a cash sale may optionally still name a customer (e.g. a regular
    # buyer paying on the spot) but never has to.
    supply_customer = None
    if payload.supply_customer_id:
        supply_customer = db.query(models.ShopSupplyCustomer).get(payload.supply_customer_id)
        if not supply_customer or supply_customer.shop_id != shop.id:
            raise HTTPException(404, "Supply customer not found for this shop")
    if payload.payment_type == "credit" and not supply_customer:
        raise HTTPException(400, "A credit sale requires a supply_customer_id")

    # Board Rate — manual entry only (§ Board Rate manual entry). No
    # system-wide auto-resolve for Shop Sale pricing: resolve_board_rate is
    # deliberately NOT called here — the user types board_rate_per_kg fresh
    # on every sale, with no pre-fill/default. This is still the same
    # formula, "SHOP SALE AMOUNT = BOARD RATE × SALEABLE KG (physical
    # weight minus fixed wastage) × QUANTITY", just sourced from
    # payload.board_rate_per_kg instead of a resolved BoardRate row.
    # resolve_board_rate/the BoardRate table are untouched and still power
    # _compute_stock_summary (Hero Metrics/Stock & Sale Pricing) and
    # create_manual_stock_batch's informational load_rate_per_kg exactly as
    # before — this change is scoped to sale pricing only.
    if payload.board_rate_per_kg <= 0:
        raise HTTPException(400, "Board Rate must be positive")
    cylinder_weight = product.weight_kg
    saleable_kg = _saleable_kg(cylinder_weight)
    # sale_rate_per_cylinder is ALWAYS board-rate-derived — the audit trail
    # of what the board-rate math produced, never touched by the Selling
    # Price override below (§ Selling Price override).
    sale_rate_per_cylinder = payload.board_rate_per_kg * saleable_kg

    # KG-based sales (§15) — stock/FIFO stays cylinder-denominated (matching
    # ShopStockBatch, which is never itself converted to KG so existing
    # batches/dashboard math are untouched); a unit='kg' entry is converted
    # to its cylinder-equivalent here, and priced directly off quantity_kg
    # so a fractional-cylinder rounding trip never affects the money.
    if payload.unit == "kg":
        if saleable_kg <= 0:
            raise HTTPException(400, "This product has no saleable weight to sell by KG")
        quantity_kg = payload.quantity
        cylinders_equivalent = quantity_kg / saleable_kg
    else:
        cylinders_equivalent = payload.quantity
        quantity_kg = payload.quantity * saleable_kg
    # Board-rate-derived total — quantity_kg × board_rate_per_kg exactly
    # (cylinders_equivalent × saleable_kg == quantity_kg).
    total_amount = cylinders_equivalent * sale_rate_per_cylinder

    # § Selling Price override — optional, distinct from Board Rate above:
    # when set, this REPLACES total_amount outright (never sale_rate_per_
    # cylinder, which keeps its board-rate-derived value as an audit trail
    # of what the calculation would have produced) — a final Rs amount the
    # user types directly, no per-cylinder math required of them.
    manual_rate_override = payload.manual_total_amount is not None
    if manual_rate_override:
        if payload.manual_total_amount <= 0:
            raise HTTPException(400, "Selling price override must be positive")
        total_amount = payload.manual_total_amount

    # GST on Sale, extended to Shop Sale (§ GST on Shop Sale) — total_amount
    # stays GST-EXCLUSIVE (what Dashboard/P&L/Tonnage read, via the shop's
    # stock summary which never touches these fields); grand_total is what
    # is ACTUALLY owed/collected from here on, same separation already
    # proven for Sale/Unified Sale.
    # Discount (§ Discount, optional) applies FIRST; GST then runs on the
    # discounted base. total_amount is never reduced — only grand_total is.
    totals = compute_sale_totals(
        total_amount, payload.discount_enabled, payload.discount_rate, payload.gst_enabled, payload.gst_rate,
    )
    gst_enabled, gst_rate, gst_amount, grand_total = (
        totals["gst_enabled"], totals["gst_rate"], totals["gst_amount"], totals["grand_total"]
    )

    # Inline Settlement (§2, Money Routing) — how much of grand_total was
    # actually collected right now. A Walk-in sale (no supply_customer) is
    # always fully paid (there's no one to owe); amount_received is
    # force-set to grand_total server-side regardless of what was sent,
    # rather than trusting a client-supplied figure for money that must
    # always be 100% collected. Once a real supply_customer is named,
    # partial payment is allowed under EITHER payment_type — "cash"
    # defaults to fully paid (today's original behavior) and "credit"
    # defaults to 0 (today's original all-or-nothing behavior) unless a
    # partial/full amount was explicitly given; payment_type no longer
    # gates whether a partial amount is honored, only the default when
    # none is sent (§ Amount Received visible for any named customer).
    if not supply_customer:
        amount_received = grand_total
    else:
        default_received = grand_total if payload.payment_type == "cash" else Decimal("0")
        amount_received = payload.amount_received if payload.amount_received is not None else default_received
        # Paying MORE than this sale's total is allowed for a named supply
        # customer (round-figure payments covering old dues, or leaving
        # advance): the excess is simply a negative outstanding, which posts
        # to their balance below as advance credit. Only a negative amount
        # is invalid. (Walk-in never reaches here — always exactly grand_total.)
        if amount_received < 0:
            raise HTTPException(400, "amount_received cannot be negative")

    use_settlement_routing = amount_received > 0 and payload.destination_type is not None
    destination_account = None
    settlement_destination_type = None
    settlement_target_plant_id = None
    settlement_account_row = None
    settlement_net_amount = Decimal("0")

    # § Multi-line Categorized Home Expense — when home_expense_lines is
    # given (non-empty), it REPLACES the legacy single home_expense_amount/
    # category_id/employee_id fields entirely for this sale's math; those
    # scalars stay 0/None below whenever lines are used. home_expense_total
    # is what every downstream calc (bypass_sum, settlement_net_amount)
    # uses instead of payload.home_expense_amount directly, so both paths
    # share the exact same math from here on.
    home_expense_lines = payload.home_expense_lines or []
    use_home_expense_lines = bool(home_expense_lines)
    home_expense_total = (
        sum((l.amount for l in home_expense_lines), Decimal("0")) if use_home_expense_lines
        else payload.home_expense_amount
    )

    if use_settlement_routing:
        bypass_sum = home_expense_total + payload.owner_drawings_amount
        if bypass_sum > amount_received + Decimal("0.01"):
            raise HTTPException(400, "Expense + owner drawings exceeds the amount collected")
        # Employee Salary Tracking (§ Employee Salary Tracking) — required
        # whenever a Home Expense category is the system "Salary" category,
        # same as every other Salary-entry surface. Checked per-line when
        # multi-line; the single legacy field otherwise.
        if use_home_expense_lines:
            for line in home_expense_lines:
                if line.amount > 0 and is_salary_category(db, line.category_id) and not line.employee_id:
                    raise HTTPException(400, "Employee is required when an Expense line's category is Salary")
        elif payload.home_expense_amount > 0 and is_salary_category(db, payload.home_expense_category_id) and not payload.home_expense_employee_id:
            raise HTTPException(400, "Employee is required when Expense category is Salary")
        settlement_net_amount = amount_received - home_expense_total - payload.owner_drawings_amount
        settlement_destination_type, settlement_target_plant_id, settlement_account_row, _ = resolve_settlement_destination(
            db, payload.destination_type, payload.target_plant_id, payload.account_id, settlement_net_amount, shop=shop
        )
    elif amount_received > 0:
        if payload.destination_account_id:
            destination_account = db.query(models.PaymentAccount).get(payload.destination_account_id)
            if not destination_account:
                raise HTTPException(404, "Destination account not found")
        else:
            destination_account = get_or_create_shop_account(db, shop)

    # FIFO — oldest batch first. This ONLY decides which physical batch
    # quantity is reduced; it has no influence on the price computed above.
    batches = (
        db.query(models.ShopStockBatch)
        .filter(
            models.ShopStockBatch.customer_id == shop.id,
            models.ShopStockBatch.product_id == payload.product_id,
            models.ShopStockBatch.status == "active",
            models.ShopStockBatch.quantity_remaining > 0,
        )
        .order_by(models.ShopStockBatch.transaction_date.asc(), models.ShopStockBatch.created_at.asc())
        .all()
    )
    available = sum((b.quantity_remaining for b in batches), start=Decimal("0"))
    if available < cylinders_equivalent:
        available_kg = available * saleable_kg
        raise HTTPException(
            400,
            f"Insufficient stock for this product — only {available} cylinder(s) "
            f"(~{available_kg} kg) available, {cylinders_equivalent} cylinder(s) requested",
        )

    sale = models.ShopSale(
        display_id=next_display_id(db, models.ShopSale, "SHSALE", width=6),
        date=payload.date,
        customer_id=shop.id,
        product_id=payload.product_id,
        quantity=cylinders_equivalent,
        unit=payload.unit,
        quantity_kg=quantity_kg,
        supply_customer_id=supply_customer.id if supply_customer else None,
        payment_type=payload.payment_type,
        amount_received=amount_received,
        destination_account_id=destination_account.id if destination_account else None,
        board_rate_per_kg_used=payload.board_rate_per_kg,
        cylinder_weight_used=cylinder_weight,
        saleable_kg_used=saleable_kg,
        sale_rate_per_cylinder=sale_rate_per_cylinder,
        total_amount=total_amount,
        manual_rate_override=manual_rate_override,
        discount_enabled=totals["discount_enabled"],
        discount_rate=totals["discount_rate"],
        discount_amount=totals["discount_amount"],
        gst_enabled=gst_enabled,
        gst_rate=gst_rate,
        gst_amount=gst_amount,
        grand_total=grand_total,
        notes=payload.notes,
        status="active",
        entered_by=entered_by,
        settlement_home_expense_amount=home_expense_total if use_settlement_routing else None,
        settlement_owner_drawings_amount=payload.owner_drawings_amount if use_settlement_routing else None,
    )
    db.add(sale)
    db.flush()

    remaining = cylinders_equivalent
    for batch in batches:
        if remaining <= 0:
            break
        take = min(batch.quantity_remaining, remaining)
        batch.quantity_remaining = batch.quantity_remaining - take
        db.add(batch)
        db.add(models.ShopSaleBatchConsumption(shop_sale_id=sale.id, shop_stock_batch_id=batch.id, quantity_consumed=take))
        remaining -= take

    # Supply Customer receivable (§25, §2) — any sale naming a customer
    # increases what they owe the SHOP by only the OUTSTANDING remainder
    # (GST-inclusive grand_total minus whatever was collected right now via
    # Inline Settlement), never the Dowa Customer Ledger/current_balance
    # (see the module docstring). Keyed off the actual outstanding amount,
    # not payment_type — a partially-paid "cash" sale owes exactly the same
    # way a partially-paid "credit" sale does (§ Amount Received visible
    # for any named customer); a Walk-in sale never reaches here with
    # outstanding > 0 since amount_received is force-set to grand_total
    # above whenever there's no supply_customer.
    outstanding = grand_total - amount_received
    if supply_customer and outstanding != 0:
        supply_customer.current_balance = supply_customer.current_balance + outstanding
        db.add(supply_customer)

    # Shop Cash Money Routing (§1/§2) — the cash portion actually collected
    # posts to a real, stored PaymentAccount balance right now, atomically
    # with the sale itself. Never posted for outstanding/credit portions.
    # Shop Cash Money Routing (§1/§2)
    if use_settlement_routing:
        if use_home_expense_lines:
            # § Multi-line Categorized Home Expense — create the
            # structured ShopSaleHomeExpenseLine + its matching bypass
            # Expense row (account_id=None, same pattern apply_settlement_
            # routing uses internally for the single-amount path) per
            # line, THEN call apply_settlement_routing with
            # home_expense_amount=0 so it skips its own single-Expense
            # creation — it still handles owner_drawings_amount and the
            # destination routing exactly as before, untouched. This keeps
            # apply_settlement_routing's signature/behavior identical for
            # its other 4 callers (Payment Receipt, Cylinder Return, Shop
            # Cash Transfer, Shop Customer Payment).
            for line in home_expense_lines:
                if line.amount <= 0:
                    continue
                db.add(models.ShopSaleHomeExpenseLine(
                    shop_sale_id=sale.id, category_id=line.category_id,
                    employee_id=line.employee_id, amount=line.amount,
                    description=line.description,
                ))
                db.add(models.Expense(
                    display_id=next_display_id(db, models.Expense, "EXP", width=6),
                    date=payload.date, category_id=line.category_id,
                    amount=line.amount, account_id=None, method="cash",
                    description=line.description or f"Auto-created from Shop Sale {sale.display_id}",
                    status="active", entered_by=entered_by,
                    source_shop_sale_id=sale.id, employee_id=line.employee_id,
                    shop_id=shop.id,
                ))
                # Flush before the NEXT iteration's next_display_id call —
                # the session is autoflush=False (app.database.SessionLocal),
                # so without this, next_display_id's MAX(display_id) query
                # can't see the Expense row just added above and hands back
                # the SAME display_id twice, a unique-constraint violation on
                # commit (caught while testing this feature: EXP-000029
                # assigned to two rows in one sale's multi-line settlement).
                db.flush()
                apply_salary_expense_if_needed(db, line.category_id, line.employee_id, line.amount, by=entered_by)
            apply_settlement_routing(
                db, payload.date, Decimal("0"), None,
                payload.owner_drawings_amount, settlement_destination_type, settlement_target_plant_id,
                settlement_account_row, settlement_net_amount, entered_by, None, f"Shop Sale {sale.display_id}",
                source_shop_sale_id=sale.id,
            )
        else:
            apply_settlement_routing(
                db, payload.date, payload.home_expense_amount, payload.home_expense_category_id,
                payload.owner_drawings_amount, settlement_destination_type, settlement_target_plant_id,
                settlement_account_row, settlement_net_amount, entered_by, None, f"Shop Sale {sale.display_id}",
                source_shop_sale_id=sale.id,
                home_expense_employee_id=payload.home_expense_employee_id,
            )
        # Flush BEFORE re-querying for the rows apply_settlement_routing
        # just created — the session is autoflush=False (see
        # app.database.SessionLocal), so without this the query below runs
        # against the database as it was before those adds and silently
        # finds nothing, leaving shop_id un-tagged on every one of them.
        db.flush()
        sale.settlement_destination_type = settlement_destination_type
        sale.settlement_account_id = settlement_account_row.id if settlement_account_row else None
        sale.settlement_target_plant_id = settlement_target_plant_id
        # § Home Expense category reversion — category_id/employee_id
        # replace the old free-text description going forward. Left None
        # for a multi-line sale — ShopSaleHomeExpenseLine rows are the
        # source of truth then, a single category/employee no longer
        # describes it.
        if not use_home_expense_lines:
            sale.settlement_home_expense_category_id = (
                payload.home_expense_category_id if payload.home_expense_amount > 0 else None
            )
            sale.settlement_home_expense_employee_id = (
                payload.home_expense_employee_id if payload.home_expense_amount > 0 else None
            )
        for bypass_row in db.query(models.Expense).filter(
            models.Expense.source_shop_sale_id == sale.id,
        ).all() + db.query(models.OwnerDrawings).filter(
            models.OwnerDrawings.source_shop_sale_id == sale.id,
        ).all():
            bypass_row.shop_id = shop.id
            db.add(bypass_row)
    elif destination_account and amount_received > 0:
        destination_account.current_balance = destination_account.current_balance + amount_received
        db.add(destination_account)
        sale.destination_account_id = destination_account.id

    db.add(sale)
    return sale
def _reverse_shop_sale_settlement(db: Session, sale: models.ShopSale) -> None:
    company_payment = (
        db.query(models.CompanyPayment)
        .filter(models.CompanyPayment.source_shop_sale_id == sale.id, models.CompanyPayment.status == "active")
        .first()
    )
    if company_payment:
        company = db.query(models.Company).get(company_payment.company_id)
        if company:
            company.current_balance = company.current_balance + company_payment.amount
            if company_payment.excess_amount:
                company.account_credit = company.account_credit - company_payment.excess_amount
            db.add(company)
        company_payment.status = "cancelled"
        db.add(company_payment)
    elif sale.settlement_destination_type == "account" and sale.settlement_account_id:
        account = db.query(models.PaymentAccount).get(sale.settlement_account_id)
        if account:
            # § Multi-line Categorized Home Expense bug fix — a sale can
            # now have MULTIPLE active Expense rows (one per home expense
            # line), not just one; summing via .all() here (rather than
            # the old .first()) is required so bypass_total — and
            # therefore net_amount debited back from the account — stays
            # correct for a multi-line sale. Harmless no-op for a legacy
            # single-line sale (sum of one row == that row's amount).
            home_exp_total = sum(
                (e.amount for e in db.query(models.Expense).filter(
                    models.Expense.source_shop_sale_id == sale.id, models.Expense.status == "active"
                ).all()), Decimal("0"),
            )
            drawing = db.query(models.OwnerDrawings).filter(
                models.OwnerDrawings.source_shop_sale_id == sale.id, models.OwnerDrawings.status == "active"
            ).first()
            bypass_total = home_exp_total + (drawing.amount if drawing else Decimal("0"))
            net_amount = (sale.amount_received or Decimal("0")) - bypass_total
            if net_amount > 0:
                account.current_balance = account.current_balance - net_amount
                db.add(account)

    # § Salary payments are never clawed back (deliberate, permanent
    # design — see utils.apply_salary_expense_if_needed's own docstring
    # for the full reasoning). Cancelling a Salary-category Expense here
    # only flips its status — it must NEVER also add the amount back onto
    # Employee.current_balance, even though every other bypass row above
    # (account/plant settlement, non-Salary Home Expense, Owner Drawings)
    # fully reverses. Do not "fix" this to also restore the employee's
    # balance — that would incorrectly claw back a salary that was
    # genuinely already paid.
    for exp in db.query(models.Expense).filter(
        models.Expense.source_shop_sale_id == sale.id, models.Expense.status == "active"
    ).all():
        exp.status = "cancelled"
        db.add(exp)
    for draw in db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_shop_sale_id == sale.id, models.OwnerDrawings.status == "active"
    ).all():
        draw.status = "cancelled"
        db.add(draw)


def _reverse_shop_sale(db: Session, sale: models.ShopSale) -> None:
    consumptions = db.query(models.ShopSaleBatchConsumption).filter(models.ShopSaleBatchConsumption.shop_sale_id == sale.id).all()
    for c in consumptions:
        batch = db.query(models.ShopStockBatch).get(c.shop_stock_batch_id)
        if batch:
            batch.quantity_remaining = batch.quantity_remaining + c.quantity_consumed
            db.add(batch)
        db.delete(c)

    # Mirrors the posting condition in _apply_shop_sale above — keyed off
    # outstanding > 0, not payment_type, so a partially-paid "cash" sale's
    # receivable reverses exactly like a "credit" sale's does. Uses
    # grand_total (GST-inclusive), matching what amount_received was
    # actually bounded against at creation — identical to total_amount for
    # every pre-GST row (grand_total was backfilled to equal total_amount).
    outstanding = sale.grand_total - (sale.amount_received if sale.amount_received is not None else Decimal("0"))
    if sale.supply_customer_id and outstanding != 0:
        supply_customer = db.query(models.ShopSupplyCustomer).get(sale.supply_customer_id)
        if supply_customer:
            supply_customer.current_balance = supply_customer.current_balance - outstanding
            db.add(supply_customer)

    if sale.settlement_destination_type:
        _reverse_shop_sale_settlement(db, sale)
    elif sale.destination_account_id and sale.amount_received:
        destination_account = db.query(models.PaymentAccount).get(sale.destination_account_id)
        if destination_account:
            destination_account.current_balance = destination_account.current_balance - sale.amount_received
            db.add(destination_account)


# ---------- Shop Cash Transfer (§ Shop Cash Transfer) ----------
# Pushes money OUT of a shop's real Shop Cash PaymentAccount balance — not a
# fresh sale generating new money, an existing stored balance being drawn
# down. Mirrors _apply_shop_sale's settlement section / _reverse_shop_sale_
# settlement, with one structural difference: since the money already
# exists (rather than being created by a sale), the balance check/debit
# happens BEFORE routing, not as a byproduct of it, and there's no FIFO/
# stock/supply-customer-receivable side to this at all.

def _apply_shop_cash_transfer(
    db: Session, shop: models.Customer, payload: schemas.ShopCashTransferCreate, entered_by: str,
) -> models.ShopCashTransfer:
    if payload.gross_amount <= 0:
        raise HTTPException(400, "gross_amount must be positive")

    shop_account = get_or_create_shop_account(db, shop)
    if payload.gross_amount > shop_account.current_balance:
        raise HTTPException(
            400,
            f"Insufficient Shop Cash balance — only {shop_account.current_balance} available, "
            f"{payload.gross_amount} requested",
        )

    bypass_sum = payload.home_expense_amount + payload.owner_drawings_amount
    if bypass_sum > payload.gross_amount + Decimal("0.01"):
        raise HTTPException(400, "Expense + owner drawings exceeds the amount transferred")
    # Employee Salary Tracking (§ Employee Salary Tracking)
    if payload.home_expense_amount > 0 and is_salary_category(db, payload.home_expense_category_id) and not payload.home_expense_employee_id:
        raise HTTPException(400, "Employee is required when Expense category is Salary")
    net_amount = payload.gross_amount - payload.home_expense_amount - payload.owner_drawings_amount

    settlement_destination_type, settlement_target_plant_id, settlement_account_row, _ = resolve_settlement_destination(
        db, payload.destination_type, payload.target_plant_id, payload.account_id, net_amount, shop=shop
    )

    transfer = models.ShopCashTransfer(
        display_id=next_display_id(db, models.ShopCashTransfer, "CASHOUT", width=6),
        date=payload.date,
        shop_id=shop.id,
        gross_amount=payload.gross_amount,
        settlement_destination_type=settlement_destination_type,
        settlement_target_plant_id=settlement_target_plant_id,
        settlement_account_id=settlement_account_row.id if settlement_account_row else None,
        # § Home Expense category reversion — category_id/employee_id
        # replace the old free-text description going forward.
        settlement_home_expense_category_id=(
            payload.home_expense_category_id if payload.home_expense_amount > 0 else None
        ),
        settlement_home_expense_employee_id=(
            payload.home_expense_employee_id if payload.home_expense_amount > 0 else None
        ),
        settlement_home_expense_amount=payload.home_expense_amount,
        settlement_owner_drawings_amount=payload.owner_drawings_amount,
        notes=payload.notes,
        status="active",
        entered_by=entered_by,
    )
    db.add(transfer)
    db.flush()

    # Debit Shop Cash FIRST — the mirror image of _apply_shop_sale's
    # destination credit (line ~528 above); nothing here CREATES money.
    shop_account.current_balance = shop_account.current_balance - payload.gross_amount
    db.add(shop_account)

    apply_settlement_routing(
        db, payload.date, payload.home_expense_amount, payload.home_expense_category_id,
        payload.owner_drawings_amount, settlement_destination_type, settlement_target_plant_id,
        settlement_account_row, net_amount, entered_by, None, f"Shop Cash Transfer {transfer.display_id}",
        source_shop_cash_transfer_id=transfer.id,
        home_expense_employee_id=payload.home_expense_employee_id,
    )
    # See the matching comment in _apply_shop_sale above — session is
    # autoflush=False, so this flush is required before the re-query below
    # can see the Expense/OwnerDrawings apply_settlement_routing just added.
    db.flush()
    for bypass_row in db.query(models.Expense).filter(
        models.Expense.source_shop_cash_transfer_id == transfer.id,
    ).all() + db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_shop_cash_transfer_id == transfer.id,
    ).all():
        bypass_row.shop_id = shop.id
        db.add(bypass_row)

    db.add(transfer)
    return transfer


def _reverse_shop_cash_transfer(db: Session, transfer: models.ShopCashTransfer) -> None:
    shop = db.query(models.Customer).get(transfer.shop_id)
    shop_account = get_or_create_shop_account(db, shop)
    # Restore the debited balance FIRST — the mirror image of the debit in
    # _apply_shop_cash_transfer above; no analogue in _reverse_shop_sale_
    # settlement (Shop Sale's own balance reversal lives in the separate
    # _reverse_shop_sale, since a sale credits rather than debits).
    shop_account.current_balance = shop_account.current_balance + transfer.gross_amount
    db.add(shop_account)

    if transfer.settlement_destination_type == "plant" and transfer.settlement_target_plant_id:
        company_payment = (
            db.query(models.CompanyPayment)
            .filter(
                models.CompanyPayment.source_shop_cash_transfer_id == transfer.id,
                models.CompanyPayment.status == "active",
            )
            .first()
        )
        if company_payment:
            company = db.query(models.Company).get(company_payment.company_id)
            if company:
                company.current_balance = company.current_balance + company_payment.amount
                if company_payment.excess_amount:
                    company.account_credit = company.account_credit - company_payment.excess_amount
                db.add(company)
            company_payment.status = "cancelled"
            db.add(company_payment)
    elif transfer.settlement_destination_type == "account" and transfer.settlement_account_id:
        account = db.query(models.PaymentAccount).get(transfer.settlement_account_id)
        if account:
            home_exp = db.query(models.Expense).filter(
                models.Expense.source_shop_cash_transfer_id == transfer.id, models.Expense.status == "active"
            ).first()
            drawing = db.query(models.OwnerDrawings).filter(
                models.OwnerDrawings.source_shop_cash_transfer_id == transfer.id, models.OwnerDrawings.status == "active"
            ).first()
            bypass_total = (home_exp.amount if home_exp else Decimal("0")) + (drawing.amount if drawing else Decimal("0"))
            net_amount = transfer.gross_amount - bypass_total
            if net_amount > 0:
                account.current_balance = account.current_balance - net_amount
                db.add(account)

    # § Salary payments are never clawed back — see utils.apply_salary_
    # expense_if_needed's docstring. Cancelling here only flips status,
    # never touches Employee.current_balance.
    for exp in db.query(models.Expense).filter(
        models.Expense.source_shop_cash_transfer_id == transfer.id, models.Expense.status == "active"
    ).all():
        exp.status = "cancelled"
        db.add(exp)
    for draw in db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_shop_cash_transfer_id == transfer.id, models.OwnerDrawings.status == "active"
    ).all():
        draw.status = "cancelled"
        db.add(draw)


# ---------- Shop list / create / detail ----------

@router.get("", response_model=list[schemas.ShopListRow])
def list_shops(db: Session = Depends(get_db)):
    shops = db.query(models.Customer).filter(models.Customer.customer_type == "shop").order_by(models.Customer.name).all()
    today = karachi_today_str()
    out = []
    for shop in shops:
        summary = _compute_stock_summary(db, shop.id, today)
        shop_account = get_or_create_shop_account(db, shop)
        last_dates = [shop.last_transaction_at]
        last_shop_sale = db.query(models.ShopSale).filter(models.ShopSale.customer_id == shop.id).order_by(models.ShopSale.created_at.desc()).first()
        if last_shop_sale:
            last_dates.append(last_shop_sale.created_at)
        last_dates = [d for d in last_dates if d]
        out.append(schemas.ShopListRow(
            customer=shop,
            current_stock=summary.total_closing_stock,
            today_load=summary.total_new_load,
            today_sales=summary.total_sales,
            current_balance=shop.current_balance,
            shop_cash_balance=shop_account.current_balance,
            last_activity=max(last_dates) if last_dates else None,
        ))
    db.commit()  # persists any Shop Cash accounts that were just lazily created
    return out


@router.post("", response_model=schemas.CustomerOut, status_code=201)
def create_shop(payload: schemas.CustomerCreate, db: Session = Depends(get_db)):
    """Creates a shop — a Customer row with customer_type="shop" (§ Shop
    Management: a Shop is a Customer, not a separate table). Reuses the
    exact same creation path as routers/customers.py's create_customer so
    display_id generation/validation never diverges between the two, then
    creates that shop's own Shop Cash account (§ Shop Cash Money Routing) —
    eagerly, so it's visible on the Cash Book from the moment the shop exists."""
    from app.routers.customers import create_customer as _create_customer_row
    payload.customer_type = "shop"
    shop = _create_customer_row(payload, db)
    get_or_create_shop_account(db, shop)
    db.commit()
    return shop


@router.get("/sales", response_model=list[schemas.ShopSaleOut])
def list_shop_sales(month: str | None = Query(None, description="YYYY-MM"), db: Session = Depends(get_db)):
    """Shop Sales across EVERY shop, not scoped to one — mirrors
    routers/sales.py's list_sales / routers/purchases.py's list_purchases
    exactly (active-only, in-Python month filter). Added for the
    Dashboard's Total Tonnage card (§ Dashboard), which needs
    ShopSale.quantity_kg summed across all shops for the period; no
    per-shop endpoint gave that without an N-shop loop.

    MUST be registered before GET /{shop_id} below — FastAPI/Starlette
    matches path routes in registration order, and a single-segment
    literal ("/sales") and a single-segment wildcard ("/{shop_id}") both
    syntactically match a request to /shops/sales, so whichever is
    registered first wins. Registering this after /{shop_id} would make
    it unreachable (every request would resolve to get_shop_detail with
    shop_id="sales" and 422 on the UUID parse instead) — caught via a
    dry-run of this exact scenario before wiring it up live."""
    rows = (
        db.query(models.ShopSale)
        .filter(models.ShopSale.status == "active")
        .order_by(models.ShopSale.date.desc(), models.ShopSale.created_at.desc())
        .all()
    )
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]

    # § Segregated Profit Centers (Dashboard) — Shop COGS. Reuses the exact
    # FIFO trail already recorded for stock/correction purposes
    # (ShopSaleBatchConsumption -> ShopStockBatch.load_rate_per_kg, the
    # Rs/physical-kg rate frozen at Load time — see routers/sales.py's
    # `load_rate_per_kg = rate_per_cylinder / product.weight_kg`). Never
    # re-derived or estimated: just summed from history, batched here to
    # avoid an N+1 query per sale.
    sale_ids = [r.id for r in rows]
    consumptions = (
        db.query(models.ShopSaleBatchConsumption)
        .filter(models.ShopSaleBatchConsumption.shop_sale_id.in_(sale_ids))
        .all()
        if sale_ids else []
    )
    batch_ids = {c.shop_stock_batch_id for c in consumptions}
    batches = (
        {b.id: b for b in db.query(models.ShopStockBatch).filter(models.ShopStockBatch.id.in_(batch_ids)).all()}
        if batch_ids else {}
    )
    product_ids = {b.product_id for b in batches.values()}
    products = (
        {p.id: p for p in db.query(models.Product).filter(models.Product.id.in_(product_ids)).all()}
        if product_ids else {}
    )
    cogs_by_sale: dict = {}
    for c in consumptions:
        batch = batches.get(c.shop_stock_batch_id)
        if not batch:
            continue
        product = products.get(batch.product_id)
        weight_kg = product.weight_kg if product else Decimal("0")
        cost = Decimal(c.quantity_consumed) * Decimal(weight_kg) * Decimal(batch.load_rate_per_kg)
        cogs_by_sale[c.shop_sale_id] = cogs_by_sale.get(c.shop_sale_id, Decimal("0")) + cost

    for r in rows:
        r.cogs_amount = cogs_by_sale.get(r.id, Decimal("0"))

    return rows


@router.get("/{shop_id}", response_model=schemas.ShopDetailOut)
def get_shop_detail(
    shop_id: UUID,
    date: str = Query(None, description="YYYY-MM-DD, defaults to today (Asia/Karachi)"),
    month: str = Query(None, description="YYYY-MM, defaults to the current month"),
    db: Session = Depends(get_db),
):
    shop = _get_shop(db, shop_id)
    business_date = date or karachi_today_str()
    month = month or business_date[:7]
    month_start = datetime.strptime(month, "%Y-%m")
    year, mo = month_start.year, month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)

    stock = _compute_stock_summary(db, shop_id, business_date)
    cash = _compute_cash_summary(db, shop, business_date)
    shop_account = get_or_create_shop_account(db, shop)
    db.commit()
    products = {p.id: p for p in db.query(models.Product).all()}
    companies = {c.id: c for c in db.query(models.Company).all()}
    accounts = {a.id: a for a in db.query(models.PaymentAccount).all()}

    transactions: list[schemas.ShopTransactionRow] = []

    loads = db.query(models.Sale).filter(
        models.Sale.customer_id == shop_id, models.Sale.status == "active", models.Sale.unified_sale_id.is_(None),
        models.Sale.date >= month_start, models.Sale.date < next_month,
    ).all()
    for s in loads:
        load_product = products.get(s.product_id)
        transactions.append(schemas.ShopTransactionRow(
            kind="load", date=s.date, ref_id=s.id, display_id=s.display_id,
            description=f"Load — {load_product.name if load_product else 'Product'} × {s.quantity}",
            quantity=s.quantity, load_rate_per_kg=s.rate_per_kg, amount=s.total_amount,
            # § Shop Statement — cylinder_weight was previously only set for
            # kind=="shop_sale", leaving a "load" row's cylinder type
            # recoverable only by parsing the free-text description above.
            # Populated here from the same product lookup that description
            # already uses, so the Shop Statement's Cylinder Type column can
            # read this structured field directly instead.
            cylinder_weight=load_product.weight_kg if load_product else None,
            entered_by=s.entered_by, status=s.status, correctable=True,
        ))

    payments = db.query(models.Payment).filter(
        models.Payment.customer_id == shop_id, models.Payment.status == "active", models.Payment.unified_sale_id.is_(None),
        models.Payment.date >= month_start, models.Payment.date < next_month,
    ).all()
    for p in payments:
        transactions.append(schemas.ShopTransactionRow(
            kind="payment", date=p.date, ref_id=p.id, display_id=p.display_id,
            description=f"Payment · {p.method}", amount=p.amount,
            entered_by=p.entered_by, status=p.status, correctable=True,
        ))

    # Payment Only mode / Supply Customer collections (§ Shop Business
    # Ledger's own customer_payment row — this Transaction History table
    # never queried ShopCustomerPayment at all, so one of these never
    # appeared here or on the Shop Statement PDF, which reuses this same
    # `transactions` list). Distinct from the "payment" kind above — that's
    # this shop's OWN payment toward its Dowa payable (models.Payment);
    # this is money the shop collected FROM one of its own supply
    # customers (models.ShopCustomerPayment), a completely different event.
    supply_customers = {c.id: c for c in db.query(models.ShopSupplyCustomer).filter(models.ShopSupplyCustomer.shop_id == shop_id).all()}
    customer_payments = db.query(models.ShopCustomerPayment).filter(
        models.ShopCustomerPayment.shop_id == shop_id, models.ShopCustomerPayment.status == "active",
        models.ShopCustomerPayment.date >= month_start, models.ShopCustomerPayment.date < next_month,
    ).all()
    for cp in customer_payments:
        sc = supply_customers.get(cp.supply_customer_id)
        transactions.append(schemas.ShopTransactionRow(
            kind="customer_payment", date=cp.date, ref_id=cp.id, display_id=cp.display_id,
            description=f"Payment from {sc.name if sc else (cp.supply_customer_label or 'Unknown')} · {cp.method}",
            amount=cp.amount, customer_name=sc.name if sc else (cp.supply_customer_label or "Unknown"),
            settlement_destination_type=cp.settlement_destination_type,
            settlement_target_plant_id=cp.settlement_target_plant_id,
            settlement_account_id=cp.settlement_account_id,
            settlement_home_expense_description=cp.settlement_home_expense_description,
            settlement_home_expense_category_id=cp.settlement_home_expense_category_id,
            settlement_home_expense_employee_id=cp.settlement_home_expense_employee_id,
            settlement_home_expense_amount=cp.settlement_home_expense_amount,
            settlement_owner_drawings_amount=cp.settlement_owner_drawings_amount,
            entered_by=cp.entered_by, status=cp.status, correctable=False,
        ))

    # Emergency Transfer Out (§ Shop — Emergency Transfer) — same Sale
    # model _compute_stock_summary above already deducts from this shop's
    # FIFO stock, but that Sale posts to the OTHER customer (Sale.customer_id
    # is the recipient, never this shop), so the "loads" query above
    # (filtered on customer_id == shop_id) never picks it up — it was
    # entirely invisible on this page's Recent Transactions/Activity
    # Register until now. Cash Impact is always Rs 0 by construction: this
    # Sale's amount posts to the recipient customer's own ledger (see
    # routers/ledger.py), never anything _compute_cash_summary reads (it
    # only ever queries ShopSale/ShopCustomerPayment/ShopExpenseTransaction/
    # Payment-from-shop-account/AccountTransfer — never models.Sale) — so
    # Shop Cash Balance is guaranteed untouched, nothing to compute here.
    transfers_out = db.query(models.Sale).filter(
        models.Sale.emergency_transfer_shop_id == shop_id, models.Sale.status == "active",
        models.Sale.date >= month_start, models.Sale.date < next_month,
    ).all()
    for s in transfers_out:
        transfer_product = products.get(s.product_id)
        product_name = transfer_product.name if transfer_product else "Product"
        recipient = db.query(models.Customer).get(s.customer_id)
        transactions.append(schemas.ShopTransactionRow(
            kind="emergency_transfer_out", date=s.date, ref_id=s.id, display_id=s.display_id,
            description=(
                f"Emergency Transfer Out — {product_name} × {s.quantity} "
                f"(to {recipient.name if recipient else 'customer'}) — Stock Transfer, no Shop Cash impact"
            ),
            quantity=-s.quantity, amount=Decimal("0"),
            # § Shop Statement — same structured-field fix as the "load"
            # loop above, so Cylinder Type never needs the description text.
            cylinder_weight=transfer_product.weight_kg if transfer_product else None,
            entered_by=s.entered_by, status=s.status, correctable=False,
        ))

    # § Multi-line Categorized Home Expense — selectinload(home_expense_lines)
    # avoids one extra SELECT per row below (each row reads s.home_expense_
    # lines to populate ShopTransactionRow/ShopBusinessLedgerRow), same
    # bulk-fetch convention the rest of this function already follows for
    # products/categories/companies/accounts.
    shop_sales = db.query(models.ShopSale).options(selectinload(models.ShopSale.home_expense_lines)).filter(
        models.ShopSale.customer_id == shop_id, models.ShopSale.status == "active",
        models.ShopSale.date >= month_start, models.ShopSale.date < next_month,
    ).all()
    for s in shop_sales:
        product_name = products.get(s.product_id).name if products.get(s.product_id) else "Product"
        qty_label = f"{s.quantity_kg} kg" if s.unit == "kg" and s.quantity_kg is not None else f"{s.quantity}"
        # § GST on Shop Sale — grand_total (GST-inclusive) is what
        # amount_received was actually bounded against at creation (see
        # _apply_shop_sale); using it here keeps received/outstanding
        # correct for a GST-enabled sale, and is identical to total_amount
        # for every non-GST sale (grand_total == total_amount when GST is off).
        received = s.amount_received if s.amount_received is not None else s.grand_total
        outstanding = s.grand_total - received
        # Keyed off outstanding > 0, not payment_type — a partially-paid
        # "cash" sale carries a real balance due exactly like a "credit"
        # sale, and the label should reflect that reality rather than the
        # dropdown value the cashier picked.
        credit_label = (
            (f" · CREDIT (partial: {received} paid, {outstanding} due)" if 0 < received < s.grand_total else " · CREDIT")
            + (f" ({_supply_name(s)})" if s.supply_customer_id else "")
        ) if outstanding > 0 else (
            f" · ADVANCE ({-outstanding} over)" + (f" ({_supply_name(s)})" if s.supply_customer_id else "")
        ) if outstanding < 0 else ""
        # Where the collected amount was routed (§ Settlement Routing) — the
        # shop-side counterpart to the plant ledger's payment-received row.
        # Null for a sale with nothing collected (all-credit) or a pre-
        # routing-change row. The human-readable label is resolved on the
        # frontend (see shops/[id]/page.tsx's resolveShopSaleRoutedLabel,
        # mirroring unified-sale/page.tsx's getDestinationLabel) so the two
        # pages can never drift.
        transactions.append(schemas.ShopTransactionRow(
            kind="shop_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
            description=f"Shop Sale — {product_name} × {qty_label}{credit_label}",
            quantity=s.quantity, board_rate_per_kg=s.board_rate_per_kg_used, cylinder_weight=s.cylinder_weight_used,
            sale_rate_per_cylinder=s.sale_rate_per_cylinder, amount=s.grand_total,
            gst_rate=s.gst_rate, gst_amount=s.gst_amount, discount_amount=s.discount_amount,
            home_expense_lines=s.home_expense_lines,
            amount_received=received, amount_outstanding=outstanding,
            # § Shop Statement — structured field for the same customer
            # name credit_label above already embeds into free text; "Walk-in
            # Customer" (not blank) when the sale named no supply customer.
            customer_name=_supply_name(s) if s.supply_customer_id else "Walk-in Customer",
            settlement_destination_type=s.settlement_destination_type,
            settlement_target_plant_id=s.settlement_target_plant_id,
            settlement_account_id=s.settlement_account_id,
            settlement_home_expense_description=s.settlement_home_expense_description,
            settlement_home_expense_category_id=s.settlement_home_expense_category_id,
            settlement_home_expense_employee_id=s.settlement_home_expense_employee_id,
            settlement_home_expense_amount=s.settlement_home_expense_amount,
            settlement_owner_drawings_amount=s.settlement_owner_drawings_amount,
            entered_by=s.entered_by, status=s.status, correctable=True,
        ))

    transactions.sort(key=lambda r: r.date, reverse=True)

    shop_sale_corrections = []
    corrected_shop_sales = db.query(models.ShopSale).filter(
        models.ShopSale.customer_id == shop_id, models.ShopSale.status == "corrected",
        models.ShopSale.corrected_at >= month_start, models.ShopSale.corrected_at < next_month,
    ).all()
    for s in corrected_shop_sales:
        replacement = db.query(models.ShopSale).filter(models.ShopSale.corrected_from_id == s.id).first()
        shop_sale_corrections.append(schemas.ShopSaleCorrectionRow(
            date=s.date, ref_id=s.id, display_id=s.display_id,
            description=f"Shop Sale × {s.quantity}", original_amount=s.grand_total,
            correction_reason=s.correction_reason or "", corrected_by=s.corrected_by or "",
            corrected_at=s.corrected_at, corrected_display_id=replacement.display_id if replacement else None,
        ))
    shop_sale_corrections.sort(key=lambda r: r.corrected_at, reverse=True)

    # Opening Cash corrections (§ Opening Balance) — the shop's Opening
    # Balance tile reads shop_account.opening_balance (NOT
    # customers.opening_balance/shop_opening_cash, the latter confirmed
    # dead), so its corrections come from a separate AuditLog lookup keyed
    # on the account id, merged with the customer-side corrections and
    # re-sorted together.
    corrections = _customer_corrections(db, shop_id, month_start, next_month) + _opening_balance_corrections(
        db, "shop_cash_account", shop_account.id, "shop_opening_cash", shop.display_id, month_start, next_month,
    )
    corrections.sort(key=lambda r: r.corrected_at, reverse=True)

    return schemas.ShopDetailOut(
        customer=shop,
        stock=stock,
        cash=cash,
        account=shop_account,
        transactions=transactions,
        corrections=corrections,
        shop_sale_corrections=shop_sale_corrections,
    )


@router.get("/{shop_id}/statement")
def shop_statement_pdf(
    shop_id: UUID,
    month: str = Query(..., description="YYYY-MM, e.g. 2026-08"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Read-only, on-demand PDF of the shop's full activity — every Load/
    Shop Sale/Payment/Emergency Transfer/Customer Payment, mirroring
    render_customer_statement_pdf/render_company_statement_pdf's "reuse the
    exact data the screen renders, never re-derive" guarantee: transactions
    come straight from get_shop_detail (the same call the Transaction
    History modal makes), the Dowa Balance comes straight from
    customer_monthly_ledger (a shop IS a Customer row — its Load/Payment
    are just ordinary Sale/Payment rows against it, so this is the exact
    same payable math the Customer Statement already uses, never
    recomputed here), and the Shop Cash figures come from
    _compute_cash_summary_range over the whole month (the exact same
    derive-from-history math the Shop Detail page's own daily Shop Cash
    tile uses, § Shop Statement — Dowa Payable vs Shop Cash). Shop Sale/
    Customer Payment/Emergency Transfer never touch the Dowa Balance, and
    Load/Payment (Dowa-side) never touch Shop Cash — two genuinely
    unrelated figures, never combined — see render_shop_statement_pdf's
    docstring."""
    shop = _get_shop(db, shop_id)
    detail = get_shop_detail(shop_id, date=None, month=month, db=db)
    ledger_summary = customer_monthly_ledger(shop_id, month, db)
    month_start = datetime.strptime(month, "%Y-%m")
    year, mo = month_start.year, month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)
    shop_cash_summary = _compute_cash_summary_range(db, shop, month_start, next_month)
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_shop_statement_pdf(
        shop, month, detail.transactions, ledger_summary, shop_cash_summary, current_user.name, generated_at,
    )
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="Statement-{shop.display_id}-{month}.pdf"'},
    )


# CORRECT OPENING CASH (§ Opening Balance) — a Shop's "Opening Balance"
# tile is neither Customer's nor Company's: it's derived (_compute_cash_
# summary above) from shop_account.opening_balance forward, NOT from
# customers.opening_balance/shop_opening_cash (the latter confirmed dead —
# grep across the repo shows it's never written, only declared). Same
# edit-in-place + delta-shift-current_balance + required-reason pattern as
# Customer/Company, just targeting the shop's own PaymentAccount row.
@router.patch("/{shop_id}/opening-cash", response_model=schemas.PaymentAccountOut)
def correct_shop_opening_cash(
    shop_id: UUID,
    payload: schemas.OpeningBalanceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required to correct the Opening Balance")

    account = get_or_create_shop_account(db, shop)
    old_value = account.opening_balance
    delta = payload.new_value - old_value
    account.opening_balance = payload.new_value
    account.current_balance = account.current_balance + delta
    db.add(account)
    log_audit(db, "shop_cash_account", account.id, "update", current_user.name,
              field="opening_balance", old=old_value, new=payload.new_value, reason=reason)
    db.commit()
    db.refresh(account)
    return account


@router.get("/{shop_id}/stock", response_model=schemas.ShopStockSummary)
def get_shop_stock(shop_id: UUID, date: str = Query(None, description="YYYY-MM-DD, defaults to today"), db: Session = Depends(get_db)):
    _get_shop(db, shop_id)
    return _compute_stock_summary(db, shop_id, date or karachi_today_str())


@router.get("/{shop_id}/batches", response_model=list[schemas.ShopStockBatchOut])
def list_shop_batches(
    shop_id: UUID,
    month: str = Query(None, description="YYYY-MM — optionally narrow to batches loaded in this month, for inspecting a past month's FIFO queue. Omit for the live/current queue (every active batch, any date)."),
    db: Session = Depends(get_db),
):
    """FIFO Breakdown table (Shop Detail UI) — read-only listing, never
    touches quantity_remaining or the consumption engine itself (see
    _apply_shop_sale/_reverse_shop_sale, the sole authority on both). The
    `month` filter only narrows WHICH batches are listed (by
    transaction_date) — quantity_remaining/quantity_consumed on any
    returned row are always today's live values (there is no point-in-time
    snapshot of a batch's past remaining quantity to reconstruct), so
    filtering to a past month shows that month's batches with their
    CURRENT state, not a historical reconstruction. Never mutates
    anything — filtering here can't alter the live operational balances
    it's reading."""
    _get_shop(db, shop_id)
    q = db.query(models.ShopStockBatch).filter(
        models.ShopStockBatch.customer_id == shop_id, models.ShopStockBatch.status == "active"
    )
    if month:
        month_start = datetime.strptime(month, "%Y-%m")
        next_month = datetime(month_start.year + 1, 1, 1) if month_start.month == 12 else datetime(month_start.year, month_start.month + 1, 1)
        q = q.filter(models.ShopStockBatch.transaction_date >= month_start, models.ShopStockBatch.transaction_date < next_month)

    # Deterministic FIFO-priority ordering — exactly the tie-break the
    # consumption engine itself uses (transaction_date, created_at), plus
    # `id` as a final guaranteed-unique tie-breaker for display purposes
    # only (the consumption query's own ordering, routers/shops.py's
    # _apply_shop_sale, is untouched by this).
    batches = q.order_by(
        models.ShopStockBatch.transaction_date.asc(),
        models.ShopStockBatch.created_at.asc(),
        models.ShopStockBatch.id.asc(),
    ).all()

    products = {p.id: p for p in db.query(models.Product).all()}
    sale_ids = {b.source_sale_id for b in batches if b.source_sale_id}
    sales = {s.id: s for s in db.query(models.Sale).filter(models.Sale.id.in_(sale_ids)).all()} if sale_ids else {}

    out = []
    for b in batches:
        row = schemas.ShopStockBatchOut.model_validate(b)
        product = products.get(b.product_id)
        row.product_name = product.name if product else None
        source_sale = sales.get(b.source_sale_id) if b.source_sale_id else None
        row.source_display_id = source_sale.display_id if source_sale else None
        out.append(row)
    return out


@router.post("/{shop_id}/stock-batches", response_model=schemas.ShopStockBatchOut, status_code=201)
def create_manual_stock_batch(
    shop_id: UUID, payload: schemas.ShopStockBatchCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Add Filled Cylinder Stock — see schemas.ShopStockBatchCreate. The
    only ShopStockBatch creation path with no backing Sale (source_sale_id
    stays NULL, source_type="manual_add"): it adds physical stock only,
    exactly like Add Empty Cylinder (routers/cylinder_returns.py,
    mode="manual_add") does for the empty-cylinder side. load_rate_per_kg
    is resolved from the Board Rate in effect on the entry date purely for
    historical record-keeping — see ShopStockBatch.load_rate_per_kg's
    docstring: it is NEVER used to price a ShopSale.

    § Add Filled Cylinder Stock, one-time-only — restricted to ONE use per
    shop (initial onboarding stock entry only), permanently disabled after
    (Customer.initial_stock_added flips true on first success). This is a
    deliberate scope narrowing: this endpoint previously also doubled as an
    ad-hoc "manual correction" path with no other use restriction — that
    use case has no replacement now and is simply gone for any shop that
    already completed onboarding."""
    shop = _get_shop(db, shop_id)
    if shop.initial_stock_added:
        raise HTTPException(400, "Initial stock has already been added for this shop — this is a one-time action")
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be positive")

    date = payload.date or datetime.utcnow()
    board_rate = resolve_board_rate(db, date)

    batch = models.ShopStockBatch(
        customer_id=shop.id,
        product_id=payload.product_id,
        source_sale_id=None,
        source_type="manual_add",
        transaction_date=date,
        quantity_received=payload.quantity,
        quantity_remaining=payload.quantity,
        load_rate_per_kg=board_rate.rate_per_kg,
        notes=payload.notes,
        status="active",
        entered_by=current_user.name,
    )
    db.add(batch)
    shop.initial_stock_added = True
    db.add(shop)
    db.commit()
    db.refresh(batch)
    return batch


@router.patch("/stock-batches/{batch_id}/cancel", response_model=schemas.ShopStockBatchOut)
def cancel_manual_stock_batch(batch_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    """Undo a manual stock-batch add (create_manual_stock_batch above).
    Never touches a Load-derived batch (source_type == "load") — reversing
    one of those is Sale-cancellation's job (_reverse_sale in
    routers/sales.py), which also unwinds the Customer.current_balance/
    Purchase-side effects a plain status flip here would miss entirely.
    Blocked once any of this batch has actually been sold (quantity_
    remaining < quantity_received) — pulling stock out from under an
    already-consumed ShopSale would silently break that sale's own FIFO
    consumption record."""
    batch = db.query(models.ShopStockBatch).get(batch_id)
    if not batch:
        raise HTTPException(404, "Stock batch not found")
    if batch.source_type != "manual_add":
        raise HTTPException(400, "Only a manually-added stock batch can be cancelled this way")
    if batch.status != "active":
        raise HTTPException(400, "Stock batch is already cancelled")
    if batch.quantity_remaining < batch.quantity_received:
        raise HTTPException(400, "Cannot cancel — some of this batch has already been sold")

    batch.status = "cancelled"
    batch.modified_at = datetime.utcnow()
    batch.modified_by = by
    db.add(batch)

    # § Add Filled Cylinder Stock, one-time-only — cancelling undoes the
    # "used" state too, so a fat-fingered entry (wrong product/quantity)
    # isn't a permanent lockout: the shop's one allowed use becomes
    # available again. Never touches a shop whose flag is already false
    # (nothing to undo).
    shop = db.query(models.Customer).get(batch.customer_id)
    if shop and shop.initial_stock_added:
        shop.initial_stock_added = False
        db.add(shop)

    db.commit()
    db.refresh(batch)
    return batch


# ---------- Shop Sales ----------

@router.get("/sales/{sale_id}", response_model=schemas.ShopSaleOut)
def get_shop_sale(sale_id: UUID, db: Session = Depends(get_db)):
    sale = db.query(models.ShopSale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Shop sale not found")
    return sale


@router.get("/sales/{sale_id}/invoice")
def get_shop_sale_invoice(
    sale_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Read-only, on-demand invoice PDF (Part B) — never stored to disk.
    See get_sale_invoice in routers/sales.py for why a corrected record
    always renders its own current values."""
    sale = db.query(models.ShopSale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Shop sale not found")
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_shop_sale_invoice_pdf(sale, current_user.name, generated_at)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{sale.display_id}.pdf"'},
    )


@router.post("/{shop_id}/sales", response_model=schemas.ShopSaleOut, status_code=201)
def create_shop_sale(
    shop_id: UUID, payload: schemas.ShopSaleCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    sale = _apply_shop_sale(db, shop, payload, current_user.name)
    db.commit()
    db.refresh(sale)
    return sale


@router.patch("/sales/{sale_id}/cancel", response_model=schemas.ShopSaleOut)
def cancel_shop_sale(sale_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    sale = db.query(models.ShopSale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Shop sale not found")
    if sale.status != "active":
        raise HTTPException(400, "Shop sale is already cancelled")
    _reverse_shop_sale(db, sale)
    sale.status = "cancelled"
    sale.modified_at = datetime.utcnow()
    sale.modified_by = by
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.patch("/sales/{sale_id}/correct", response_model=schemas.ShopSaleOut)
def correct_shop_sale(
    sale_id: UUID, payload: schemas.ShopSaleCorrect, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Ledger Correction, same reverse-then-reapply pattern as
    correct_sale/correct_payment/correct_purchase/correct_company_payment.
    Correcting the date legitimately re-resolves the Board Rate for the
    corrected date — that's expected (§14), not a bug."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.ShopSale).get(sale_id)
    if not original:
        raise HTTPException(404, "Shop sale not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active shop sale can be corrected")

    shop = db.query(models.Customer).get(original.customer_id)

    _reverse_shop_sale(db, original)

    original.status = "corrected"
    original.corrected_by = current_user.name
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_shop_sale(db, shop, payload, current_user.name)
    corrected.corrected_from_id = original.id
    db.add(corrected)

    db.commit()
    db.refresh(corrected)
    return corrected


# ============================================================
# Shop Business Finance (Engine 3, §19-§26) — the shop's own cash/customer
# books. Deliberately separate endpoints from everything above: nothing
# here ever touches Customer.current_balance (the Dowa receivable) or the
# Customer Ledger. A Supply Customer credit sale is still just a ShopSale
# (see _apply_shop_sale's supply_customer_id/payment_type handling above)
# so it still prices off the Board Rate and draws down FIFO stock exactly
# like any other Shop Sale — only the cash-vs-receivable destination differs.
# ============================================================

# ---------- Shop Cash Transfer ----------

@router.post("/{shop_id}/cash-transfers", response_model=schemas.ShopCashTransferOut, status_code=201)
def create_shop_cash_transfer(
    shop_id: UUID, payload: schemas.ShopCashTransferCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    transfer = _apply_shop_cash_transfer(db, shop, payload, current_user.name)
    db.commit()
    db.refresh(transfer)
    return transfer


@router.patch("/cash-transfers/{transfer_id}/cancel", response_model=schemas.ShopCashTransferOut)
def cancel_shop_cash_transfer(transfer_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    transfer = db.query(models.ShopCashTransfer).get(transfer_id)
    if not transfer:
        raise HTTPException(404, "Shop cash transfer not found")
    if transfer.status != "active":
        raise HTTPException(400, "Shop cash transfer is already cancelled")
    _reverse_shop_cash_transfer(db, transfer)
    transfer.status = "cancelled"
    transfer.modified_at = datetime.utcnow()
    transfer.modified_by = by
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return transfer


# ---------- Supply Customers ----------

@router.get("/{shop_id}/customers", response_model=list[schemas.ShopSupplyCustomerOut])
def list_supply_customers(shop_id: UUID, db: Session = Depends(get_db)):
    _get_shop(db, shop_id)
    return (
        db.query(models.ShopSupplyCustomer)
        .filter(models.ShopSupplyCustomer.shop_id == shop_id)
        .order_by(models.ShopSupplyCustomer.name)
        .all()
    )


@router.post("/{shop_id}/customers", response_model=schemas.ShopSupplyCustomerOut, status_code=201)
def create_supply_customer(
    shop_id: UUID, payload: schemas.ShopSupplyCustomerCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    customer = models.ShopSupplyCustomer(
        shop_id=shop.id, name=payload.name, mobile=payload.mobile, address=payload.address,
        opening_balance=payload.opening_balance, current_balance=payload.opening_balance,
        status="active", entered_by=current_user.name,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


def _supply_name(row) -> str:
    """A ShopSale's supply customer name — the live row while it exists,
    otherwise the permanent snapshot Delete Supply Customer left behind
    (row.supply_customer is None for a deleted customer, so reading .name
    off it directly would crash the whole shop page)."""
    return (row.supply_customer.name if row.supply_customer else row.supply_customer_label) or "Unknown"


@router.delete("/customers/{supply_customer_id}")
def delete_supply_customer(
    supply_customer_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_owner),
):
    """Delete a shop's own (supply) customer — hard-deletes the customer row
    and writes off whatever they currently owe (or hold as advance).
    Every past ShopSale/ShopCustomerPayment/ShopExpenseTransaction stays
    exactly as it was, keeping its supply_customer_id and gaining a
    permanent supply_customer_label so ledgers still read "Credit Sale to
    <name>". Cash already collected into Shop Cash is real money that
    already moved and is never touched. Cancelling/correcting one of those
    old sales or payments still works — those paths already skip a missing
    customer's balance. Owner-only, no password gate; nothing on a supply
    customer is ever "pending", so there is no pending guard."""
    sc = db.query(models.ShopSupplyCustomer).get(supply_customer_id)
    if not sc:
        raise HTTPException(404, "Customer not found")
    written_off = {"current_balance": str(sc.current_balance)}
    label = sc.name
    try:
        for model in (models.ShopSale, models.ShopCustomerPayment, models.ShopExpenseTransaction):
            db.query(model).filter(model.supply_customer_id == supply_customer_id).update(
                {model.supply_customer_label: label}, synchronize_session=False,
            )
        log_audit(
            db, "shop_supply_customer", sc.id, "delete", current_user.name,
            field="written_off", old=json.dumps(written_off), new="0",
            reason=f"Deleted shop customer {label}; outstanding balance written off",
        )
        db.delete(sc)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(400, f"Cannot delete — this customer is still referenced by records this delete does not cover: {e.orig}")
    return {"deleted": True, "name": label, "written_off": written_off}


@router.get("/customers/{supply_customer_id}", response_model=schemas.ShopSupplyCustomerOut)
def get_supply_customer(supply_customer_id: UUID, db: Session = Depends(get_db)):
    customer = db.query(models.ShopSupplyCustomer).get(supply_customer_id)
    if not customer:
        raise HTTPException(404, "Supply customer not found")
    return customer


@router.get("/customers/{supply_customer_id}/ledger", response_model=schemas.ShopSupplyCustomerLedgerOut)
def get_supply_customer_ledger(supply_customer_id: UUID, db: Session = Depends(get_db)):
    """All-time running-balance ledger for one shop's own supply customer —
    the shop-scoped mirror of GET /ledger/customer/{id}, scaled down to this
    customer's own two event kinds (ShopSale, ShopCustomerPayment) and with
    no month scoping (ShopSupplyCustomer carries a single opening_balance,
    not a month-anchored one like Customer.opening_balance_month). Reads
    only ShopSale/ShopCustomerPayment rows tied to this supply_customer_id —
    never touches models.Customer, Sale, Payment, or the real Customer
    Ledger (see the Shop Business Finance module docstring above)."""
    customer = db.query(models.ShopSupplyCustomer).get(supply_customer_id)
    if not customer:
        raise HTTPException(404, "Supply customer not found")

    sales = (
        db.query(models.ShopSale)
        .options(selectinload(models.ShopSale.home_expense_lines))
        .filter(models.ShopSale.supply_customer_id == supply_customer_id, models.ShopSale.status == "active")
        .order_by(models.ShopSale.date)
        .all()
    )
    payments = (
        db.query(models.ShopCustomerPayment)
        .filter(models.ShopCustomerPayment.supply_customer_id == supply_customer_id, models.ShopCustomerPayment.status == "active")
        .order_by(models.ShopCustomerPayment.date)
        .all()
    )
    products = {p.id: p for p in db.query(models.Product).all()}

    events = (
        [{"date": s.date, "kind": "sale", "obj": s} for s in sales]
        + [{"date": p.date, "kind": "payment", "obj": p} for p in payments]
    )
    events.sort(key=lambda e: e["date"])

    rows: list[schemas.ShopSupplyCustomerLedgerRow] = []
    running = customer.opening_balance
    total_sales = Decimal("0")
    total_payments = Decimal("0")
    # Cash actually collected AT THE MOMENT OF SALE (a full cash sale, or
    # the inline-settled portion of a credit sale) — tracked separately
    # from total_payments (genuine ShopCustomerPayment rows) so the two
    # summary tiles keep their own distinct meaning: total_sales -
    # total_payments still reconciles exactly to (closing - opening), which
    # would break if collected-at-sale cash were folded into total_payments
    # (it never touched running_balance to begin with — seeing it as
    # "outstanding" already nets it out).
    total_collected_at_sale = Decimal("0")

    for e in events:
        if e["kind"] == "sale":
            s: models.ShopSale = e["obj"]
            # Same convention as _apply_shop_sale/_reverse_shop_sale above —
            # only the OUTSTANDING remainder ever posts to this customer's
            # balance, keyed off the amount actually outstanding rather than
            # payment_type (a partially-paid "cash" sale contributes exactly
            # like a "credit" one). Every event in this loop already belongs
            # to this one supply customer's own ledger, so outstanding is 0
            # for any sale fully collected at the time (cash or credit).
            collected_now = s.amount_received if s.amount_received is not None else Decimal("0")
            # § GST on Shop Sale — grand_total (GST-inclusive), matching
            # what actually posts to this same customer's current_balance
            # in _apply_shop_sale/_reverse_shop_sale; identical to
            # total_amount for every non-GST sale.
            outstanding = s.grand_total - collected_now
            contribution = outstanding
            running += contribution
            total_sales += contribution
            total_collected_at_sale += collected_now
            product = products.get(s.product_id)
            unit_label = "KG" if s.unit == "kg" else "Cylinder"
            qty = s.quantity_kg if s.unit == "kg" and s.quantity_kg is not None else s.quantity
            description = f"{product.name if product else 'Product'} × {qty} {unit_label}"
            # Rate column (Bug 3) — sale_rate_per_cylinder is always the
            # FULL-CYLINDER price regardless of what unit was actually sold
            # in; for a unit="kg" row that reads as an incoherent number
            # next to a "X.XX KG" quantity (e.g. Rs 17,100 next to "1.00
            # KG"). Show the per-KG rate the sale actually priced off
            # (board_rate_per_kg_used) for kg rows, matching the unit the
            # quantity column already shows.
            rate = s.board_rate_per_kg_used if s.unit == "kg" else s.sale_rate_per_cylinder
            rows.append(schemas.ShopSupplyCustomerLedgerRow(
                date=s.date, kind="sale", ref_id=s.id, display_id=s.display_id,
                # Payment column (Bug 2) — cash actually collected at the
                # point of sale now shows as its own visible figure instead
                # of being silently netted into the outstanding/sale_amount
                # calc with no trace. Never subtracted again from
                # running_balance here — outstanding above already excludes
                # it, so this is purely informational, not double-counted.
                description=description, sale_amount=contribution, payment_amount=collected_now,
                running_balance=running, rate=rate, entered_by=s.entered_by,
                # § Supply Customer Statement — same structured fields as
                # the description text above, exposed directly.
                gross_amount=s.grand_total, cylinder_weight=product.weight_kg if product else None,
                quantity=qty, unit=s.unit, board_rate_per_kg=s.board_rate_per_kg_used,
                gst_rate=s.gst_rate, gst_amount=s.gst_amount, discount_amount=s.discount_amount,
                # Settlement breakdown of what was collected at the sale
                # (Expense / Owner Drawings / Plant / Account) — same fields
                # and same source (the ShopSale itself) the shop's own
                # Business Ledger uses for this exact sale.
                settlement_destination_type=s.settlement_destination_type,
                settlement_target_plant_id=s.settlement_target_plant_id,
                settlement_account_id=s.settlement_account_id,
                settlement_home_expense_description=s.settlement_home_expense_description,
                settlement_home_expense_category_id=s.settlement_home_expense_category_id,
                settlement_home_expense_employee_id=s.settlement_home_expense_employee_id,
                settlement_home_expense_amount=s.settlement_home_expense_amount,
                settlement_owner_drawings_amount=s.settlement_owner_drawings_amount,
                home_expense_lines=s.home_expense_lines,
            ))
        else:
            p: models.ShopCustomerPayment = e["obj"]
            running -= p.amount
            total_payments += p.amount
            description = f"Payment · {p.method}"
            # Advance/overpayment (Bug 4) — same excess_amount convention as
            # Payment/CompanyPayment; running_balance going negative here IS
            # the advance (never clamped to zero), this note just makes an
            # overpaying transaction legible in the ledger the same way it
            # already is on the Payment record itself.
            if p.excess_amount:
                description += f" (Rs {p.excess_amount:,.0f} advance)"
            rows.append(schemas.ShopSupplyCustomerLedgerRow(
                date=p.date, kind="payment", ref_id=p.id, display_id=p.display_id,
                description=description, sale_amount=Decimal("0"), payment_amount=p.amount,
                running_balance=running, rate=None, entered_by=p.entered_by,
                # Settlement Routing (§ Payment Only mode) — same fields
                # ShopBusinessLedgerRow's customer_payment row now carries;
                # this schema never had them at all until now.
                settlement_destination_type=p.settlement_destination_type,
                settlement_target_plant_id=p.settlement_target_plant_id,
                settlement_account_id=p.settlement_account_id,
                settlement_home_expense_description=p.settlement_home_expense_description,
                settlement_home_expense_category_id=p.settlement_home_expense_category_id,
                settlement_home_expense_employee_id=p.settlement_home_expense_employee_id,
                settlement_home_expense_amount=p.settlement_home_expense_amount,
                settlement_owner_drawings_amount=p.settlement_owner_drawings_amount,
            ))

    # Latest transaction first (top) to oldest (bottom). running_balance was
    # accumulated oldest-first above and stays attached to its own row, so
    # every figure is unchanged — only the presentation order flips. This
    # one reversal feeds both the on-screen ledger and the statement PDF.
    rows.reverse()

    return schemas.ShopSupplyCustomerLedgerOut(
        customer=customer, opening_balance=customer.opening_balance,
        total_sales=total_sales, total_payments=total_payments,
        total_collected_at_sale=total_collected_at_sale,
        total_transactions=len(rows), closing_balance=running, rows=rows,
    )


@router.get("/customers/{supply_customer_id}/statement")
def supply_customer_statement_pdf(
    supply_customer_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Read-only, on-demand PDF of the same all-time ledger the Supply
    Customer Ledger modal shows — mirrors shop_statement_pdf/company_
    statement_pdf's "reuse the exact data the screen renders, never
    re-derive" guarantee: calls get_supply_customer_ledger directly (a
    plain function call — its own @router.get decorator returns it
    unchanged)."""
    ledger = get_supply_customer_ledger(supply_customer_id, db)
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_supply_customer_statement_pdf(ledger.customer, ledger, current_user.name, generated_at)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        # ShopSupplyCustomer has no display_id (deliberately — see its own
        # model docstring: no Dowa-shared sequence), so the filename uses
        # its name instead, same convention as render_company_statement_
        # pdf's filename (a Company has no display_id either).
        headers={"Content-Disposition": f'inline; filename="Statement-{ledger.customer.name}.pdf"'},
    )


# ---------- Supply Customer Payments ----------

# Payment Only mode (Record Shop Sale, §5) — a supply customer paying the
# shop with nothing collected in-person. Mirrors _apply_shop_sale's
# settlement branch (money being COLLECTED, i.e. new, same as a sale's
# amount_received) rather than _apply_shop_cash_transfer's (money drawn
# down from an EXISTING stored balance) — there is no PaymentAccount being
# debited here, so no balance-safety check applies; the only safety check
# that DOES apply everywhere settlement routing is used is bypass_sum
# (Home Expense + Owner Drawings) never exceeding the amount itself.
def _apply_customer_payment(
    db: Session, shop: models.Customer, customer: models.ShopSupplyCustomer,
    payload: schemas.ShopCustomerPaymentCreate, entered_by: str,
) -> models.ShopCustomerPayment:
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    if payload.shop_sale_id:
        linked_sale = db.query(models.ShopSale).get(payload.shop_sale_id)
        if not linked_sale or linked_sale.customer_id != shop.id:
            raise HTTPException(404, "Linked shop sale not found for this shop")

    use_settlement_routing = payload.destination_type is not None
    account = None
    settlement_destination_type = None
    settlement_target_plant_id = None
    settlement_account_row = None
    settlement_net_amount = Decimal("0")

    if use_settlement_routing:
        bypass_sum = payload.home_expense_amount + payload.owner_drawings_amount
        if bypass_sum > payload.amount + Decimal("0.01"):
            raise HTTPException(400, "Expense + owner drawings exceeds the amount collected")
        # Employee Salary Tracking (§ Employee Salary Tracking)
        if payload.home_expense_amount > 0 and is_salary_category(db, payload.home_expense_category_id) and not payload.home_expense_employee_id:
            raise HTTPException(400, "Employee is required when Expense category is Salary")
        settlement_net_amount = payload.amount - payload.home_expense_amount - payload.owner_drawings_amount
        settlement_destination_type, settlement_target_plant_id, settlement_account_row, _ = resolve_settlement_destination(
            db, payload.destination_type, payload.target_plant_id, payload.settlement_account_id, settlement_net_amount, shop=shop
        )
    else:
        # Legacy plain path (RecordSupplyCustomerPaymentModal) — byte-for-byte
        # unchanged behavior: defaults to the shop's own account, same
        # account choices as elsewhere.
        if payload.account_id:
            account = db.query(models.PaymentAccount).get(payload.account_id)
            if not account:
                raise HTTPException(404, "Account not found")
        else:
            account = get_or_create_shop_account(db, shop)

    # Advance/overpayment (Bug 4) — same convention as Payment.excess_amount
    # (routers/payments.py::_apply_payment), and computed identically
    # regardless of path: it's about the customer's receivable, not where
    # the money physically routes. current_balance going negative below
    # already IS the advance (never clamped to zero); this is purely the
    # audit-trail record of that.
    excess = payload.amount - customer.current_balance
    excess_amount = excess if excess > 0 else None

    payment = models.ShopCustomerPayment(
        display_id=next_display_id(db, models.ShopCustomerPayment, "SHCPAY", width=6),
        date=payload.date, shop_id=shop.id, supply_customer_id=customer.id,
        shop_sale_id=payload.shop_sale_id,
        account_id=account.id if account else None,
        amount=payload.amount, method=payload.method, notes=payload.notes,
        excess_amount=excess_amount,
        status="active", entered_by=entered_by,
        settlement_home_expense_amount=payload.home_expense_amount if use_settlement_routing else None,
        settlement_owner_drawings_amount=payload.owner_drawings_amount if use_settlement_routing else None,
    )
    db.add(payment)
    db.flush()

    customer.current_balance = customer.current_balance - payload.amount
    db.add(customer)

    if use_settlement_routing:
        apply_settlement_routing(
            db, payload.date, payload.home_expense_amount, payload.home_expense_category_id,
            payload.owner_drawings_amount, settlement_destination_type, settlement_target_plant_id,
            settlement_account_row, settlement_net_amount, entered_by, None, f"Shop Customer Payment {payment.display_id}",
            source_shop_customer_payment_id=payment.id,
            home_expense_employee_id=payload.home_expense_employee_id,
        )
        # Flush BEFORE re-querying for the rows apply_settlement_routing just
        # created — the session is autoflush=False (see app.database.
        # SessionLocal), so without this the query below runs against the
        # database as it was before those adds and silently finds nothing,
        # leaving shop_id un-tagged (the exact bug already found and fixed
        # in _apply_shop_sale/_apply_shop_cash_transfer).
        db.flush()
        payment.settlement_destination_type = settlement_destination_type
        payment.settlement_account_id = settlement_account_row.id if settlement_account_row else None
        payment.settlement_target_plant_id = settlement_target_plant_id
        # § Home Expense category reversion — category_id/employee_id
        # replace the old free-text description going forward.
        payment.settlement_home_expense_category_id = (
            payload.home_expense_category_id if payload.home_expense_amount > 0 else None
        )
        payment.settlement_home_expense_employee_id = (
            payload.home_expense_employee_id if payload.home_expense_amount > 0 else None
        )
        for bypass_row in db.query(models.Expense).filter(
            models.Expense.source_shop_customer_payment_id == payment.id,
        ).all() + db.query(models.OwnerDrawings).filter(
            models.OwnerDrawings.source_shop_customer_payment_id == payment.id,
        ).all():
            bypass_row.shop_id = shop.id
            db.add(bypass_row)
    else:
        account.current_balance = account.current_balance + payload.amount
        db.add(account)

    db.add(payment)
    return payment


def _reverse_customer_payment_settlement(db: Session, payment: models.ShopCustomerPayment) -> None:
    if payment.settlement_destination_type == "plant" and payment.settlement_target_plant_id:
        company_payment = (
            db.query(models.CompanyPayment)
            .filter(
                models.CompanyPayment.source_shop_customer_payment_id == payment.id,
                models.CompanyPayment.status == "active",
            )
            .first()
        )
        if company_payment:
            company = db.query(models.Company).get(company_payment.company_id)
            if company:
                company.current_balance = company.current_balance + company_payment.amount
                if company_payment.excess_amount:
                    company.account_credit = company.account_credit - company_payment.excess_amount
                db.add(company)
            company_payment.status = "cancelled"
            db.add(company_payment)
    elif payment.settlement_destination_type == "account" and payment.settlement_account_id:
        account = db.query(models.PaymentAccount).get(payment.settlement_account_id)
        if account:
            home_exp = db.query(models.Expense).filter(
                models.Expense.source_shop_customer_payment_id == payment.id, models.Expense.status == "active"
            ).first()
            drawing = db.query(models.OwnerDrawings).filter(
                models.OwnerDrawings.source_shop_customer_payment_id == payment.id, models.OwnerDrawings.status == "active"
            ).first()
            bypass_total = (home_exp.amount if home_exp else Decimal("0")) + (drawing.amount if drawing else Decimal("0"))
            net_amount = payment.amount - bypass_total
            if net_amount > 0:
                account.current_balance = account.current_balance - net_amount
                db.add(account)

    # § Salary payments are never clawed back — see utils.apply_salary_
    # expense_if_needed's docstring. Cancelling here only flips status,
    # never touches Employee.current_balance.
    for exp in db.query(models.Expense).filter(
        models.Expense.source_shop_customer_payment_id == payment.id, models.Expense.status == "active"
    ).all():
        exp.status = "cancelled"
        db.add(exp)
    for draw in db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_shop_customer_payment_id == payment.id, models.OwnerDrawings.status == "active"
    ).all():
        draw.status = "cancelled"
        db.add(draw)


@router.post("/{shop_id}/customers/{supply_customer_id}/payments", response_model=schemas.ShopCustomerPaymentOut, status_code=201)
def create_customer_payment(
    shop_id: UUID, supply_customer_id: UUID, payload: schemas.ShopCustomerPaymentCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    customer = db.query(models.ShopSupplyCustomer).get(supply_customer_id)
    if not customer or customer.shop_id != shop.id:
        raise HTTPException(404, "Supply customer not found for this shop")
    payment = _apply_customer_payment(db, shop, customer, payload, current_user.name)
    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/customer-payments/{payment_id}/cancel", response_model=schemas.ShopCustomerPaymentOut)
def cancel_customer_payment(payment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    payment = db.query(models.ShopCustomerPayment).get(payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status != "active":
        raise HTTPException(400, "Payment is already cancelled")
    customer = db.query(models.ShopSupplyCustomer).get(payment.supply_customer_id)
    if customer:
        customer.current_balance = customer.current_balance + payment.amount
        db.add(customer)
    if payment.settlement_destination_type:
        _reverse_customer_payment_settlement(db, payment)
    elif payment.account_id:
        account = db.query(models.PaymentAccount).get(payment.account_id)
        if account:
            account.current_balance = account.current_balance - payment.amount
            db.add(account)
    payment.status = "cancelled"
    payment.modified_at = datetime.utcnow()
    payment.modified_by = by
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


# ---------- Expense Transactions (multi-line, §20-21) ----------

def _expense_txn_to_out(db: Session, txn: models.ShopExpenseTransaction) -> schemas.ShopExpenseTransactionOut:
    lines = db.query(models.ShopExpenseLine).filter(models.ShopExpenseLine.expense_transaction_id == txn.id).all()
    categories = {c.id: c for c in db.query(models.ExpenseCategory).all()}
    employee_ids = {l.employee_id for l in lines if l.employee_id}
    employees = (
        {e.id: e for e in db.query(models.Employee).filter(models.Employee.id.in_(employee_ids)).all()}
        if employee_ids else {}
    )
    line_outs = [
        schemas.ShopExpenseLineOut(
            id=l.id, category_id=l.category_id,
            category_name=categories.get(l.category_id).name if categories.get(l.category_id) else None,
            line_type=l.line_type, amount=l.amount, description=l.description,
            employee_id=l.employee_id,
            employee_name=employees[l.employee_id].name if l.employee_id in employees else None,
        )
        for l in lines
    ]
    # Attribution (§ Shop Expense/Withdrawal Attribution) — null on both
    # unless the form this was entered from actually had that context; see
    # ShopExpenseTransactionCreate.supply_customer_id/shop_sale_id.
    customer = db.query(models.ShopSupplyCustomer).get(txn.supply_customer_id) if txn.supply_customer_id else None
    sale = db.query(models.ShopSale).get(txn.shop_sale_id) if txn.shop_sale_id else None
    return schemas.ShopExpenseTransactionOut(
        id=txn.id, display_id=txn.display_id, date=txn.date, shop_id=txn.shop_id,
        total_amount=txn.total_amount, account_id=txn.account_id,
        payment_source=txn.payment_source, notes=txn.notes,
        supply_customer_id=txn.supply_customer_id, customer_name=customer.name if customer else txn.supply_customer_label,
        shop_sale_id=txn.shop_sale_id, shop_sale_display_id=sale.display_id if sale else None,
        status=txn.status, entered_by=txn.entered_by, created_at=txn.created_at, lines=line_outs,
    )


@router.get("/{shop_id}/expenses", response_model=list[schemas.ShopExpenseTransactionOut])
def list_shop_expenses(shop_id: UUID, month: str = Query(None, description="YYYY-MM"), db: Session = Depends(get_db)):
    _get_shop(db, shop_id)
    rows = (
        db.query(models.ShopExpenseTransaction)
        .filter(models.ShopExpenseTransaction.shop_id == shop_id, models.ShopExpenseTransaction.status == "active")
        .order_by(models.ShopExpenseTransaction.date.desc())
        .all()
    )
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return [_expense_txn_to_out(db, r) for r in rows]


@router.post("/{shop_id}/expenses", response_model=schemas.ShopExpenseTransactionOut, status_code=201)
def create_shop_expense(
    shop_id: UUID, payload: schemas.ShopExpenseTransactionCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """One atomic cash-out event with 1+ categorized lines (§20-21) — a
    single owner cash withdrawal split into Fuel/Salary/Home is ONE
    transaction, never N separate ones. line_type distinguishes genuine
    Business Expenses from Owner Withdrawals (§23) even when mixed in the
    same submission; both reduce Shop Cash identically."""
    shop = _get_shop(db, shop_id)
    if not payload.lines:
        raise HTTPException(400, "At least one expense line is required")
    for line in payload.lines:
        if line.amount <= 0:
            raise HTTPException(400, "Every line amount must be positive")
        # A Category classifies an EXPENSE — an Owner Withdrawal isn't a
        # category of expense, so it's never required/validated here, even
        # if the client sent one (line creation below force-clears it).
        if line.line_type == "expense":
            if not line.category_id:
                raise HTTPException(400, "category_id is required for an expense line")
            category = db.query(models.ExpenseCategory).get(line.category_id)
            if not category:
                raise HTTPException(404, f"Expense category {line.category_id} not found")
            # Employee Salary Tracking (§ Employee Salary Tracking)
            if category.is_system and category.name == "Salary" and not line.employee_id:
                raise HTTPException(400, "Employee is required when category is Salary")

    # Shop Cash Money Routing (§1) — defaults to the shop's own account,
    # same account choices as elsewhere.
    if payload.account_id:
        account = db.query(models.PaymentAccount).get(payload.account_id)
        if not account:
            raise HTTPException(404, "Account not found")
    else:
        account = get_or_create_shop_account(db, shop)

    # Attribution (§ Shop Expense/Withdrawal Attribution) — both optional
    # and, when sent, must actually belong to THIS shop; a stray/foreign id
    # here would attribute the withdrawal to the wrong customer or sale.
    if payload.supply_customer_id:
        sc = db.query(models.ShopSupplyCustomer).get(payload.supply_customer_id)
        if not sc or sc.shop_id != shop.id:
            raise HTTPException(404, "Supply customer not found for this shop")
    if payload.shop_sale_id:
        sale = db.query(models.ShopSale).get(payload.shop_sale_id)
        if not sale or sale.customer_id != shop.id:
            raise HTTPException(404, "Shop sale not found for this shop")

    total = sum((l.amount for l in payload.lines), Decimal("0"))
    txn = models.ShopExpenseTransaction(
        display_id=next_display_id(db, models.ShopExpenseTransaction, "SHEXP", width=6),
        date=payload.date, shop_id=shop.id, total_amount=total, account_id=account.id,
        payment_source=payload.payment_source, notes=payload.notes,
        supply_customer_id=payload.supply_customer_id, shop_sale_id=payload.shop_sale_id,
        status="active", entered_by=current_user.name,
    )
    db.add(txn)
    db.flush()
    for line in payload.lines:
        db.add(models.ShopExpenseLine(
            expense_transaction_id=txn.id,
            category_id=line.category_id if line.line_type == "expense" else None,
            line_type=line.line_type, amount=line.amount, description=line.description,
            employee_id=line.employee_id if line.line_type == "expense" else None,
        ))
        # Dashboard P&L / Shop Expense integration (§ Dashboard) — dual-
        # write into the SAME general Expense/OwnerDrawings tables the
        # plant-level Expenses/Cash Book pages already read, tagged with
        # shop_id + source_shop_expense_transaction_id (the latter is what
        # lets cancel_shop_expense below find and reverse these rows).
        # Never touches account.current_balance here — that debit already
        # happens once, below, for the whole transaction; doing it again
        # per-line here would double-count it.
        if line.line_type == "expense":
            db.add(models.Expense(
                display_id=next_display_id(db, models.Expense, "EXP", width=6),
                date=payload.date, category_id=line.category_id, amount=line.amount,
                account_id=account.id, method="cash",
                description=line.description or f"Shop expense — {shop.name}",
                shop_id=shop.id, source_shop_expense_transaction_id=txn.id,
                status="active", entered_by=current_user.name,
                employee_id=line.employee_id,
            ))
            # Employee Salary Tracking (§ Employee Salary Tracking) — a
            # no-op unless line.category_id is the system "Salary"
            # category, in which case this reduces that employee's balance.
            apply_salary_expense_if_needed(db, line.category_id, line.employee_id, line.amount, by=current_user.name)
        else:
            db.add(models.OwnerDrawings(
                display_id=next_display_id(db, models.OwnerDrawings, "DRAW", width=6),
                date=payload.date, amount=line.amount, account_id=account.id,
                notes=line.description or f"Shop owner withdrawal — {shop.name}",
                shop_id=shop.id, source_shop_expense_transaction_id=txn.id,
                status="active", entered_by=current_user.name,
            ))
    account.current_balance = account.current_balance - total
    db.add(account)
    db.commit()
    db.refresh(txn)
    return _expense_txn_to_out(db, txn)


@router.patch("/expenses/{expense_id}/cancel", response_model=schemas.ShopExpenseTransactionOut)
def cancel_shop_expense(expense_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    txn = db.query(models.ShopExpenseTransaction).get(expense_id)
    if not txn:
        raise HTTPException(404, "Expense transaction not found")
    if txn.status != "active":
        raise HTTPException(400, "Expense transaction is already cancelled")
    if txn.account_id:
        account = db.query(models.PaymentAccount).get(txn.account_id)
        if account:
            account.current_balance = account.current_balance + txn.total_amount
            db.add(account)
    txn.status = "cancelled"
    txn.modified_at = datetime.utcnow()
    txn.modified_by = by
    db.add(txn)

    # Dashboard P&L / Shop Expense integration (§ Dashboard) — keep the
    # dual-written Expense/OwnerDrawings rows in sync: status-only flip,
    # never touch account balance again (already reversed above once, for
    # the whole transaction — these rows never touched it in the first
    # place, they exist purely for Expenses-page/Cash-Book visibility and
    # P&L reporting).
    for exp in db.query(models.Expense).filter(
        models.Expense.source_shop_expense_transaction_id == txn.id, models.Expense.status == "active"
    ).all():
        exp.status = "cancelled"
        db.add(exp)
    for draw in db.query(models.OwnerDrawings).filter(
        models.OwnerDrawings.source_shop_expense_transaction_id == txn.id, models.OwnerDrawings.status == "active"
    ).all():
        draw.status = "cancelled"
        db.add(draw)

    db.commit()
    db.refresh(txn)
    return _expense_txn_to_out(db, txn)


# ---------- Shop Business Ledger (§28E) ----------

@router.get("/{shop_id}/business-ledger", response_model=schemas.ShopBusinessLedgerOut)
def get_shop_business_ledger(
    shop_id: UUID,
    date: str = Query(None, description="YYYY-MM-DD, defaults to today"),
    month: str = Query(None, description="YYYY-MM, defaults to current month"),
    db: Session = Depends(get_db),
):
    """Engine 3 only — cash retail sales, supply-customer credit sales/
    collections, expenses, owner withdrawals, and payments to Dowa. Never a
    Shop's Dowa-side Load/Payment or a public-retail Shop Sale's stock/FIFO
    effect (those stay in /shops/{id} Transaction History + stock summary)."""
    shop = _get_shop(db, shop_id)
    business_date = date or karachi_today_str()
    month = month or business_date[:7]
    month_start = datetime.strptime(month, "%Y-%m")
    year, mo = month_start.year, month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)

    cash = _compute_cash_summary(db, shop, business_date)
    rows: list[schemas.ShopBusinessLedgerRow] = []

    supply_customers = {c.id: c for c in db.query(models.ShopSupplyCustomer).filter(models.ShopSupplyCustomer.shop_id == shop_id).all()}
    products = {p.id: p for p in db.query(models.Product).all()}
    categories = {c.id: c for c in db.query(models.ExpenseCategory).all()}
    companies = {c.id: c for c in db.query(models.Company).all()}
    accounts = {a.id: a for a in db.query(models.PaymentAccount).all()}

    # § Multi-line Categorized Home Expense — selectinload(home_expense_lines)
    # avoids one extra SELECT per row below (each row reads s.home_expense_
    # lines to populate ShopTransactionRow/ShopBusinessLedgerRow), same
    # bulk-fetch convention the rest of this function already follows for
    # products/categories/companies/accounts.
    shop_sales = db.query(models.ShopSale).options(selectinload(models.ShopSale.home_expense_lines)).filter(
        models.ShopSale.customer_id == shop_id, models.ShopSale.status == "active",
        models.ShopSale.date >= month_start, models.ShopSale.date < next_month,
    ).all()
    for s in shop_sales:
        product_name = products.get(s.product_id).name if products.get(s.product_id) else "Product"
        qty_label = f"{s.quantity_kg} kg" if s.unit == "kg" and s.quantity_kg is not None else f"{s.quantity}"
        # Amount = full sale value (always), GST-inclusive (§ GST on Shop
        # Sale — grand_total, identical to total_amount when GST is off).
        # Cash Impact = only what was actually received (§2/C2) — for a
        # "cash" sale these are always equal (amount_received ==
        # grand_total, enforced at creation); for a "credit" sale they
        # diverge whenever it was partially paid.
        received = s.amount_received if s.amount_received is not None else s.grand_total
        # Where the collected amount was routed (§ Settlement Routing) — the
        # shop-side counterpart to the plant ledger's payment-received row.
        # Null for a credit sale with nothing collected (all-credit) or a
        # pre-routing-change row; the human-readable label is resolved on the
        # frontend (shops/[id]/page.tsx's resolveShopSaleRoutedLabel,
        # mirroring unified-sale/page.tsx's getDestinationLabel) so the two
        # pages can never drift.
        # Keyed off outstanding > 0, not payment_type — a partially-paid
        # "cash" sale carries a real balance due exactly like a "credit"
        # sale, and this row should show the customer name + outstanding
        # note (kind="credit_sale") to reflect that reality rather than the
        # dropdown value the cashier picked.
        if s.grand_total - received != 0:
            sc = supply_customers.get(s.supply_customer_id)
            paid_note = f" ({received} paid, {s.grand_total - received} outstanding)" if 0 < received < s.grand_total else ""
            if received > s.grand_total:
                paid_note = f" ({received} paid, {received - s.grand_total} advance)"
            rows.append(schemas.ShopBusinessLedgerRow(
                kind="credit_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
                description=f"Credit Sale to {sc.name if sc else (s.supply_customer_label or 'Unknown')} — {product_name} × {qty_label}{paid_note}",
                amount=s.grand_total, cash_impact=received,
                settlement_destination_type=s.settlement_destination_type,
                settlement_target_plant_id=s.settlement_target_plant_id,
                settlement_account_id=s.settlement_account_id,
                settlement_home_expense_description=s.settlement_home_expense_description,
                settlement_home_expense_category_id=s.settlement_home_expense_category_id,
                settlement_home_expense_employee_id=s.settlement_home_expense_employee_id,
                settlement_home_expense_amount=s.settlement_home_expense_amount,
                settlement_owner_drawings_amount=s.settlement_owner_drawings_amount,
                gst_rate=s.gst_rate, gst_amount=s.gst_amount, discount_amount=s.discount_amount,
                home_expense_lines=s.home_expense_lines,
                entered_by=s.entered_by, status=s.status,
            ))
        else:
            rows.append(schemas.ShopBusinessLedgerRow(
                kind="cash_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
                description=f"Cash Sale — {product_name} × {qty_label}",
                amount=s.grand_total, cash_impact=received,
                settlement_destination_type=s.settlement_destination_type,
                settlement_target_plant_id=s.settlement_target_plant_id,
                settlement_account_id=s.settlement_account_id,
                settlement_home_expense_description=s.settlement_home_expense_description,
                settlement_home_expense_category_id=s.settlement_home_expense_category_id,
                settlement_home_expense_employee_id=s.settlement_home_expense_employee_id,
                settlement_home_expense_amount=s.settlement_home_expense_amount,
                settlement_owner_drawings_amount=s.settlement_owner_drawings_amount,
                gst_rate=s.gst_rate, gst_amount=s.gst_amount, discount_amount=s.discount_amount,
                home_expense_lines=s.home_expense_lines,
                entered_by=s.entered_by, status=s.status,
            ))

    collections = db.query(models.ShopCustomerPayment).filter(
        models.ShopCustomerPayment.shop_id == shop_id, models.ShopCustomerPayment.status == "active",
        models.ShopCustomerPayment.date >= month_start, models.ShopCustomerPayment.date < next_month,
    ).all()
    for p in collections:
        sc = supply_customers.get(p.supply_customer_id)
        rows.append(schemas.ShopBusinessLedgerRow(
            kind="customer_payment", date=p.date, ref_id=p.id, display_id=p.display_id,
            description=f"Payment from {sc.name if sc else (p.supply_customer_label or 'Unknown')} · {p.method}",
            amount=p.amount, cash_impact=p.amount,
            # Settlement Routing (§ Payment Only mode) — this row's ShopCustomerPayment
            # already carries these from _apply_customer_payment; simply never copied
            # onto the ledger row before now, so a Payment Only collection's Home
            # Expense/Owner Drawings/Routed-To breakdown never rendered here even
            # though cash_sale/credit_sale/shop_cash_transfer rows already do.
            settlement_destination_type=p.settlement_destination_type,
            settlement_target_plant_id=p.settlement_target_plant_id,
            settlement_account_id=p.settlement_account_id,
            settlement_home_expense_description=p.settlement_home_expense_description,
            settlement_home_expense_category_id=p.settlement_home_expense_category_id,
            settlement_home_expense_employee_id=p.settlement_home_expense_employee_id,
            settlement_home_expense_amount=p.settlement_home_expense_amount,
            settlement_owner_drawings_amount=p.settlement_owner_drawings_amount,
            entered_by=p.entered_by, status=p.status,
        ))

    expense_txns = db.query(models.ShopExpenseTransaction).filter(
        models.ShopExpenseTransaction.shop_id == shop_id, models.ShopExpenseTransaction.status == "active",
        models.ShopExpenseTransaction.date >= month_start, models.ShopExpenseTransaction.date < next_month,
    ).all()
    if expense_txns:
        all_lines = db.query(models.ShopExpenseLine).filter(
            models.ShopExpenseLine.expense_transaction_id.in_([t.id for t in expense_txns])
        ).all()
        lines_by_txn: dict = {}
        for l in all_lines:
            lines_by_txn.setdefault(l.expense_transaction_id, []).append(l)
        # Attribution (§ Shop Expense/Withdrawal Attribution) — supply_customers
        # is already this-shop-scoped (built above); shop_sale_id can point
        # outside this month's own shop_sales query above (a sale entered in
        # month N, an expense against it corrected/re-entered in month N+1),
        # so this is its own small batched lookup rather than reusing that list.
        sale_ids = {t.shop_sale_id for t in expense_txns if t.shop_sale_id}
        sales_by_id = (
            {s.id: s for s in db.query(models.ShopSale).filter(models.ShopSale.id.in_(sale_ids)).all()}
            if sale_ids else {}
        )
        for t in expense_txns:
            lines = lines_by_txn.get(t.id, [])
            # Owner Withdrawal lines never carry a category_id (see
            # ShopExpenseLine.category_id) — label those "Owner Withdrawal"
            # here instead of falling into the "?" unknown-category case,
            # which is reserved for an actual dangling/deleted category.
            cat_names = ", ".join(
                "Owner Withdrawal" if l.line_type == "owner_withdrawal"
                else (categories.get(l.category_id).name if categories.get(l.category_id) else "?")
                for l in lines
            )
            has_withdrawal = any(l.line_type == "owner_withdrawal" for l in lines)
            has_expense = any(l.line_type == "expense" for l in lines)
            # A mixed transaction (some expense lines, some owner-withdrawal
            # lines — §36's exact example) still shows as ONE ledger row,
            # matching "one atomic transaction"; category-level totals (used
            # to report Fuel/Salary/... and Owner Withdrawal separately)
            # come from the lines themselves, not from this row's kind.
            kind = "owner_withdrawal" if has_withdrawal and not has_expense else "expense"
            # Attribution (§ Shop Expense/Withdrawal Attribution) — same
            # "baked into description" convention credit_sale/customer_payment
            # rows above already use in this same table, rather than a
            # special-cased extra column for just this one row kind.
            attribution_bits = []
            if t.supply_customer_id:
                sc = supply_customers.get(t.supply_customer_id)
                attribution_bits.append(f"for {sc.name}" if sc else "for unknown customer")
            if t.shop_sale_id and t.shop_sale_id in sales_by_id:
                attribution_bits.append(f"(Sale #{sales_by_id[t.shop_sale_id].display_id})")
            attribution = f" {' '.join(attribution_bits)}" if attribution_bits else ""
            rows.append(schemas.ShopBusinessLedgerRow(
                kind=kind, date=t.date, ref_id=t.id, display_id=t.display_id,
                description=(cat_names or "Expense") + attribution + (f" — {t.notes}" if t.notes else ""),
                amount=t.total_amount, cash_impact=-t.total_amount,
                entered_by=t.entered_by, status=t.status,
            ))

    shop_account = get_or_create_shop_account(db, shop)
    dowa_payments = db.query(models.Payment).filter(
        models.Payment.customer_id == shop_id, models.Payment.status == "active", models.Payment.unified_sale_id.is_(None),
        models.Payment.date >= month_start, models.Payment.date < next_month,
    ).all()
    for p in dowa_payments:
        # Only a payment actually funded FROM this shop's own account
        # reduces Shop Cash — one funded from a different account (e.g.
        # Office Cash) is still shown here (it's still this shop's Dowa
        # payment event) but has zero impact on Shop Cash specifically.
        funded_from_shop_cash = p.source_account_id == shop_account.id
        rows.append(schemas.ShopBusinessLedgerRow(
            kind="dowa_payment", date=p.date, ref_id=p.id, display_id=p.display_id,
            description=f"Payment to Dowa · {p.method}" + ("" if funded_from_shop_cash else " (funded from another account)"),
            amount=p.amount, cash_impact=-p.amount if funded_from_shop_cash else Decimal("0"),
            entered_by=p.entered_by, status=p.status,
        ))

    cash_transfers = db.query(models.ShopCashTransfer).filter(
        models.ShopCashTransfer.shop_id == shop_id, models.ShopCashTransfer.status == "active",
        models.ShopCashTransfer.date >= month_start, models.ShopCashTransfer.date < next_month,
    ).all()
    for t in cash_transfers:
        rows.append(schemas.ShopBusinessLedgerRow(
            kind="shop_cash_transfer", date=t.date, ref_id=t.id, display_id=t.display_id,
            description="Shop Cash Transfer Out" + (f" — {t.notes}" if t.notes else ""),
            amount=t.gross_amount, cash_impact=-t.gross_amount,
            settlement_destination_type=t.settlement_destination_type,
            settlement_target_plant_id=t.settlement_target_plant_id,
            settlement_account_id=t.settlement_account_id,
            settlement_home_expense_description=t.settlement_home_expense_description,
            settlement_home_expense_category_id=t.settlement_home_expense_category_id,
            settlement_home_expense_employee_id=t.settlement_home_expense_employee_id,
            settlement_home_expense_amount=t.settlement_home_expense_amount,
            settlement_owner_drawings_amount=t.settlement_owner_drawings_amount,
            entered_by=t.entered_by, status=t.status,
        ))

    rows.sort(key=lambda r: r.date, reverse=True)

    db.commit()  # persists the shop's Shop Cash account if this request just lazily created it
    return schemas.ShopBusinessLedgerOut(business_date=business_date, cash=cash, rows=rows)


