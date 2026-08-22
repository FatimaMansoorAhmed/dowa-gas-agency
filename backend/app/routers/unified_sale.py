from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id

router = APIRouter(prefix="/sales", tags=["unified-sale"])

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


def _validate_and_load(db: Session, payload: schemas.UnifiedSaleCreate):
    """Shared by create and edit — validates every referenced entity and the
    settlement rule up front, before anything is written. Settled money is
    exactly: home_expense + owner_drawings + net_plant_payment (computed,
    never entered) = total_credit_received."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    company = db.query(models.Company).get(payload.plant_id)
    if not company:
        raise HTTPException(404, "Plant not found")

    products_by_id = {}
    for item in payload.items:
        if item.product_id not in products_by_id:
            product = db.query(models.Product).get(item.product_id)
            if not product:
                raise HTTPException(404, f"Product {item.product_id} not found")
            products_by_id[item.product_id] = product

    s = payload.settlement
    bypass_sum = s.home_expense_amount + s.owner_drawings_amount
    if bypass_sum > s.total_credit_received + EPSILON:
        raise HTTPException(
            400,
            f"Home expense ({s.home_expense_amount}) + owner drawings ({s.owner_drawings_amount}) "
            f"= {bypass_sum} exceeds total credit received ({s.total_credit_received}) — "
            f"nothing would be left to settle with the plant.",
        )
    if s.home_expense_amount > 0 and not s.home_expense_category_id:
        raise HTTPException(400, "home_expense_category_id is required when home_expense_amount > 0")

    if s.home_expense_category_id:
        if not db.query(models.ExpenseCategory).get(s.home_expense_category_id):
            raise HTTPException(404, "Expense category not found")

    destination_type, target_plant_id, account_id = _resolve_destination(db, s, payload.plant_id)

    return customer, company, products_by_id, destination_type, target_plant_id, account_id


def _create_pending_children(db: Session, payload: schemas.UnifiedSaleCreate, batch, products_by_id):
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
            gate_pass_no=payload.gate_pass_no, vehicle_no=payload.vehicle_no, notes=payload.notes,
            status="pending", entered_by=payload.entered_by, unified_sale_id=batch.id,
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
            status="pending", entered_by=payload.entered_by, unified_sale_id=batch.id,
        )
        db.add(purchase)
        db.flush()
        purchases_created.append(purchase)

    net_plant_payment = s.total_credit_received - s.home_expense_amount - s.owner_drawings_amount

    plant_payment = None
    if net_plant_payment > 0 and batch.destination_type == "plant":
        plant_payment = models.CompanyPayment(
            display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
            date=payload.date, company_id=batch.target_plant_id, amount=net_plant_payment,
            method="direct_settlement", account_id=None,
            notes=f"3-way settlement via Unified Sale {batch.display_id} — customer paid plant directly",
            status="pending", entered_by=payload.entered_by, unified_sale_id=batch.id,
        )
        db.add(plant_payment)
        db.flush()

    expense = None
    if s.home_expense_amount > 0:
        expense = models.Expense(
            display_id=next_display_id(db, models.Expense, "EXP", width=6),
            date=payload.date, category_id=s.home_expense_category_id, amount=s.home_expense_amount,
            account_id=None, method="cash", description=f"Auto-created from Unified Sale {batch.display_id}",
            status="pending", entered_by=payload.entered_by, unified_sale_id=batch.id,
        )
        db.add(expense)
        db.flush()

    owner_drawing = None
    if s.owner_drawings_amount > 0:
        owner_drawing = models.OwnerDrawings(
            display_id=next_display_id(db, models.OwnerDrawings, "DRAW", width=6),
            date=payload.date, amount=s.owner_drawings_amount, account_id=None,
            notes=f"Auto-created from Unified Sale {batch.display_id}",
            status="pending", entered_by=payload.entered_by, unified_sale_id=batch.id,
        )
        db.add(owner_drawing)
        db.flush()

    return sales_created, purchases_created, plant_payment, expense, owner_drawing


def _batch_to_out(batch, sales, purchases, plant_payment, expense, owner_drawing) -> schemas.UnifiedSaleOut:
    return schemas.UnifiedSaleOut(
        id=batch.id, display_id=batch.display_id, date=batch.date,
        customer_id=batch.customer_id, company_id=batch.company_id,
        total_selling_amount=batch.total_selling_amount, total_purchase_amount=batch.total_purchase_amount,
        total_credit_received=batch.total_credit_received, net_plant_payment=batch.net_plant_payment,
        home_expense_amount=batch.home_expense_amount, owner_drawings_amount=batch.owner_drawings_amount,
        destination_type=batch.destination_type, target_plant_id=batch.target_plant_id, account_id=batch.account_id,
        status=batch.status, approved_at=batch.approved_at, approved_by=batch.approved_by,
        entered_by=batch.entered_by, created_at=batch.created_at,
        sales=[schemas.SaleOut.model_validate(x) for x in sales],
        purchases=[schemas.PurchaseOut.model_validate(x) for x in purchases],
        plant_payment=schemas.CompanyPaymentOut.model_validate(plant_payment) if plant_payment else None,
        expense=schemas.ExpenseOut.model_validate(expense) if expense else None,
        owner_drawing=schemas.OwnerDrawingsOut.model_validate(owner_drawing) if owner_drawing else None,
    )


def _load_children(db: Session, batch_id):
    sales = db.query(models.Sale).filter(models.Sale.unified_sale_id == batch_id).order_by(models.Sale.created_at).all()
    purchases = db.query(models.Purchase).filter(models.Purchase.unified_sale_id == batch_id).order_by(models.Purchase.created_at).all()
    plant_payment = db.query(models.CompanyPayment).filter(models.CompanyPayment.unified_sale_id == batch_id).first()
    expense = db.query(models.Expense).filter(models.Expense.unified_sale_id == batch_id).first()
    owner_drawing = db.query(models.OwnerDrawings).filter(models.OwnerDrawings.unified_sale_id == batch_id).first()
    return sales, purchases, plant_payment, expense, owner_drawing


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
    sales, purchases, payment, expense, owner_drawing = _load_children(db, batch.id)
    return _batch_to_out(batch, sales, purchases, payment, expense, owner_drawing)


@router.post("/unified", response_model=schemas.UnifiedSaleOut, status_code=201)
def create_unified_sale(payload: schemas.UnifiedSaleCreate, db: Session = Depends(get_db)):
    """Creates a PENDING Unified Sale."""
    customer, company, products_by_id, destination_type, target_plant_id, account_id = _validate_and_load(db, payload)

    try:
        total_selling_amount = sum((item.quantity * item.selling_rate for item in payload.items), Decimal("0"))
        total_purchase_amount = sum((item.quantity * item.purchase_rate for item in payload.items), Decimal("0"))
        s = payload.settlement

        net_plant_payment = s.total_credit_received - s.home_expense_amount - s.owner_drawings_amount

        batch = models.UnifiedSaleBatch(
            display_id=next_display_id(db, models.UnifiedSaleBatch, "USALE", width=6),
            date=payload.date,
            customer_id=payload.customer_id,
            company_id=payload.plant_id,
            total_selling_amount=total_selling_amount,
            total_purchase_amount=total_purchase_amount,
            total_credit_received=s.total_credit_received,
            net_plant_payment=net_plant_payment,
            home_expense_amount=s.home_expense_amount,
            owner_drawings_amount=s.owner_drawings_amount,
            destination_type=destination_type,
            target_plant_id=target_plant_id,
            account_id=account_id,
            status="pending",
            entered_by=payload.entered_by,
        )
        db.add(batch)
        db.flush()

        sales, purchases, payment, expense, owner_drawing = _create_pending_children(db, payload, batch, products_by_id)
        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Unified sale failed, nothing was saved: {e}")

    db.refresh(batch)
    return _batch_to_out(batch, sales, purchases, payment, expense, owner_drawing)


@router.put("/unified/{unified_sale_id}", response_model=schemas.UnifiedSaleOut)
def edit_unified_sale(unified_sale_id: UUID, payload: schemas.UnifiedSaleEdit, db: Session = Depends(get_db)):
    """Only allowed while PENDING."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.status != "pending":
        raise HTTPException(400, f"Cannot edit a {batch.status} order — only pending orders are editable")

    customer, company, products_by_id, destination_type, target_plant_id, account_id = _validate_and_load(db, payload)

    try:
        for model in (models.Sale, models.Purchase, models.CompanyPayment, models.Expense, models.OwnerDrawings):
            db.query(model).filter(model.unified_sale_id == batch.id).delete()
        db.flush()

        total_selling_amount = sum((item.quantity * item.selling_rate for item in payload.items), Decimal("0"))
        total_purchase_amount = sum((item.quantity * item.purchase_rate for item in payload.items), Decimal("0"))
        s = payload.settlement

        net_plant_payment = s.total_credit_received - s.home_expense_amount - s.owner_drawings_amount

        batch.date = payload.date
        batch.customer_id = payload.customer_id
        batch.company_id = payload.plant_id
        batch.total_selling_amount = total_selling_amount
        batch.total_purchase_amount = total_purchase_amount
        batch.total_credit_received = s.total_credit_received
        batch.net_plant_payment = net_plant_payment
        batch.home_expense_amount = s.home_expense_amount
        batch.owner_drawings_amount = s.owner_drawings_amount
        batch.destination_type = destination_type
        batch.target_plant_id = target_plant_id
        batch.account_id = account_id
        db.add(batch)
        db.flush()

        sales, purchases, payment, expense, owner_drawing = _create_pending_children(db, payload, batch, products_by_id)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Edit failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(batch, sales, purchases, payment, expense, owner_drawing)


@router.post("/unified/{unified_sale_id}/approve", response_model=schemas.UnifiedSaleOut)
def approve_unified_sale(
    unified_sale_id: UUID, 
    by: Optional[str] = Query("system"),  # FIX 1: Made 'by' optional with default 'system'
    db: Session = Depends(get_db)
):
    """The only place a Unified Sale's ledger effects actually get posted."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.status != "pending":
        raise HTTPException(400, f"Cannot approve a {batch.status} order — already resolved")

    customer = db.query(models.Customer).get(batch.customer_id)
    company = db.query(models.Company).get(batch.company_id)
    sales, purchases, payment, expense, owner_drawing = _load_children(db, batch.id)

    try:
        # ---- Customer Balance Adjustment ----
        # New Balance = Current Balance + Selling Amount - Credit Received.
        # All operands Decimal-coerced — a NULL current_balance (or any other
        # not-yet-initialized numeric column) must never crash approval.
        current_balance = _dec(customer.current_balance)
        selling_amount = _dec(batch.total_selling_amount)
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

        # ---- Purchase Plant Balance (always grows by the purchase, regardless
        # of where the settlement money is routed to) ----
        company.current_balance = _dec(company.current_balance) + _dec(batch.total_purchase_amount)
        db.add(company)

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
                account_uuid = _try_uuid(batch.account_id)
                account_row = db.query(models.PaymentAccount).get(account_uuid) if account_uuid else None
                if account_row:
                    account_row.current_balance = _dec(account_row.current_balance) + net_plant_payment
                    db.add(account_row)
                # else: a category label with no PaymentAccount row (e.g.
                # "office_cash") — nothing to credit, money is only tracked
                # via the batch's own destination_type/account_id fields.
            else:
                target_id = batch.target_plant_id or batch.company_id
                target_company = company if target_id == batch.company_id else db.query(models.Company).get(target_id)
                if target_company:
                    target_company.current_balance = _dec(target_company.current_balance) - net_plant_payment
                    db.add(target_company)

        # ---- Payment Status Update ----
        # FIX 2: Safely update payment status without querying PaymentAccount since account_id is None
        if payment:
            payment.status = "active"
            db.add(payment)

        for sale in sales:
            sale.status = "active"
            db.add(sale)
        for purchase in purchases:
            purchase.status = "active"
            db.add(purchase)
        if expense:
            expense.status = "active"
            db.add(expense)
        if owner_drawing:
            owner_drawing.status = "active"
            db.add(owner_drawing)

        batch.status = "approved"
        # Timezone-aware so the API response carries a UTC offset — a naive
        # timestamp gets misread as local wall-clock time by the frontend's
        # `new Date(...)` and displays hours off (e.g. 5 AM PKT instead of
        # the actual approval time).
        batch.approved_at = datetime.now(timezone.utc)
        batch.approved_by = by
        db.add(batch)

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Approval failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(batch, sales, purchases, payment, expense, owner_drawing)


@router.post("/unified/{unified_sale_id}/cancel", response_model=schemas.UnifiedSaleOut)
def cancel_unified_sale(
    unified_sale_id: UUID, 
    by: Optional[str] = Query("system"), # FIX 3: Made 'by' optional
    db: Session = Depends(get_db)
):
    """Only allowed while PENDING."""
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        raise HTTPException(404, "Unified sale not found")
    if batch.status != "pending":
        raise HTTPException(400, f"Cannot cancel a {batch.status} order — already resolved")

    sales, purchases, payment, expense, owner_drawing = _load_children(db, batch.id)
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
        if expense:
            expense.status = "cancelled"
            db.add(expense)
        if owner_drawing:
            owner_drawing.status = "cancelled"
            db.add(owner_drawing)

        batch.status = "cancelled"
        db.add(batch)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Cancel failed, nothing was changed: {e}")

    db.refresh(batch)
    return _batch_to_out(batch, sales, purchases, payment, expense, owner_drawing)