from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.reporting.invoice_pdf import render_unified_sale_invoice_pdf
from app.timezone import KARACHI_TZ
from app.utils import (
    next_display_id, resolve_account_or_bucket, compute_gst, resync_unified_sale_batch_totals,
    is_salary_category, apply_salary_expense_if_needed,
)
from app.routers.payments import _reverse_payment

router = APIRouter(prefix="/sales", tags=["unified-sale"], dependencies=[Depends(require_active_user), Depends(require_csrf)])

EPSILON = Decimal("0.01")  # rounding tolerance for the settlement-sum check


def _dec(value) -> Decimal:
    """Coerce a possibly-NULL numeric column to Decimal('0') so ledger math
    never blows up on None (e.g. a balance that was never initialized)."""
    return value if value is not None else Decimal("0")


def _try_uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _resolve_destination(db: Session, settlement: schemas.UnifiedSaleSettlement, purchase_plant_id):
    """Validates and normalizes settlement routing, defaulting an empty
    target_plant_id to the purchase plant itself (old-behavior default).
    Returns (destination_type, target_plant_id, account_id_str)."""
    destination_type = settlement.destination_type or "plant"
    if destination_type == "plant":
        target_plant_id = settlement.target_plant_id or purchase_plant_id
        if not db.query(models.Company).get(target_plant_id):
            raise HTTPException(404, "Target plant not found")
        return destination_type, target_plant_id, None

    if not settlement.account_id:
        raise HTTPException(400, "account_id is required when destination_type is 'account'")
    account_uuid = _try_uuid(settlement.account_id)
    if account_uuid and not db.query(models.PaymentAccount).get(account_uuid):
        raise HTTPException(404, "Payment account not found")
    return destination_type, None, str(settlement.account_id)


def _home_expense_total(s: schemas.UnifiedSaleSettlement) -> Decimal:
    """§ Multi-line Categorized Home Expense — when home_expense_lines is
    given (non-empty), it REPLACES the legacy single home_expense_amount
    entirely for this settlement's math; every downstream calc (bypass_sum,
    net_plant_payment, batch.home_expense_amount) uses this instead of
    s.home_expense_amount directly, so both paths share the exact same
    math from here on (mirrors routers/shops.py's home_expense_total)."""
    lines = s.home_expense_lines or []
    if lines:
        return sum((l.amount for l in lines), Decimal("0"))
    return s.home_expense_amount


def _validate_and_load(db: Session, payload: schemas.UnifiedSaleCreate):
    """Shared by create and edit — validates every referenced entity and the
    settlement rule up front, before anything is written. Settled money is
    exactly: home_expense + owner_drawings + net_plant_payment (computed,
    never entered) = total_credit_received."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    # Payment-Only (§ Payment-Only Pending Approval) has no purchase plant —
    # no items, nothing loaded. plant_id is required whenever there's an
    # actual item to load; company stays None otherwise (batch.company_id
    # NULL is how the rest of this module tells a Payment-Only batch apart
    # from an ordinary Full Sale).
    company = None
    if payload.plant_id:
        company = db.query(models.Company).get(payload.plant_id)
        if not company:
            raise HTTPException(404, "Plant not found")
    elif payload.items:
        raise HTTPException(400, "plant_id is required when items are present")

    products_by_id = {}
    for item in payload.items:
        if item.product_id not in products_by_id:
            product = db.query(models.Product).get(item.product_id)
            if not product:
                raise HTTPException(404, f"Product {item.product_id} not found")
            products_by_id[item.product_id] = product

    s = payload.settlement
    home_expense_lines = s.home_expense_lines or []
    use_home_expense_lines = bool(home_expense_lines)
    home_expense_total = _home_expense_total(s)

    bypass_sum = home_expense_total + s.owner_drawings_amount
    if bypass_sum > s.total_credit_received + EPSILON:
        raise HTTPException(
            400,
            f"Home expense ({home_expense_total}) + owner drawings ({s.owner_drawings_amount}) "
            f"= {bypass_sum} exceeds total credit received ({s.total_credit_received}) — "
            f"nothing would be left to settle with the plant.",
        )

    if use_home_expense_lines:
        for line in home_expense_lines:
            if line.amount > 0 and not db.query(models.ExpenseCategory).get(line.category_id):
                raise HTTPException(404, "Expense category not found")
            # Employee Salary Tracking (§ Employee Salary Tracking) — same
            # check as ShopSaleCreate's home_expense_lines handling.
            if line.amount > 0 and is_salary_category(db, line.category_id) and not line.employee_id:
                raise HTTPException(400, "Employee is required when a Home Expense line's category is Salary")
    else:
        if s.home_expense_amount > 0 and not s.home_expense_category_id:
            raise HTTPException(400, "home_expense_category_id is required when home_expense_amount > 0")
        if s.home_expense_category_id:
            if not db.query(models.ExpenseCategory).get(s.home_expense_category_id):
                raise HTTPException(404, "Expense category not found")

    destination_type, target_plant_id, account_id = _resolve_destination(db, s, payload.plant_id)

    return customer, company, products_by_id, destination_type, target_plant_id, account_id


def _sync_legacy_status(batch: models.UnifiedSaleBatch) -> None:
    """Keeps the legacy aggregate `status` (still read by the Payments
    Register and Cash Management pages, which only want fully-posted
    batches) derived from the two independent sub-statuses — 'approved'
    only once BOTH sides have posted, 'cancelled' if either side was
    cancelled, else 'pending'. The approval endpoints below never read
    `status` themselves; only sale_status/payment_status gate posting."""
    if batch.sale_status == "cancelled" or batch.payment_status == "cancelled":
        batch.status = "cancelled"
    elif batch.sale_status == "approved" and batch.payment_status == "approved":
        batch.status = "approved"
        batch.approved_at = batch.payment_approved_at or batch.sale_approved_at
        batch.approved_by = batch.payment_approved_by or batch.sale_approved_by
    else:
        batch.status = "pending"


def _create_pending_children(db: Session, payload: schemas.UnifiedSaleCreate, batch, products_by_id, entered_by: str):
    """Creates Sale/Purchase/CompanyPayment/Expense/OwnerDrawings rows with
    status='pending' and unified_sale_id set — none of these touch any
    balance yet. That only happens on /approve.

    The CompanyPayment (3-way settlement) child is only created when the
    batch is routed to a plant (batch.destination_type == "plant") — it
    targets batch.target_plant_id, which may differ from the purchase
    plant. When routed to an account instead, no pending child represents
    it; /approve credits the account balance directly from the batch's own
    destination_type/account_id."""
    s = payload.settlement
    sales_created, purchases_created = [], []

    for item in payload.items:
        product = products_by_id[item.product_id]

        sale = models.Sale(
            display_id=next_display_id(db, models.Sale, "SALE", width=6),
            date=payload.date, customer_id=payload.customer_id, product_id=item.product_id,
            company_id=payload.plant_id, quantity=item.quantity, weight_per_cylinder=product.weight_kg,
            total_kg=item.quantity * product.weight_kg,
            rate_per_kg=round(item.selling_rate / product.weight_kg, 2) if product.weight_kg else None,
            rate_per_cylinder=item.selling_rate, total_amount=item.quantity * item.selling_rate,
            grand_total=item.quantity * item.selling_rate,
            gate_pass_no=payload.gate_pass_no, vehicle_no=payload.vehicle_no, notes=payload.notes,
            status="pending", entered_by=entered_by, unified_sale_id=batch.id,
        )
        db.add(sale)
        db.flush()
        sales_created.append(sale)

        purchase = models.Purchase(
            display_id=next_display_id(db, models.Purchase, "PUR", width=6),
            date=payload.date, company_id=payload.plant_id, product_id=item.product_id,
            quantity=item.quantity, weight_per_cylinder=product.weight_kg,
            total_kg=item.quantity * product.weight_kg,
            rate_per_kg=round(item.purchase_rate / product.weight_kg, 2) if product.weight_kg else None,
            rate_per_cylinder=item.purchase_rate, total_amount=item.quantity * item.purchase_rate,
            gate_pass_no=payload.gate_pass_no, vehicle_no=payload.vehicle_no, notes=payload.notes,
            status="pending", entered_by=entered_by, unified_sale_id=batch.id,
        )
        db.add(purchase)
        db.flush()
        purchases_created.append(purchase)

    home_expense_lines = s.home_expense_lines or []
    use_home_expense_lines = bool(home_expense_lines)
    home_expense_total = _home_expense_total(s)

    net_plant_payment = s.total_credit_received - home_expense_total - s.owner_drawings_amount

    plant_payment = None
    if net_plant_payment > 0 and batch.destination_type == "plant":
        plant_payment = models.CompanyPayment(
            display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
            date=payload.date, company_id=batch.target_plant_id, amount=net_plant_payment,
            method="direct_settlement", account_id=None,
            notes=f"3-way settlement via Unified Sale {batch.display_id} — customer paid plant directly",
            status="pending", entered_by=entered_by, unified_sale_id=batch.id,
        )
        db.add(plant_payment)
        db.flush()

    # § Multi-line Categorized Home Expense — one UnifiedSaleHomeExpenseLine
    # + one pending Expense row per entry, mirroring routers/shops.py's
    # single-amount-vs-lines branch. Both the structured line and its
    # matching Expense are created now (status="pending" on the Expense,
    # same as the legacy single-amount path below) — neither posts any
    # balance until _do_approve_payment activates the Expense. Salary
    # balance reduction (apply_salary_expense_if_needed) is deliberately
    # NOT called here — unlike Shop Sale (single-phase, posts immediately),
    # a Unified Sale's settlement doesn't actually happen until approval,
    # so that call lives in _do_approve_payment instead.
    expenses_created = []
    if use_home_expense_lines:
        for line in home_expense_lines:
            if line.amount <= 0:
                continue
            db.add(models.UnifiedSaleHomeExpenseLine(
                unified_sale_id=batch.id, category_id=line.category_id,
                employee_id=line.employee_id, amount=line.amount,
                description=line.description,
            ))
            expense = models.Expense(
                display_id=next_display_id(db, models.Expense, "EXP", width=6),
                date=payload.date, category_id=line.category_id, amount=line.amount,
                account_id=None, method="cash",
                description=line.description or f"Auto-created from Unified Sale {batch.display_id}",
                status="pending", entered_by=entered_by, unified_sale_id=batch.id,
                employee_id=line.employee_id,
            )
            db.add(expense)
            # Flush before the NEXT iteration's next_display_id call — same
            # duplicate-display_id race already found and fixed for Shop
            # Sale's multi-line loop (see routers/shops.py).
            db.flush()
            expenses_created.append(expense)
    elif s.home_expense_amount > 0:
        expense = models.Expense(
            display_id=next_display_id(db, models.Expense, "EXP", width=6),
            date=payload.date, category_id=s.home_expense_category_id, amount=s.home_expense_amount,
            account_id=None, method="cash", description=f"Auto-created from Unified Sale {batch.display_id}",
            status="pending", entered_by=entered_by, unified_sale_id=batch.id,
        )
        db.add(expense)
        db.flush()
        expenses_created.append(expense)

    owner_drawing = None
    if s.owner_drawings_amount > 0:
        owner_drawing = models.OwnerDrawings(
            display_id=next_display_id(db, models.OwnerDrawings, "DRAW", width=6),
            date=payload.date, amount=s.owner_drawings_amount, account_id=None,
            notes=f"Auto-created from Unified Sale {batch.display_id}",
            status="pending", entered_by=entered_by, unified_sale_id=batch.id,
        )
        db.add(owner_drawing)
        db.flush()

    return sales_created, purchases_created, plant_payment, expenses_created, owner_drawing


def _batch_to_out(db: Session, batch, sales, purchases, plant_payment, expenses, owner_drawing) -> schemas.UnifiedSaleOut:
    home_expense_lines = (
        db.query(models.UnifiedSaleHomeExpenseLine)
        .filter(models.UnifiedSaleHomeExpenseLine.unified_sale_id == batch.id)
        .all()
    )
    return schemas.UnifiedSaleOut(
        id=batch.id, display_id=batch.display_id, date=batch.date,
        customer_id=batch.customer_id, company_id=batch.company_id,
        total_selling_amount=batch.total_selling_amount, total_purchase_amount=batch.total_purchase_amount,
        delivery_charges=batch.delivery_charges,
        total_credit_received=batch.total_credit_received, net_plant_payment=batch.net_plant_payment,
        home_expense_amount=batch.home_expense_amount, owner_drawings_amount=batch.owner_drawings_amount,
        destination_type=batch.destination_type, target_plant_id=batch.target_plant_id, account_id=batch.account_id,
        vehicle_no=batch.vehicle_no, gate_pass_no=batch.gate_pass_no, notes=batch.notes,
        payment_reference=batch.payment_reference,
        settlement_corrected_by=batch.settlement_corrected_by,
        settlement_corrected_at=batch.settlement_corrected_at,
        settlement_correction_reason=batch.settlement_correction_reason,
        gst_enabled=batch.gst_enabled, gst_rate=batch.gst_rate, gst_amount=batch.gst_amount, grand_total=batch.grand_total,
        status=batch.status, approved_at=batch.approved_at, approved_by=batch.approved_by,
        sale_status=batch.sale_status, sale_approved_at=batch.sale_approved_at, sale_approved_by=batch.sale_approved_by,
        payment_status=batch.payment_status, payment_approved_at=batch.payment_approved_at, payment_approved_by=batch.payment_approved_by,
        entered_by=batch.entered_by, created_at=batch.created_at,
        sales=[schemas.SaleOut.model_validate(x) for x in sales],
        purchases=[schemas.PurchaseOut.model_validate(x) for x in purchases],
        plant_payment=schemas.CompanyPaymentOut.model_validate(plant_payment) if plant_payment else None,
        expense=schemas.ExpenseOut.model_validate(expenses[0]) if expenses else None,
        owner_drawing=schemas.OwnerDrawingsOut.model_validate(owner_drawing) if owner_drawing else None,
        home_expense_lines=[schemas.UnifiedSaleHomeExpenseLineOut.model_validate(x) for x in home_expense_lines],
    )


def _load_children(db: Session, batch_id):
    """plant_payment/expenses/owner_drawing: excludes "cancelled" (not just
    "active") because approve_unified_sale_payment needs to find the still-
    "pending" one(s) to activate — but MUST exclude cancelled, because
    correct_unified_sale_settlement (§ Bug Fix — Correction Modal Routing)
    cancels the old ones and posts fresh rows with the SAME unified_sale_id
    rather than mutating them in place (an uncorrupted audit trail — see
    models.UnifiedSaleBatch.settlement_corrected_by). plant_payment/
    owner_drawing stay single-row (.first(), newest first) — a batch never
    has more than one of either — but expenses is a LIST (§ Multi-line
    Categorized Home Expense): a batch can have zero, one (legacy
    single-amount), or many (multi-line) active Expense rows at once, and
    summing/activating via .all() here — never .first() — is required for
    a multi-line settlement's math to stay correct, the same bug class
    already found and fixed for Shop Sale (see routers/shops.py::
    _reverse_shop_sale_settlement)."""
    sales = db.query(models.Sale).filter(models.Sale.unified_sale_id == batch_id).order_by(models.Sale.created_at).all()
    purchases = db.query(models.Purchase).filter(models.Purchase.unified_sale_id == batch_id).order_by(models.Purchase.created_at).all()
    plant_payment = (
        db.query(models.CompanyPayment)
        .filter(models.CompanyPayment.unified_sale_id == batch_id, models.CompanyPayment.status != "cancelled")
        .order_by(models.CompanyPayment.created_at.desc()).first()
    )
    expenses = (
        db.query(models.Expense)
        .filter(models.Expense.unified_sale_id == batch_id, models.Expense.status != "cancelled")
        .order_by(models.Expense.created_at).all()
    )
    owner_drawing = (
        db.query(models.OwnerDrawings)
        .filter(models.OwnerDrawings.unified_sale_id == batch_id, models.OwnerDrawings.status != "cancelled")
        .order_by(models.OwnerDrawings.created_at.desc()).first()
    )
    return sales, purchases, plant_payment, expenses, owner_drawing


@router.get("/unified", response_model=list[schemas.UnifiedSaleBatchOut])
def list_unified_sales(
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    month: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.UnifiedSaleBatch)
    if customer_id:
        q = q.filter(models.UnifiedSaleBatch.customer_id == customer_id)
    if status:
        q = q.filter(models.UnifiedSaleBatch.status == status)
    rows = q.order_by(models.UnifiedSaleBatch.date.desc(), models.UnifiedSaleBatch.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]

    result = []
    for r in rows:
        # Batch ke child sales record fetch karein
        sales = db.query(models.Sale).filter(models.Sale.unified_sale_id == r.id).all()
        
        qty_11_8 = Decimal("0")
        qty_45_4 = Decimal("0")
        total_kg = Decimal("0")

        for sale in sales:
            # Total KG accumulate karein
            if sale.total_kg:
                total_kg += Decimal(str(sale.total_kg))

            # Weight classification based on weight_per_cylinder
            w = float(sale.weight_per_cylinder or 0)
            if 11.0 <= w <= 12.5:  # Matches 11.8 KG Cylinders
                qty_11_8 += Decimal(str(sale.quantity))
            elif 44.0 <= w <= 47.0:  # Matches 45.4 KG Cylinders
                qty_45_4 += Decimal(str(sale.quantity))

        # Schema output build karein
        out = schemas.UnifiedSaleBatchOut.model_validate(r)
        out.qty_11_8kg = qty_11_8
        out.qty_45_4kg = qty_45_4
        out.total_kg = total_kg
        result.append(out)

    return result


@router.get("/unified/{unified_sale_id}", response_model=schemas.UnifiedSaleOut)
def get_unified_sale(unified_sale_id: UUID, db: Session = Depends(get_db)):
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    sales, purchases, payment, expenses, owner_drawing = _load_children(db, batch.id)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)


@router.get("/unified/{unified_sale_id}/invoice")
def get_unified_sale_invoice(
    unified_sale_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """One combined invoice PDF for the whole batch (§ One Invoice for
    Multi-Item Sales) — every child Sale line item on one document under
    the batch's own display_id, instead of a separate invoice per product.
    Read-only, on-demand, never stored to disk — same convention as
    routers/sales.py's get_sale_invoice."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    sales, _, _, _, _ = _load_children(db, batch.id)
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_unified_sale_invoice_pdf(batch, sales, current_user.name, generated_at)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{batch.display_id}.pdf"'},
    )


@router.post("/unified", response_model=schemas.UnifiedSaleOut, status_code=201)
def create_unified_sale(
    payload: schemas.UnifiedSaleCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Creates a PENDING Unified Sale."""
    customer, company, products_by_id, destination_type, target_plant_id, account_id = _validate_and_load(db, payload)

    try:
        # Delivery charges fold straight into total_selling_amount — the
        # customer owes it exactly like another item's total would, and it
        # flows into net_plant_payment through total_credit_received below
        # the same way the rest of the sale amount does. Never added to
        # total_purchase_amount — it's pure margin, no plant cost behind it.
        total_selling_amount = sum((item.quantity * item.selling_rate for item in payload.items), Decimal("0")) + payload.delivery_charges
        total_purchase_amount = sum((item.quantity * item.purchase_rate for item in payload.items), Decimal("0"))
        s = payload.settlement
        home_expense_total = _home_expense_total(s)

        net_plant_payment = s.total_credit_received - home_expense_total - s.owner_drawings_amount

        # GST on Sale, extended to Unified Sale (§ GST on Sale) — computed
        # once here from total_selling_amount and frozen on the batch;
        # grand_total (never total_selling_amount) is what
        # approve_unified_sale_sale posts to the customer's balance/ledger.
        gst_enabled, gst_rate, gst_amount, grand_total = compute_gst(
            total_selling_amount, payload.gst_enabled, payload.gst_rate
        )

        batch = models.UnifiedSaleBatch(
            display_id=next_display_id(db, models.UnifiedSaleBatch, "USALE", width=6),
            date=payload.date,
            customer_id=payload.customer_id,
            company_id=payload.plant_id,
            total_selling_amount=total_selling_amount,
            total_purchase_amount=total_purchase_amount,
            delivery_charges=payload.delivery_charges,
            total_credit_received=s.total_credit_received,
            net_plant_payment=net_plant_payment,
            home_expense_amount=home_expense_total,
            owner_drawings_amount=s.owner_drawings_amount,
            destination_type=destination_type,
            target_plant_id=target_plant_id,
            account_id=account_id,
            payment_reference=s.payment_reference,
            vehicle_no=payload.vehicle_no,
            gate_pass_no=payload.gate_pass_no,
            notes=payload.notes,
            gst_enabled=gst_enabled,
            gst_rate=gst_rate,
            gst_amount=gst_amount,
            grand_total=grand_total,
            status="pending",
            sale_status="pending",
            payment_status="pending",
            entered_by=current_user.name,
        )
        db.add(batch)
        db.flush()

        sales, purchases, payment, expenses, owner_drawing = _create_pending_children(db, payload, batch, products_by_id, current_user.name)
        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Unified sale failed, nothing was saved: {e}")

    db.refresh(batch)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)


@router.put("/unified/{unified_sale_id}", response_model=schemas.UnifiedSaleOut)
def edit_unified_sale(
    unified_sale_id: UUID, payload: schemas.UnifiedSaleEdit, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Only allowed while PENDING."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.sale_status != "pending" or batch.payment_status != "pending":
        raise HTTPException(400, "Cannot edit — sale or payment has already been approved/cancelled")

    customer, company, products_by_id, destination_type, target_plant_id, account_id = _validate_and_load(db, payload)

    try:
        for model in (
            models.Sale, models.Purchase, models.CompanyPayment, models.Expense, models.OwnerDrawings,
            models.UnifiedSaleHomeExpenseLine,
        ):
            db.query(model).filter(model.unified_sale_id == batch.id).delete()
        db.flush()

        total_selling_amount = sum((item.quantity * item.selling_rate for item in payload.items), Decimal("0")) + payload.delivery_charges
        total_purchase_amount = sum((item.quantity * item.purchase_rate for item in payload.items), Decimal("0"))
        s = payload.settlement
        home_expense_total = _home_expense_total(s)

        net_plant_payment = s.total_credit_received - home_expense_total - s.owner_drawings_amount

        # GST on Sale, extended to Unified Sale (§ GST on Sale) — recomputed
        # from this edit's own total_selling_amount/gst_rate, same as every
        # other field here being fully replaced by the edit, not patched.
        gst_enabled, gst_rate, gst_amount, grand_total = compute_gst(
            total_selling_amount, payload.gst_enabled, payload.gst_rate
        )

        batch.date = payload.date
        batch.customer_id = payload.customer_id
        batch.company_id = payload.plant_id
        batch.total_selling_amount = total_selling_amount
        batch.total_purchase_amount = total_purchase_amount
        batch.delivery_charges = payload.delivery_charges
        batch.total_credit_received = s.total_credit_received
        batch.net_plant_payment = net_plant_payment
        batch.home_expense_amount = home_expense_total
        batch.owner_drawings_amount = s.owner_drawings_amount
        batch.destination_type = destination_type
        batch.target_plant_id = target_plant_id
        batch.account_id = account_id
        batch.payment_reference = s.payment_reference
        batch.vehicle_no = payload.vehicle_no
        batch.gate_pass_no = payload.gate_pass_no
        batch.notes = payload.notes
        batch.gst_enabled = gst_enabled
        batch.gst_rate = gst_rate
        batch.gst_amount = gst_amount
        batch.grand_total = grand_total
        db.add(batch)
        db.flush()

        sales, purchases, payment, expenses, owner_drawing = _create_pending_children(db, payload, batch, products_by_id, current_user.name)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Edit failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)


def _do_approve_sale(db: Session, batch: models.UnifiedSaleBatch, sales, purchases, by: str) -> None:
    """Body of the sale/load approval — customer ledger, purchase-plant
    payable, Sale/Purchase child rows. No commit/rollback — the caller
    (approve_unified_sale_sale for a Full Sale, or approve_payment_only for
    a Payment-Only batch, which has no separate sale side for a human to
    approve) owns the transaction."""
    if batch.sale_status != "pending":
        raise HTTPException(400, f"Cannot approve sale — already {batch.sale_status}")

    customer = db.query(models.Customer).get(batch.customer_id)
    # None for a Payment-Only batch (no purchase plant) — see
    # UnifiedSaleCreate.plant_id. Every step below already guards on it.
    company = db.query(models.Company).get(batch.company_id) if batch.company_id else None

    # ---- Customer Balance Adjustment ----
    # New Balance = Current Balance + Selling Amount - Credit Received.
    # total_credit_received is money the customer already handed over
    # at the point of sale/delivery — it settles the customer's side
    # right away, independent of whether/when that cash later gets
    # routed on to the plant or a Dowa account (that's the separate
    # payment/settlement approval below). All operands Decimal-coerced
    # — a NULL current_balance must never crash approval.
    current_balance = _dec(customer.current_balance)
    # grand_total (incl. GST when enabled), never total_selling_amount —
    # GST is money the customer owes, not business revenue (§ GST on Sale).
    # Zero for a Payment-Only batch (no items, nothing sold) — this then
    # correctly reduces to "balance -= credit_received", a plain payment.
    selling_amount = _dec(batch.grand_total)
    credit_received = _dec(batch.total_credit_received)

    balance_before_settlement = current_balance + selling_amount
    excess = credit_received - balance_before_settlement
    excess_amount = excess if excess > 0 else None

    customer.current_balance = balance_before_settlement - credit_received
    customer.last_transaction_at = batch.date
    customer.last_overpayment_amount = excess_amount
    customer.last_overpayment_date = batch.date if excess_amount else None
    if excess_amount:
        customer.account_credit = _dec(customer.account_credit) + excess_amount
    db.add(customer)

    # ---- Payment record for total_credit_received (reporting/audit
    # trail only — SAFETY: this must NEVER go through
    # routers.payments._apply_payment or replicate its balance-mutating
    # lines, since customer.current_balance was JUST fully computed
    # above in one combined formula (selling_amount - credit_received);
    # calling _apply_payment here would subtract credit_received a
    # SECOND time. This is a plain models.Payment(...) + db.add() with
    # zero balance side effects, exactly like the sibling
    # CompanyPayment/Expense/OwnerDrawings children below (account_id=
    # None — this cash hasn't landed in any Dowa account yet, it's
    # routed onward at settlement, see _do_approve_payment).
    # Only created once credit_received > 0, same "> 0" guard those
    # siblings use. status="active" immediately, unlike those siblings
    # (which start "pending"): this row's real-world event and its
    # balance effect both already happened, right here, gated by
    # sale_status, not payment_status.
    if credit_received > 0:
        db.add(models.Payment(
            display_id=next_display_id(db, models.Payment, "PAY", width=6),
            date=batch.date, customer_id=batch.customer_id, amount=credit_received,
            method="unified_sale_credit", account_id=None, source_account_id=None,
            notes=f"Collected at Unified Sale {batch.display_id} — routed onward at settlement",
            status="active", entered_by=batch.entered_by, unified_sale_id=batch.id,
        ))

    # ---- Purchase Plant Balance (grows by the cost of goods loaded —
    # this is the sale/load event, regardless of where the settlement
    # money is later routed to). None for a Payment-Only batch — no plant,
    # no total_purchase_amount, nothing to post here. ----
    if company:
        company.current_balance = _dec(company.current_balance) + _dec(batch.total_purchase_amount)
        db.add(company)

    # Shop Management (§ Shop spec, "one transaction, no duplication") —
    # mirrors routers/sales.py's _apply_sale exactly. This is the ONLY
    # Sale entry point actually reachable from the UI (Shell's "Sale"
    # nav goes to /unified-sale; /new-sale, which has its own copy of
    # this block, is not linked), so without this a Load to a Shop
    # customer would post to the customer's balance/plant payable like
    # any other Sale but silently never create the ShopStockBatch the
    # Shop dashboard's stock figures depend on. Posted here rather than
    # in _create_pending_children because this — approval — is the
    # moment a Sale actually becomes "active" and posts financially;
    # a pending, not-yet-approved Load must not already be sitting in
    # the shop's physical stock. source_sale_id=sale.id lets
    # routers/sales.py's _reverse_sale (used by /sales/{id}/cancel and
    # /sales/{id}/correct — see CorrectTransactionModal on the Shop
    # Detail page) find and reverse this batch precisely, the same way
    # it already does for a batch created via the direct Sale flow.
    # Empty for a Payment-Only batch — loop is simply a no-op.
    for sale in sales:
        sale.status = "active"
        db.add(sale)
        if customer.customer_type == "shop":
            db.add(models.ShopStockBatch(
                customer_id=customer.id,
                product_id=sale.product_id,
                source_sale_id=sale.id,
                transaction_date=sale.date,
                quantity_received=sale.quantity,
                quantity_remaining=sale.quantity,
                load_rate_per_kg=(sale.rate_per_cylinder / sale.weight_per_cylinder) if sale.weight_per_cylinder else 0,
                status="active",
                entered_by=by,
            ))
    for purchase in purchases:
        purchase.status = "active"
        db.add(purchase)

    batch.sale_status = "approved"
    # Naive UTC — matches every other DateTime column's storage
    # convention (datetime.utcnow()). An AWARE datetime bound to this
    # naive column would get silently shifted by Postgres's
    # Asia/Karachi session timezone before storage, then shifted AGAIN
    # by the frontend's UTC->Asia/Karachi display conversion — a +5h
    # double offset (§ Double Timezone Offset Fix). See app/timezone.py.
    batch.sale_approved_at = datetime.utcnow()
    batch.sale_approved_by = by
    _sync_legacy_status(batch)
    db.add(batch)


def _do_approve_payment(db: Session, batch: models.UnifiedSaleBatch, payment, expenses, owner_drawing, by: str, reference: Optional[str]) -> None:
    """Body of the plant payment/settlement approval — settlement routing,
    CompanyPayment/Expense/OwnerDrawings child rows. No commit/rollback —
    see _do_approve_sale."""
    if batch.payment_status != "pending":
        raise HTTPException(400, f"Cannot approve payment — already {batch.payment_status}")

    if reference:
        batch.payment_reference = reference

    # ---- Settlement Routing ----
    # Net Plant Payment = Credit Received - Home Expense - Owner Drawings
    # (already computed onto the batch at create/edit time). Where it
    # actually posts depends on destination_type — it must NEVER
    # unconditionally reduce the purchase plant's payable, since the
    # customer may have routed it to a different plant or a Dowa account
    # entirely (§ Settlement Routing).
    net_plant_payment = _dec(batch.net_plant_payment)
    if net_plant_payment > 0:
        if batch.destination_type == "account":
            # A fixed bucket key (office_cash | owner_home | dowa_account)
            # resolves to the same real PaymentAccount row Cash Management
            # reads — see resolve_account_or_bucket — so both pages stay
            # in sync with this credit.
            account_row = resolve_account_or_bucket(db, batch.account_id)
            if account_row:
                account_row.current_balance = _dec(account_row.current_balance) + net_plant_payment
                db.add(account_row)
        else:
            # batch.company_id is None for a Payment-Only batch, but that's
            # fine — destination_type=="plant" there always has an explicit
            # target_plant_id (required at create time, see
            # frontend's paymentOnlyDestinationValid), so this never
            # actually falls back to a None company_id in practice.
            target_id = batch.target_plant_id or batch.company_id
            target_company = db.query(models.Company).get(target_id) if target_id else None
            if target_company:
                target_company.current_balance = _dec(target_company.current_balance) - net_plant_payment
                db.add(target_company)

    if payment:
        payment.status = "active"
        db.add(payment)
    # § Multi-line Categorized Home Expense — activate EVERY pending
    # Expense row (0, 1, or N — see _load_children), not just one.
    # apply_salary_expense_if_needed runs HERE, at approval, not at
    # creation (_create_pending_children) — unlike Shop Sale's single-
    # phase posting, a Unified Sale's settlement genuinely hasn't happened
    # yet until this call, so the employee balance must not move earlier.
    # § Salary payments are never clawed back (deliberate, permanent
    # design — see utils.apply_salary_expense_if_needed's own docstring).
    # Once this posts, cancel_unified_sale and correct_unified_sale_
    # settlement both only ever cancel the Expense row's status — neither
    # may add the amount back onto Employee.current_balance, even though
    # every other settlement effect (plant/account routing, non-Salary
    # Home Expense, Owner Drawings) does fully reverse on cancel/correct.
    for expense in expenses:
        expense.status = "active"
        db.add(expense)
        apply_salary_expense_if_needed(db, expense.category_id, expense.employee_id, expense.amount, by=by)
    if owner_drawing:
        owner_drawing.status = "active"
        db.add(owner_drawing)

    batch.payment_status = "approved"
    batch.payment_approved_at = datetime.utcnow()
    batch.payment_approved_by = by
    _sync_legacy_status(batch)
    db.add(batch)


@router.post("/unified/{unified_sale_id}/approve-sale", response_model=schemas.UnifiedSaleOut)
def approve_unified_sale_sale(
    unified_sale_id: UUID,
    by: Optional[str] = Query("system"),
    db: Session = Depends(get_db),
):
    """Posts ONLY the sale/load side of a Unified Sale: customer ledger,
    purchase-plant payable, and the Sale/Purchase child rows. Never touches
    the plant payment/settlement — see approve_unified_sale_payment, which
    is approved completely independently (§ Independent Sale/Payment
    Approval). Guarded by sale_status so calling this twice never re-posts.
    A Payment-Only batch (company_id IS NULL) has nothing meaningful to
    approve here separately — see approve_payment_only instead.

    § Zero-Payment Sale Auto-Approval — when the batch collected nothing
    at all (total_credit_received <= 0), the payment side genuinely has
    nothing to post: the bypass_sum <= total_credit_received validation
    enforced at create/edit time (see _resolve_settlement above) means
    home_expense_amount/owner_drawings_amount must also be 0 whenever
    total_credit_received is 0, so net_plant_payment is 0 and no Payment/
    Expense/OwnerDrawings child row exists to activate either. Rather than
    forcing a separate, meaningless "Approve Payment" click for a batch
    with nothing to approve there, this call also approves payment_status
    in the SAME transaction — the frontend correspondingly never renders
    a separate Approve Payment action for this case (see
    unified-sale/page.tsx). Any batch with a nonzero total_credit_received
    is completely untouched by this: payment_status stays "pending" and
    still requires its own separate approve-payment call, exactly as
    before this change."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")

    sales, purchases, payment, expenses, owner_drawing = _load_children(db, batch.id)

    try:
        _do_approve_sale(db, batch, sales, purchases, by)
        if _dec(batch.total_credit_received) <= 0 and batch.payment_status == "pending":
            _do_approve_payment(db, batch, payment, expenses, owner_drawing, by, None)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Sale approval failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)


@router.post("/unified/{unified_sale_id}/approve-payment", response_model=schemas.UnifiedSaleOut)
def approve_unified_sale_payment(
    unified_sale_id: UUID,
    by: Optional[str] = Query("system"),
    reference: Optional[str] = Query(None, description="Settlement reference (bank transfer/cheque no.), if now known"),
    db: Session = Depends(get_db),
):
    """Posts ONLY the plant payment/settlement side of a Unified Sale: the
    settlement routing (plant payable decrease or Dowa account credit) and
    the CompanyPayment/Expense/OwnerDrawings child rows. Never re-posts the
    sale — see approve_unified_sale_sale, approved completely independently.
    Guarded by payment_status so calling this twice never double-posts."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")

    sales, purchases, payment, expenses, owner_drawing = _load_children(db, batch.id)

    try:
        _do_approve_payment(db, batch, payment, expenses, owner_drawing, by, reference)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Payment approval failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)


@router.post("/unified/{unified_sale_id}/approve", response_model=schemas.UnifiedSaleOut)
def approve_payment_only(
    unified_sale_id: UUID,
    by: Optional[str] = Query("system"),
    reference: Optional[str] = Query(None, description="Settlement reference (bank transfer/cheque no.), if now known"),
    db: Session = Depends(get_db),
):
    """Combined, atomic approval for a Payment-Only batch (§ Payment-Only
    Pending Approval) — company_id IS NULL, no purchase plant, no items.
    There's nothing meaningful to approve on the sale side separately (no
    load to verify happened), so this approves both sale_status and
    payment_status together in one transaction: the customer's balance drops
    by what they paid AND that money is routed to its destination (plant
    payable / Dowa account / Owner Drawings / Home Expense) in the same
    commit. A Full Sale (company_id set) must use approve-sale/
    approve-payment independently instead — this endpoint refuses those, so
    a real Load can never skip its own sale-side approval by accident."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.company_id is not None:
        raise HTTPException(400, "This endpoint is for Payment-Only batches only — use approve-sale/approve-payment for a Full Sale")

    sales, purchases, payment, expenses, owner_drawing = _load_children(db, batch.id)

    try:
        _do_approve_sale(db, batch, sales, purchases, by)
        _do_approve_payment(db, batch, payment, expenses, owner_drawing, by, reference)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Approval failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)


@router.patch("/unified/{unified_sale_id}/correct-settlement", response_model=schemas.UnifiedSaleOut)
def correct_unified_sale_settlement(
    unified_sale_id: UUID,
    payload: schemas.UnifiedSaleSettlementCorrect,
    db: Session = Depends(get_db),
):
    """§ Bug Fix — Correction Modal Routing. Corrects where an ALREADY-
    APPROVED settlement's money went (destination_type/target_plant_id/
    account_id) and the home_expense/owner_drawings split — never
    total_credit_received, which is the SALE side's concern and stays
    exactly what it was (see approve_unified_sale_sale; correcting that
    would mean re-touching the customer's balance, a different operation
    from correcting routing). Reverses exactly what the current settlement
    posted, cancels (never mutates) the old CompanyPayment/Expense/
    OwnerDrawings children, then posts fresh ones with the corrected
    values — same cancel + re-create convention every other correctable
    transaction in this app already uses (see routers/sales.py::
    correct_sale). The audit-trail Payment row itself (see
    approve_unified_sale_sale) is untouched — its amount never changes
    here, and routers/payments.py._attach_destination_info always resolves
    its displayed destination live from this batch, so it reflects the
    correction automatically."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.payment_status != "approved":
        raise HTTPException(400, "Only an approved settlement can be corrected — edit the pending batch instead")

    home_expense_lines = payload.home_expense_lines or []
    use_home_expense_lines = bool(home_expense_lines)
    home_expense_total = _home_expense_total(payload)

    bypass_sum = home_expense_total + payload.owner_drawings_amount
    if bypass_sum > _dec(batch.total_credit_received) + EPSILON:
        raise HTTPException(
            400,
            f"Home expense ({home_expense_total}) + owner drawings ({payload.owner_drawings_amount}) "
            f"= {bypass_sum} exceeds total credit received ({batch.total_credit_received}) — "
            f"nothing would be left to settle.",
        )
    if use_home_expense_lines:
        for line in home_expense_lines:
            if line.amount > 0 and not db.query(models.ExpenseCategory).get(line.category_id):
                raise HTTPException(404, "Expense category not found")
            if line.amount > 0 and is_salary_category(db, line.category_id) and not line.employee_id:
                raise HTTPException(400, "Employee is required when a Home Expense line's category is Salary")
    else:
        if payload.home_expense_amount > 0 and not payload.home_expense_category_id:
            raise HTTPException(400, "home_expense_category_id is required when home_expense_amount > 0")
        if payload.home_expense_category_id and not db.query(models.ExpenseCategory).get(payload.home_expense_category_id):
            raise HTTPException(404, "Expense category not found")

    new_destination_type, new_target_plant_id, new_account_id = _resolve_destination(db, payload, batch.company_id)

    sales, purchases, old_plant_payment, old_expenses, old_owner_drawing = _load_children(db, batch.id)

    try:
        # ---- Reverse exactly what the CURRENT (about-to-be-superseded)
        # settlement posted — mirrors _do_approve_payment's own posting,
        # just subtracting instead of adding and vice versa. ----
        old_net = _dec(batch.net_plant_payment)
        if old_net > 0:
            if batch.destination_type == "account":
                old_account_row = resolve_account_or_bucket(db, batch.account_id)
                if old_account_row:
                    old_account_row.current_balance = _dec(old_account_row.current_balance) - old_net
                    db.add(old_account_row)
            else:
                old_target_id = batch.target_plant_id or batch.company_id
                old_target_company = db.query(models.Company).get(old_target_id) if old_target_id else None
                if old_target_company:
                    old_target_company.current_balance = _dec(old_target_company.current_balance) + old_net
                    db.add(old_target_company)

        # Cancel (never mutate) the old settlement children — an
        # uncorrupted audit trail, same convention as every other
        # correctable transaction in this app.
        #
        # § Salary payments are never clawed back (deliberate, permanent
        # design — see utils.apply_salary_expense_if_needed's docstring).
        # Unlike old_plant_payment/old_owner_drawing above, cancelling a
        # Salary-category old_expenses row here must NOT add its amount
        # back onto Employee.current_balance — that balance was already
        # genuinely reduced when the ORIGINAL settlement was approved
        # (_do_approve_payment), and the correction below posts a brand
        # new deduction for whatever the corrected lines specify, on top
        # of it, not in place of it. Only plant/account routing and non-
        # Salary bypass amounts reverse-then-repost; Salary is cumulative.
        for child in (old_plant_payment, *old_expenses, old_owner_drawing):
            if child and child.status == "active":
                child.status = "cancelled"
                db.add(child)

        # § Multi-line Categorized Home Expense — the structured lines
        # describe the CURRENT composition only (no audit-trail status of
        # their own, unlike Expense), so a correction replaces them
        # outright rather than cancel+recreate.
        db.query(models.UnifiedSaleHomeExpenseLine).filter(
            models.UnifiedSaleHomeExpenseLine.unified_sale_id == batch.id
        ).delete()

        # ---- Post the corrected settlement ----
        new_net_plant_payment = _dec(batch.total_credit_received) - home_expense_total - payload.owner_drawings_amount

        new_plant_payment = None
        if new_net_plant_payment > 0 and new_destination_type == "plant":
            new_plant_payment = models.CompanyPayment(
                display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
                date=batch.date, company_id=new_target_plant_id, amount=new_net_plant_payment,
                method="direct_settlement", account_id=None,
                notes=f"Settlement correction of Unified Sale {batch.display_id} — {payload.correction_reason}",
                status="active", entered_by=payload.corrected_by, unified_sale_id=batch.id,
            )
            db.add(new_plant_payment)
            db.flush()

        # § Multi-line Categorized Home Expense — already-approved batch,
        # so (unlike _create_pending_children) these post as "active"
        # immediately, same as new_plant_payment/new_owner_drawing above,
        # including the salary balance reduction right away.
        new_expenses = []
        if use_home_expense_lines:
            for line in home_expense_lines:
                if line.amount <= 0:
                    continue
                db.add(models.UnifiedSaleHomeExpenseLine(
                    unified_sale_id=batch.id, category_id=line.category_id,
                    employee_id=line.employee_id, amount=line.amount,
                    description=line.description,
                ))
                new_expense = models.Expense(
                    display_id=next_display_id(db, models.Expense, "EXP", width=6),
                    date=batch.date, category_id=line.category_id, amount=line.amount,
                    account_id=None, method="cash",
                    description=line.description or f"Settlement correction of Unified Sale {batch.display_id} — {payload.correction_reason}",
                    status="active", entered_by=payload.corrected_by, unified_sale_id=batch.id,
                    employee_id=line.employee_id,
                )
                db.add(new_expense)
                db.flush()
                apply_salary_expense_if_needed(db, line.category_id, line.employee_id, line.amount, by=payload.corrected_by)
                new_expenses.append(new_expense)
        elif payload.home_expense_amount > 0:
            new_expense = models.Expense(
                display_id=next_display_id(db, models.Expense, "EXP", width=6),
                date=batch.date, category_id=payload.home_expense_category_id, amount=payload.home_expense_amount,
                account_id=None, method="cash",
                description=f"Settlement correction of Unified Sale {batch.display_id} — {payload.correction_reason}",
                status="active", entered_by=payload.corrected_by, unified_sale_id=batch.id,
            )
            db.add(new_expense)
            db.flush()
            new_expenses.append(new_expense)

        new_owner_drawing = None
        if payload.owner_drawings_amount > 0:
            new_owner_drawing = models.OwnerDrawings(
                display_id=next_display_id(db, models.OwnerDrawings, "DRAW", width=6),
                date=batch.date, amount=payload.owner_drawings_amount, account_id=None,
                notes=f"Settlement correction of Unified Sale {batch.display_id} — {payload.correction_reason}",
                status="active", entered_by=payload.corrected_by, unified_sale_id=batch.id,
            )
            db.add(new_owner_drawing)
            db.flush()

        if new_net_plant_payment > 0:
            if new_destination_type == "account":
                new_account_row = resolve_account_or_bucket(db, new_account_id)
                if new_account_row:
                    new_account_row.current_balance = _dec(new_account_row.current_balance) + new_net_plant_payment
                    db.add(new_account_row)
            else:
                new_target_company = db.query(models.Company).get(new_target_plant_id) if new_target_plant_id else None
                if new_target_company:
                    new_target_company.current_balance = _dec(new_target_company.current_balance) - new_net_plant_payment
                    db.add(new_target_company)

        batch.home_expense_amount = home_expense_total
        batch.owner_drawings_amount = payload.owner_drawings_amount
        batch.net_plant_payment = new_net_plant_payment
        batch.destination_type = new_destination_type
        batch.target_plant_id = new_target_plant_id
        batch.account_id = new_account_id
        if payload.payment_reference:
            batch.payment_reference = payload.payment_reference
        batch.settlement_corrected_by = payload.corrected_by
        batch.settlement_corrected_at = datetime.utcnow()
        batch.settlement_correction_reason = payload.correction_reason
        db.add(batch)

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Settlement correction failed, nothing was changed: {e}")

    db.refresh(batch)
    sales, purchases, plant_payment, expenses, owner_drawing = _load_children(db, batch.id)
    return _batch_to_out(db, batch, sales, purchases, plant_payment, expenses, owner_drawing)


@router.patch("/unified/{unified_sale_id}/correct-amount", response_model=schemas.UnifiedSaleOut)
def correct_unified_sale_amount(
    unified_sale_id: UUID,
    payload: schemas.UnifiedSaleAmountCorrect,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """§ Amount Correction for Unified-Sale-Linked Payments. Sibling of
    correct_unified_sale_settlement above — that one corrects WHERE the
    money went, this one corrects HOW MUCH (total_credit_received), never
    the other's concern. Same reverse-then-repost discipline as every
    other correction in this app, applied on BOTH sides an approved
    amount already touched:
      1. The audit-trail Payment row itself (reverse-then-repost, same
         shape as routers/payments.py::correct_payment — but posted
         directly rather than via _apply_payment, which requires a real
         account_id; this payment type's money "hasn't landed in any
         account yet, routed onward at settlement", same as
         approve_unified_sale_sale's own Payment-creation).
      2. The REAL settlement destination (account or plant balance) that
         already received the old net_plant_payment at approval time —
         resync_unified_sale_batch_totals only fixes the batch's own
         stored display fields (total_credit_received/net_plant_payment),
         it deliberately never re-routes money a second time (see its own
         docstring), so this reverses/reposts that money movement itself,
         exactly mirroring correct_unified_sale_settlement's own
         reversal/repost block above.

    payment_status == "approved" (not just sale_status) is required —
    only once the settlement itself is approved has real money actually
    moved to a real account/plant; reversing that movement before it
    happened would corrupt a balance the sale never touched. (A batch
    with sale_status=approved but payment_status still pending can't be
    amount-corrected here, same pre-existing limitation
    correct_unified_sale_settlement already has — edit the pending
    settlement instead.)

    Deliberately does NOT touch excess_amount/account_credit — this
    payment type never sets excess_amount at creation (see
    approve_unified_sale_sale's Payment-creation comment: the sale
    approval's own overpayment math is a one-time combined formula,
    never stored back onto the Payment row), so there is nothing
    reliable to reverse or recompute there."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")
    if payload.amount <= 0:
        raise HTTPException(400, "amount must be greater than zero")

    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.payment_status != "approved":
        raise HTTPException(400, "Only an approved settlement's collected amount can be corrected")

    original = (
        db.query(models.Payment)
        .filter(
            models.Payment.unified_sale_id == batch.id,
            models.Payment.method == "unified_sale_credit",
            models.Payment.status == "active",
        )
        .first()
    )
    if not original:
        raise HTTPException(404, "No active collected-amount record found for this sale")

    bypass_sum = _dec(batch.home_expense_amount) + _dec(batch.owner_drawings_amount)
    if bypass_sum > payload.amount + EPSILON:
        raise HTTPException(
            400,
            f"Home expense ({batch.home_expense_amount}) + owner drawings ({batch.owner_drawings_amount}) "
            f"= {bypass_sum} would exceed the corrected amount ({payload.amount}) — nothing would be left to settle.",
        )

    # home_expense_amount/owner_drawings_amount are untouched by this
    # correction (not part of the payload) — only the CompanyPayment child
    # depends on net_plant_payment and needs cancel+recreate; Expense/
    # OwnerDrawings' own amounts don't change, so they're left alone.
    old_plant_payment = (
        db.query(models.CompanyPayment)
        .filter(models.CompanyPayment.unified_sale_id == batch.id, models.CompanyPayment.status == "active")
        .first()
    )

    try:
        customer = db.query(models.Customer).get(original.customer_id)

        # ---- Reverse exactly what the OLD amount posted ----
        _reverse_payment(db, original)
        old_net = _dec(batch.net_plant_payment)
        if old_net > 0:
            if batch.destination_type == "account":
                old_account_row = resolve_account_or_bucket(db, batch.account_id)
                if old_account_row:
                    old_account_row.current_balance = _dec(old_account_row.current_balance) - old_net
                    db.add(old_account_row)
            else:
                old_target_id = batch.target_plant_id or batch.company_id
                old_target_company = db.query(models.Company).get(old_target_id) if old_target_id else None
                if old_target_company:
                    old_target_company.current_balance = _dec(old_target_company.current_balance) + old_net
                    db.add(old_target_company)

        # Cancel (never mutate) the old CompanyPayment — same audit-trail
        # convention as correct_unified_sale_settlement above. Its amount
        # mirrors net_plant_payment, which is about to change.
        if old_plant_payment and old_plant_payment.status == "active":
            old_plant_payment.status = "cancelled"
            db.add(old_plant_payment)

        original.status = "corrected"
        original.corrected_by = current_user.name
        original.corrected_at = datetime.utcnow()
        original.correction_reason = payload.correction_reason
        db.add(original)
        db.flush()

        # ---- Post the corrected amount ----
        new_payment = models.Payment(
            display_id=next_display_id(db, models.Payment, "PAY", width=6),
            date=original.date, customer_id=original.customer_id, amount=payload.amount,
            method="unified_sale_credit", account_id=None, source_account_id=None,
            notes=original.notes, status="active", entered_by=current_user.name,
            unified_sale_id=batch.id,
        )
        new_payment.corrected_from_id = original.id
        db.add(new_payment)
        customer.current_balance = _dec(customer.current_balance) - payload.amount
        db.add(customer)
        db.flush()

        # Batch's own Collected/Outstanding — sums the now-active
        # new_payment (old one is "corrected", excluded).
        resync_unified_sale_batch_totals(db, batch.id)

        new_net = _dec(batch.net_plant_payment)
        if new_net > 0:
            if batch.destination_type == "account":
                new_account_row = resolve_account_or_bucket(db, batch.account_id)
                if new_account_row:
                    new_account_row.current_balance = _dec(new_account_row.current_balance) + new_net
                    db.add(new_account_row)
            else:
                new_target_id = batch.target_plant_id or batch.company_id
                new_target_company = db.query(models.Company).get(new_target_id) if new_target_id else None
                if new_target_company:
                    new_target_company.current_balance = _dec(new_target_company.current_balance) - new_net
                # New CompanyPayment child — same fields as correct_unified_
                # sale_settlement's own posting, its amount now correctly
                # mirroring the corrected net_plant_payment.
                db.add(models.CompanyPayment(
                    display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
                    date=batch.date, company_id=new_target_id, amount=new_net,
                    method="direct_settlement", account_id=None,
                    notes=f"Amount correction of Unified Sale {batch.display_id} — {payload.correction_reason}",
                    status="active", entered_by=current_user.name, unified_sale_id=batch.id,
                ))

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Amount correction failed, nothing was changed: {e}")

    db.refresh(batch)
    sales, purchases, plant_payment, expenses, owner_drawing = _load_children(db, batch.id)
    return _batch_to_out(db, batch, sales, purchases, plant_payment, expenses, owner_drawing)


@router.post("/unified/{unified_sale_id}/cancel", response_model=schemas.UnifiedSaleOut)
def cancel_unified_sale(
    unified_sale_id: UUID, 
    by: Optional[str] = Query("system"), # FIX 3: Made 'by' optional
    db: Session = Depends(get_db)
):
    """Only allowed while both sale and payment are still PENDING — once
    either side has been approved, that side's ledger effects are already
    posted and cancelling the whole order would leave them dangling."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.sale_status != "pending" or batch.payment_status != "pending":
        raise HTTPException(400, "Cannot cancel — sale or payment has already been approved/cancelled")

    sales, purchases, payment, expenses, owner_drawing = _load_children(db, batch.id)
    try:
        for sale in sales:
            sale.status = "cancelled"
            db.add(sale)
        for purchase in purchases:
            purchase.status = "cancelled"
            db.add(purchase)
        if payment:
            payment.status = "cancelled"
            db.add(payment)
        # § Multi-line Categorized Home Expense — cancel EVERY pending
        # Expense row, not just one (see _load_children). No Employee.
        # current_balance reversal needed here even for a Salary-category
        # line — cancel_unified_sale only runs while payment_status is
        # still "pending" (guarded above), so these rows are still
        # "pending" too and apply_salary_expense_if_needed was never
        # called for them (see _do_approve_payment, where that happens).
        # Nothing was ever posted, so there is nothing to reverse. Compare
        # correct_unified_sale_settlement below, which DOES cancel already-
        # ACTIVE Expense rows post-approval and, per § Salary payments are
        # never clawed back, must not reverse the balance there either.
        for expense in expenses:
            expense.status = "cancelled"
            db.add(expense)
        if owner_drawing:
            owner_drawing.status = "cancelled"
            db.add(owner_drawing)

        batch.sale_status = "cancelled"
        batch.payment_status = "cancelled"
        _sync_legacy_status(batch)
        db.add(batch)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Cancel failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(db, batch, sales, purchases, payment, expenses, owner_drawing)