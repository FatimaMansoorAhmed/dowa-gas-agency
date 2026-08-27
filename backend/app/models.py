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
    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    current_balance = Column(Numeric(14, 2), nullable=False, default=0)
    active = Column(String, nullable=False, default="active")


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

    status = Column(String, nullable=False, default="active")  # active | cancelled | reversed
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

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

    status = Column(String, nullable=False, default="active")  # active | cancelled | reversed
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

    customer = relationship("Customer")
    sale = relationship("Sale")
    account = relationship("PaymentAccount", foreign_keys=[account_id])
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

    # pending -> approved | canceled. Ledger effects only apply on approval —
    # a pending batch's child Sale/Purchase/Payment/Expense/OwnerDrawings
    # rows exist (so they're editable) but none of them have posted to any
    # balance yet.
    status = Column(String, nullable=False, default="pending")
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String, nullable=True)

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

    status = Column(String, nullable=False, default="active")  # active | cancelled | reversed
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by = Column(String, nullable=True)

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
    quantity = Column(Numeric(10, 0), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    notes = Column(String, nullable=True)

    status = Column(String, nullable=False, default="active")  # active | cancelled
    entered_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    customer = relationship("Customer")