from datetime import datetime, date
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app import models, schemas
from app.utils import next_display_id

router = APIRouter(prefix="/customers", tags=["customers"])


# 1. GET ALL CUSTOMERS
@router.get("", response_model=list[schemas.CustomerOut])
@router.get("/", response_model=list[schemas.CustomerOut])
def list_customers(
    search: str | None = Query(None, description="Matches name, mobile, shop name, or customer ID"),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.Customer)
    if status:
        q = q.filter(models.Customer.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (models.Customer.name.ilike(like))
            | (models.Customer.mobile.ilike(like))
            | (models.Customer.shop_name.ilike(like))
            | (models.Customer.display_id.ilike(like))
        )
    return q.order_by(models.Customer.name).all()


# 2. CREATE NEW CUSTOMER (NOT NULL Display ID Fix Applied)
@router.post("", response_model=schemas.CustomerOut)
@router.post("/", response_model=schemas.CustomerOut)
def create_customer(payload: schemas.CustomerCreate, db: Session = Depends(get_db)):
    try:
        # Display ID generation with fallback
        try:
            disp_id = next_display_id(db, models.Customer)
        except Exception:
            count = db.query(models.Customer).count() + 1
            disp_id = f"CUST-{count:03d}"

        # Safety check: display_id null na ho
        if not disp_id:
            count = db.query(models.Customer).count() + 1
            disp_id = f"CUST-{count:03d}"

        opening_bal = float(payload.opening_balance or 0)

        # Date conversion
        parsed_date = None
        if payload.opening_balance_date:
            if isinstance(payload.opening_balance_date, date):
                parsed_date = payload.opening_balance_date
            else:
                try:
                    parsed_date = datetime.strptime(str(payload.opening_balance_date), "%Y-%m-%d").date()
                except ValueError:
                    parsed_date = datetime.utcnow().date()

        # Cross/PSO breakdown per size (§ Empty Cylinders — Size + Type
        # Model). Whenever either is provided for a size, that size's total
        # is DERIVED as cross + pso — never accepted as a separate,
        # independently-editable value, so the two can never disagree.
        # A caller that only sends the old flat total (no cross/pso) keeps
        # the pre-existing legacy behavior: total as given, cross/pso at 0.
        cross_118 = payload.empty_cylinders_118_cross or 0
        pso_118 = payload.empty_cylinders_118_pso or 0
        total_118 = (cross_118 + pso_118) if (cross_118 or pso_118) else (payload.empty_cylinders_118 or 0)

        cross_454 = payload.empty_cylinders_454_cross or 0
        pso_454 = payload.empty_cylinders_454_pso or 0
        total_454 = (cross_454 + pso_454) if (cross_454 or pso_454) else (payload.empty_cylinders_454 or 0)

        new_customer = models.Customer(
            display_id=disp_id,
            name=payload.name,
            mobile=payload.mobile,
            alt_mobile=getattr(payload, 'alt_mobile', None),
            shop_name=getattr(payload, 'shop_name', None),
            address=getattr(payload, 'address', None),
            city_area=getattr(payload, 'city_area', None),
            opening_balance=opening_bal,
            current_balance=opening_bal,
            opening_balance_date=parsed_date,
            empty_cylinders_118=total_118,
            empty_cylinders_454=total_454,
            empty_cylinders_118_cross=cross_118,
            empty_cylinders_118_pso=pso_118,
            empty_cylinders_454_cross=cross_454,
            empty_cylinders_454_pso=pso_454,
            # Generic running total (drives the Sell Empty Cylinders flow,
            # which doesn't split by size) starts as the sum of both.
            empty_cylinders=total_118 + total_454,
        )
        
        db.add(new_customer)
        db.commit()
        db.refresh(new_customer)
        return new_customer

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# 3. GET SINGLE CUSTOMER BY ID
@router.get("/{customer_id}", response_model=schemas.CustomerOut)
def get_customer(customer_id: UUID, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    return customer


# 4. RECALCULATE ALL BALANCES
@router.post("/recalculate-balances")
def recalculate_all_balances(db: Session = Depends(get_db)):
    try:
        customers = db.query(models.Customer).all()
        
        for customer in customers:
            total_sales = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0)).filter(
                models.Sale.customer_id == customer.id,
                models.Sale.status == "active"
            ).scalar()

            total_payments = db.query(func.coalesce(func.sum(models.Payment.amount), 0)).filter(
                models.Payment.customer_id == customer.id,
                models.Payment.status == "active"
            ).scalar()

            opening = customer.opening_balance or 0
            customer.current_balance = float(opening) + float(total_sales) - float(total_payments)
            db.add(customer)

        db.commit()
        return {"status": "success", "message": "All customer balances recalculated successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# 5. ADJUST BALANCE
@router.patch("/{customer_id}/adjust", response_model=schemas.CustomerOut)
def adjust_customer(customer_id: UUID, payload: schemas.CustomerAdjust, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    amount = payload.amount
    if payload.kind == "payment":
        excess = amount - customer.current_balance
        customer.current_balance = customer.current_balance - amount
        if excess > 0:
            customer.last_overpayment_amount = excess
            customer.last_overpayment_date = datetime.utcnow()
        else:
            customer.last_overpayment_amount = None
            customer.last_overpayment_date = None
    else:  # charge / sale
        customer.current_balance = customer.current_balance + amount

    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


# 6. SET STATUS (ACTIVE / INACTIVE)
@router.patch("/{customer_id}/status", response_model=schemas.CustomerOut)
def set_customer_status(customer_id: UUID, status: str = Query(..., pattern="^(active|inactive)$"), db: Session = Depends(get_db)):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    customer.status = status
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer

# 7. ADD CYLINDER TRANSACTION (Return / Exchange / Sell Empty)
@router.post("/{customer_id}/cylinders")
def add_cylinder_transaction(
    customer_id: UUID,
    payload: schemas.CylinderTransactionCreate,
    db: Session = Depends(get_db)
):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    # Same validation as the standalone /cylinder-transactions endpoint
    # (app/routers/cylinder_transactions.py) — kept in sync so both entry
    # points enforce the same rules.
    if payload.qty_out < 0 or payload.qty_in < 0:
        raise HTTPException(400, "Quantities cannot be negative")
    if payload.qty_out == 0 and payload.qty_in == 0:
        raise HTTPException(400, "Enter a quantity out or in")

    disp_id = f"CYL-{db.query(models.CylinderTransaction).count() + 1:06d}"

    txn = models.CylinderTransaction(
        display_id=disp_id,
        customer_id=customer_id,
        product_id=payload.product_id,
        qty_out=payload.qty_out,
        qty_in=payload.qty_in,
        transaction_type=payload.transaction_type,
        notes=payload.notes,
        entered_by=payload.entered_by,
        status="active"
    )
    db.add(txn)

    # Balance Update Logic — Decimal throughout, matching the Numeric DB columns.
    net = payload.qty_out - payload.qty_in
    if payload.product_id:
        product = db.query(models.Product).get(payload.product_id)
        if product and product.weight_kg > Decimal("20"):
            customer.cylinder_balance_454 = (customer.cylinder_balance_454 or Decimal("0")) + net
        else:
            customer.cylinder_balance_118 = (customer.cylinder_balance_118 or Decimal("0")) + net
    else:
        customer.cylinder_balance_118 = (customer.cylinder_balance_118 or Decimal("0")) + net

    db.add(customer)
    db.commit()
    db.refresh(txn)
    return {"status": "success", "data": txn}


# 7b. SELL EMPTY CYLINDERS (Empty Cylinders page action)
@router.post("/{customer_id}/empty-cylinders/sell", response_model=schemas.EmptyCylinderSaleOut, status_code=201)
def sell_empty_cylinders(
    customer_id: UUID,
    payload: schemas.EmptyCylinderSaleCreate,
    db: Session = Depends(get_db),
):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be greater than 0")
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be greater than 0")

    is_454 = payload.cylinder_size == "454"
    size_label = "45.4" if is_454 else "11.8"
    size_total = (customer.empty_cylinders_454 if is_454 else customer.empty_cylinders_118) or 0

    # When cylinder_type is given, the exact size+type balance is checked
    # and deducted (§ Empty Cylinder Sale) — Cross and PSO are tracked
    # completely independently, selling one must never touch the other.
    # Omitted means the untyped legacy path: only the size total is
    # checked/deducted, unchanged from before this feature existed.
    if payload.cylinder_type:
        type_attr = f"empty_cylinders_{'454' if is_454 else '118'}_{payload.cylinder_type}"
        type_available = getattr(customer, type_attr) or 0
        if payload.quantity > type_available:
            raise HTTPException(
                400,
                f"Quantity exceeds the customer's available {size_label} KG {payload.cylinder_type.upper()} empty cylinder balance",
            )
        setattr(customer, type_attr, type_available - payload.quantity)
    elif payload.quantity > size_total:
        raise HTTPException(
            400,
            f"Quantity exceeds the customer's available {size_label} KG empty cylinder balance",
        )

    sale = models.EmptyCylinderSale(
        display_id=next_display_id(db, models.EmptyCylinderSale, "ECS", width=6),
        date=payload.date or datetime.utcnow(),
        customer_id=customer_id,
        cylinder_size=payload.cylinder_size,
        cylinder_type=payload.cylinder_type,
        quantity=payload.quantity,
        amount=payload.amount,
        notes=payload.notes,
        status="active",
        entered_by=payload.entered_by,
    )
    db.add(sale)

    if is_454:
        customer.empty_cylinders_454 = size_total - payload.quantity
    else:
        customer.empty_cylinders_118 = size_total - payload.quantity
    customer.empty_cylinders = (customer.empty_cylinders or 0) - payload.quantity
    # Same core formula as a regular Sale (§13): a sale only ever adds to
    # what the customer owes.
    customer.current_balance = customer.current_balance + payload.amount
    customer.last_transaction_at = sale.date
    db.add(customer)

    db.commit()
    db.refresh(sale)
    return sale


# 8. GET COMBINED FINANCIAL & CYLINDER LEDGER FOR A CUSTOMER
@router.get("/{customer_id}/ledger")
def get_customer_combined_ledger(customer_id: UUID, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    # 1. Fetch Sales (Debit Money / Credit Cylinder)
    sales = db.query(models.Sale).filter(
        models.Sale.customer_id == customer_id, models.Sale.status == "active"
    ).all()

    # 2. Fetch Payments (Credit Money)
    payments = db.query(models.Payment).filter(
        models.Payment.customer_id == customer_id, models.Payment.status == "active"
    ).all()

    # 3. Fetch Cylinder Returns/Adjustments
    cyl_txns = db.query(models.CylinderTransaction).filter(
        models.CylinderTransaction.customer_id == customer_id, models.CylinderTransaction.status == "active"
    ).all()

    # Combine into unified ledger list
    ledger_entries = []

    for s in sales:
        ledger_entries.append({
            "id": str(s.id),
            "date": s.date,
            "type": "SALE",
            "description": f"Sale - {s.display_id}",
            "debit": float(s.total_amount),
            "credit": 0.0,
            "cyl_out": int(s.quantity),
            "cyl_in": 0
        })

    for p in payments:
        ledger_entries.append({
            "id": str(p.id),
            "date": p.date,
            "type": "PAYMENT",
            "description": f"Payment - {p.display_id} ({p.method})",
            "debit": 0.0,
            "credit": float(p.amount),
            "cyl_out": 0,
            "cyl_in": 0
        })

    for c in cyl_txns:
        ledger_entries.append({
            "id": str(c.id),
            "date": c.date,
            "type": c.transaction_type,
            "description": f"Cylinder Movement - {c.display_id}",
            "debit": 0.0,
            "credit": 0.0,
            "cyl_out": int(c.qty_out),
            "cyl_in": int(c.qty_in)
        })

    # Date wise sort
    ledger_entries.sort(key=lambda x: x["date"])

    # Calculate Running Balances
    running_cash = float(customer.opening_balance or 0)
    running_cyl = 0

    formatted_ledger = []
    for entry in ledger_entries:
        running_cash += (entry["debit"] - entry["credit"])
        running_cyl += (entry["cyl_out"] - entry["cyl_in"])

        entry["cash_balance"] = running_cash
        entry["cyl_balance"] = running_cyl
        formatted_ledger.append(entry)

    return {
        "customer_name": customer.name,
        "opening_balance": float(customer.opening_balance or 0),
        "current_cash_balance": customer.current_balance,
        "current_cyl_118": customer.cylinder_balance_118,
        "current_cyl_454": customer.cylinder_balance_454,
        "ledger": formatted_ledger
    }