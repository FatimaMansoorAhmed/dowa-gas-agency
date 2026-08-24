from sqlalchemy.orm import Session
from sqlalchemy import func, Integer, cast


def next_display_id(db: Session, model, prefix: str, width: int = 4) -> str:
    """Sequential display ID: CUST-0001, SALE-000123, etc. Derives the next
    number from the highest existing numeric suffix for this prefix — never
    from row count (COUNT(*) drifts out of sync the moment any row is
    deleted, or a row is inserted through any path other than this
    function — that drift is what produced the CPAY-000025 collision this
    replaced). Casting the suffix to Integer before MAX() is required so
    'CPAY-000009' < 'CPAY-000010' compares numerically, not as strings."""
    suffix_len = len(prefix) + 1  # +1 for the hyphen
    max_suffix = (
        db.query(func.max(cast(func.substr(model.display_id, suffix_len + 1), Integer)))
        .filter(model.display_id.like(f"{prefix}-%"))
        .scalar()
    )
    next_number = (max_suffix or 0) + 1
    candidate = f"{prefix}-{str(next_number).zfill(width)}"

    # Defensive: if a row with this exact display_id somehow already exists
    # (stale data, or a genuine race with another request), bump once more
    # rather than handing back a value guaranteed to collide.
    if db.query(model.id).filter(model.display_id == candidate).first():
        next_number += 1
        candidate = f"{prefix}-{str(next_number).zfill(width)}"

    return candidate


# The 3 fixed Liquidity Hub buckets Cash Management and the Payments page
# both read/write through — a customer payment routed to "office_cash", a
# Cash Management transfer, and an owner drawing all resolve to exactly one
# of these real PaymentAccount rows, so there is never a second balance.
BUCKET_ACCOUNT_LABELS = {
    "office_cash": "Office Cash",
    "owner_home": "Home Cash",
    "dowa_account": "Dowa Account",
}


def get_or_create_bucket_account(db: Session, account_type: str):
    """Returns the one real PaymentAccount row tagged with this account_type,
    creating it (zero opening balance) the first time it's needed. This is
    the single ledger row every page/router reads and writes for that
    bucket — never a value computed separately per page."""
    from app import models  # local import avoids a circular import with models.py

    label = BUCKET_ACCOUNT_LABELS.get(account_type)
    if not label:
        return None

    account = db.query(models.PaymentAccount).filter(models.PaymentAccount.account_type == account_type).first()
    if account:
        return account

    # A same-named row created before the account_type column existed —
    # tag it instead of creating a second row for the same bucket.
    account = db.query(models.PaymentAccount).filter(models.PaymentAccount.name == label).first()
    if account:
        account.account_type = account_type
        db.add(account)
        db.flush()
        return account

    account = models.PaymentAccount(
        name=label, kind="cash", account_type=account_type,
        opening_balance=0, current_balance=0, active="active",
    )
    db.add(account)
    db.flush()
    return account


def resolve_account_or_bucket(db: Session, value):
    """Resolves a settlement's account_id/account_category value to a real
    PaymentAccount row. `value` is either a real PaymentAccount UUID or one
    of the fixed bucket keys (office_cash | owner_home | dowa_account) —
    either way this returns the same row Cash Management balances come
    from, so crediting/debiting through here keeps every page in sync."""
    from uuid import UUID
    from app import models

    if not value:
        return None
    try:
        account_uuid = UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        account_uuid = None
    if account_uuid:
        return db.query(models.PaymentAccount).get(account_uuid)
    return get_or_create_bucket_account(db, str(value))


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