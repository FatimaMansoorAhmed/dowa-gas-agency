from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.reporting.invoice_pdf import render_shop_sale_invoice_pdf
from app.utils import next_display_id, get_or_create_shop_account
from app.timezone import KARACHI_TZ, karachi_day_bounds, karachi_today_str
from app.routers.board_rates import resolve_board_rate
from app.routers.ledger import _customer_corrections

router = APIRouter(prefix="/shops", tags=["shops"], dependencies=[Depends(require_active_user), Depends(require_csrf)])

# Fixed physical->saleable conversion for a Shop's board-rate cylinder
# pricing (§7/§9 of the Shop spec): a physical cylinder always loses a
# fixed 0.4kg to wastage before it's sellable — never user-editable, never
# hard-coded per product (the physical figure always comes from
# Product.weight_kg, only this constant is fixed). For the current 45.4kg
# product this yields the spec's 45kg saleable figure; it applies the same
# way to any other cylinder size added later.
FIXED_WASTAGE_KG = Decimal("0.4")


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

def _compute_cash_summary(db: Session, shop: models.Customer, business_date: str) -> schemas.ShopCashSummary:
    """Shop Cash = opening_cash + cash actually received on sales (any
    payment_type — a partially-paid credit sale still puts real cash in the
    till, §2) + supply-customer collections + transfers in − expenses −
    owner withdrawals − Dowa payments funded from Shop Cash − transfers out.
    Every term is summed fresh from Engine 3's own history plus the
    EXISTING Payment/AccountTransfer models (§19: don't duplicate a concept
    the app already has) — never from the stored account balance itself,
    mirroring _compute_stock_summary's derive-from-history pattern."""
    day_start, day_end = karachi_day_bounds(business_date)
    shop_account = get_or_create_shop_account(db, shop)

    # Every term below is filtered to the transactions that actually posted
    # to THIS shop's own account — a Shop Sale/collection/expense entered
    # with a different destination/source account (§2/§1: "should allow the
    # same account choices as elsewhere") never touches Shop Cash, only
    # whichever account was actually chosen does.
    all_sales = (
        db.query(models.ShopSale)
        .filter(
            models.ShopSale.customer_id == shop.id, models.ShopSale.status == "active",
            models.ShopSale.destination_account_id == shop_account.id,
        )
        .all()
    )
    collections = (
        db.query(models.ShopCustomerPayment)
        .filter(
            models.ShopCustomerPayment.shop_id == shop.id, models.ShopCustomerPayment.status == "active",
            models.ShopCustomerPayment.account_id == shop_account.id,
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

    before = lambda rows, attr: [r for r in rows if getattr(r, attr) < day_start]
    today = lambda rows, attr: [r for r in rows if day_start <= getattr(r, attr) < day_end]

    before_expense, before_withdrawal = _expense_split(before(expense_txns, "date"))
    today_expense, today_withdrawal = _expense_split(today(expense_txns, "date"))

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
    )

    day_cash_sales = _received(today(all_sales, "date"))
    day_collections = sum((p.amount for p in today(collections, "date")), start=Decimal("0"))
    day_dowa_payments = sum((p.amount for p in today(dowa_payments, "date")), start=Decimal("0"))
    day_transfers_in = sum((t.amount for t in today(transfers_in_rows, "date")), start=Decimal("0"))
    day_transfers_out = sum((t.amount for t in today(transfers_out_rows, "date")), start=Decimal("0"))

    closing_cash = (
        opening_cash + day_cash_sales + day_collections + day_transfers_in
        - today_expense - today_withdrawal - day_dowa_payments - day_transfers_out
    )

    return schemas.ShopCashSummary(
        business_date=business_date,
        opening_cash=opening_cash,
        cash_retail_sales=day_cash_sales,
        supply_customer_collections=day_collections,
        expenses=today_expense,
        owner_withdrawals=today_withdrawal,
        dowa_payments=day_dowa_payments,
        transfers_in=day_transfers_in,
        transfers_out=day_transfers_out,
        closing_cash=closing_cash,
    )


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

    # Board Rate is resolved here, server-side, from the SALE DATE — never
    # from any ShopStockBatch.load_rate_per_kg. This is the literal
    # implementation of "SHOP SALE AMOUNT = SALE-DATE BOARD RATE ×
    # SALEABLE KG (physical weight minus fixed wastage) × QUANTITY".
    board_rate = resolve_board_rate(db, payload.date)
    cylinder_weight = product.weight_kg
    saleable_kg = _saleable_kg(cylinder_weight)
    sale_rate_per_cylinder = board_rate.rate_per_kg * saleable_kg

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
    total_amount = quantity_kg * board_rate.rate_per_kg

    # Inline Settlement (§2, Money Routing) — how much of total_amount was
    # actually collected right now. A "cash"/walk-in sale is always fully
    # paid (there's no one to owe); amount_received is force-set to
    # total_amount server-side regardless of what was sent, rather than
    # trusting a client-supplied figure for money that must always be
    # 100% collected. A "credit" sale defaults to 0 (today's original
    # all-or-nothing behavior) unless a partial/full amount was given.
    if payload.payment_type == "cash":
        amount_received = total_amount
    else:
        amount_received = payload.amount_received if payload.amount_received is not None else Decimal("0")
        if amount_received < 0 or amount_received > total_amount:
            raise HTTPException(400, f"amount_received must be between 0 and the sale total ({total_amount})")

    destination_account = None
    if amount_received > 0:
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
        board_rate_per_kg_used=board_rate.rate_per_kg,
        cylinder_weight_used=cylinder_weight,
        saleable_kg_used=saleable_kg,
        sale_rate_per_cylinder=sale_rate_per_cylinder,
        total_amount=total_amount,
        notes=payload.notes,
        status="active",
        entered_by=entered_by,
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

    # Supply Customer receivable (§25, §2) — a credit sale increases what
    # this customer owes the SHOP by only the OUTSTANDING remainder (total
    # minus whatever was collected right now via Inline Settlement), never
    # the Dowa Customer Ledger/current_balance (see the module docstring).
    # A cash sale, even one that names a customer, never touches this
    # balance — it's always amount_received == total_amount == 0 outstanding.
    outstanding = total_amount - amount_received
    if payload.payment_type == "credit" and supply_customer and outstanding > 0:
        supply_customer.current_balance = supply_customer.current_balance + outstanding
        db.add(supply_customer)

    # Shop Cash Money Routing (§1/§2) — the cash portion actually collected
    # posts to a real, stored PaymentAccount balance right now, atomically
    # with the sale itself. Never posted for outstanding/credit portions.
    if destination_account and amount_received > 0:
        destination_account.current_balance = destination_account.current_balance + amount_received
        db.add(destination_account)

    return sale


def _reverse_shop_sale(db: Session, sale: models.ShopSale) -> None:
    consumptions = db.query(models.ShopSaleBatchConsumption).filter(models.ShopSaleBatchConsumption.shop_sale_id == sale.id).all()
    for c in consumptions:
        batch = db.query(models.ShopStockBatch).get(c.shop_stock_batch_id)
        if batch:
            batch.quantity_remaining = batch.quantity_remaining + c.quantity_consumed
            db.add(batch)
        db.delete(c)

    outstanding = sale.total_amount - (sale.amount_received if sale.amount_received is not None else Decimal("0"))
    if sale.payment_type == "credit" and sale.supply_customer_id and outstanding > 0:
        supply_customer = db.query(models.ShopSupplyCustomer).get(sale.supply_customer_id)
        if supply_customer:
            supply_customer.current_balance = supply_customer.current_balance - outstanding
            db.add(supply_customer)

    if sale.destination_account_id and sale.amount_received:
        destination_account = db.query(models.PaymentAccount).get(sale.destination_account_id)
        if destination_account:
            destination_account.current_balance = destination_account.current_balance - sale.amount_received
            db.add(destination_account)


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

    transactions: list[schemas.ShopTransactionRow] = []

    loads = db.query(models.Sale).filter(
        models.Sale.customer_id == shop_id, models.Sale.status == "active", models.Sale.unified_sale_id.is_(None),
        models.Sale.date >= month_start, models.Sale.date < next_month,
    ).all()
    for s in loads:
        transactions.append(schemas.ShopTransactionRow(
            kind="load", date=s.date, ref_id=s.id, display_id=s.display_id,
            description=f"Load — {products.get(s.product_id).name if products.get(s.product_id) else 'Product'} × {s.quantity}",
            quantity=s.quantity, load_rate_per_kg=s.rate_per_kg, amount=s.total_amount,
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

    shop_sales = db.query(models.ShopSale).filter(
        models.ShopSale.customer_id == shop_id, models.ShopSale.status == "active",
        models.ShopSale.date >= month_start, models.ShopSale.date < next_month,
    ).all()
    for s in shop_sales:
        product_name = products.get(s.product_id).name if products.get(s.product_id) else "Product"
        qty_label = f"{s.quantity_kg} kg" if s.unit == "kg" and s.quantity_kg is not None else f"{s.quantity}"
        received = s.amount_received if s.amount_received is not None else s.total_amount
        outstanding = s.total_amount - received
        credit_label = (
            (f" · CREDIT (partial: {received} paid, {outstanding} due)" if 0 < received < s.total_amount else " · CREDIT")
            + (f" ({s.supply_customer.name})" if s.supply_customer_id else "")
        ) if s.payment_type == "credit" else ""
        transactions.append(schemas.ShopTransactionRow(
            kind="shop_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
            description=f"Shop Sale — {product_name} × {qty_label}{credit_label}",
            quantity=s.quantity, board_rate_per_kg=s.board_rate_per_kg_used, cylinder_weight=s.cylinder_weight_used,
            sale_rate_per_cylinder=s.sale_rate_per_cylinder, amount=s.total_amount,
            amount_received=received, amount_outstanding=outstanding,
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
            description=f"Shop Sale × {s.quantity}", original_amount=s.total_amount,
            correction_reason=s.correction_reason or "", corrected_by=s.corrected_by or "",
            corrected_at=s.corrected_at, corrected_display_id=replacement.display_id if replacement else None,
        ))
    shop_sale_corrections.sort(key=lambda r: r.corrected_at, reverse=True)

    return schemas.ShopDetailOut(
        customer=shop,
        stock=stock,
        cash=cash,
        account=shop_account,
        transactions=transactions,
        corrections=_customer_corrections(db, shop_id, month_start, next_month),
        shop_sale_corrections=shop_sale_corrections,
    )


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
            # only the OUTSTANDING remainder of a credit sale ever posts to
            # this customer's balance; a cash sale (even one naming a
            # customer) never does, matching what's actually happening to
            # current_balance rather than showing the full sale total.
            collected_now = s.amount_received if s.amount_received is not None else Decimal("0")
            outstanding = s.total_amount - collected_now
            contribution = outstanding if s.payment_type == "credit" else Decimal("0")
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
            ))

    return schemas.ShopSupplyCustomerLedgerOut(
        customer=customer, opening_balance=customer.opening_balance,
        total_sales=total_sales, total_payments=total_payments,
        total_collected_at_sale=total_collected_at_sale,
        total_transactions=len(rows), closing_balance=running, rows=rows,
    )


# ---------- Supply Customer Payments ----------

@router.post("/{shop_id}/customers/{supply_customer_id}/payments", response_model=schemas.ShopCustomerPaymentOut, status_code=201)
def create_customer_payment(
    shop_id: UUID, supply_customer_id: UUID, payload: schemas.ShopCustomerPaymentCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    shop = _get_shop(db, shop_id)
    customer = db.query(models.ShopSupplyCustomer).get(supply_customer_id)
    if not customer or customer.shop_id != shop.id:
        raise HTTPException(404, "Supply customer not found for this shop")
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    if payload.shop_sale_id:
        linked_sale = db.query(models.ShopSale).get(payload.shop_sale_id)
        if not linked_sale or linked_sale.customer_id != shop.id:
            raise HTTPException(404, "Linked shop sale not found for this shop")

    # Shop Cash Money Routing (§1) — defaults to the shop's own account,
    # same account choices as elsewhere.
    if payload.account_id:
        account = db.query(models.PaymentAccount).get(payload.account_id)
        if not account:
            raise HTTPException(404, "Account not found")
    else:
        account = get_or_create_shop_account(db, shop)

    # Advance/overpayment (Bug 4) — same convention as Payment.excess_amount
    # (routers/payments.py::_apply_payment): computed BEFORE applying this
    # payment, so it's a snapshot of how much of THIS payment exceeded what
    # was actually owed at the time. The balance mechanic itself needs no
    # separate "apply credit" step — current_balance going negative below
    # already IS the advance (never clamped to zero), and a later credit
    # sale naturally nets against it via the same running-balance math this
    # endpoint and get_supply_customer_ledger both already use. excess_amount
    # is purely the audit-trail record of that, not a second mechanism.
    excess = payload.amount - customer.current_balance
    excess_amount = excess if excess > 0 else None

    payment = models.ShopCustomerPayment(
        display_id=next_display_id(db, models.ShopCustomerPayment, "SHCPAY", width=6),
        date=payload.date, shop_id=shop.id, supply_customer_id=customer.id,
        shop_sale_id=payload.shop_sale_id, account_id=account.id,
        amount=payload.amount, method=payload.method, notes=payload.notes,
        excess_amount=excess_amount,
        status="active", entered_by=current_user.name,
    )
    db.add(payment)
    customer.current_balance = customer.current_balance - payload.amount
    db.add(customer)
    account.current_balance = account.current_balance + payload.amount
    db.add(account)
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
    if payment.account_id:
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
    line_outs = [
        schemas.ShopExpenseLineOut(
            id=l.id, category_id=l.category_id,
            category_name=categories.get(l.category_id).name if categories.get(l.category_id) else None,
            line_type=l.line_type, amount=l.amount, description=l.description,
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
        supply_customer_id=txn.supply_customer_id, customer_name=customer.name if customer else None,
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
            if not db.query(models.ExpenseCategory).get(line.category_id):
                raise HTTPException(404, f"Expense category {line.category_id} not found")

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
            ))
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

    shop_sales = db.query(models.ShopSale).filter(
        models.ShopSale.customer_id == shop_id, models.ShopSale.status == "active",
        models.ShopSale.date >= month_start, models.ShopSale.date < next_month,
    ).all()
    for s in shop_sales:
        product_name = products.get(s.product_id).name if products.get(s.product_id) else "Product"
        qty_label = f"{s.quantity_kg} kg" if s.unit == "kg" and s.quantity_kg is not None else f"{s.quantity}"
        # Amount = full sale value (always). Cash Impact = only what was
        # actually received (§2/C2) — for a "cash" sale these are always
        # equal (amount_received == total_amount, enforced at creation);
        # for a "credit" sale they diverge whenever it was partially paid.
        received = s.amount_received if s.amount_received is not None else s.total_amount
        if s.payment_type == "credit":
            sc = supply_customers.get(s.supply_customer_id)
            paid_note = f" ({received} paid, {s.total_amount - received} outstanding)" if 0 < received < s.total_amount else ""
            rows.append(schemas.ShopBusinessLedgerRow(
                kind="credit_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
                description=f"Credit Sale to {sc.name if sc else 'Unknown'} — {product_name} × {qty_label}{paid_note}",
                amount=s.total_amount, cash_impact=received,
                entered_by=s.entered_by, status=s.status,
            ))
        else:
            rows.append(schemas.ShopBusinessLedgerRow(
                kind="cash_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
                description=f"Cash Sale — {product_name} × {qty_label}",
                amount=s.total_amount, cash_impact=received,
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
            description=f"Payment from {sc.name if sc else 'Unknown'} · {p.method}",
            amount=p.amount, cash_impact=p.amount,
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

    rows.sort(key=lambda r: r.date, reverse=True)

    db.commit()  # persists the shop's Shop Cash account if this request just lazily created it
    return schemas.ShopBusinessLedgerOut(business_date=business_date, cash=cash, rows=rows)
