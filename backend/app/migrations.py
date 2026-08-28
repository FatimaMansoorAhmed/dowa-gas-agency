"""Additive, non-destructive column migrations.

This project uses Base.metadata.create_all() at startup instead of Alembic —
that creates missing TABLES but never adds missing COLUMNS to a table that
already exists. Every column below was added to models.py after the tables
were first created, so on an existing database they'd otherwise be silently
absent and every INSERT/SELECT touching them would fail. This runs once at
startup, after create_all(), and only ever adds a column — it never drops,
renames, or alters existing data.
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# (table, column, DDL type). "GUID" is a placeholder resolved per-dialect
# below — it must match what models.GUID actually stores (native UUID on
# Postgres, CHAR(36) elsewhere), or comparisons against it (e.g. `.filter(
# Expense.source_payment_id == payment.id)`) fail with a type-mismatch
# error at the DB level even though the ORM query itself is correct.
_NEW_COLUMNS: list[tuple[str, str, str]] = [
    ("payment_accounts", "account_type", "VARCHAR(50)"),
    ("unified_sale_batches", "destination_type", "VARCHAR(50) NOT NULL DEFAULT 'plant'"),
    ("unified_sale_batches", "target_plant_id", "GUID"),
    ("unified_sale_batches", "account_id", "VARCHAR(255)"),
    ("unified_sale_batches", "vehicle_no", "VARCHAR(255)"),
    ("unified_sale_batches", "gate_pass_no", "VARCHAR(255)"),
    ("unified_sale_batches", "notes", "VARCHAR(255)"),
    ("payments", "destination_type", "VARCHAR(50)"),
    ("payments", "target_plant_id", "GUID"),
    ("payments", "account_category", "VARCHAR(255)"),
    ("payments", "net_settlement_amount", "NUMERIC(14, 2)"),
    ("company_payments", "source_payment_id", "GUID"),
    ("company_payments", "source_owner_capital_id", "GUID"),
    ("expenses", "source_payment_id", "GUID"),
    ("owner_drawings", "source_payment_id", "GUID"),
    ("customers", "cylinder_balance_118", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "cylinder_balance_454", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_118", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_454", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("empty_cylinder_sales", "cylinder_size", "VARCHAR(10) NOT NULL DEFAULT '118'"),
    ("cylinder_transactions", "transaction_type", "VARCHAR(50) NOT NULL DEFAULT 'SALE_RETURN'"),
    ("cylinder_transactions", "unified_sale_id", "GUID"),
    # Independent Sale/Load vs Plant Payment/Settlement approval (see
    # models.UnifiedSaleBatch and routers/unified_sale.py). Every existing
    # row gets 'pending' from the column default; the backfill below then
    # brings already-resolved batches (approved/cancelled under the old
    # single-status workflow) up to date in one pass.
    ("unified_sale_batches", "sale_status", "VARCHAR(50) NOT NULL DEFAULT 'pending'"),
    ("unified_sale_batches", "sale_approved_at", "TIMESTAMP"),
    ("unified_sale_batches", "sale_approved_by", "VARCHAR(255)"),
    ("unified_sale_batches", "payment_status", "VARCHAR(50) NOT NULL DEFAULT 'pending'"),
    ("unified_sale_batches", "payment_approved_at", "TIMESTAMP"),
    ("unified_sale_batches", "payment_approved_by", "VARCHAR(255)"),
    ("unified_sale_batches", "payment_reference", "VARCHAR(255)"),
]


def run_startup_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    guid_type = "UUID" if engine.dialect.name == "postgresql" else "CHAR(36)"

    with engine.begin() as conn:
        for table, column, ddl_type in _NEW_COLUMNS:
            if table not in existing_tables:
                continue  # create_all() will have made it with the column already
            existing_columns = {c["name"] for c in inspector.get_columns(table)}
            if column in existing_columns:
                continue
            resolved_type = guid_type if ddl_type == "GUID" else ddl_type
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {resolved_type}"))

        # payments.account_id was NOT NULL before Payment Receipts existed —
        # a "plant"-routed receipt legitimately has no account (mirrors
        # CompanyPayment.account_id / Expense.account_id, both already
        # nullable for the same 3-way-settlement reason). Postgres only:
        # SQLite can't ALTER a column's nullability without a table rebuild,
        # but a fresh SQLite DB created by create_all() already has the
        # column nullable, so there's nothing to migrate there.
        if "payments" in existing_tables and engine.dialect.name == "postgresql":
            payments_columns = {c["name"]: c for c in inspector.get_columns("payments")}
            if payments_columns.get("account_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE payments ALTER COLUMN account_id DROP NOT NULL"))

        # cylinder_transactions.product_id was NOT NULL on some existing
        # databases from before generic (non-product-specific) cylinder
        # entries existed — models.CylinderTransaction.product_id has always
        # been nullable=True, so this brings the DB back in line with the
        # model. Postgres only, same reasoning as payments.account_id above.
        if "cylinder_transactions" in existing_tables and engine.dialect.name == "postgresql":
            cyl_txn_columns = {c["name"]: c for c in inspector.get_columns("cylinder_transactions")}
            if cyl_txn_columns.get("product_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE cylinder_transactions ALTER COLUMN product_id DROP NOT NULL"))

        # One-time backfill: bring pre-existing Unified Sale batches (created
        # under the old single-status workflow) up to date with the new
        # independent sale_status/payment_status columns, which the ADD
        # COLUMN loop above defaulted to 'pending' for every row, including
        # ones that were already approved/cancelled. Guarded by
        # `sale_status = 'pending'` so it only ever touches a row once —
        # a batch legitimately approved/cancelled via the new endpoints
        # already has sale_status != 'pending' and is left untouched.
        #
        # Deliberately does NOT re-check `inspector.get_columns(...)` here —
        # `inspector` was captured before this transaction started, so on
        # some dialects it can't see the ALTER TABLE statements the loop
        # above just ran on `conn` in this same still-open transaction. The
        # columns are guaranteed to exist by this point regardless: either
        # this is a fresh DB (create_all() already created them) or the
        # loop above just added them — both covered by the same
        # `unified_sale_batches` table-existence check.
        if "unified_sale_batches" in existing_tables:
            conn.execute(text("""
                UPDATE unified_sale_batches
                SET sale_status = status,
                    payment_status = status,
                    sale_approved_at = approved_at,
                    payment_approved_at = approved_at,
                    sale_approved_by = approved_by,
                    payment_approved_by = approved_by
                WHERE status IN ('approved', 'cancelled') AND sale_status = 'pending'
            """))