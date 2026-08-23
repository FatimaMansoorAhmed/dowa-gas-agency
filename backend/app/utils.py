from sqlalchemy.orm import Session
from sqlalchemy import func


def next_display_id(db: Session, model, prefix: str, width: int = 4) -> str:
    """Simple sequential display ID: CUST-0001, SALE-000123, etc.
    Not concurrency-safe under heavy parallel writes at this table size —
    fine for a small internal tool; revisit with a DB sequence if needed."""
    count = db.query(func.count(model.id)).scalar() or 0
    return f"{prefix}-{str(count + 1).zfill(width)}"


def adjust_cylinder_balance(db: Session, customer_id, product_id, delta):
    """Applies delta (qty_out - qty_in) to a customer's running per-product
    cylinder balance, creating the row if it doesn't exist yet. Shared by
    the cylinder-transactions router and the Sale flow, which creates its
    own linked cylinder transaction alongside every sale."""
    from app import models  # local import avoids a circular import with models.py

    row = (
        db.query(models.CustomerCylinderBalance)
        .filter(
            models.CustomerCylinderBalance.customer_id == customer_id,
            models.CustomerCylinderBalance.product_id == product_id,
        )
        .first()
    )
    if not row:
        row = models.CustomerCylinderBalance(customer_id=customer_id, product_id=product_id, balance=0)
    row.balance = row.balance + delta
    db.add(row)
    return row