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


def get_or_create_shop_account(db: Session, shop):
    """Returns the ONE real PaymentAccount row that IS this shop's own Shop
    Cash (§ Shop Cash Money Routing) — same account_type/kind convention as
    the 3 Liquidity Hub buckets above, just additionally scoped by shop_id
    so multiple shops never share a balance. Deliberately keyed on BOTH
    account_type=="shop_cash" AND shop_id (never account_type alone, unlike
    get_or_create_bucket_account) — account_type=="shop_cash" is not a key
    in BUCKET_ACCOUNT_LABELS, so the generic bucket helpers above never
    resolve to a shop's account by accident."""
    from app import models  # local import avoids a circular import with models.py

    account = (
        db.query(models.PaymentAccount)
        .filter(models.PaymentAccount.account_type == "shop_cash", models.PaymentAccount.shop_id == shop.id)
        .first()
    )
    if account:
        return account

    account = models.PaymentAccount(
        name=f"Shop Cash — {shop.name}",
        kind="cash",
        account_type="shop_cash",
        shop_id=shop.id,
        opening_balance=0,
        current_balance=0,
        active="active",
    )
    db.add(account)
    db.flush()
    return account


def resync_unified_sale_batch_totals(db: Session, unified_sale_id) -> None:
    """Keeps UnifiedSaleBatch.total_selling_amount/total_credit_received/
    net_plant_payment in sync after a child Sale or Payment is corrected
    (routers/sales.py::correct_sale, routers/payments.py::correct_payment).

    These are stored (not computed-on-read) fields, set once at
    create/approve time and otherwise read only for DISPLAY — the ledger's
    "unified_sale" row (routers/ledger.py) walks total_selling_amount
    straight into its running_balance math. Without this resync, correcting
    a batch-linked Sale/Payment leaves that stored total pointing at the
    pre-correction amount forever, so every ledger row after it silently
    drifts from the customer's real current_balance even though the
    customer's own balance (updated directly by correct_sale/correct_payment)
    is correct.

    Deliberately does NOT touch net_plant_payment's downstream settlement
    effect (the plant-payable / account credit routed in
    approve_unified_sale_payment) — that money already moved, once, at
    approval; this only fixes the batch's own bookkeeping fields, never
    re-routes funds a second time."""
    from app import models  # local import avoids a circular import with models.py

    if not unified_sale_id:
        return
    batch = db.query(models.UnifiedSaleBatch).get(unified_sale_id)
    if not batch:
        return

    total_selling_amount = (
        db.query(func.coalesce(func.sum(models.Sale.total_amount), 0))
        .filter(models.Sale.unified_sale_id == unified_sale_id, models.Sale.status == "active")
        .scalar()
    )
    total_credit_received = (
        db.query(func.coalesce(func.sum(models.Payment.amount), 0))
        .filter(models.Payment.unified_sale_id == unified_sale_id, models.Payment.status == "active")
        .scalar()
    )
    batch.total_selling_amount = total_selling_amount
    batch.total_credit_received = total_credit_received
    batch.net_plant_payment = total_credit_received - (batch.home_expense_amount or 0) - (batch.owner_drawings_amount or 0)
    db.add(batch)


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