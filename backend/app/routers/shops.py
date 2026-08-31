from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id
from app.timezone import karachi_day_bounds, karachi_today_str
from app.routers.board_rates import resolve_board_rate
from app.routers.ledger import _customer_corrections

router = APIRouter(prefix="/shops", tags=["shops"])

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
    all_adjustments = db.query(models.ShopStockAdjustment).filter(
        models.ShopStockAdjustment.customer_id == shop_id, models.ShopStockAdjustment.status == "active"
    ).all()

    product_ids = {b.product_id for b in all_batches} | {s.product_id for s in all_sales} | {a.product_id for a in all_adjustments}

    try:
        board_rate = resolve_board_rate(db, on_date)
    except HTTPException:
        board_rate = None

    rows: list[schemas.ShopProductStockSummary] = []
    totals = {"opening": Decimal("0"), "load": Decimal("0"), "sales": Decimal("0"), "returns": Decimal("0"), "adjustments": Decimal("0"), "closing": Decimal("0"), "sales_amount": Decimal("0")}

    for pid in product_ids:
        product = products.get(pid)
        if not product:
            continue
        batches = [b for b in all_batches if b.product_id == pid]
        sales = [s for s in all_sales if s.product_id == pid]
        adjustments = [a for a in all_adjustments if a.product_id == pid]

        opening = (
            sum((b.quantity_received for b in batches if b.transaction_date < day_start), start=Decimal("0"))
            - sum((s.quantity for s in sales if s.date < day_start), start=Decimal("0"))
            + sum((a.quantity_delta for a in adjustments if a.date < day_start), start=Decimal("0"))
        )
        day_load = sum((b.quantity_received for b in batches if day_start <= b.transaction_date < day_end), start=Decimal("0"))
        day_sales = sum((s.quantity for s in sales if day_start <= s.date < day_end), start=Decimal("0"))
        day_sales_amount = sum((s.total_amount for s in sales if day_start <= s.date < day_end), start=Decimal("0"))
        day_returns = sum(
            (a.quantity_delta for a in adjustments if day_start <= a.date < day_end and a.adjustment_type == "return"),
            start=Decimal("0"),
        )
        day_adj = sum(
            (a.quantity_delta for a in adjustments if day_start <= a.date < day_end and a.adjustment_type == "adjustment"),
            start=Decimal("0"),
        )
        closing = opening + day_load + day_returns + day_adj - day_sales

        cylinder_weight = product.weight_kg
        saleable_kg = _saleable_kg(cylinder_weight)
        sale_rate = (board_rate.rate_per_kg * saleable_kg) if board_rate else None

        rows.append(schemas.ShopProductStockSummary(
            product_id=pid, product_name=product.name,
            opening_stock=opening, new_load=day_load, sales=day_sales,
            returns=day_returns, adjustments=day_adj, closing_stock=closing,
            board_rate_per_kg=board_rate.rate_per_kg if board_rate else None,
            cylinder_weight=cylinder_weight, wastage_kg=FIXED_WASTAGE_KG, saleable_kg=saleable_kg,
            sale_rate_per_cylinder=sale_rate,
            todays_sales_amount=day_sales_amount,
        ))

        totals["opening"] += opening
        totals["load"] += day_load
        totals["sales"] += day_sales
        totals["returns"] += day_returns
        totals["adjustments"] += day_adj
        totals["closing"] += closing
        totals["sales_amount"] += day_sales_amount

    rows.sort(key=lambda r: r.product_name)

    return schemas.ShopStockSummary(
        business_date=business_date,
        products=rows,
        total_opening_stock=totals["opening"],
        total_new_load=totals["load"],
        total_sales=totals["sales"],
        total_returns=totals["returns"],
        total_adjustments=totals["adjustments"],
        total_closing_stock=totals["closing"],
        total_sales_amount=totals["sales_amount"],
    )


# ---------- Shop Cash summary (derived, never stored — §24) ----------

def _compute_cash_summary(db: Session, shop: models.Customer, business_date: str) -> schemas.ShopCashSummary:
    """Shop Cash = opening_cash + cash retail sales + supply-customer
    collections − expenses − owner withdrawals − Dowa payments. Every term
    is summed fresh from Engine 3's own history (ShopSale.payment_type ==
    'cash', ShopCustomerPayment, ShopExpenseTransaction/Line) plus the
    EXISTING Payment model for the Dowa-payments term (§19: don't duplicate
    a concept the app already has) — never from a stored running balance,
    mirroring _compute_stock_summary's derive-from-history pattern."""
    day_start, day_end = karachi_day_bounds(business_date)

    cash_sales = (
        db.query(models.ShopSale)
        .filter(models.ShopSale.customer_id == shop.id, models.ShopSale.status == "active", models.ShopSale.payment_type == "cash")
        .all()
    )
    collections = (
        db.query(models.ShopCustomerPayment)
        .filter(models.ShopCustomerPayment.shop_id == shop.id, models.ShopCustomerPayment.status == "active")
        .all()
    )
    expense_txns = (
        db.query(models.ShopExpenseTransaction)
        .filter(models.ShopExpenseTransaction.shop_id == shop.id, models.ShopExpenseTransaction.status == "active")
        .all()
    )
    dowa_payments = (
        db.query(models.Payment)
        .filter(models.Payment.customer_id == shop.id, models.Payment.status == "active")
        .all()
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

    opening_cash = (
        shop.shop_opening_cash
        + sum((s.total_amount for s in before(cash_sales, "date")), start=Decimal("0"))
        + sum((p.amount for p in before(collections, "date")), start=Decimal("0"))
        - before_expense - before_withdrawal
        - sum((p.amount for p in before(dowa_payments, "date")), start=Decimal("0"))
    )

    day_cash_sales = sum((s.total_amount for s in today(cash_sales, "date")), start=Decimal("0"))
    day_collections = sum((p.amount for p in today(collections, "date")), start=Decimal("0"))
    day_dowa_payments = sum((p.amount for p in today(dowa_payments, "date")), start=Decimal("0"))

    closing_cash = opening_cash + day_cash_sales + day_collections - today_expense - today_withdrawal - day_dowa_payments

    return schemas.ShopCashSummary(
        business_date=business_date,
        opening_cash=opening_cash,
        cash_retail_sales=day_cash_sales,
        supply_customer_collections=day_collections,
        expenses=today_expense,
        owner_withdrawals=today_withdrawal,
        dowa_payments=day_dowa_payments,
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

    # Supply Customer receivable (§25) — a credit sale increases what this
    # customer owes the SHOP (never the Dowa Customer Ledger/current_balance
    # — see the module docstring). A cash sale, even one that names a
    # customer, never touches this balance; Shop Cash picks it up instead,
    # derived on read by _compute_cash_summary from ShopSale.payment_type.
    if payload.payment_type == "credit" and supply_customer:
        supply_customer.current_balance = supply_customer.current_balance + total_amount
        db.add(supply_customer)

    return sale


def _reverse_shop_sale(db: Session, sale: models.ShopSale) -> None:
    consumptions = db.query(models.ShopSaleBatchConsumption).filter(models.ShopSaleBatchConsumption.shop_sale_id == sale.id).all()
    for c in consumptions:
        batch = db.query(models.ShopStockBatch).get(c.shop_stock_batch_id)
        if batch:
            batch.quantity_remaining = batch.quantity_remaining + c.quantity_consumed
            db.add(batch)
        db.delete(c)

    if sale.payment_type == "credit" and sale.supply_customer_id:
        supply_customer = db.query(models.ShopSupplyCustomer).get(sale.supply_customer_id)
        if supply_customer:
            supply_customer.current_balance = supply_customer.current_balance - sale.total_amount
            db.add(supply_customer)


# ---------- Shop list / create / detail ----------

@router.get("", response_model=list[schemas.ShopListRow])
def list_shops(db: Session = Depends(get_db)):
    shops = db.query(models.Customer).filter(models.Customer.customer_type == "shop").order_by(models.Customer.name).all()
    today = karachi_today_str()
    out = []
    for shop in shops:
        summary = _compute_stock_summary(db, shop.id, today)
        last_dates = [shop.last_transaction_at]
        last_shop_sale = db.query(models.ShopSale).filter(models.ShopSale.customer_id == shop.id).order_by(models.ShopSale.created_at.desc()).first()
        if last_shop_sale:
            last_dates.append(last_shop_sale.created_at)
        last_adj = db.query(models.ShopStockAdjustment).filter(models.ShopStockAdjustment.customer_id == shop.id).order_by(models.ShopStockAdjustment.created_at.desc()).first()
        if last_adj:
            last_dates.append(last_adj.created_at)
        last_dates = [d for d in last_dates if d]
        out.append(schemas.ShopListRow(
            customer=shop,
            current_stock=summary.total_closing_stock,
            today_load=summary.total_new_load,
            today_sales=summary.total_sales,
            today_returns=summary.total_returns,
            current_balance=shop.current_balance,
            last_activity=max(last_dates) if last_dates else None,
        ))
    return out


@router.post("", response_model=schemas.CustomerOut, status_code=201)
def create_shop(payload: schemas.CustomerCreate, db: Session = Depends(get_db)):
    """Creates a shop — a Customer row with customer_type="shop" (§ Shop
    Management: a Shop is a Customer, not a separate table). Reuses the
    exact same creation path as routers/customers.py's create_customer so
    display_id generation/validation never diverges between the two."""
    from app.routers.customers import create_customer as _create_customer_row
    payload.customer_type = "shop"
    return _create_customer_row(payload, db)


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
        credit_label = f" · CREDIT" + (f" ({s.supply_customer.name})" if s.supply_customer_id else "") if s.payment_type == "credit" else ""
        transactions.append(schemas.ShopTransactionRow(
            kind="shop_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
            description=f"Shop Sale — {product_name} × {qty_label}{credit_label}",
            quantity=s.quantity, board_rate_per_kg=s.board_rate_per_kg_used, cylinder_weight=s.cylinder_weight_used,
            sale_rate_per_cylinder=s.sale_rate_per_cylinder, amount=s.total_amount,
            entered_by=s.entered_by, status=s.status, correctable=True,
        ))

    adjustments = db.query(models.ShopStockAdjustment).filter(
        models.ShopStockAdjustment.customer_id == shop_id, models.ShopStockAdjustment.status == "active",
        models.ShopStockAdjustment.date >= month_start, models.ShopStockAdjustment.date < next_month,
    ).all()
    for a in adjustments:
        transactions.append(schemas.ShopTransactionRow(
            kind=a.adjustment_type, date=a.date, ref_id=a.id, display_id=a.display_id,
            description=f"{a.adjustment_type.title()} — {products.get(a.product_id).name if products.get(a.product_id) else 'Product'}" + (f" ({a.reason})" if a.reason else ""),
            quantity=a.quantity_delta, entered_by=a.entered_by, status=a.status, correctable=False,
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
        transactions=transactions,
        corrections=_customer_corrections(db, shop_id, month_start, next_month),
        shop_sale_corrections=shop_sale_corrections,
    )


@router.get("/{shop_id}/stock", response_model=schemas.ShopStockSummary)
def get_shop_stock(shop_id: UUID, date: str = Query(None, description="YYYY-MM-DD, defaults to today"), db: Session = Depends(get_db)):
    _get_shop(db, shop_id)
    return _compute_stock_summary(db, shop_id, date or karachi_today_str())


@router.get("/{shop_id}/batches", response_model=list[schemas.ShopStockBatchOut])
def list_shop_batches(shop_id: UUID, db: Session = Depends(get_db)):
    _get_shop(db, shop_id)
    return (
        db.query(models.ShopStockBatch)
        .filter(models.ShopStockBatch.customer_id == shop_id, models.ShopStockBatch.status == "active")
        .order_by(models.ShopStockBatch.transaction_date.asc())
        .all()
    )


# ---------- Shop Sales ----------

@router.get("/sales/{sale_id}", response_model=schemas.ShopSaleOut)
def get_shop_sale(sale_id: UUID, db: Session = Depends(get_db)):
    sale = db.query(models.ShopSale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Shop sale not found")
    return sale


@router.post("/{shop_id}/sales", response_model=schemas.ShopSaleOut, status_code=201)
def create_shop_sale(shop_id: UUID, payload: schemas.ShopSaleCreate, db: Session = Depends(get_db)):
    shop = _get_shop(db, shop_id)
    sale = _apply_shop_sale(db, shop, payload, payload.entered_by)
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
def correct_shop_sale(sale_id: UUID, payload: schemas.ShopSaleCorrect, db: Session = Depends(get_db)):
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
    original.corrected_by = payload.corrected_by
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_shop_sale(db, shop, payload, payload.corrected_by)
    corrected.corrected_from_id = original.id
    db.add(corrected)

    db.commit()
    db.refresh(corrected)
    return corrected


# ---------- Stock Adjustments (Return / Adjustment) ----------
# Deliberately simple (§ Shop Management, explicit instruction): does NOT
# create, consume, or otherwise touch any ShopStockBatch/FIFO layer — that
# interaction is left undefined until the business rule for it exists.
# Create + cancel only, no correction chain yet.

@router.post("/{shop_id}/adjustments", response_model=schemas.ShopStockAdjustmentOut, status_code=201)
def create_shop_adjustment(shop_id: UUID, payload: schemas.ShopStockAdjustmentCreate, db: Session = Depends(get_db)):
    shop = _get_shop(db, shop_id)
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    # Stock must never silently go negative (§27) — a read-only check
    # against the current live total, never a batch mutation.
    if payload.quantity_delta < 0:
        current_total = (
            db.query(models.ShopStockBatch)
            .filter(
                models.ShopStockBatch.customer_id == shop_id,
                models.ShopStockBatch.product_id == payload.product_id,
                models.ShopStockBatch.status == "active",
            )
            .all()
        )
        available = sum((b.quantity_remaining for b in current_total), start=Decimal("0"))
        if available + payload.quantity_delta < 0:
            raise HTTPException(400, f"This would make stock negative — only {available} currently available")

    adj = models.ShopStockAdjustment(
        display_id=next_display_id(db, models.ShopStockAdjustment, "SHADJ", width=6),
        date=payload.date,
        customer_id=shop.id,
        product_id=payload.product_id,
        adjustment_type=payload.adjustment_type,
        quantity_delta=payload.quantity_delta,
        reason=payload.reason,
        status="active",
        entered_by=payload.entered_by,
    )
    db.add(adj)
    db.commit()
    db.refresh(adj)
    return adj


@router.patch("/adjustments/{adjustment_id}/cancel", response_model=schemas.ShopStockAdjustmentOut)
def cancel_shop_adjustment(adjustment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    adj = db.query(models.ShopStockAdjustment).get(adjustment_id)
    if not adj:
        raise HTTPException(404, "Adjustment not found")
    if adj.status != "active":
        raise HTTPException(400, "Adjustment is already cancelled")
    adj.status = "cancelled"
    adj.modified_at = datetime.utcnow()
    adj.modified_by = by
    db.add(adj)
    db.commit()
    db.refresh(adj)
    return adj


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
def create_supply_customer(shop_id: UUID, payload: schemas.ShopSupplyCustomerCreate, db: Session = Depends(get_db)):
    shop = _get_shop(db, shop_id)
    customer = models.ShopSupplyCustomer(
        shop_id=shop.id, name=payload.name, mobile=payload.mobile, address=payload.address,
        opening_balance=payload.opening_balance, current_balance=payload.opening_balance,
        status="active", entered_by=payload.entered_by,
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


# ---------- Supply Customer Payments ----------

@router.post("/{shop_id}/customers/{supply_customer_id}/payments", response_model=schemas.ShopCustomerPaymentOut, status_code=201)
def create_customer_payment(
    shop_id: UUID, supply_customer_id: UUID, payload: schemas.ShopCustomerPaymentCreate, db: Session = Depends(get_db)
):
    shop = _get_shop(db, shop_id)
    customer = db.query(models.ShopSupplyCustomer).get(supply_customer_id)
    if not customer or customer.shop_id != shop.id:
        raise HTTPException(404, "Supply customer not found for this shop")
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    payment = models.ShopCustomerPayment(
        display_id=next_display_id(db, models.ShopCustomerPayment, "SHCPAY", width=6),
        date=payload.date, shop_id=shop.id, supply_customer_id=customer.id,
        amount=payload.amount, method=payload.method, notes=payload.notes,
        status="active", entered_by=payload.entered_by,
    )
    db.add(payment)
    customer.current_balance = customer.current_balance - payload.amount
    db.add(customer)
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
    return schemas.ShopExpenseTransactionOut(
        id=txn.id, display_id=txn.display_id, date=txn.date, shop_id=txn.shop_id,
        total_amount=txn.total_amount, payment_source=txn.payment_source, notes=txn.notes,
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
def create_shop_expense(shop_id: UUID, payload: schemas.ShopExpenseTransactionCreate, db: Session = Depends(get_db)):
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
        if not db.query(models.ExpenseCategory).get(line.category_id):
            raise HTTPException(404, f"Expense category {line.category_id} not found")

    total = sum((l.amount for l in payload.lines), Decimal("0"))
    txn = models.ShopExpenseTransaction(
        display_id=next_display_id(db, models.ShopExpenseTransaction, "SHEXP", width=6),
        date=payload.date, shop_id=shop.id, total_amount=total,
        payment_source=payload.payment_source, notes=payload.notes,
        status="active", entered_by=payload.entered_by,
    )
    db.add(txn)
    db.flush()
    for line in payload.lines:
        db.add(models.ShopExpenseLine(
            expense_transaction_id=txn.id, category_id=line.category_id,
            line_type=line.line_type, amount=line.amount, description=line.description,
        ))
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
    txn.status = "cancelled"
    txn.modified_at = datetime.utcnow()
    txn.modified_by = by
    db.add(txn)
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
        if s.payment_type == "credit":
            sc = supply_customers.get(s.supply_customer_id)
            rows.append(schemas.ShopBusinessLedgerRow(
                kind="credit_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
                description=f"Credit Sale to {sc.name if sc else 'Unknown'} — {product_name} × {qty_label}",
                amount=s.total_amount, cash_impact=Decimal("0"),
                entered_by=s.entered_by, status=s.status,
            ))
        else:
            rows.append(schemas.ShopBusinessLedgerRow(
                kind="cash_sale", date=s.date, ref_id=s.id, display_id=s.display_id,
                description=f"Cash Sale — {product_name} × {qty_label}",
                amount=s.total_amount, cash_impact=s.total_amount,
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
        for t in expense_txns:
            lines = lines_by_txn.get(t.id, [])
            cat_names = ", ".join(categories.get(l.category_id).name if categories.get(l.category_id) else "?" for l in lines)
            has_withdrawal = any(l.line_type == "owner_withdrawal" for l in lines)
            has_expense = any(l.line_type == "expense" for l in lines)
            # A mixed transaction (some expense lines, some owner-withdrawal
            # lines — §36's exact example) still shows as ONE ledger row,
            # matching "one atomic transaction"; category-level totals (used
            # to report Fuel/Salary/... and Owner Withdrawal separately)
            # come from the lines themselves, not from this row's kind.
            kind = "owner_withdrawal" if has_withdrawal and not has_expense else "expense"
            rows.append(schemas.ShopBusinessLedgerRow(
                kind=kind, date=t.date, ref_id=t.id, display_id=t.display_id,
                description=(cat_names or "Expense") + (f" — {t.notes}" if t.notes else ""),
                amount=t.total_amount, cash_impact=-t.total_amount,
                entered_by=t.entered_by, status=t.status,
            ))

    dowa_payments = db.query(models.Payment).filter(
        models.Payment.customer_id == shop_id, models.Payment.status == "active", models.Payment.unified_sale_id.is_(None),
        models.Payment.date >= month_start, models.Payment.date < next_month,
    ).all()
    for p in dowa_payments:
        rows.append(schemas.ShopBusinessLedgerRow(
            kind="dowa_payment", date=p.date, ref_id=p.id, display_id=p.display_id,
            description=f"Payment to Dowa · {p.method}",
            amount=p.amount, cash_impact=-p.amount,
            entered_by=p.entered_by, status=p.status,
        ))

    rows.sort(key=lambda r: r.date, reverse=True)

    return schemas.ShopBusinessLedgerOut(business_date=business_date, cash=cash, rows=rows)
