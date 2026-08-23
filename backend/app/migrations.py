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
    ("unified_sale_batches", "destination_type", "VARCHAR(50) NOT NULL DEFAULT 'plant'"),
    ("unified_sale_batches", "target_plant_id", "GUID"),
    ("unified_sale_batches", "account_id", "VARCHAR(255)"),
    ("payments", "destination_type", "VARCHAR(50)"),
    ("payments", "target_plant_id", "GUID"),
    ("payments", "account_category", "VARCHAR(255)"),
    ("payments", "net_settlement_amount", "NUMERIC(14, 2)"),
    ("company_payments", "source_payment_id", "GUID"),
    ("expenses", "source_payment_id", "GUID"),
    ("owner_drawings", "source_payment_id", "GUID"),
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