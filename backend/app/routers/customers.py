from datetime import datetime, date
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