"""Additive, non-destructive column migrations.

This project uses Base.metadata.create_all() at startup instead of Alembic —
that creates missing TABLES but never adds missing COLUMNS to a table that
already exists. Every column below was added to models.py after the tables
were first created, so on an existing database they'd otherwise be silently
absent and every INSERT/SELECT touching them would fail. This runs once at
startup, after create_all(), and only ever adds a column — it never drops,
renames, or alters existing data.
"""

import uuid as _uuid
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
    # shop_customer_payments.account_id/shop_sale_id: null for every
    # existing collection — pre-migration collections never posted to any
    # account and were never linked to a specific originating sale.
    ("shop_customer_payments", "account_id", "GUID"),
    ("shop_customer_payments", "shop_sale_id", "GUID"),
    # shop_expense_transactions.account_id: null for every existing
    # expense — pre-migration expenses only ever had the free-text
    # payment_source note, no real account was debited.
    ("shop_expense_transactions", "account_id", "GUID"),
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