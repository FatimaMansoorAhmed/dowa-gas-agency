import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Numeric, DateTime, ForeignKey, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator, CHAR

from app.database import Base
from app.timezone import karachi_month_str

class GUID(TypeDecorator):
    """Platform-independent UUID: Postgres UUID, or CHAR(36) on SQLite (for local dev)."""
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID())
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return uuid.UUID(str(value))


def gen_uuid():
    return uuid.uuid4()


class Company(Base):
    __tablename__ = "companies"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)
    mobile = Column(String, nullable=True)

    # Same payable pattern as Customer's receivable: opening_balance is the
    # year anchor, current_balance is the running payable, negative means
    # Dowa has paid this plant in advance (mirrors the customer advance
    # convention exactly, just on the liability side).
    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    opening_balance_date = Column(DateTime, nullable=False, default=datetime.utcnow)
    current_balance = Column(Numeric(14, 2), nullable=False, default=0)
    opening_balance_month = Column(String, nullable=False, default=karachi_month_str)
    last_overpayment_amount = Column(Numeric(14, 2), nullable=True)
    last_overpayment_date = Column(DateTime, nullable=True)
    account_credit = Column(Numeric(14, 2), nullable=False, default=0)

    parties = relationship("Party", back_populates="company", cascade="all, delete-orphan")


class Party(Base):
    __tablename__ = "parties"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_party_per_company"),)

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    company_id = Column(GUID(), ForeignKey("companies.id"), nullable=False)
    name = Column(String, nullable=False)

    company = relationship("Company", back_populates="parties")
    rates = relationship("RateEntry", back_populates="party", cascade="all, delete-orphan")


class RateEntry(Base):
    """Every rate update is its own immutable row — nothing is overwritten.
    45.4kg (commercial) is always derived from 11.8kg (domestic) at write time
    using the fixed ratio 45.4 / 11.8, never entered directly.
    """
    __tablename__ = "rate_entries"

    RATIO = 45.4 / 11.8

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    company_id = Column(GUID(), ForeignKey("companies.id"), nullable=False)
    party_id = Column(GUID(), ForeignKey("parties.id"), nullable=False)
    rate_118 = Column(Numeric(10, 2), nullable=False)
    rate_454 = Column(Numeric(10, 2), nullable=False)
    entered_by = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    party = relationship("Party", back_populates="rates")
    company = relationship("Company")


class Customer(Base):
    __tablename__ = "customers"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # auto-generated e.g. CUST-0001
    name = Column(String, nullable=False)
    mobile = Column(String, nullable=False)
    alt_mobile = Column(String, nullable=True)
    shop_name = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city_area = Column(String, nullable=True)

    # "individual" (walk-in/household customer, the original meaning of
    # this table) | "shop" (a retail outlet that receives wholesale Loads
    # via the ordinary Sale flow below and resells at the daily Board
    # Rate — see models.ShopStockBatch/ShopSale). A Shop IS a Customer row
    # rather than a separate table: it reuses every existing Sale/Payment/
    # Customer-Ledger/correction code path unchanged for the money side,
    # only the new Shop-specific tables below are genuinely new.
    customer_type = Column(String, nullable=False, default="individual")

    # Shop Business Finance (Engine 3, §19/§24) — the shop's own cash
    # position anchor, mirroring opening_balance's role for the Dowa
    # receivable side: the one hand-entered number Shop Cash is derived
    # from, never edited after (see routers/shops._compute_cash_summary).
    # Meaningless/unused for customer_type != "shop".
    shop_opening_cash = Column(Numeric(14, 2), nullable=False, default=0)

    # "Year Opening Balance" — the anchor for the whole ledger. Monthly
    # opening balances (see opening_balance_month below) are always derived
    # from this plus everything that happened since, never edited by hand.
    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    opening_balance_date = Column(DateTime, nullable=False, default=datetime.utcnow)

    current_balance = Column(Numeric(14, 2), nullable=False, default=0)
    status = Column(String, nullable=False, default="active")  # active | inactive
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_transaction_at = Column(DateTime, nullable=True)
    opening_balance_month = Column(String, nullable=False, default=karachi_month_str)

    # Advance convention: a NEGATIVE current_balance means the customer has
    # paid ahead of what they owe. It must never be treated as a debt.
    last_overpayment_amount = Column(Numeric(14, 2), nullable=True)
    last_overpayment_date = Column(DateTime, nullable=True)

    # Account credit built up from overpayments — usable against future
    # sales (§18 Overpayment). Kept separate from current_balance so a
    # credit is always visible as its own number, not folded silently in.
    account_credit = Column(Numeric(14, 2), nullable=False, default=0)
    
    cylinder_balance_118 = Column(Numeric(10, 0), nullable=False, default=0)
    cylinder_balance_454 = Column(Numeric(10, 0), nullable=False, default=0)

    # Empty cylinders the customer currently holds and can sell back to the
    # agency — separate from cylinder_balance_118/454, which track filled
    # cylinders out on loan per size. Kept as the generic running total used
    # by the Sell Empty Cylinders flow (which doesn't split by size).
    empty_cylinders = Column(Numeric(10, 0), nullable=False, default=0)

    # Opening empty-cylinder balances, captured per size at customer
    # creation (Add New Customer form) — independent of empty_cylinders'
    # undifferentiated running total, so the 11.8kg / 45.4kg split is never
    # lost even though sales/purchases only ever move the generic total.
    empty_cylinders_118 = Column(Numeric(10, 0), nullable=False, default=0)
    empty_cylinders_454 = Column(Numeric(10, 0), nullable=False, default=0)

    # Cross / PSO breakdown WITHIN each size (§ Empty Cylinders — Size +
    # Type Model). Cross/PSO is a cylinder TYPE, never a separate size —
    # for a type-aware customer, cross + pso == the size's total above
    # (empty_cylinders_118 / _454, which stays the source of truth read
    # everywhere else: the untyped Sell Empty Cylinders flow, the ledger,
    # the dashboard). Customers created before this feature existed keep
    # their original size totals untouched here with cross/pso left at 0 —
    # that stock was never guessable into a type, so it's preserved as-is
    # and stays fully sellable via the untyped legacy path; the breakdown
    # only ever reflects transactions entered after typed tracking existed.
    empty_cylinders_118_cross = Column(Numeric(10, 0), nullable=False, default=0)
    empty_cylinders_118_pso = Column(Numeric(10, 0), nullable=False, default=0)
    empty_cylinders_454_cross = Column(Numeric(10, 0), nullable=False, default=0)
    empty_cylinders_454_pso = Column(Numeric(10, 0), nullable=False, default=0)

    # Relationships
    cylinder_transactions = relationship("CylinderTransaction", back_populates="customer", cascade="all, delete-orphan")


class Product(Base):
    """Cylinder / gas product type. Not hard-coded — administrator can add more."""
    __tablename__ = "products"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)  # e.g. "11.8 KG Cylinder"
    weight_kg = Column(Numeric(8, 2), nullable=False)
    active = Column(String, nullable=False, default="active")  # active | inactive


class PaymentAccount(Base):
    """A cash or bank account the agency actually holds money in."""
    __tablename__ = "payment_accounts"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)  # Main Cash, Meezan Bank, HBL...
    kind = Column(String, nullable=False, default="cash")  # cash | bank
    # Tags a real PaymentAccount row as one of the fixed Liquidity Hub
    # buckets (office_cash | owner_home | dowa_account) so Cash Management
    # can find/transfer/pay against it. Null for ordinary bank/cash rows
    # (Main Cash, Meezan Bank, ...) that aren't one of those buckets.
    account_type = Column(String, nullable=True)
    # Shop Cash Money Routing — scopes this row to ONE shop's own account
    # ("shop_cash" account_type + this shop_id) rather than a global bucket.
    # Null for every existing account (Office Cash, Home Cash, Dowa Account,
    # Main Cash, Meezan Bank, ...) — those stay global, unowned by any shop.
    # See app/utils.get_or_create_shop_account.
    shop_id = Column(GUID(), ForeignKey("customers.id"), nullable=True)
    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    current_balance = Column(Numeric(14, 2), nullable=False, default=0)
    active = Column(String, nullable=False, default="active")

    shop = relationship("Customer", foreign_keys=[shop_id])


class AccountTransfer(Base):
    """Persisted audit-trail row for one internal money move between two
    PaymentAccount rows (Office Cash <-> Dowa Account, a shop's own Shop
    Cash <-> Office Cash, etc.) — previously /payment-accounts/transfer
    mutated both balances with no queryable history at all. Written
    atomically alongside the balance mutation in
    routers/payment_accounts.transfer_between_accounts; never corrected,
    only ever a straight record of what moved and when."""
    __tablename__ = "account_transfers"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    date = Column(DateTime, default=datetime.utcnow, nullable=False)
    from_account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=False)
    to_account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    notes = Column(String, nullable=True)
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    from_account = relationship("PaymentAccount", foreign_keys=[from_account_id])
    to_account = relationship("PaymentAccount", foreign_keys=[to_account_id])


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    active = Column(String, nullable=False, default="active")


class Sale(Base):
    """One sale transaction. Rate and amount are snapshotted at write time —
    historical sales never change if today's rate changes (§6, §29)."""
    __tablename__ = "sales"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. SALE-000123
    date = Column(DateTime, nullable=False)  # business date of the sale
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=False)
    company_id = Column(GUID(), ForeignKey("companies.id"), nullable=True)  # plant

    quantity = Column(Numeric(10, 2), nullable=False)
    weight_per_cylinder = Column(Numeric(8, 2), nullable=False)  # snapshot from product
    total_kg = Column(Numeric(12, 2), nullable=False)
    rate_per_kg = Column(Numeric(10, 2), nullable=True)
    rate_per_cylinder = Column(Numeric(10, 2), nullable=True)
    total_amount = Column(Numeric(14, 2), nullable=False)  # stored, immutable

    gate_pass_no = Column(String, nullable=True)
    vehicle_no = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled | reversed | corrected
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    # Ledger Corrections (§1) — set on the ORIGINAL row when it is
    # superseded by a corrected replacement (status becomes "corrected",
    # never deleted). corrected_from_id is set on the NEW replacement row,
    # pointing back at the original it replaces — never the other way
    # around, so a chain of corrections reads as a simple linked list.
    corrected_by = Column(String, nullable=True)
    corrected_at = Column(DateTime, nullable=True)
    correction_reason = Column(String, nullable=True)
    corrected_from_id = Column(GUID(), nullable=True)

    customer = relationship("Customer")
    product = relationship("Product")
    company = relationship("Company")


class Payment(Base):
    """Money received from a customer. Strictly separate from Expense (§9, §11)."""
    __tablename__ = "payments"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. PAY-000123
    date = Column(DateTime, nullable=False)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    sale_id = Column(GUID(), ForeignKey("sales.id"), nullable=True)  # optional allocation to one sale

    amount = Column(Numeric(14, 2), nullable=False)
    method = Column(String, nullable=False)  # cash | bank_transfer | cheque | online | other
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    # Shop Cash Money Routing (§3) — WHICH account the money physically came
    # FROM before landing in account_id above. Null for an ordinary
    # individual customer's payment (no tracked source, they just handed
    # over cash). Set when the payer is a shop paying down its Dowa payable
    # out of its own Shop Cash (or another chosen account) — decremented in
    # the exact same transaction that credits account_id and reduces
    # Customer.current_balance, mirroring OwnerDrawings.account_id's
    # "funding source, decremented" role.
    source_account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    reference_no = Column(String, nullable=True)
    received_by = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    # Overpayment handling, mirrors the Customer advance fields at the
    # moment this specific payment was made (§18).
    excess_amount = Column(Numeric(14, 2), nullable=True)

    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)

    # Payment Receipt settlement routing (§ Settlement Routing) — set only
    # by /payment-receipts, never by the plain /payments quick-pay flow.
    # "plant" -> a linked CompanyPayment (source_payment_id) does the 3-way
    # settlement; "account" -> account_id (a real PaymentAccount) or
    # account_category (a label like "office_cash" with no ledger row yet)
    # receives net_settlement_amount = amount - home_expense - drawings.
    destination_type = Column(String(50), nullable=True)
    target_plant_id = Column(GUID(), ForeignKey("companies.id"), nullable=True)
    account_category = Column(String(255), nullable=True)
    net_settlement_amount = Column(Numeric(14, 2), nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled | reversed | corrected
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    # Ledger Corrections (§1) — see Sale.corrected_by for the convention.
    corrected_by = Column(String, nullable=True)
    corrected_at = Column(DateTime, nullable=True)
    correction_reason = Column(String, nullable=True)
    corrected_from_id = Column(GUID(), nullable=True)

    customer = relationship("Customer")
    sale = relationship("Sale")
    account = relationship("PaymentAccount", foreign_keys=[account_id])
    source_account = relationship("PaymentAccount", foreign_keys=[source_account_id])
    target_plant = relationship("Company", foreign_keys=[target_plant_id])


class Expense(Base):
    """Money the agency spends. Never touches a customer balance (§9, §11)."""
    __tablename__ = "expenses"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. EXP-000123
    date = Column(DateTime, nullable=False)
    category_id = Column(GUID(), ForeignKey("expense_categories.id"), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    # Nullable: a normal business expense is paid FROM an account (debited
    # here). An expense funded directly out of field-collected customer
    # cash (Unified Sale settlement split) never touched an account, so
    # account_id is left null and no balance is debited for it.
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    method = Column(String, nullable=False, default="cash")
    description = Column(String, nullable=True)
    vendor = Column(String, nullable=True)
    reference_no = Column(String, nullable=True)

    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)
    # Set when this Expense was auto-created by a standalone Payment
    # Receipt's home-expense deduction — lets cancelling that receipt find
    # and reverse this row. Mirrors unified_sale_id's linkage pattern.
    source_payment_id = Column(GUID(), ForeignKey("payments.id"), nullable=True)

    status = Column(String, nullable=False, default="active")
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    category = relationship("ExpenseCategory")
    account = relationship("PaymentAccount")


class OwnerDrawings(Base):
    """Money withdrawn by the owner for personal/household use. Tracked as
    its own ledger — must never appear as a business expense or reduce
    reported profit, only ever shown separately for cash tracking."""
    __tablename__ = "owner_drawings"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. DRAW-000123
    date = Column(DateTime, nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    # Same convention as Expense.account_id — null means funded directly
    # from field-collected cash, never deposited into an account.
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    notes = Column(String, nullable=True)

    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)
    # Set when this OwnerDrawings row was auto-created by a standalone
    # Payment Receipt's owner-drawings deduction — mirrors unified_sale_id.
    source_payment_id = Column(GUID(), ForeignKey("payments.id"), nullable=True)

    status = Column(String, nullable=False, default="active")
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    account = relationship("PaymentAccount")


class OwnerCapital(Base):
    """Fresh capital the owner injects into the business — the reverse of
    OwnerDrawings, and deliberately kept just as separate from Sale/Payment
    accounting. Two mutually exclusive destinations, chosen at entry time:

    destination_type == "account": the full amount is credited straight to
    one PaymentAccount (account_id) — Office Cash, Home Cash, or Dowa
    Account. No Sale/Expense is created; only that one account balance moves.

    destination_type == "plant": the full amount settles a plant's payable
    directly via a linked CompanyPayment (found by
    CompanyPayment.source_owner_capital_id) — reusing the exact same
    plant-payment accounting as an ordinary CompanyPayment (excess ->
    advance/account_credit), with account_id left null so the money never
    touches Office Cash, Home Cash, or the Dowa Account.
    """
    __tablename__ = "owner_capital"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. RCAP-000123
    date = Column(DateTime, nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)

    destination_type = Column(String(50), nullable=False, default="account")  # account | plant
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    target_plant_id = Column(GUID(), ForeignKey("companies.id"), nullable=True)

    notes = Column(String, nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    account = relationship("PaymentAccount")
    target_plant = relationship("Company", foreign_keys=[target_plant_id])


class UnifiedSaleBatch(Base):
    """One 'Unified Sale' submission. Not itself a ledger entry — a
    lightweight grouping row so the Sale(s), Purchase(s), Payment, Expense,
    and OwnerDrawings created together in one atomic transaction can all be
    traced back to the single form submission that created them."""
    __tablename__ = "unified_sale_batches"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. USALE-000123
    date = Column(DateTime, nullable=False)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    company_id = Column(GUID(), ForeignKey("companies.id"), nullable=False)

    total_selling_amount = Column(Numeric(14, 2), nullable=False, default=0)
    total_purchase_amount = Column(Numeric(14, 2), nullable=False, default=0)
    total_credit_received = Column(Numeric(14, 2), nullable=False, default=0)
    # Settled money is split exactly three ways, all computed/validated
    # server-side except the two explicit ones below:
    #   home_expense_amount + owner_drawings_amount (bypass, no account touched)
    #   net_plant_payment = total_credit_received - home_expense - drawings
    # (3-way settlement straight to the plant — see CompanyPayment above).
    # Nothing from a Unified Sale settlement enters a Dowa cash/bank account.
    net_plant_payment = Column(Numeric(14, 2), nullable=False, default=0)
    home_expense_amount = Column(Numeric(14, 2), nullable=False, default=0)
    owner_drawings_amount = Column(Numeric(14, 2), nullable=False, default=0)

    # Settlement Routing (Flexible Destination) — where net_plant_payment
    # actually goes: straight to a plant's payable via a 3-way settlement
    # (target_plant_id, which may differ from company_id — the purchase
    # plant's payable always grows by total_purchase_amount regardless of
    # this), or deposited into a Dowa cash/bank account. account_id holds
    # either a real PaymentAccount UUID (as text) or a category label like
    # "cash" / "office_cash" / "owner_home" / "dowa_account" when no
    # PaymentAccount row exists yet for that bucket — never FK-enforced.
    destination_type = Column(String(50), nullable=False, default="plant")
    target_plant_id = Column(GUID(), ForeignKey("companies.id"), nullable=True)
    account_id = Column(String(255), nullable=True)

    # Optional delivery reference for the whole batch — never required to save.
    vehicle_no = Column(String, nullable=True)
    gate_pass_no = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    # Legacy aggregate — kept for the Payments Register / Cash Management
    # pages, which only want batches that are FULLY posted. Derived from
    # sale_status/payment_status below (see _sync_legacy_status in
    # routers/unified_sale.py): "approved" only once BOTH sides have
    # posted, "cancelled" if either side was cancelled, else "pending".
    # Never read directly by the approval logic itself anymore.
    status = Column(String, nullable=False, default="pending")
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String, nullable=True)

    # Sale/Load and Plant Payment/Settlement are two independent real-world
    # events (customer receives goods today, plant may be paid days later)
    # and are approved independently. sale_status gates Sale/Purchase
    # posting + the customer ledger + the purchase-plant payable increase.
    # payment_status gates the settlement routing (plant payable decrease
    # or Dowa account credit) + CompanyPayment/Expense/OwnerDrawings
    # posting. Each is pending -> approved | cancelled, and one can be
    # "approved" while the other is still "pending" — that is a valid,
    # expected state, not a bug.
    sale_status = Column(String, nullable=False, default="pending")
    sale_approved_at = Column(DateTime, nullable=True)
    sale_approved_by = Column(String, nullable=True)
    payment_status = Column(String, nullable=False, default="pending")
    payment_approved_at = Column(DateTime, nullable=True)
    payment_approved_by = Column(String, nullable=True)
    # Free-text reference for the settlement (e.g. a bank transfer/cheque
    # number) — filled in whenever it becomes available, typically right
    # before payment approval.
    payment_reference = Column(String, nullable=True)

    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    customer = relationship("Customer")
    company = relationship("Company", foreign_keys=[company_id])
    target_plant = relationship("Company", foreign_keys=[target_plant_id])


class AuditLog(Base):
    """Every financial edit gets a row here — nothing is silently changed (§16, §31)."""
    __tablename__ = "audit_logs"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    entity_type = Column(String, nullable=False)  # "sale" | "payment" | "expense" | "customer"
    entity_id = Column(GUID(), nullable=False)
    action = Column(String, nullable=False)  # "create" | "update" | "cancel" | "reverse"
    field = Column(String, nullable=True)
    old_value = Column(String, nullable=True)
    new_value = Column(String, nullable=True)
    performed_by = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)


class Purchase(Base):
    """One purchase transaction from a plant. Mirrors Sale exactly, just
    posting to the Company payable instead of the Customer receivable."""
    __tablename__ = "purchases"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. PUR-000123
    date = Column(DateTime, nullable=False)
    company_id = Column(GUID(), ForeignKey("companies.id"), nullable=False)
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=False)

    quantity = Column(Numeric(10, 2), nullable=False)
    weight_per_cylinder = Column(Numeric(8, 2), nullable=False)  # snapshot from product
    total_kg = Column(Numeric(12, 2), nullable=False)
    rate_per_kg = Column(Numeric(10, 2), nullable=True)
    rate_per_cylinder = Column(Numeric(10, 2), nullable=True)

    additional_charges = Column(Numeric(14, 2), nullable=False, default=0)
    transport_charges = Column(Numeric(14, 2), nullable=False, default=0)
    other_charges = Column(Numeric(14, 2), nullable=False, default=0)
    total_amount = Column(Numeric(14, 2), nullable=False)  # cylinders + all charges, stored, immutable

    gate_pass_no = Column(String, nullable=True)
    vehicle_no = Column(String, nullable=True)
    driver_name = Column(String, nullable=True)
    driver_contact = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled | reversed | corrected
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    # Ledger Corrections (§1) — see Sale.corrected_by for the convention.
    corrected_by = Column(String, nullable=True)
    corrected_at = Column(DateTime, nullable=True)
    correction_reason = Column(String, nullable=True)
    corrected_from_id = Column(GUID(), nullable=True)

    company = relationship("Company")
    product = relationship("Product")


class CompanyPayment(Base):
    """Money Dowa pays to a plant. Strictly separate from Expense — this
    reduces a specific plant's payable, an Expense never does."""
    __tablename__ = "company_payments"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. CPAY-000123
    date = Column(DateTime, nullable=False)
    company_id = Column(GUID(), ForeignKey("companies.id"), nullable=False)
    purchase_id = Column(GUID(), ForeignKey("purchases.id"), nullable=True)  # optional allocation

    amount = Column(Numeric(14, 2), nullable=False)
    method = Column(String, nullable=False)  # cash | bank_transfer | cheque | online | other | direct_settlement
    # Nullable: a normal plant payment is paid FROM a Dowa account (debited
    # here). A 3-way settlement — customer money going straight to the
    # plant via a Unified Sale, never touching a Dowa account — leaves this
    # null, mirroring Expense.account_id / OwnerDrawings.account_id.
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    reference_no = Column(String, nullable=True)
    paid_by = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    excess_amount = Column(Numeric(14, 2), nullable=True)  # overpaid to plant -> advance/credit
    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)
    # Set when this CompanyPayment was auto-created by a standalone Payment
    # Receipt's "plant" destination routing (3-way settlement) — lets
    # cancelling that receipt find and reverse this row.
    source_payment_id = Column(GUID(), ForeignKey("payments.id"), nullable=True)
    # Set when this CompanyPayment was auto-created by a Direct Plant
    # Payment Re-Investment (OwnerCapital.destination_type == "plant") —
    # mirrors source_payment_id's linkage pattern, lets cancelling that
    # Owner Capital entry find and reverse this row.
    source_owner_capital_id = Column(GUID(), ForeignKey("owner_capital.id"), nullable=True)

    status = Column(String, nullable=False, default="active")
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    # Ledger Corrections (§1) — see Sale.corrected_by for the convention.
    corrected_by = Column(String, nullable=True)
    corrected_at = Column(DateTime, nullable=True)
    correction_reason = Column(String, nullable=True)
    corrected_from_id = Column(GUID(), nullable=True)

    company = relationship("Company")
    purchase = relationship("Purchase")
    account = relationship("PaymentAccount")


class CylinderTransaction(Base):
    """Tracks physical cylinder movement (In / Out) per customer.
    Decoupled from Sales/Payments, but optionally linked to one (sale_id /
    unified_sale_id) when it was created alongside a sale.
    """
    __tablename__ = "cylinder_transactions"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. CYL-000123
    date = Column(DateTime, nullable=False, default=datetime.utcnow)

    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=True)

    # Single flow linkages (optional: link to a unified sale or sale entry if created via sale)
    sale_id = Column(GUID(), ForeignKey("sales.id"), nullable=True)
    unified_sale_id = Column(GUID(), ForeignKey("unified_sale_batches.id"), nullable=True)

    # Quantities
    qty_out = Column(Numeric(10, 2), nullable=False, default=0)  # Filled cylinders delivered to customer
    qty_in = Column(Numeric(10, 2), nullable=False, default=0)   # Empty cylinders returned by customer

    # Transaction Types: 'SALE_RETURN', 'EMPTY_RECEIPT', 'EMPTY_SALE', 'ADJUSTMENT'
    transaction_type = Column(String(50), nullable=False, default="SALE_RETURN")

    notes = Column(String, nullable=True)
    status = Column(String, nullable=False, default="active")  # active | cancelled
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    customer = relationship("Customer", back_populates="cylinder_transactions")
    product = relationship("Product")
    sale = relationship("Sale")


class CustomerCylinderBalance(Base):
    """Running per-customer, per-product filled-cylinder balance — how many
    of a given product a customer currently holds (delivered minus
    returned). Kept as its own table (rather than folded into Customer)
    because a customer can carry a separate balance per product/size."""
    __tablename__ = "customer_cylinder_balances"
    __table_args__ = (UniqueConstraint("customer_id", "product_id", name="uq_cylinder_balance_per_product"),)

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=False)
    balance = Column(Numeric(10, 2), nullable=False, default=0)

    customer = relationship("Customer")
    product = relationship("Product")


class EmptyCylinderSale(Base):
    """One 'Sell Empty Cylinders' transaction — the agency selling a
    customer's surplus empty cylinders. Kept as its own lightweight table,
    mirroring OwnerDrawings/Expense, since a generic empty-cylinder sale has
    no fixed product/weight the way a real Sale does."""
    __tablename__ = "empty_cylinder_sales"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. ECS-000123
    date = Column(DateTime, nullable=False, default=datetime.utcnow)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)

    # Which categorized balance (Customer.empty_cylinders_118 /
    # empty_cylinders_454) this sale draws down — "118" or "454".
    cylinder_size = Column(String(10), nullable=False, default="118")
    # "cross" or "pso" — which type within cylinder_size this sale draws
    # down (Customer.empty_cylinders_{size}_{type}). Nullable: sales
    # recorded before typed tracking existed have no reliable type to
    # backfill, so they're left NULL (legacy/unclassified) rather than
    # guessed; every sale recorded through the typed flow sets this.
    cylinder_type = Column(String(10), nullable=True)
    quantity = Column(Numeric(10, 0), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    notes = Column(String, nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    customer = relationship("Customer")


class GeneratedReport(Base):
    """One generated report file (currently only report_type == "daily") —
    metadata + where it lives on disk, so it can be listed/viewed/
    downloaded/re-sent later without re-generating it (§6, §7). Every
    (re)generation inserts a NEW row rather than overwriting an existing
    one, so a report that was already sent over WhatsApp is never silently
    replaced — the Reports page shows the full history of every run."""
    __tablename__ = "generated_reports"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    report_type = Column(String, nullable=False, default="daily")
    business_date = Column(String, nullable=False)  # "YYYY-MM-DD", Asia/Karachi business date
    file_path = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    generated_by = Column(String, nullable=False)

    # WhatsApp delivery — see app/whatsapp.py. "not_sent" until a send is
    # attempted; "unavailable" means no provider credentials are configured
    # (never treated as an error — the PDF itself is unaffected).
    whatsapp_status = Column(String, nullable=False, default="not_sent")
    whatsapp_sent_at = Column(DateTime, nullable=True)
    whatsapp_error = Column(String, nullable=True)


class BoardRate(Base):
    """The single, system-wide official daily rate/kg for shop retail
    sales — a real Pakistani LPG-trade concept, deliberately NOT per-plant
    (unlike RateEntry, which is a per-party quote never actually wired to
    Sale pricing). Immutable/append-only, same "latest as-of a date"
    resolution pattern as RateEntry (routers/rates.py) — never edited or
    deleted, only ever superseded by a newer-dated row. A ShopSale snapshots
    the resolved rate at creation time (see ShopSale below); changing the
    Board Rate later never touches any existing ShopSale."""
    __tablename__ = "board_rates"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    effective_date = Column(DateTime, nullable=False)
    rate_per_kg = Column(Numeric(10, 2), nullable=False)
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ShopStockBatch(Base):
    """One Load's worth of physical stock sitting at a shop, preserving the
    rate it was loaded at (§8 of the Shop spec — different Loads can carry
    different rates, and that history must survive even after the stock is
    partly sold). Created automatically, in the same transaction, whenever
    an ordinary Sale posts to a customer whose customer_type is "shop" —
    see routers/sales.py's _apply_sale/_reverse_sale. There is no separate
    "enter a shop load" endpoint; a Load is always just a Sale.

    quantity_remaining is a LIVE, FIFO-mutated counter used only to decide
    which batch a ShopSale draws from next — it is never the source for
    period/historical stock reporting (see ShopSale/reporting, which always
    sums the immutable quantity_received/ShopSale.quantity/
    ShopStockAdjustment.quantity_delta logs instead, mirroring how
    routers/ledger.py derives opening balances from summed history rather
    than a stored running field)."""
    __tablename__ = "shop_stock_batches"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)  # the shop
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=False)
    source_sale_id = Column(GUID(), ForeignKey("sales.id"), nullable=True)  # the Load (Sale) that created this batch
    transaction_date = Column(DateTime, nullable=False)
    # 4 decimal places (not 2): a KG-based ShopSale (§15) consumes a
    # fractional cylinder-equivalent here (e.g. 10kg / 45kg saleable =
    # 0.2222) — 2dp would round that away and drift stock over repeated
    # KG sales. See routers/shops._apply_shop_sale.
    quantity_received = Column(Numeric(10, 4), nullable=False)
    quantity_remaining = Column(Numeric(10, 4), nullable=False)
    load_rate_per_kg = Column(Numeric(10, 2), nullable=False)  # historical only — NEVER used to price a ShopSale
    status = Column(String, nullable=False, default="active")
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    customer = relationship("Customer")
    product = relationship("Product")


class ShopSale(Base):
    """A shop's retail sale to its own end customers — a real-world event
    Dowa's ordinary Sale model doesn't represent (it's not a Dowa
    receivable; a shop's Load already paid Dowa in full via the normal
    Sale/Customer.current_balance flow). Priced ALWAYS from the Board Rate
    in effect on `date`, never from any ShopStockBatch.load_rate_per_kg —
    FIFO (see ShopSaleBatchConsumption) only ever decides which physical
    batch quantity is reduced, never the money. Every pricing field below
    is a frozen snapshot, computed once at creation and never recomputed —
    a later Board Rate change must never alter an existing ShopSale."""
    __tablename__ = "shop_sales"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. SHSALE-000123
    date = Column(DateTime, nullable=False)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)  # the shop
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=False)
    # FIFO/dashboard math (ShopStockBatch.quantity_remaining, stock summary
    # sums) is always in cylinder-equivalent units, matching ShopStockBatch —
    # see routers/shops._apply_shop_sale. `unit`/`quantity_kg` record what
    # the user actually entered without disturbing that: a unit="kg" sale
    # stores a fractional cylinder-equivalent here (quantity_kg / saleable kg
    # per cylinder) so stock math never needs two code paths.
    quantity = Column(Numeric(10, 4), nullable=False)
    unit = Column(String(10), nullable=False, default="cylinder")  # "cylinder" | "kg" — what the user entered
    quantity_kg = Column(Numeric(10, 2), nullable=True)  # actual KG sold, frozen; nullable only for rows predating this column

    # Supply Customers (§25) — null means an anonymous cash/public retail
    # sale, exactly today's behavior. "credit" always requires a
    # supply_customer_id (a credit sale to nobody is meaningless); "cash"
    # may or may not name a customer.
    supply_customer_id = Column(GUID(), ForeignKey("shop_supply_customers.id"), nullable=True)
    payment_type = Column(String(10), nullable=False, default="cash")  # "cash" | "credit"

    # Inline Settlement (§2, Money Routing) — how much of total_amount was
    # actually collected at the point of sale, frozen forever like every
    # other pricing field here. A "cash"/walk-in sale always has
    # amount_received == total_amount (enforced server-side, never partial
    # — there's no customer to owe). A "credit" sale can be anywhere from 0
    # (today's original all-or-nothing credit behavior) up to total_amount
    # (paid in full despite being tied to a named customer) — the remainder
    # (total_amount - amount_received) is what actually posts to
    # ShopSupplyCustomer.current_balance, not the full total_amount.
    # Nullable only for rows predating this column (backfilled: cash ->
    # total_amount, credit -> 0, matching the exact behavior those rows were
    # created under before partial payment existed).
    amount_received = Column(Numeric(14, 2), nullable=True)
    # Which real PaymentAccount received amount_received — defaults to this
    # shop's own Shop Cash account, but the same account choices available
    # elsewhere (Office Cash, Dowa Account, ...) are allowed. Null only for
    # a sale with amount_received == 0 (nothing to post) or a pre-migration row.
    destination_account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)

    board_rate_per_kg_used = Column(Numeric(10, 2), nullable=False)
    cylinder_weight_used = Column(Numeric(8, 2), nullable=False)  # physical weight, from Product.weight_kg — informational only, NEVER used to price
    # Saleable KG actually used to price this sale = cylinder_weight_used minus
    # the fixed 0.4kg wastage (see routers/shops.FIXED_WASTAGE_KG) — frozen at
    # sale time so a later change never recomputes an old sale. Nullable: rows
    # created before this column existed have no reliable value to backfill
    # (their sale_rate_per_cylinder was computed from the full physical
    # weight, not the saleable weight) and are left NULL rather than guessed.
    saleable_kg_used = Column(Numeric(8, 2), nullable=True)
    sale_rate_per_cylinder = Column(Numeric(10, 2), nullable=False)  # = board_rate_per_kg_used * saleable_kg_used
    total_amount = Column(Numeric(14, 2), nullable=False)  # = quantity * sale_rate_per_cylinder

    notes = Column(String, nullable=True)
    status = Column(String, nullable=False, default="active")  # active | cancelled | corrected
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    # Ledger Corrections — same convention as Sale/Payment/Purchase/CompanyPayment.
    corrected_by = Column(String, nullable=True)
    corrected_at = Column(DateTime, nullable=True)
    correction_reason = Column(String, nullable=True)
    corrected_from_id = Column(GUID(), nullable=True)

    customer = relationship("Customer")
    product = relationship("Product")
    supply_customer = relationship("ShopSupplyCustomer")
    destination_account = relationship("PaymentAccount")


class ShopSaleBatchConsumption(Base):
    """Records exactly which ShopStockBatch row(s) one ShopSale drew from
    via FIFO, and how much — lets a correction/cancellation reverse the
    physical stock precisely instead of re-deriving it."""
    __tablename__ = "shop_sale_batch_consumptions"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    shop_sale_id = Column(GUID(), ForeignKey("shop_sales.id"), nullable=False)
    shop_stock_batch_id = Column(GUID(), ForeignKey("shop_stock_batches.id"), nullable=False)
    quantity_consumed = Column(Numeric(10, 4), nullable=False)  # 4dp — see ShopStockBatch.quantity_remaining


class ShopStockAdjustment(Base):
    """A standalone Return/Adjustment stock movement for a shop — kept
    deliberately simple: it does NOT create, consume, or otherwise touch
    any ShopStockBatch/FIFO layer (that interaction is intentionally left
    undefined until the business rule for it is decided). It only ever
    contributes its own signed quantity_delta as an independent term in
    the derived Closing Stock formula (Opening + Load + Adjustments −
    Sales) — stock-only, never touches any money/balance field."""
    __tablename__ = "shop_stock_adjustments"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. SHADJ-000123
    date = Column(DateTime, nullable=False)
    customer_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    product_id = Column(GUID(), ForeignKey("products.id"), nullable=False)
    adjustment_type = Column(String, nullable=False)  # "return" | "adjustment"
    quantity_delta = Column(Numeric(10, 2), nullable=False)  # signed: +in / -out
    reason = Column(String, nullable=True)
    status = Column(String, nullable=False, default="active")
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    customer = relationship("Customer")
    product = relationship("Product")


# ============================================================
# Shop Business Finance (Engine 3, §19-§26) — the shop's own
# cash/customer books, deliberately separate from the Dowa Customer
# Ledger/Customer.current_balance (Engine 1) and from Shop stock/FIFO
# pricing (Engine 2). Nothing here ever touches a Customer row's
# current_balance or a ShopStockBatch beyond the ShopSale linkage that
# already existed (a Supply Customer credit sale is still just a
# ShopSale — see ShopSale.supply_customer_id/payment_type above — so it
# still draws down FIFO stock and prices off the Board Rate exactly like
# any other Shop Sale; only the cash-vs-receivable destination differs).
# ============================================================

class ShopSupplyCustomer(Base):
    """A shop's own retail/wholesale customer — entirely distinct from
    models.Customer (the Dowa-side ledger). Deliberately its own table
    rather than reusing Customer: a Supply Customer has no Dowa
    receivable, no cylinder balances, no display_id sequence shared with
    Dowa customers — conflating the two would let a shop's walk-in credit
    customer accidentally show up in the Dowa Customer Ledger (§25)."""
    __tablename__ = "shop_supply_customers"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    shop_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    name = Column(String, nullable=False)
    mobile = Column(String, nullable=True)
    address = Column(String, nullable=True)

    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    current_balance = Column(Numeric(14, 2), nullable=False, default=0)  # receivable OWED TO the shop

    status = Column(String, nullable=False, default="active")  # active | inactive
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    shop = relationship("Customer")


class ShopCustomerPayment(Base):
    """Money a Supply Customer pays the shop, settling a credit ShopSale —
    the mirror of models.Payment, scoped to one shop's own customer book.
    Reduces ShopSupplyCustomer.current_balance, increases Shop Cash (§25)."""
    __tablename__ = "shop_customer_payments"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. SHCPAY-000123
    date = Column(DateTime, nullable=False)
    shop_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)
    supply_customer_id = Column(GUID(), ForeignKey("shop_supply_customers.id"), nullable=False)
    # Optional traceability back to the credit ShopSale this collection is
    # settling — mirrors Payment.sale_id's "optional allocation" convention
    # exactly (never required, never auto-allocated/FIFO-matched). The
    # original ShopSale's own amount_received/Balance Due stays frozen at
    # what it was when the sale was created; only
    # ShopSupplyCustomer.current_balance (the aggregate) reflects this
    # collection — see routers/shops.py's Money Routing module docstring.
    shop_sale_id = Column(GUID(), ForeignKey("shop_sales.id"), nullable=True)

    amount = Column(Numeric(14, 2), nullable=False)
    method = Column(String, nullable=False, default="cash")
    # Which real PaymentAccount received this collection — defaults to the
    # shop's own Shop Cash account, same account choices as elsewhere.
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    notes = Column(String, nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    shop = relationship("Customer")
    supply_customer = relationship("ShopSupplyCustomer")
    shop_sale = relationship("ShopSale")
    account = relationship("PaymentAccount")


class ShopExpenseTransaction(Base):
    """One cash-out event at a shop, atomically grouping 1+ categorized
    ExpenseLines (§20-21) — e.g. one owner cash withdrawal split into
    Fuel/Salary/Home in a single transaction. The header carries the
    total/cash impact; each line carries its own category and
    expense-vs-owner-withdrawal classification (line_type) so reporting
    can total each category, and Owner Withdrawals separately from
    Business Expenses (§23), even when they were entered together."""
    __tablename__ = "shop_expense_transactions"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    display_id = Column(String, unique=True, nullable=False)  # e.g. SHEXP-000123
    date = Column(DateTime, nullable=False)
    shop_id = Column(GUID(), ForeignKey("customers.id"), nullable=False)

    total_amount = Column(Numeric(14, 2), nullable=False)  # = sum(lines.amount), reduces Shop Cash regardless of line_type mix
    # Which real PaymentAccount was debited — defaults to the shop's own
    # Shop Cash account (see app/utils.get_or_create_shop_account), same
    # account choices as elsewhere. payment_source stays as a free-text note
    # alongside it (e.g. "cash drawer") — kept, not restructured (§4).
    account_id = Column(GUID(), ForeignKey("payment_accounts.id"), nullable=True)
    payment_source = Column(String, nullable=True)
    notes = Column(String, nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    shop = relationship("Customer")
    account = relationship("PaymentAccount")
    lines = relationship("ShopExpenseLine", back_populates="transaction", cascade="all, delete-orphan")


class ShopExpenseLine(Base):
    """One categorized line within a ShopExpenseTransaction (§21-22)."""
    __tablename__ = "shop_expense_lines"

    id = Column(GUID(), primary_key=True, default=gen_uuid)
    expense_transaction_id = Column(GUID(), ForeignKey("shop_expense_transactions.id"), nullable=False)
    # Nullable — a category classifies an EXPENSE (Fuel/Salary/...); an
    # owner_withdrawal isn't a category of expense at all, so this is only
    # ever set (and only ever required, see routers/shops.create_shop_expense)
    # when line_type == "expense".
    category_id = Column(GUID(), ForeignKey("expense_categories.id"), nullable=True)
    # "expense" | "owner_withdrawal" (§22-23) — Home/personal withdrawals
    # are owner_withdrawal even though entered in the same transaction as
    # genuine business expenses; both reduce Shop Cash identically, this
    # field only affects reporting classification.
    line_type = Column(String, nullable=False, default="expense")
    amount = Column(Numeric(14, 2), nullable=False)
    description = Column(String, nullable=True)

    transaction = relationship("ShopExpenseTransaction", back_populates="lines")
    category = relationship("ExpenseCategory")