"""Additive, non-destructive column migrations.

This project uses Base.metadata.create_all() at startup instead of Alembic —
that creates missing TABLES but never adds missing COLUMNS to a table that
already exists. Every column below was added to models.py after the tables
were first created, so on an existing database they'd otherwise be silently
absent and every INSERT/SELECT touching them would fail. This runs once at
startup, after create_all(), and only ever adds a column — it never drops,
renames, or alters existing data.
"""

import logging
import uuid as _uuid
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

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
    # Delivery Charges (optional, default 0) — see models.UnifiedSaleBatch.
    ("unified_sale_batches", "delivery_charges", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    ("payments", "destination_type", "VARCHAR(50)"),
    ("payments", "target_plant_id", "GUID"),
    ("payments", "account_category", "VARCHAR(255)"),
    ("payments", "net_settlement_amount", "NUMERIC(14, 2)"),
    ("company_payments", "source_payment_id", "GUID"),
    ("company_payments", "source_owner_capital_id", "GUID"),
    ("expenses", "source_payment_id", "GUID"),
    ("expenses", "source_shop_sale_id", "GUID"),
    ("owner_drawings", "source_payment_id", "GUID"),
    ("owner_drawings", "source_shop_sale_id", "GUID"),
    ("customers", "cylinder_balance_118", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "cylinder_balance_454", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_118", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_454", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    # Cross / PSO breakdown within each size (§ Empty Cylinders — Size +
    # Type Model). Every existing customer gets 0/0 from the column
    # default — their pre-existing empty_cylinders_118/454 totals are left
    # exactly as they were, never guessed into a type.
    ("customers", "empty_cylinders_118_cross", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_118_pso", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_454_cross", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("customers", "empty_cylinders_454_pso", "NUMERIC(10, 0) NOT NULL DEFAULT 0"),
    ("empty_cylinder_sales", "cylinder_size", "VARCHAR(10) NOT NULL DEFAULT '118'"),
    # Nullable — existing empty_cylinder_sales rows have no reliable type
    # to backfill, so they stay NULL (legacy/unclassified) rather than guessed.
    ("empty_cylinder_sales", "cylinder_type", "VARCHAR(10)"),
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
    # Ledger Corrections (§1) — additive on the 4 correctable transaction
    # types (Sale/Payment on the customer side, Purchase/CompanyPayment on
    # the plant side). See models.Sale.corrected_by for the convention:
    # set on the ORIGINAL row when superseded (status becomes "corrected"),
    # corrected_from_id set on the NEW replacement row pointing back at it.
    ("sales", "corrected_by", "VARCHAR(255)"),
    ("sales", "corrected_at", "TIMESTAMP"),
    ("sales", "correction_reason", "VARCHAR(255)"),
    ("sales", "corrected_from_id", "GUID"),
    # Emergency Transfer (§ Shop — Emergency Transfer).
    ("sales", "emergency_transfer_shop_id", "GUID"),
    # Dashboard P&L / Shop Expense integration (§ Dashboard) — dual-write
    # tags, going forward only.
    ("expenses", "shop_id", "GUID"),
    ("expenses", "source_shop_expense_transaction_id", "GUID"),
    ("owner_drawings", "shop_id", "GUID"),
    ("owner_drawings", "source_shop_expense_transaction_id", "GUID"),
    ("payments", "corrected_by", "VARCHAR(255)"),
    ("payments", "corrected_at", "TIMESTAMP"),
    ("payments", "correction_reason", "VARCHAR(255)"),
    ("payments", "corrected_from_id", "GUID"),
    ("purchases", "corrected_by", "VARCHAR(255)"),
    ("purchases", "corrected_at", "TIMESTAMP"),
    ("purchases", "correction_reason", "VARCHAR(255)"),
    ("purchases", "corrected_from_id", "GUID"),
    ("company_payments", "corrected_by", "VARCHAR(255)"),
    ("company_payments", "corrected_at", "TIMESTAMP"),
    ("company_payments", "correction_reason", "VARCHAR(255)"),
    ("company_payments", "corrected_from_id", "GUID"),
    # Shop Management (§ Shop Management + Board Rate) — additive. Every
    # existing customer gets 'individual' from the default, so nothing
    # about existing Sale/Payment/Purchase/Customer behavior changes.
    ("customers", "customer_type", "VARCHAR(50) NOT NULL DEFAULT 'individual'"),
    # Saleable-KG wastage fix (§ Shop Management — Board Rate / Saleable KG):
    # a Shop Sale must price off (physical weight - 0.4kg fixed wastage), not
    # the raw Product.weight_kg — see routers/shops.FIXED_WASTAGE_KG. Existing
    # ShopSale rows were priced with the old (incorrect) formula, so there is
    # nothing correct to backfill here; they're left NULL, same convention as
    # empty_cylinder_sales.cylinder_type above.
    ("shop_sales", "saleable_kg_used", "NUMERIC(8, 2)"),
    # Shop KG-based sales (§15) — unit/quantity_kg record what the user
    # actually entered; `quantity` itself stays cylinder-equivalent for
    # FIFO/dashboard math (see models.ShopSale). Backfilled below for
    # existing rows, all of which were cylinder sales.
    ("shop_sales", "unit", "VARCHAR(10) NOT NULL DEFAULT 'cylinder'"),
    ("shop_sales", "quantity_kg", "NUMERIC(10, 2)"),
    # Supply Customers (§25) — additive, null/'cash' preserves every
    # existing ShopSale as the anonymous cash retail sale it already was.
    ("shop_sales", "supply_customer_id", "GUID"),
    ("shop_sales", "payment_type", "VARCHAR(10) NOT NULL DEFAULT 'cash'"),
    # Shop Business Finance (Engine 3, §19/§24) opening-cash anchor.
    # Superseded by the shop's own PaymentAccount.opening_balance (see
    # payment_accounts.shop_id below) — kept, unused, rather than dropped,
    # per this file's own additive-only convention; never non-zero in
    # practice since no UI ever set it.
    ("customers", "shop_opening_cash", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),

    # Shop Cash Money Routing (§ Shop Cash / Inline Settlement) — additive.
    # payment_accounts.shop_id: null for every existing account (Office
    # Cash, Home Cash, Dowa Account, ...) — those stay global/unowned.
    ("payment_accounts", "shop_id", "GUID"),
    # payments.source_account_id: null for every existing Payment — an
    # ordinary individual customer's payment has no tracked funding source.
    ("payments", "source_account_id", "GUID"),
    # shop_sales.amount_received/destination_account_id: backfilled below
    # (cash -> total_amount, credit -> 0) so every existing row reflects
    # exactly the all-or-nothing behavior it was created under.
    ("shop_sales", "amount_received", "NUMERIC(14, 2)"),
    ("shop_sales", "destination_account_id", "GUID"),
    # Settlement Routing (§ Settlement Routing — Shop Sale form) — where the
    # collected amount was routed at creation time. destination_account_id
    # above is the LEGACY fallback (a single PaymentAccount); these three
    # carry the new 3-way split (Plant Settlement / Account Deposit /
    # Home Expense + Owner Drawings bypass). Null for every pre-existing
    # row, which predates routing entirely.
    ("shop_sales", "settlement_destination_type", "VARCHAR(50)"),
    ("shop_sales", "settlement_target_plant_id", "GUID"),
    ("shop_sales", "settlement_account_id", "GUID"),
    # Free-text description the user typed for the Home Expense deduction
    # (§ Settlement Routing — Shop Sale form). Null for every pre-existing
    # row.
    ("shop_sales", "settlement_home_expense_description", "VARCHAR(255)"),
    ("shop_sales", "settlement_home_expense_amount", "NUMERIC(14, 2)"),
    ("shop_sales", "settlement_owner_drawings_amount", "NUMERIC(14, 2)"),
    # shop_customer_payments.account_id/shop_sale_id: null for every
    # existing collection — pre-migration collections never posted to any
    # account and were never linked to a specific originating sale.
    ("shop_customer_payments", "account_id", "GUID"),
    ("shop_customer_payments", "shop_sale_id", "GUID"),
    # shop_customer_payments.excess_amount: null for every existing
    # collection — pre-migration collections never recorded whether they
    # overpaid what was owed at the time (§ Shop Customer Ledger Bug 4).
    ("shop_customer_payments", "excess_amount", "NUMERIC(14, 2)"),
    # shop_expense_transactions.account_id: null for every existing
    # expense — pre-migration expenses only ever had the free-text
    # payment_source note, no real account was debited.
    ("shop_expense_transactions", "account_id", "GUID"),
    # Shop Expense/Withdrawal Attribution (§ Dashboard P&L / Shop Expense
    # integration) — captures which supply customer and/or which sale an
    # expense/withdrawal transaction was entered alongside, when the form
    # it came from actually had that context (Record Shop Sale, Record
    # Supply Customer Payment). Null for every existing row and for the
    # standalone Record Expense form, which has neither — there is
    # genuinely no customer/sale to attribute those to.
    ("shop_expense_transactions", "supply_customer_id", "GUID"),
    ("shop_expense_transactions", "shop_sale_id", "GUID"),
    # Daily Report Urdu translation (§ Phase D3) — every existing row
    # predates bilingual generation and was, by construction, English-only,
    # so it gets 'en' from the column default rather than being guessed.
    ("generated_reports", "language", "VARCHAR(10) NOT NULL DEFAULT 'en'"),
    # GST on Sale (optional, locked at entry) — every existing sale had no
    # GST, so gst_enabled/gst_amount get safe zero-value defaults here.
    # grand_total is added nullable and backfilled to equal total_amount
    # for every pre-existing row below (models.Sale.grand_total itself
    # stays nullable=False — the ORM always populates it going forward).
    ("sales", "gst_enabled", "BOOLEAN NOT NULL DEFAULT false"),
    ("sales", "gst_rate", "NUMERIC(5, 2)"),
    ("sales", "gst_amount", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    ("sales", "grand_total", "NUMERIC(14, 2)"),
    ("sales", "discount_enabled", "BOOLEAN NOT NULL DEFAULT false"),
    ("sales", "discount_rate", "NUMERIC(5, 2)"),
    ("sales", "discount_amount", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    # GST on Sale, extended to Unified Sale — same additive/backfill
    # pattern as the sales.* columns above.
    ("unified_sale_batches", "gst_enabled", "BOOLEAN NOT NULL DEFAULT false"),
    ("unified_sale_batches", "gst_rate", "NUMERIC(5, 2)"),
    ("unified_sale_batches", "gst_amount", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    ("unified_sale_batches", "grand_total", "NUMERIC(14, 2)"),
    ("unified_sale_batches", "discount_enabled", "BOOLEAN NOT NULL DEFAULT false"),
    ("unified_sale_batches", "discount_rate", "NUMERIC(5, 2)"),
    ("unified_sale_batches", "discount_amount", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    # Delete Customer / Delete Company — permanent display snapshot ("name
    # (CUST-007)"), written ONLY by the delete endpoints at the moment the
    # row they describe is hard-deleted, and left NULL for every row whose
    # customer/plant is still live. The customer_id/company_id UUID itself is
    # kept as-is (its FK constraint is dropped below), so the historical row
    # is otherwise untouched; this label is what keeps invoices, lists and
    # reports readable once the live Customer/Company row is gone.
    ("sales", "customer_label", "VARCHAR"),
    ("payments", "customer_label", "VARCHAR"),
    ("unified_sale_batches", "customer_label", "VARCHAR"),
    ("cylinder_transactions", "customer_label", "VARCHAR"),
    ("cylinder_returns", "customer_label", "VARCHAR"),
    ("cylinder_returns", "to_customer_label", "VARCHAR"),
    ("empty_cylinder_sales", "customer_label", "VARCHAR"),
    ("sales", "company_label", "VARCHAR"),
    ("purchases", "company_label", "VARCHAR"),
    ("company_payments", "company_label", "VARCHAR"),
    ("unified_sale_batches", "company_label", "VARCHAR"),
    # Delete Supply Customer (a shop's own customer) — same permanent display
    # snapshot idea as customer_label above, written only by that endpoint.
    ("shop_sales", "supply_customer_label", "VARCHAR"),
    ("shop_customer_payments", "supply_customer_label", "VARCHAR"),
    ("shop_expense_transactions", "supply_customer_label", "VARCHAR"),
    # Sell Empty Cylinders / Return Cylinder unification (§ Empty Cylinders
    # page) — every existing cylinder_returns row predates this distinction
    # and was, by construction, an ordinary Customer Ledger return, so it
    # gets 'return_cylinder' from the column default. Going forward, the
    # Empty Cylinders page's "Sell Cylinder" button passes
    # origin='sell_cylinder' explicitly (see models.CylinderReturn.origin).
    ("cylinder_returns", "origin", "VARCHAR(20) NOT NULL DEFAULT 'return_cylinder'"),
    # Settlement Correction (§ Bug Fix — Correction Modal Routing) — every
    # existing batch predates settlement correction and was, by
    # construction, never corrected, so these are simply NULL for all of
    # them (see models.UnifiedSaleBatch.settlement_corrected_by).
    ("unified_sale_batches", "settlement_corrected_by", "VARCHAR(255)"),
    ("unified_sale_batches", "settlement_corrected_at", "TIMESTAMP"),
    ("unified_sale_batches", "settlement_correction_reason", "VARCHAR(255)"),
    # Add Filled Cylinder Stock (§ Shop Management) — every existing batch
    # predates this distinction and was, by construction, created by a Load
    # (Sale), so it gets 'load' from the column default. notes is nullable
    # and only ever set on a 'manual_add' batch.
    ("shop_stock_batches", "source_type", "VARCHAR(20) NOT NULL DEFAULT 'load'"),
    ("shop_stock_batches", "notes", "VARCHAR(255)"),
    ("shop_stock_batches", "modified_at", "TIMESTAMP"),
    ("shop_stock_batches", "modified_by", "VARCHAR(255)"),
    # Opening Balance Correction (§ Opening Balance) — every pre-existing
    # audit_logs row (routers/sales.py's create/cancel/correct logging)
    # predates this and has no reason to backfill, so it stays NULL.
    ("audit_logs", "reason", "VARCHAR(255)"),
    # CompanyPayment <-> Shop Sale linkage fix (§ Shop Sale Settlement
    # Routing bug fix) — every existing row predates this column and is
    # NULL here; the ones actually created by a Shop Sale's "plant"
    # settlement are backfilled by the one-time repair further below,
    # which also reverses any that are incorrectly still "active" after
    # their originating Shop Sale was already cancelled.
    ("company_payments", "source_shop_sale_id", "GUID"),
    # Shop Cash Transfer (§ Shop Cash Transfer) — pushes money OUT of a
    # shop's real Shop Cash balance via the same 3-way settlement split as
    # Shop Sale. shop_cash_transfers itself is a brand-new table (created
    # by create_all(), not here); these three columns are the back-links on
    # the pre-existing bypass/settlement tables its routing can create, all
    # null for every pre-existing row since the feature is new.
    ("expenses", "source_shop_cash_transfer_id", "GUID"),
    ("owner_drawings", "source_shop_cash_transfer_id", "GUID"),
    ("company_payments", "source_shop_cash_transfer_id", "GUID"),
    # Payment Only mode (Record Shop Sale) — the same 3-way settlement
    # split, now on ShopCustomerPayment (a supply customer paying the shop
    # with nothing collected in-person). All null for every pre-existing
    # row: the legacy plain single-account path (account_id) is untouched
    # and still fully functional — these columns are additive, not a
    # replacement.
    ("shop_customer_payments", "settlement_destination_type", "VARCHAR(50)"),
    ("shop_customer_payments", "settlement_target_plant_id", "GUID"),
    ("shop_customer_payments", "settlement_account_id", "GUID"),
    ("shop_customer_payments", "settlement_home_expense_description", "VARCHAR(255)"),
    ("shop_customer_payments", "settlement_home_expense_amount", "NUMERIC(14, 2)"),
    ("shop_customer_payments", "settlement_owner_drawings_amount", "NUMERIC(14, 2)"),
    ("expenses", "source_shop_customer_payment_id", "GUID"),
    ("owner_drawings", "source_shop_customer_payment_id", "GUID"),
    ("company_payments", "source_shop_customer_payment_id", "GUID"),
    # Delete Shop (§ Delete Shop) — permanent snapshot set only when a shop
    # is deleted, replacing its now-gone shop_id/source_shop_*_id back-links
    # with a plain text label (e.g. "Shop Sale SHSALE-000042 (Some Shop)")
    # so the "came from a shop" context survives forever. Null for every
    # pre-existing row and for every row whose shop-side origin is still
    # live — see routers/shops.py's delete_shop.
    ("expenses", "shop_origin_label", "VARCHAR(255)"),
    ("owner_drawings", "shop_origin_label", "VARCHAR(255)"),
    ("company_payments", "shop_origin_label", "VARCHAR(255)"),
    # Rate Dashboard — Remove Company (§ Rate Dashboard part b) — scoped
    # purely to whether this company's card appears on the Rate Dashboard;
    # the Company row itself (and its RateEntry history) is untouched and
    # keeps working everywhere else (Purchases, Sales, Plant Ledger,
    # Executive Dashboard). False for every existing company — none were
    # hidden before this feature existed.
    ("companies", "hidden_from_rate_dashboard", "BOOLEAN NOT NULL DEFAULT false"),
    # Employee Salary Tracking (§ Employee Salary Tracking) — Expense/
    # ShopExpenseLine.employee_id required only when category_id is the
    # system "Salary" category (enforced at the router); null for every
    # existing row and every non-Salary category going forward.
    ("expenses", "employee_id", "GUID"),
    ("shop_expense_lines", "employee_id", "GUID"),
    # System-provided category (currently only "Salary", seeded below) —
    # false for every existing category, since none were system-provided
    # before this feature existed.
    ("expense_categories", "is_system", "BOOLEAN NOT NULL DEFAULT false"),
    # § Home Expense category reversion — replaces the free-text
    # settlement_home_expense_description going forward (that column is
    # kept, never dropped, for historical rows). Null for every existing
    # row, which all predate this reversion.
    ("shop_sales", "settlement_home_expense_category_id", "GUID"),
    ("shop_sales", "settlement_home_expense_employee_id", "GUID"),
    ("shop_cash_transfers", "settlement_home_expense_category_id", "GUID"),
    ("shop_cash_transfers", "settlement_home_expense_employee_id", "GUID"),
    ("shop_customer_payments", "settlement_home_expense_category_id", "GUID"),
    ("shop_customer_payments", "settlement_home_expense_employee_id", "GUID"),
    # § Manual Selling Rate override — false for every existing row (none
    # of them could have used an override before this feature existed).
    ("shop_sales", "manual_rate_override", "BOOLEAN NOT NULL DEFAULT false"),
    # § GST on Shop Sale — same pattern as sales.gst_enabled/grand_total
    # above: grand_total added nullable, backfilled to equal total_amount
    # for every pre-existing row below.
    ("shop_sales", "gst_enabled", "BOOLEAN NOT NULL DEFAULT false"),
    ("shop_sales", "gst_rate", "NUMERIC(5, 2)"),
    ("shop_sales", "gst_amount", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    ("shop_sales", "grand_total", "NUMERIC(14, 2)"),
    ("shop_sales", "discount_enabled", "BOOLEAN NOT NULL DEFAULT false"),
    ("shop_sales", "discount_rate", "NUMERIC(5, 2)"),
    ("shop_sales", "discount_amount", "NUMERIC(14, 2) NOT NULL DEFAULT 0"),
    # § Add Filled Cylinder Stock — one-time-only. False for every existing
    # shop; a shop that already used this feature before the restriction
    # existed is NOT retroactively locked out (would be indistinguishable
    # from a shop that never used it, and unfairly blocking a legitimate
    # future correction for pre-existing shops isn't the intent here).
    ("customers", "initial_stock_added", "BOOLEAN NOT NULL DEFAULT false"),
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

        # Repair Shop Sale settlement bypass rows that were historically
        # written with a ShopSale UUID in the Payment-FK source_payment_id
        # column. Only rows with no matching Payment and a matching ShopSale
        # are eligible; valid Payment lineage is never touched.
        if {"expenses", "owner_drawings", "payments", "shop_sales"} <= existing_tables:
            expense_repaired = conn.execute(text("""
                UPDATE expenses
                SET source_shop_sale_id = source_payment_id,
                    source_payment_id = NULL
                WHERE source_payment_id IS NOT NULL
                  AND (source_shop_sale_id IS NULL OR source_shop_sale_id = source_payment_id)
                  AND NOT EXISTS (
                      SELECT 1 FROM payments payment
                      WHERE payment.id = expenses.source_payment_id
                  )
                  AND EXISTS (
                      SELECT 1 FROM shop_sales shop_sale
                      WHERE shop_sale.id = expenses.source_payment_id
                  )
            """)).rowcount or 0
            drawing_repaired = conn.execute(text("""
                UPDATE owner_drawings
                SET source_shop_sale_id = source_payment_id,
                    source_payment_id = NULL
                WHERE source_payment_id IS NOT NULL
                  AND (source_shop_sale_id IS NULL OR source_shop_sale_id = source_payment_id)
                  AND NOT EXISTS (
                      SELECT 1 FROM payments payment
                      WHERE payment.id = owner_drawings.source_payment_id
                  )
                  AND EXISTS (
                      SELECT 1 FROM shop_sales shop_sale
                      WHERE shop_sale.id = owner_drawings.source_payment_id
                  )
            """)).rowcount or 0
            repaired_total = expense_repaired + drawing_repaired
            if repaired_total:
                logger.info(
                    "Shop Sale settlement lineage repair: expenses=%s owner_drawings=%s total=%s",
                    expense_repaired, drawing_repaired, repaired_total,
                )

        # Repair CompanyPayments created by a Shop Sale's "plant" settlement
        # before source_shop_sale_id existed to link them back (see
        # utils.apply_settlement_routing / _reverse_shop_sale_settlement bug
        # fix). Unlike the Expense/OwnerDrawings repair above, these rows'
        # source_payment_id was always correctly NULL — there's no misplaced
        # FK value to recover, so the only surviving signal is the notes
        # text apply_settlement_routing always writes for this path:
        # "3-way settlement via Shop Sale <display_id> — customer paid plant
        # directly". Postgres only (split_part) — fine, since this bug only
        # matters for real production data, never a fresh/local SQLite DB.
        if {"company_payments", "shop_sales", "companies"} <= existing_tables and engine.dialect.name == "postgresql":
            linked = conn.execute(text("""
                UPDATE company_payments cp
                SET source_shop_sale_id = ss.id
                FROM shop_sales ss
                WHERE cp.source_shop_sale_id IS NULL
                  AND cp.method = 'direct_settlement'
                  AND cp.notes LIKE '3-way settlement via Shop Sale %'
                  AND ss.display_id = split_part(split_part(cp.notes, 'Shop Sale ', 2), ' —', 1)
                RETURNING cp.id
            """)).fetchall()

            # Any now-linked row still "active" despite its ShopSale having
            # ALREADY been cancelled/corrected is the exact bug symptom this
            # repair exists for (a user cancelled the sale; reversal
            # silently no-op'd) — actually reverse it now, not just relink.
            stuck = conn.execute(text("""
                SELECT cp.id, cp.company_id, cp.amount, cp.excess_amount
                FROM company_payments cp
                JOIN shop_sales ss ON ss.id = cp.source_shop_sale_id
                WHERE cp.status = 'active' AND ss.status != 'active'
            """)).fetchall()
            for cp_id, company_id, amount, excess_amount in stuck:
                conn.execute(text("""
                    UPDATE companies
                    SET current_balance = current_balance + :amount,
                        account_credit = account_credit - :excess
                    WHERE id = :cid
                """), {"amount": amount, "excess": excess_amount or 0, "cid": company_id})
                conn.execute(text("UPDATE company_payments SET status = 'cancelled' WHERE id = :id"), {"id": cp_id})

            if linked or stuck:
                logger.info(
                    "CompanyPayment <-> Shop Sale lineage repair: linked=%s reversed_stuck_active=%s",
                    len(linked), len(stuck),
                )

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

        # shop_sales.quantity widened from NUMERIC(10,2) to NUMERIC(10,4) —
        # a unit='kg' Shop Sale (§15) stores a fractional cylinder-equivalent
        # here (quantity_kg / saleable kg per cylinder), which needs more
        # than 2 decimal places to stay reasonably precise for FIFO. Widening
        # precision is a safe, non-destructive ALTER in Postgres (existing
        # values are unaffected). SQLite has no fixed column precision to
        # widen — every value is stored as-is regardless of the declared type.
        if "shop_sales" in existing_tables and engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE shop_sales ALTER COLUMN quantity TYPE NUMERIC(10, 4)"))
        # Same widening for the batch side (§15 — a KG-based sale consumes a
        # fractional cylinder-equivalent from a batch, e.g. 0.2222).
        if "shop_stock_batches" in existing_tables and engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE shop_stock_batches ALTER COLUMN quantity_received TYPE NUMERIC(10, 4)"))
            conn.execute(text("ALTER TABLE shop_stock_batches ALTER COLUMN quantity_remaining TYPE NUMERIC(10, 4)"))
        if "shop_sale_batch_consumptions" in existing_tables and engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE shop_sale_batch_consumptions ALTER COLUMN quantity_consumed TYPE NUMERIC(10, 4)"))

        # cylinder_transactions.product_id was NOT NULL on some existing
        # databases from before generic (non-product-specific) cylinder
        # entries existed — models.CylinderTransaction.product_id has always
        # been nullable=True, so this brings the DB back in line with the
        # model. Postgres only, same reasoning as payments.account_id above.
        if "cylinder_transactions" in existing_tables and engine.dialect.name == "postgresql":
            cyl_txn_columns = {c["name"]: c for c in inspector.get_columns("cylinder_transactions")}
            if cyl_txn_columns.get("product_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE cylinder_transactions ALTER COLUMN product_id DROP NOT NULL"))

        # shop_expense_lines.category_id was NOT NULL before an Owner
        # Withdrawal line stopped being forced through a Category — a
        # withdrawal isn't a category of expense, so models.ShopExpenseLine
        # made this nullable=True (only "expense" lines require/validate it,
        # see routers/shops.create_shop_expense). Postgres only, same
        # reasoning as payments.account_id / cylinder_transactions.product_id
        # above.
        if "shop_expense_lines" in existing_tables and engine.dialect.name == "postgresql":
            expense_line_columns = {c["name"]: c for c in inspector.get_columns("shop_expense_lines")}
            if expense_line_columns.get("category_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE shop_expense_lines ALTER COLUMN category_id DROP NOT NULL"))

        # expenses.category_id was NOT NULL before a Settlement-Routing Home
        # Expense stopped being forced through a Category — a shop's on-the-spot
        # field expense (§ Settlement Routing — Shop Sale form) is a free-text
        # description the user typed ("fuel", "tea", ...) with no
        # ExpenseCategory behind it, so models.Expense made this
        # nullable=True (only an ordinary account-funded expense, entered
        # through the Expenses page's own form, requires a category). Postgres
        # only, same reasoning as payments.account_id / cylinder_transactions
        # .product_id / shop_expense_lines.category_id above.
        if "expenses" in existing_tables and engine.dialect.name == "postgresql":
            expense_columns = {c["name"]: c for c in inspector.get_columns("expenses")}
            if expense_columns.get("category_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE expenses ALTER COLUMN category_id DROP NOT NULL"))

        # rate_entries.party_id was NOT NULL before Party became optional —
        # some real plants have no party at all (§ Party optional). Postgres
        # only, same reasoning as payments.account_id above; local SQLite dev
        # keeps the NOT NULL constraint for now (out of scope, per decision).
        if "rate_entries" in existing_tables and engine.dialect.name == "postgresql":
            rate_entry_columns = {c["name"]: c for c in inspector.get_columns("rate_entries")}
            if rate_entry_columns.get("party_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE rate_entries ALTER COLUMN party_id DROP NOT NULL"))

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

        # Product de-duplication (§ Shop Management — Product Duplicate).
        # Investigation found "11.8 KG Cylinder2" sitting alongside "11.8 KG
        # Cylinder" as a genuine accidental duplicate DB row (same
        # weight_kg, zero Sale/Purchase/ShopSale/ShopStockBatch/
        # ShopStockAdjustment/CylinderTransaction references) — most likely
        # created once through the plain POST /products endpoint. It must
        # never be silently deleted (historical rows could reference it on
        # some other database), only deactivated so every product selector
        # (Shop Sale, Unified Sale items, Purchase) stops offering it,
        # which is also what let a user type a rate into the *duplicate's*
        # row and see the 11.8->45.4 auto-calc "not fire" (that calc keys
        # off the specific product id, and the duplicate's id never matched
        # it) — restoring a single 11.8kg product restores the calc too,
        # with no change to the calc logic itself.
        #
        # General + idempotent: for every weight_kg shared by more than one
        # ACTIVE product, keep exactly one (preferring whichever already has
        # historical Sale/Purchase rows, so real data is never orphaned; if
        # none do, keep the lowest id for a stable, repeatable choice) and
        # deactivate the rest. Already-inactive products are left alone, so
        # re-running this on every startup never re-flips a deliberate
        # manual reactivation.
        if "products" in existing_tables:
            rows = conn.execute(text(
                "SELECT id, weight_kg FROM products WHERE active = 'active'"
            )).fetchall()
            by_weight: dict[str, list[str]] = {}
            for pid, weight in rows:
                by_weight.setdefault(str(weight), []).append(str(pid))

            for weight, ids in by_weight.items():
                if len(ids) < 2:
                    continue

                counts = {}
                for pid in ids:
                    sale_cnt = conn.execute(
                        text("SELECT COUNT(*) FROM sales WHERE product_id = :pid"), {"pid": pid}
                    ).scalar() or 0
                    purchase_cnt = conn.execute(
                        text("SELECT COUNT(*) FROM purchases WHERE product_id = :pid"), {"pid": pid}
                    ).scalar() or 0
                    counts[pid] = sale_cnt + purchase_cnt

                keep_id = sorted(ids, key=lambda pid: (-counts[pid], pid))[0]
                for pid in ids:
                    if pid != keep_id:
                        conn.execute(
                            text("UPDATE products SET active = 'inactive' WHERE id = :pid"),
                            {"pid": pid},
                        )

        # One-time backfill: every existing shop_sales row predates the
        # unit/quantity_kg columns and was, by construction, a whole-cylinder
        # sale (quantity_kg = quantity * cylinder_weight_used — the physical
        # weight, matching what that row's already-frozen total_amount was
        # actually computed from before the wastage fix; never recomputed
        # from today's saleable-KG rule, which would silently change a
        # historical amount's implied weight). Guarded by quantity_kg IS NULL
        # so a re-run never touches a row a real Shop Sale already populated.
        if "shop_sales" in existing_tables:
            conn.execute(text("""
                UPDATE shop_sales
                SET quantity_kg = quantity * cylinder_weight_used
                WHERE quantity_kg IS NULL
            """))

        # One-time backfill: every existing shop_sales row predates
        # amount_received (Inline Settlement / partial payment) and was, by
        # construction, all-or-nothing — a 'cash' sale was always paid in
        # full on the spot, a 'credit' sale was always fully unpaid at
        # creation. Guarded by amount_received IS NULL so a re-run never
        # touches a row a real Shop Sale already populated (including one
        # deliberately saved with amount_received = 0).
        if "shop_sales" in existing_tables:
            conn.execute(text("""
                UPDATE shop_sales
                SET amount_received = CASE WHEN payment_type = 'cash' THEN total_amount ELSE 0 END
                WHERE amount_received IS NULL
            """))

        # One-time backfill: models.Payment.unified_sale_id was a real
        # column with ZERO rows ever using it (confirmed directly against
        # the database before this fix) — a Unified Sale's
        # total_credit_received (the customer's actual on-the-spot
        # collection) was posted straight onto customer.current_balance in
        # approve_unified_sale_sale, with no Payment row created for it at
        # all, so it had no reporting/audit trail anywhere except the now-
        # retired separate "Unified Sale" Daily Report section. That
        # function now creates this row going forward (§ Daily Report
        # Unified Sale fixes); this backfills every ALREADY-approved batch
        # it predates. Guarded by "no Payment row already linked to this
        # batch" so a re-run is a no-op. Never touches
        # customer.current_balance — that already correctly reflects
        # credit_received from when the batch was originally approved; this
        # is a pure audit-trail insert, matching exactly what the live code
        # path now does (account_id=NULL, method='unified_sale_credit',
        # status='active').
        _required_unified = {"unified_sale_batches", "payments"}
        if _required_unified <= existing_tables:
            already_backfilled = {
                str(row[0]) for row in conn.execute(text(
                    "SELECT DISTINCT unified_sale_id FROM payments WHERE unified_sale_id IS NOT NULL"
                )).fetchall()
            }
            to_backfill = conn.execute(text("""
                SELECT id, display_id, date, customer_id, total_credit_received, entered_by
                FROM unified_sale_batches
                WHERE sale_status = 'approved' AND total_credit_received > 0
            """)).fetchall()
            for batch_id, batch_display_id, batch_date, customer_id, credit_received, entered_by in to_backfill:
                if str(batch_id) in already_backfilled:
                    continue
                max_suffix = conn.execute(text(
                    "SELECT MAX(CAST(SUBSTR(display_id, 5) AS INTEGER)) FROM payments WHERE display_id LIKE 'PAY-%'"
                )).scalar()
                new_display_id = f"PAY-{(max_suffix or 0) + 1:06d}"
                conn.execute(text("""
                    INSERT INTO payments (id, display_id, date, customer_id, amount, method, account_id,
                                           source_account_id, notes, status, entered_by, created_at, unified_sale_id)
                    VALUES (:id, :display_id, :date, :customer_id, :amount, 'unified_sale_credit', NULL,
                            NULL, :notes, 'active', :entered_by, :date, :batch_id)
                """), {
                    "id": str(_uuid.uuid4()), "display_id": new_display_id, "date": batch_date,
                    "customer_id": str(customer_id), "amount": credit_received,
                    "notes": f"Collected at Unified Sale {batch_display_id} — routed onward at settlement",
                    "entered_by": entered_by, "batch_id": str(batch_id),
                })
                already_backfilled.add(str(batch_id))

        # Shop Cash Money Routing — every shop's own account, plus
        # reconciliation of pre-existing history against it. Runs on EVERY
        # startup (not guarded to "once") and is safe to do so: it always
        # RECOMPUTES current_balance from the full linked transaction set
        # rather than incrementing it, so a re-run is a no-op once nothing
        # is left to link, and it self-heals if a live mutation path ever
        # drifts from the transaction log. Scoped strictly to "shop_cash"
        # accounts — never touches Office Cash/Home Cash/Dowa Account/etc.,
        # whose own history (Sales, CompanyPayments, OwnerCapital, ...) is
        # far too broad to safely reconstruct here.
        _required = {"customers", "payment_accounts", "shop_sales", "shop_customer_payments", "shop_expense_transactions", "payments"}
        if _required <= existing_tables:
            shops = conn.execute(text("SELECT id, name FROM customers WHERE customer_type = 'shop'")).fetchall()
            for shop_id, shop_name in shops:
                row = conn.execute(
                    text("SELECT id FROM payment_accounts WHERE account_type = 'shop_cash' AND shop_id = :sid"),
                    {"sid": shop_id},
                ).fetchone()
                if row:
                    account_id = str(row[0])
                else:
                    account_id = str(_uuid.uuid4())
                    conn.execute(text("""
                        INSERT INTO payment_accounts (id, name, kind, account_type, shop_id, opening_balance, current_balance, active)
                        VALUES (:id, :name, 'cash', 'shop_cash', :sid, 0, 0, 'active')
                    """), {"id": account_id, "name": f"Shop Cash — {shop_name}", "sid": shop_id})

                # Backfill FK links on historical rows (all predate this
                # column and were, by construction, this shop's own money
                # movement) — guarded by IS NULL so a row a real request
                # already linked (possibly to a DIFFERENT chosen account)
                # is never overwritten.
                conn.execute(text("""
                    UPDATE shop_sales SET destination_account_id = :aid
                    WHERE customer_id = :sid AND destination_account_id IS NULL
                      AND amount_received IS NOT NULL AND amount_received > 0 AND status = 'active'
                """), {"aid": account_id, "sid": shop_id})
                conn.execute(text("""
                    UPDATE shop_customer_payments SET account_id = :aid
                    WHERE shop_id = :sid AND account_id IS NULL AND status = 'active'
                """), {"aid": account_id, "sid": shop_id})
                conn.execute(text("""
                    UPDATE shop_expense_transactions SET account_id = :aid
                    WHERE shop_id = :sid AND account_id IS NULL AND status = 'active'
                """), {"aid": account_id, "sid": shop_id})
                # Payment.source_account_id: before this feature existed,
                # every Dowa payment from a shop was implicitly assumed to
                # come from that shop's own cash (the only convention that
                # existed) — backfilling it here preserves that same
                # accounting for historical rows rather than silently
                # dropping them out of Shop Cash.
                conn.execute(text("""
                    UPDATE payments SET source_account_id = :aid
                    WHERE customer_id = :sid AND source_account_id IS NULL AND status = 'active'
                """), {"aid": account_id, "sid": shop_id})

                sales_sum = conn.execute(text(
                    "SELECT COALESCE(SUM(amount_received),0) FROM shop_sales WHERE destination_account_id = :aid AND status = 'active'"
                ), {"aid": account_id}).scalar()
                collections_sum = conn.execute(text(
                    "SELECT COALESCE(SUM(amount),0) FROM shop_customer_payments WHERE account_id = :aid AND status = 'active'"
                ), {"aid": account_id}).scalar()
                expense_sum = conn.execute(text(
                    "SELECT COALESCE(SUM(total_amount),0) FROM shop_expense_transactions WHERE account_id = :aid AND status = 'active'"
                ), {"aid": account_id}).scalar()
                dowa_sum = conn.execute(text(
                    "SELECT COALESCE(SUM(amount),0) FROM payments WHERE source_account_id = :aid AND status = 'active'"
                ), {"aid": account_id}).scalar()
                transfers_in = conn.execute(text(
                    "SELECT COALESCE(SUM(amount),0) FROM account_transfers WHERE to_account_id = :aid"
                ), {"aid": account_id}).scalar() if "account_transfers" in existing_tables else 0
                transfers_out = conn.execute(text(
                    "SELECT COALESCE(SUM(amount),0) FROM account_transfers WHERE from_account_id = :aid"
                ), {"aid": account_id}).scalar() if "account_transfers" in existing_tables else 0
                opening = conn.execute(
                    text("SELECT opening_balance FROM payment_accounts WHERE id = :aid"), {"aid": account_id}
                ).scalar() or 0

                new_balance = opening + sales_sum + collections_sum - expense_sum - dowa_sum + transfers_in - transfers_out
                conn.execute(
                    text("UPDATE payment_accounts SET current_balance = :bal WHERE id = :aid"),
                    {"bal": new_balance, "aid": account_id},
                )

        # Payment-Only Pending Approval (§ Payment-Only) — unified_sale_batches
        # .company_id was NOT NULL before a Payment-Only batch (no purchase
        # plant, no items) started reusing this table. Postgres only, same
        # reasoning as payments.account_id above; a fresh DB created by
        # create_all() already has the column nullable.
        if "unified_sale_batches" in existing_tables and engine.dialect.name == "postgresql":
            usb_columns = {c["name"]: c for c in inspector.get_columns("unified_sale_batches")}
            if usb_columns.get("company_id", {}).get("nullable") is False:
                conn.execute(text("ALTER TABLE unified_sale_batches ALTER COLUMN company_id DROP NOT NULL"))

        # One-time backfill: every existing sales row predates GST and was,
        # by construction, GST-free — grand_total (added nullable above)
        # equals total_amount for every one of them. Guarded by
        # grand_total IS NULL so a re-run never touches a row a real GST-
        # aware create/correct already populated (including one
        # deliberately saved with gst_amount = 0, i.e. GST toggled off).
        if "sales" in existing_tables:
            conn.execute(text("""
                UPDATE sales SET grand_total = total_amount WHERE grand_total IS NULL
            """))

        # Same backfill for Unified Sale batches — every existing batch
        # predates GST and was, by construction, GST-free.
        if "unified_sale_batches" in existing_tables:
            conn.execute(text("""
                UPDATE unified_sale_batches SET grand_total = total_selling_amount WHERE grand_total IS NULL
            """))

        # Same backfill for Shop Sales — every existing row predates GST on
        # Shop Sale and was, by construction, GST-free.
        if "shop_sales" in existing_tables:
            conn.execute(text("""
                UPDATE shop_sales SET grand_total = total_amount WHERE grand_total IS NULL
            """))

        # Employee Salary Tracking (§ Employee Salary Tracking) — seed the
        # one system-provided category exactly once. If a category literally
        # named "Salary" already exists (a user made one before this feature
        # existed), promote that same row to is_system rather than fail on
        # the name's UNIQUE constraint or create a confusing duplicate —
        # its existing id/history stays exactly as it was, only is_system
        # flips to true.
        if "expense_categories" in existing_tables:
            existing_salary = conn.execute(
                text("SELECT id FROM expense_categories WHERE name = 'Salary'")
            ).fetchone()
            if existing_salary:
                conn.execute(text("UPDATE expense_categories SET is_system = true WHERE id = :id"), {"id": existing_salary[0]})
            else:
                conn.execute(text("""
                    INSERT INTO expense_categories (id, name, description, active, is_system)
                    VALUES (:id, 'Salary', 'Employee salary payments — system-provided, cannot be deactivated', 'active', true)
                """), {"id": str(_uuid.uuid4())})

    # Delete Customer / Delete Company / Delete Employee — the entity row is
    # hard-deleted while every historical transaction that points at it
    # stays exactly as it was, so the FK constraints that would refuse that
    # delete are dropped (the UUID column and its value are kept). Postgres
    # only, idempotent: a column with no FK constraint left is simply
    # skipped, so this is a no-op on every restart after the first.
    if engine.dialect.name == "postgresql":
        _drop_fk_columns(engine, _FK_DROPS)

    _ensure_indexes(engine, _INDEXES)
    _normalize_whatsapp_recipients(engine)


def _normalize_whatsapp_recipients(engine: Engine) -> None:
    """Rewrites stored WhatsApp recipient numbers saved before validation
    existed (e.g. "03701234567") into E.164 ("+923701234567") — Meta matches
    recipients by exact number, so the un-prefixed form fails with error
    #131030. Idempotent: an already-normal number is left alone. A number
    that can't be read as a Pakistan mobile, or that would duplicate another
    recipient, is left untouched and logged for a person to sort out."""
    if "whatsapp_recipients" not in inspect(engine).get_table_names():
        return
    from app.whatsapp import normalize_phone_number

    def masked(p: str) -> str:
        return p[:4] + "…" + p[-3:] if len(p) > 7 else "…"

    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, phone_number FROM whatsapp_recipients ORDER BY created_at")).fetchall()
        taken: set[str] = set()
        pending: list[tuple] = []
        for rid, phone in rows:
            try:
                fixed = normalize_phone_number(phone)
            except ValueError:
                logger.warning("WhatsApp recipient %s is not a valid Pakistan mobile number — fix it by hand", masked(phone))
                continue
            if fixed == phone:
                taken.add(fixed)
            else:
                pending.append((rid, phone, fixed))
        for rid, phone, fixed in pending:
            if fixed in taken:
                logger.warning("WhatsApp recipient %s duplicates another recipient once normalized — left as is", masked(phone))
                continue
            conn.execute(text("UPDATE whatsapp_recipients SET phone_number = :p WHERE id = :id"), {"p": fixed, "id": rid})
            taken.add(fixed)
            logger.info("Normalized WhatsApp recipient %s -> %s", masked(phone), masked(fixed))


# (table, column) pairs whose FK to customers/companies/employees is dropped.
# customer_cylinder_balances / parties / rate_entries are deliberately NOT
# here — Delete Customer/Company hard-deletes those rows instead.
_FK_DROPS = [
    ("sales", "customer_id"), ("payments", "customer_id"), ("unified_sale_batches", "customer_id"),
    ("cylinder_transactions", "customer_id"), ("cylinder_returns", "customer_id"),
    ("cylinder_returns", "to_customer_id"), ("empty_cylinder_sales", "customer_id"),
    ("purchases", "company_id"), ("company_payments", "company_id"), ("sales", "company_id"),
    ("unified_sale_batches", "company_id"), ("owner_capital", "target_plant_id"),
    ("shop_cash_transfers", "settlement_target_plant_id"),
    ("employee_salary_accruals", "employee_id"), ("shop_sale_home_expense_lines", "employee_id"),
    ("unified_sale_home_expense_lines", "employee_id"),
    ("shop_customer_payments", "supply_customer_id"),
]


def _drop_fk_columns(engine: Engine, pairs) -> None:
    with engine.begin() as conn:
        for table, column in pairs:
            names = conn.execute(text("""
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = :t AND kcu.column_name = :c
                  AND tc.table_schema = current_schema()
            """), {"t": table, "c": column}).fetchall()
            for (name,) in names:
                conn.execute(text(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{name}"'))


# Performance — before this, every table had ONLY its primary key and
# display_id indexed, so every "WHERE customer_id = ..." / "WHERE
# unified_sale_id = ..." / date-range query was a full table scan. The list
# endpoints issue one such query per row, so page load time grew with the
# SQUARE of the data (rows x table size). Plain btree indexes on the columns
# the app filters and joins by; CREATE INDEX IF NOT EXISTS, so re-running at
# every startup is a no-op, and a missing table/column is skipped rather than
# failing startup. Additive only — no query, result or constraint changes.
_INDEXES = [
    ("sales", "unified_sale_id"), ("sales", "customer_id"), ("sales", "company_id"), ("sales", "date"), ("sales", "status"),
    ("purchases", "unified_sale_id"), ("purchases", "company_id"), ("purchases", "date"), ("purchases", "status"),
    ("payments", "unified_sale_id"), ("payments", "customer_id"), ("payments", "date"), ("payments", "status"),
    ("company_payments", "company_id"), ("company_payments", "unified_sale_id"), ("company_payments", "date"),
    ("expenses", "unified_sale_id"), ("expenses", "source_payment_id"), ("expenses", "date"), ("expenses", "status"),
    ("expenses", "shop_id"), ("expenses", "source_shop_sale_id"),
    ("owner_drawings", "unified_sale_id"), ("owner_drawings", "date"), ("owner_drawings", "status"), ("owner_drawings", "shop_id"),
    ("unified_sale_batches", "customer_id"), ("unified_sale_batches", "date"), ("unified_sale_batches", "company_id"),
    ("unified_sale_batches", "target_plant_id"), ("unified_sale_batches", "status"),
    ("unified_sale_home_expense_lines", "unified_sale_id"),
    ("shop_sales", "customer_id"), ("shop_sales", "date"), ("shop_sales", "supply_customer_id"), ("shop_sales", "status"),
    ("shop_sale_home_expense_lines", "shop_sale_id"), ("shop_sale_batch_consumptions", "shop_sale_id"),
    ("shop_customer_payments", "shop_id"), ("shop_customer_payments", "supply_customer_id"),
    ("shop_cash_transfers", "shop_id"), ("shop_expense_transactions", "shop_id"),
    ("shop_stock_batches", "customer_id"), ("shop_supply_customers", "shop_id"),
    ("cylinder_transactions", "customer_id"), ("cylinder_transactions", "sale_id"),
    ("customer_cylinder_balances", "customer_id"), ("cylinder_returns", "customer_id"),
    ("employee_salary_accruals", "employee_id"), ("audit_logs", "entity_id"),
    ("parties", "company_id"), ("rate_entries", "company_id"),
]


def _ensure_indexes(engine: Engine, pairs) -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, column in pairs:
            if table not in tables:
                continue
            if column not in {c["name"] for c in insp.get_columns(table)}:
                continue
            conn.execute(text(f'CREATE INDEX IF NOT EXISTS ix_{table}_{column} ON "{table}" ("{column}")'))
