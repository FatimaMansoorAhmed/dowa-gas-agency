from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.routers.sales import _apply_sale
from app.routers.payments import _apply_payment
from app.utils import get_or_create_shop_account

router = APIRouter(prefix="/sales", tags=["emergency-transfer"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.post("/emergency-transfer", response_model=schemas.SaleOut, status_code=201)
def create_emergency_transfer(
    payload: schemas.EmergencyTransferCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """A real (non-shop) customer needs cylinders urgently and is directed
    to a shop instead of a plant. Posts a genuine Sale — the customer's
    real ledger balance is charged exactly like any other sale — while
    physically drawing stock from the named shop's own FIFO stock instead
    of a new plant Load. Reuses _apply_sale (sales.py) for the ledger
    half and _apply_payment (payments.py) for the optional inline
    settlement half — see routers/sales.py's emergency-transfer branches
    in _apply_sale/_reverse_sale for the stock-deduction half, and
    models.Sale.emergency_transfer_shop_id for why correction/cancellation
    need no new endpoints (they reuse /sales/{id}/correct and
    /sales/{id}/cancel unmodified)."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    if customer.customer_type == "shop":
        raise HTTPException(
            400,
            "Emergency Transfer is for a real customer — for a shop's own retail sale, use Record Shop Sale instead",
        )

    shop = db.query(models.Customer).get(payload.shop_id)
    if not shop or shop.customer_type != "shop":
        raise HTTPException(404, "Shop not found")

    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be greater than 0")
    if payload.rate_per_cylinder <= 0:
        raise HTTPException(400, "Rate must be greater than 0")

    sale_payload = schemas.SaleCreate(
        date=payload.date,
        customer_id=payload.customer_id,
        product_id=payload.product_id,
        company_id=None,  # no plant purchase counterpart — the stock already exists at the shop
        quantity=payload.quantity,
        rate_per_cylinder=payload.rate_per_cylinder,
        notes=payload.notes,
        entered_by=current_user.name,
        emergency_transfer_shop_id=payload.shop_id,
    )
    # _apply_sale raises (before any commit) if the shop doesn't have
    # enough stock — see _consume_shop_stock_for_emergency_transfer.
    sale = _apply_sale(db, sale_payload, current_user.name)

    if payload.amount_collected_now and payload.amount_collected_now > 0:
        if payload.amount_collected_now > sale.total_amount:
            raise HTTPException(400, "Amount collected now cannot exceed the transfer total")
        account = (
            db.query(models.PaymentAccount).get(payload.destination_account_id)
            if payload.destination_account_id
            else get_or_create_shop_account(db, shop)
        )
        if not account:
            raise HTTPException(404, "Destination account not found")
        payment_payload = schemas.PaymentCreate(
            date=payload.date,
            customer_id=payload.customer_id,
            sale_id=sale.id,
            amount=payload.amount_collected_now,
            method=payload.payment_method,
            account_id=account.id,
            notes=f"Collected at Emergency Transfer {sale.display_id} ({shop.name})",
            entered_by=current_user.name,
        )
        _apply_payment(db, payment_payload, current_user.name)

    db.commit()
    db.refresh(sale)
    return sale
