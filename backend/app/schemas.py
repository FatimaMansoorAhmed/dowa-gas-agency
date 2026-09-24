    # from datetime import datetime
    # from decimal import Decimal
    # from typing import Optional, Literal
    # from uuid import UUID

    # from pydantic import BaseModel, ConfigDict


    # # ---------- Company ----------
    # class CompanyCreate(BaseModel):
    #     name: str


    # class CompanyOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     name: str


    # # ---------- Party ----------
    # class PartyCreate(BaseModel):
    #     company_id: UUID
    #     name: str


    # class PartyOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     company_id: UUID
    #     name: str


    # # ---------- Rate ----------
    # class RateCreate(BaseModel):
    #     company_id: UUID
    #     party_id: UUID
    #     rate_118: Decimal
    #     entered_by: str
    #     timestamp: Optional[datetime] = None  # defaults to now if omitted; editable for backdating


    # class RateOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     company_id: UUID
    #     party_id: UUID
    #     rate_118: Decimal
    #     rate_454: Decimal
    #     entered_by: str
    #     timestamp: datetime


    # # ---------- Customer ----------
    # class CustomerCreate(BaseModel):
    #     name: str
    #     mobile: str
    #     alt_mobile: Optional[str] = None
    #     shop_name: Optional[str] = None
    #     address: Optional[str] = None
    #     city_area: Optional[str] = None
    #     opening_balance: Decimal = Decimal("0")
    #     opening_balance_date: Optional[datetime] = None


    # class CustomerOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)

    #     id: UUID
    #     name: str

    #     # Non-optional string fields jin mein NULL ho sakta hai:
    #     display_id: Optional[str] = None
    #     mobile: Optional[str] = None
    #     alt_mobile: Optional[str] = None
    #     shop_name: Optional[str] = None
    #     address: Optional[str] = None
    #     city_area: Optional[str] = None

    #     # Date & Numeric fields ko Optional aur Default set karein:
    #     opening_balance: Decimal = Decimal("0.00")
    #     opening_balance_date: Optional[datetime] = None
    #     opening_balance_month: Optional[str] = None
    #     current_balance: Decimal = Decimal("0.00")
    #     account_credit: Optional[Decimal] = Decimal("0.00")

    #     status: str = "active"
    #     created_at: datetime
    #     last_transaction_at: Optional[datetime] = None
    #     last_overpayment_amount: Optional[Decimal] = None
    #     last_overpayment_date: Optional[datetime] = None


    # class CustomerAdjust(BaseModel):
    #     kind: Literal["payment", "charge"]
    #     amount: Decimal


    # # ---------- Product ----------
    # class ProductCreate(BaseModel):
    #     name: str
    #     weight_kg: Decimal


    # class ProductOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     name: str
    #     weight_kg: Decimal
    #     active: str


    # # ---------- Payment Account ----------
    # class PaymentAccountCreate(BaseModel):
    #     name: str
    #     kind: Literal["cash", "bank"] = "cash"
    #     opening_balance: Decimal = Decimal("0")


    # class PaymentAccountOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     name: str
    #     kind: str
    #     opening_balance: Decimal
    #     current_balance: Decimal
    #     active: str


    # # ---------- Expense Category ----------
    # class ExpenseCategoryCreate(BaseModel):
    #     name: str
    #     description: Optional[str] = None


    # class ExpenseCategoryOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     name: str
    #     description: Optional[str]
    #     active: str


    # # ---------- Sale ----------
    # class SaleCreate(BaseModel):
    #     date: datetime
    #     customer_id: UUID
    #     product_id: UUID
    #     company_id: Optional[UUID] = None
    #     quantity: Decimal
    #     rate_per_cylinder: Decimal  # what the agency actually charges per cylinder for this line
    #     gate_pass_no: Optional[str] = None
    #     vehicle_no: Optional[str] = None
    #     notes: Optional[str] = None
    #     entered_by: str


    # class SaleItemOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     product_id: str
    #     quantity: float
    #     unit_price: float
    #     total_price: float


    # class SaleOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     display_id: str
    #     date: datetime
    #     customer_id: UUID
    #     product_id: UUID
    #     company_id: Optional[UUID] = None
    #     quantity: Decimal
    #     weight_per_cylinder: Decimal
    #     total_kg: Decimal
    #     rate_per_kg: Optional[Decimal] = None
    #     rate_per_cylinder: Optional[Decimal] = None
    #     total_amount: Decimal
    #     gate_pass_no: Optional[str] = None
    #     vehicle_no: Optional[str] = None
    #     notes: Optional[str] = None
    #     status: str
    #     entered_by: str
    #     created_at: datetime

    #     # Product relation model taake frontend weight_kg context read kar sake:
    #     product: Optional[ProductOut] = None
    #     items: list[SaleItemOut] = []


    # # ---------- Payment ----------
    # class PaymentCreate(BaseModel):
    #     date: datetime
    #     customer_id: UUID
    #     sale_id: Optional[UUID] = None
    #     amount: Decimal
    #     method: Literal["cash", "bank_transfer", "cheque", "online", "other"]
    #     account_id: UUID
    #     reference_no: Optional[str] = None
    #     received_by: Optional[str] = None
    #     notes: Optional[str] = None
    #     entered_by: str


    # class PaymentOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     display_id: str
    #     date: datetime
    #     customer_id: UUID
    #     sale_id: Optional[UUID] = None
    #     amount: Decimal
    #     method: str
    #     account_id: UUID
    #     reference_no: Optional[str] = None
    #     received_by: Optional[str] = None
    #     notes: Optional[str] = None
    #     excess_amount: Optional[Decimal] = None
    #     status: str
    #     entered_by: str
    #     created_at: datetime


    # # ---------- Expense ----------
    # class ExpenseCreate(BaseModel):
    #     date: datetime
    #     category_id: UUID
    #     amount: Decimal
    #     account_id: UUID
    #     method: str = "cash"
    #     description: Optional[str] = None
    #     vendor: Optional[str] = None
    #     reference_no: Optional[str] = None
    #     entered_by: str


    # class ExpenseOut(BaseModel):
    #     model_config = ConfigDict(from_attributes=True)
    #     id: UUID
    #     display_id: str
    #     date: datetime
    #     category_id: UUID
    #     amount: Decimal
    #     account_id: UUID
    #     method: str
    #     description: Optional[str] = None
    #     vendor: Optional[str] = None
    #     reference_no: Optional[str] = None
    #     status: str
    #     entered_by: str
    #     created_at: datetime


    # # ---------- Customer Ledger (computed, read-only view) ----------
    # class LedgerRow(BaseModel):
    #     date: datetime
    #     kind: Literal["sale", "payment"]
    #     ref_id: UUID
    #     display_id: str
    #     description: str
    #     sale_amount: Decimal
    #     payment_amount: Decimal
    #     running_balance: Decimal


    # class CustomerLedgerSummary(BaseModel):
    #     customer: CustomerOut
    #     month: str
    #     opening_balance: Decimal
    #     total_sales: Decimal
    #     total_payments: Decimal
    #     total_118: Decimal
    #     total_454: Decimal
    #     total_kg: Decimal
    #     total_transactions: int
    #     closing_balance: Decimal
    #     rows: list[LedgerRow]

# from datetime import datetime
# from decimal import Decimal
# from typing import Optional, Literal
# from uuid import UUID

# from pydantic import BaseModel, ConfigDict


# # ---------- Company ----------
# class CompanyCreate(BaseModel):
#     name: str
#     mobile: Optional[str] = None
#     opening_balance: Decimal = Decimal("0")
#     opening_balance_date: Optional[datetime] = None


# class CompanyOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     name: str
#     mobile: Optional[str]
#     opening_balance: Decimal
#     opening_balance_date: datetime
#     current_balance: Decimal
#     opening_balance_month: str
#     last_overpayment_amount: Optional[Decimal] = None
#     last_overpayment_date: Optional[datetime] = None
#     account_credit: Decimal


# # ---------- Party ----------
# class PartyCreate(BaseModel):
#     company_id: UUID
#     name: str


# class PartyOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     company_id: UUID
#     name: str


# # ---------- Rate ----------
# class RateCreate(BaseModel):
#     company_id: UUID
#     party_id: UUID
#     rate_118: Decimal
#     entered_by: str
#     timestamp: Optional[datetime] = None


# class RateOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     company_id: UUID
#     party_id: UUID
#     rate_118: Decimal
#     rate_454: Decimal
#     entered_by: str
#     timestamp: datetime


# # ---------- Customer ----------
# class CustomerCreate(BaseModel):
#     name: str
#     mobile: str
#     alt_mobile: Optional[str] = None
#     shop_name: Optional[str] = None
#     address: Optional[str] = None
#     city_area: Optional[str] = None
#     opening_balance: Decimal = Decimal("0")
#     opening_balance_date: Optional[datetime] = None


# class CustomerOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     name: str
#     mobile: str
#     alt_mobile: Optional[str]
#     shop_name: Optional[str]
#     address: Optional[str]
#     city_area: Optional[str]
#     opening_balance: Decimal
#     opening_balance_date: datetime
#     current_balance: Decimal
#     status: str
#     created_at: datetime
#     last_transaction_at: Optional[datetime]
#     opening_balance_month: str
#     last_overpayment_amount: Optional[Decimal] = None
#     last_overpayment_date: Optional[datetime] = None
#     account_credit: Decimal


# class CustomerAdjust(BaseModel):
#     kind: Literal["payment", "charge"]
#     amount: Decimal


# # ---------- Product ----------
# class ProductCreate(BaseModel):
#     name: str
#     weight_kg: Decimal


# class ProductOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     name: str
#     weight_kg: Decimal
#     active: str


# # ---------- Payment Account ----------
# class PaymentAccountCreate(BaseModel):
#     name: str
#     kind: Literal["cash", "bank"] = "cash"
#     opening_balance: Decimal = Decimal("0")


# class PaymentAccountOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     name: str
#     kind: str
#     opening_balance: Decimal
#     current_balance: Decimal
#     active: str


# # ---------- Expense Category ----------
# class ExpenseCategoryCreate(BaseModel):
#     name: str
#     description: Optional[str] = None


# class ExpenseCategoryOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     name: str
#     description: Optional[str]
#     active: str


# # ---------- Sale ----------
# class SaleCreate(BaseModel):
#     date: datetime
#     customer_id: UUID
#     product_id: UUID
#     company_id: Optional[UUID] = None
#     quantity: Decimal
#     rate_per_cylinder: Decimal
#     gate_pass_no: Optional[str] = None
#     vehicle_no: Optional[str] = None
#     notes: Optional[str] = None
#     entered_by: str
#     cylinders_returned: Decimal = Decimal("0")


# class SaleOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     customer_id: UUID
#     product_id: UUID
#     company_id: Optional[UUID]
#     quantity: Decimal
#     weight_per_cylinder: Decimal
#     total_kg: Decimal
#     rate_per_kg: Optional[Decimal]
#     rate_per_cylinder: Optional[Decimal]
#     total_amount: Decimal
#     gate_pass_no: Optional[str]
#     vehicle_no: Optional[str]
#     notes: Optional[str]
#     status: str
#     entered_by: str
#     created_at: datetime


# # ---------- Payment ----------
# class PaymentCreate(BaseModel):
#     date: datetime
#     customer_id: UUID
#     sale_id: Optional[UUID] = None
#     amount: Decimal
#     method: Literal["cash", "bank_transfer", "cheque", "online", "other"]
#     account_id: UUID
#     reference_no: Optional[str] = None
#     received_by: Optional[str] = None
#     notes: Optional[str] = None
#     entered_by: str


# class PaymentOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     customer_id: UUID
#     sale_id: Optional[UUID]
#     amount: Decimal
#     method: str
#     account_id: UUID
#     reference_no: Optional[str]
#     received_by: Optional[str]
#     notes: Optional[str]
#     excess_amount: Optional[Decimal]
#     status: str
#     entered_by: str
#     created_at: datetime


# # ---------- Expense ----------
# class ExpenseCreate(BaseModel):
#     date: datetime
#     category_id: UUID
#     amount: Decimal
#     account_id: Optional[UUID] = None  # FIX: Optional for field-cash expenses
#     method: str = "cash"
#     description: Optional[str] = None
#     vendor: Optional[str] = None
#     reference_no: Optional[str] = None
#     entered_by: str


# class ExpenseOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     category_id: UUID
#     amount: Decimal
#     account_id: Optional[UUID] = None  # FIX: Fixed crash when account_id is None
#     method: str
#     description: Optional[str] = None
#     vendor: Optional[str] = None
#     reference_no: Optional[str] = None
#     status: str
#     entered_by: str
#     created_at: datetime


# # ---------- Customer Ledger ----------
# class LedgerRow(BaseModel):
#     date: datetime
#     kind: Literal["sale", "payment"]
#     ref_id: UUID
#     display_id: str
#     description: str
#     sale_amount: Decimal
#     payment_amount: Decimal
#     running_balance: Decimal


# class CustomerLedgerSummary(BaseModel):
#     customer: CustomerOut
#     month: str
#     opening_balance: Decimal
#     total_sales: Decimal
#     total_payments: Decimal
#     total_118: Decimal
#     total_454: Decimal
#     total_kg: Decimal
#     total_transactions: int
#     closing_balance: Decimal
#     rows: list[LedgerRow]


# # ---------- Purchase ----------
# class PurchaseCreate(BaseModel):
#     date: datetime
#     company_id: UUID
#     product_id: UUID
#     quantity: Decimal
#     rate_per_cylinder: Decimal
#     additional_charges: Decimal = Decimal("0")
#     transport_charges: Decimal = Decimal("0")
#     other_charges: Decimal = Decimal("0")
#     gate_pass_no: Optional[str] = None
#     vehicle_no: Optional[str] = None
#     driver_name: Optional[str] = None
#     driver_contact: Optional[str] = None
#     notes: Optional[str] = None
#     entered_by: str


# class PurchaseOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     company_id: UUID
#     product_id: UUID
#     quantity: Decimal
#     weight_per_cylinder: Decimal
#     total_kg: Decimal
#     rate_per_kg: Optional[Decimal]
#     rate_per_cylinder: Optional[Decimal]
#     additional_charges: Decimal
#     transport_charges: Decimal
#     other_charges: Decimal
#     total_amount: Decimal
#     gate_pass_no: Optional[str]
#     vehicle_no: Optional[str]
#     driver_name: Optional[str]
#     driver_contact: Optional[str]
#     notes: Optional[str]
#     status: str
#     entered_by: str
#     created_at: datetime


# # ---------- Company Payment ----------
# class CompanyPaymentCreate(BaseModel):
#     date: datetime
#     company_id: UUID
#     purchase_id: Optional[UUID] = None
#     amount: Decimal
#     method: Literal["cash", "bank_transfer", "cheque", "online", "other"]
#     account_id: UUID
#     reference_no: Optional[str] = None
#     paid_by: Optional[str] = None
#     notes: Optional[str] = None
#     entered_by: str


# class CompanyPaymentOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     company_id: UUID
#     purchase_id: Optional[UUID]
#     amount: Decimal
#     method: str
#     account_id: UUID
#     reference_no: Optional[str]
#     paid_by: Optional[str]
#     notes: Optional[str]
#     excess_amount: Optional[Decimal]
#     status: str
#     entered_by: str
#     created_at: datetime


# # ---------- Company Ledger ----------
# class CompanyLedgerRow(BaseModel):
#     date: datetime
#     kind: Literal["purchase", "payment"]
#     ref_id: UUID
#     display_id: str
#     description: str
#     purchase_amount: Decimal
#     payment_amount: Decimal
#     running_balance: Decimal


# class CompanyLedgerSummary(BaseModel):
#     company: CompanyOut
#     month: str
#     opening_balance: Decimal
#     total_purchases: Decimal
#     total_payments: Decimal
#     total_118: Decimal
#     total_454: Decimal
#     total_kg: Decimal
#     total_transactions: int
#     closing_balance: Decimal
#     rows: list[CompanyLedgerRow]


# # ---------- Cylinder Tracking ----------
# class CylinderTransactionCreate(BaseModel):
#     date: datetime
#     customer_id: UUID
#     product_id: UUID
#     qty_out: Decimal = Decimal("0")
#     qty_in: Decimal = Decimal("0")
#     notes: Optional[str] = None
#     entered_by: str


# class CylinderTransactionOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     customer_id: UUID
#     product_id: UUID
#     sale_id: Optional[UUID]
#     qty_out: Decimal
#     qty_in: Decimal
#     notes: Optional[str]
#     status: str
#     entered_by: str
#     created_at: datetime


# class CylinderBalanceOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     customer_id: UUID
#     product_id: UUID
#     balance: Decimal


# class PlantLedgerSummaryRow(BaseModel):
#     company: CompanyOut
#     opening_balance: Decimal
#     total_118: Decimal
#     total_454: Decimal
#     total_kg: Decimal
#     total_purchases: Decimal
#     total_payments: Decimal
#     closing_balance: Decimal


# # ---------- Owner Drawings ----------
# class OwnerDrawingsCreate(BaseModel):
#     date: datetime
#     amount: Decimal
#     account_id: Optional[UUID] = None
#     notes: Optional[str] = None
#     entered_by: str


# class OwnerDrawingsOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     amount: Decimal
#     account_id: Optional[UUID]
#     notes: Optional[str]
#     unified_sale_id: Optional[UUID] = None
#     status: str
#     entered_by: str
#     created_at: datetime


# # ---------- Unified Sale Engine ----------
# class UnifiedSaleItem(BaseModel):
#     product_id: UUID
#     quantity: Decimal
#     purchase_rate: Decimal
#     selling_rate: Decimal


# class UnifiedSaleSettlement(BaseModel):
#     total_credit_received: Decimal = Decimal("0")
#     cash_received: Decimal = Decimal("0")
#     cash_account_id: Optional[UUID] = None
#     home_expense_amount: Decimal = Decimal("0")
#     home_expense_category_id: Optional[UUID] = None
#     owner_drawings_amount: Decimal = Decimal("0")


# class UnifiedSaleCreate(BaseModel):
#     date: datetime
#     customer_id: UUID
#     plant_id: UUID
#     items: list[UnifiedSaleItem] = []
#     settlement: UnifiedSaleSettlement
#     gate_pass_no: Optional[str] = None
#     vehicle_no: Optional[str] = None
#     notes: Optional[str] = None
#     entered_by: str


# class UnifiedSaleBatchOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     customer_id: UUID
#     company_id: UUID
#     total_selling_amount: Decimal
#     total_purchase_amount: Decimal
#     total_credit_received: Decimal
#     cash_received: Decimal
#     home_expense_amount: Decimal
#     owner_drawings_amount: Decimal
#     entered_by: str
#     created_at: datetime


# class UnifiedSaleOut(BaseModel):
#     model_config = ConfigDict(from_attributes=True)
#     id: UUID
#     display_id: str
#     date: datetime
#     customer_id: UUID
#     company_id: UUID
#     total_selling_amount: Decimal
#     total_purchase_amount: Decimal
#     total_credit_received: Decimal
#     cash_received: Decimal
#     home_expense_amount: Decimal
#     owner_drawings_amount: Decimal
#     entered_by: str
#     created_at: datetime
#     sales: list[SaleOut] = []
#     purchases: list[PurchaseOut] = []
#     payment: Optional[PaymentOut] = None
#     expense: Optional[ExpenseOut] = None
#     owner_drawing: Optional[OwnerDrawingsOut] = None

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Optional, Literal
from uuid import UUID

from pydantic import AfterValidator, BeforeValidator, BaseModel, ConfigDict

from app.timezone import to_naive_utc

# Every inbound "when did this happen" field goes through this — see
# to_naive_utc's docstring for why: the Postgres session's `timezone` GUC
# is Asia/Karachi, so an aware datetime bound to one of this app's naive
# DateTime columns gets silently shifted by Postgres before storage, then
# shifted again on display, producing a +5h "double timezone offset" bug
# (§ Double Timezone Offset Fix). Every *Create/*Update schema's date /
# timestamp field below uses this instead of plain `datetime`.
UtcDateTime = Annotated[datetime, AfterValidator(to_naive_utc)]


def _blank_to_none(v):
    """An empty string ("" — an unselected <select>, or a line-type switch
    that clears a field client-side) means "none", exactly like omitting
    the field. Without this, Pydantic's bare UUID validator rejects "" with
    a raw uuid_parsing 422 instead of a clean, endpoint-specific 400 (e.g.
    routers/shops.create_shop_expense's own check for a missing
    category_id on an expense line)."""
    return None if v == "" else v


# Use for any optional UUID field a plain HTML <select> could plausibly
# submit as "" instead of omitting — see _blank_to_none above.
OptionalUUID = Annotated[Optional[UUID], BeforeValidator(_blank_to_none)]


# ---------- Company ----------
class CompanyCreate(BaseModel):
    name: str
    mobile: Optional[str] = None
    opening_balance: Decimal = Decimal("0")
    opening_balance_date: Optional[UtcDateTime] = None


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    mobile: Optional[str]
    opening_balance: Decimal
    opening_balance_date: datetime
    current_balance: Decimal
    opening_balance_month: str
    last_overpayment_amount: Optional[Decimal] = None
    last_overpayment_date: Optional[datetime] = None
    account_credit: Decimal
    hidden_from_rate_dashboard: bool = False


# ---------- Party ----------
class PartyCreate(BaseModel):
    company_id: UUID
    name: str


class PartyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    name: str


# ---------- Rate ----------
class RateCreate(BaseModel):
    company_id: UUID
    # Optional — some real plants have no party at all (§ Party optional).
    # None means "no party", not "omitted/legacy" — routers/rates.create_rate
    # only looks up/validates a Party when this is given.
    party_id: Optional[UUID] = None
    rate_118: Decimal
    entered_by: str
    timestamp: Optional[UtcDateTime] = None  # defaults to now if omitted; editable for backdating


class RateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    party_id: Optional[UUID] = None
    rate_118: Decimal
    rate_454: Decimal
    entered_by: str
    timestamp: datetime


# ---------- Customer ----------
class CustomerCreate(BaseModel):
    name: str
    mobile: str
    alt_mobile: Optional[str] = None
    shop_name: Optional[str] = None
    address: Optional[str] = None
    city_area: Optional[str] = None
    opening_balance: Decimal = Decimal("0")
    opening_balance_date: Optional[UtcDateTime] = None
    # Opening empty-cylinder balances, entered per size on the Add New
    # Customer form — replaces the old single generic `empty_cylinders` input.
    # Kept for backward compatibility with callers that only pass a size
    # total (no Cross/PSO split) — the router derives the total from
    # Cross + PSO instead whenever either of those is provided (§ Empty
    # Cylinders — Size + Type Model), so there is never a second,
    # independently-editable "Total" to fall out of sync.
    empty_cylinders_118: Decimal = Decimal("0")
    empty_cylinders_454: Decimal = Decimal("0")
    empty_cylinders_118_cross: Decimal = Decimal("0")
    empty_cylinders_118_pso: Decimal = Decimal("0")
    empty_cylinders_454_cross: Decimal = Decimal("0")
    empty_cylinders_454_pso: Decimal = Decimal("0")
    # "individual" (default) | "shop" — see models.Customer.customer_type.
    customer_type: Literal["individual", "shop"] = "individual"


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    name: str
    mobile: str
    alt_mobile: Optional[str]
    shop_name: Optional[str]
    address: Optional[str]
    city_area: Optional[str]
    opening_balance: Decimal
    opening_balance_date: datetime
    current_balance: Decimal
    status: str
    created_at: datetime
    last_transaction_at: Optional[datetime]
    opening_balance_month: str
    last_overpayment_amount: Optional[Decimal] = None
    last_overpayment_date: Optional[datetime] = None
    account_credit: Decimal
    cylinder_balance_118: Decimal = Decimal("0")
    cylinder_balance_454: Decimal = Decimal("0")
    empty_cylinders: Decimal = Decimal("0")
    empty_cylinders_118: Decimal = Decimal("0")
    empty_cylinders_454: Decimal = Decimal("0")
    empty_cylinders_118_cross: Decimal = Decimal("0")
    empty_cylinders_118_pso: Decimal = Decimal("0")
    empty_cylinders_454_cross: Decimal = Decimal("0")
    empty_cylinders_454_pso: Decimal = Decimal("0")
    customer_type: str = "individual"
    # § Add Filled Cylinder Stock — one-time-only; meaningless/unused for
    # customer_type != "shop".
    initial_stock_added: bool = False


class CustomerAdjust(BaseModel):
    kind: Literal["payment", "charge"]
    amount: Decimal


# ---------- Product ----------
class ProductCreate(BaseModel):
    name: str
    weight_kg: Decimal


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    weight_kg: Decimal
    active: str


# ---------- Payment Account ----------
class PaymentAccountCreate(BaseModel):
    name: str
    kind: Literal["cash", "bank"] = "cash"
    opening_balance: Decimal = Decimal("0")
    # One of the fixed Liquidity Hub buckets this row represents, if any —
    # "shop_cash" additionally requires shop_id (see get_or_create_shop_account).
    account_type: Optional[Literal["cash", "office_cash", "owner_home", "dowa_account", "shop_cash"]] = None
    shop_id: Optional[UUID] = None


class PaymentAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    kind: str
    account_type: Optional[str] = None
    shop_id: Optional[UUID] = None
    opening_balance: Decimal
    current_balance: Decimal
    active: str


# ---------- Account Transfer (internal cash movement between two real
# PaymentAccount rows — e.g. Office Cash -> Dowa Account, or a shop's own
# Shop Cash -> Office Cash) ----------
class AccountTransferCreate(BaseModel):
    from_account_id: UUID
    to_account_id: UUID
    amount: Decimal
    notes: Optional[str] = None
    entered_by: str


class AccountTransferOut(BaseModel):
    from_account: PaymentAccountOut
    to_account: PaymentAccountOut


class AccountTransferRecordOut(BaseModel):
    """One persisted audit-trail row for a transfer (§ Transfer Audit
    Trail) — distinct from AccountTransferOut, which is the create
    endpoint's response shape (the two updated account balances)."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    date: datetime
    from_account_id: UUID
    to_account_id: UUID
    amount: Decimal
    notes: Optional[str] = None
    entered_by: str
    created_at: datetime


# ---------- Expense Category ----------
class ExpenseCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None


class ExpenseCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: Optional[str]
    active: str
    # System-provided category (§ Employee Salary Tracking) — currently
    # only "Salary". Frontend hides the Deactivate button for these as a
    # courtesy; the real enforcement is the server-side guard in
    # routers/expense_categories.py's deactivate_category.
    is_system: bool = False


# ---------- Sale ----------
class SaleCreate(BaseModel):
    date: UtcDateTime
    customer_id: UUID
    product_id: UUID
    company_id: Optional[UUID] = None
    quantity: Decimal
    rate_per_cylinder: Decimal  # what the agency actually charges per cylinder for this line
    gate_pass_no: Optional[str] = None
    vehicle_no: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str
    # Cylinders handed back on the spot, alongside the ones delivered —
    # read by routers/sales.py's create_sale to size the linked
    # CylinderTransaction's qty_in. The New Sale form has always sent this;
    # it was missing from this schema (silently dropped under pydantic's
    # default extra="ignore"), so a returned-cylinder count entered on that
    # form never reached the cylinder balance. Declaring it here is what
    # actually makes it take effect, for both create and the new /correct
    # endpoint below, which reuses this exact field.
    cylinders_returned: Decimal = Decimal("0")
    # Emergency Transfer (§ Shop — Emergency Transfer) — null for every
    # ordinary sale; set only via POST /sales/emergency-transfer. Living on
    # the shared SaleCreate/SaleCorrect shape (rather than a parallel
    # schema) is what lets a correction change which shop an emergency
    # transfer draws from through the SAME /sales/{id}/correct endpoint
    # every other Sale already uses.
    emergency_transfer_shop_id: Optional[UUID] = None
    # GST on Sale (optional, locked at entry) — free-text percentage,
    # matching rate_per_cylinder's manually-entered/trusted convention
    # rather than a fixed preset list, so it never goes stale if the
    # government rate changes. gst_rate is required when gst_enabled is
    # true (validated in routers/sales.py._apply_sale); both are ignored
    # (treated as off) otherwise.
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None


class SaleCorrect(SaleCreate):
    """Same shape as SaleCreate — the corrected transaction entirely
    replaces the original's field values (§1). `entered_by` here is who is
    PERFORMING the correction (sent as corrected_by too); the original row
    keeps its own entered_by untouched."""
    correction_reason: str
    corrected_by: str


class SaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    company_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    customer_id: UUID
    product_id: UUID
    company_id: Optional[UUID]
    quantity: Decimal
    weight_per_cylinder: Decimal
    total_kg: Decimal
    rate_per_kg: Optional[Decimal]
    rate_per_cylinder: Optional[Decimal]
    total_amount: Decimal
    gate_pass_no: Optional[str]
    vehicle_no: Optional[str]
    notes: Optional[str]
    status: str
    entered_by: str
    created_at: datetime
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None
    # Real FK, was simply never exposed here — needed so the frontend can
    # match a Sale back to its Unified-Sale-created sibling Purchase (same
    # unified_sale_id + product_id) for the Approved Sale Rate column (§3).
    unified_sale_id: Optional[UUID] = None
    emergency_transfer_shop_id: Optional[UUID] = None
    # GST on Sale (optional, locked at entry) — see models.Sale.gst_enabled.
    # grand_total (= total_amount + gst_amount) is what actually posted to
    # the customer's balance/ledger; total_amount above stays excl.-GST for
    # Dashboard/P&L/Tonnage, unaffected.
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    discount_amount: Decimal = Decimal("0")
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None
    gst_amount: Decimal = Decimal("0")
    grand_total: Decimal


class EmergencyTransferCreate(BaseModel):
    """A real customer needs cylinders urgently and is directed to a shop
    instead of a plant — posts a genuine Sale (charge to that customer's
    real ledger balance) while drawing physical stock from the named
    shop's own FIFO stock, not a new plant Load. No entered_by field —
    always server-stamped from the authenticated session
    (routers/emergency_transfers.py)."""
    date: UtcDateTime
    customer_id: UUID  # the real, non-shop customer being charged
    shop_id: UUID  # whose stock this draws from
    product_id: UUID
    quantity: Decimal
    rate_per_cylinder: Decimal  # manually entered — same trust model as an ordinary Sale's rate
    notes: Optional[str] = None
    # Inline Settlement (§ Unified Sale / Shop Sale pattern) — optional;
    # when omitted or 0 this is a pure credit charge. When set, creates a
    # linked Payment (Payment.sale_id) crediting destination_account_id
    # (defaults to the shop's own Shop Cash account).
    amount_collected_now: Optional[Decimal] = None
    payment_method: Literal["cash", "bank_transfer", "cheque", "online", "other"] = "cash"
    destination_account_id: Optional[UUID] = None


# ---------- Payment ----------
class PaymentCreate(BaseModel):
    date: UtcDateTime
    customer_id: UUID
    sale_id: Optional[UUID] = None
    amount: Decimal
    method: Literal["cash", "bank_transfer", "cheque", "online", "other"]
    account_id: UUID
    # Shop Cash Money Routing (§3) — which account the money physically came
    # FROM (a shop's own Shop Cash, or another chosen account) before
    # landing in account_id above. Left unset for an ordinary customer.
    source_account_id: Optional[UUID] = None
    reference_no: Optional[str] = None
    received_by: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


class PaymentCorrect(PaymentCreate):
    """Same shape as PaymentCreate — see SaleCorrect for the convention."""
    correction_reason: str
    corrected_by: str


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    customer_id: UUID
    sale_id: Optional[UUID]
    amount: Decimal
    method: str
    # Nullable — null for a Payment whose money hasn't landed in any Dowa
    # account yet (e.g. a Unified Sale's total_credit_received, routed
    # onward at settlement — see approve_unified_sale_sale). The model
    # column has always allowed this (nullable=True); this schema field
    # was the one place still requiring it, which crashed any endpoint
    # returning such a row (GET /payments, cancel, correct) with a
    # response-validation 500 the moment one existed.
    account_id: Optional[UUID] = None
    source_account_id: Optional[UUID] = None
    reference_no: Optional[str]
    received_by: Optional[str]
    notes: Optional[str]
    excess_amount: Optional[Decimal]
    status: str
    entered_by: str
    created_at: datetime
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None
    # Real FK, same gap SaleOut/PurchaseOut had (§3) — never exposed here,
    # so the API always showed None for a Unified-Sale-originated Payment
    # even though the DB column was populated.
    unified_sale_id: Optional[UUID] = None
    # Not real Payment columns for a Unified-Sale-originated row (that
    # settlement routing lives on the parent UnifiedSaleBatch, not here) —
    # resolved in routers/payments.py._attach_destination_info and attached
    # to the ORM row before serialization (§ Bug Fix — Approved Payments
    # destination display). For a Payment Receipt-sourced row (destination_
    # type set directly on the row) these already ARE real columns and pass
    # through unchanged. None for an ordinary quick-pay Payment — its
    # destination is simply account_id.
    destination_type: Optional[str] = None
    target_plant_id: Optional[UUID] = None
    account_category: Optional[str] = None
    # Same resolution as PaymentReceiptOut's own fields (§ Bug Fix —
    # Correction Modal Routing pre-fill) — for a receipt-sourced row,
    # resolved from the linked Expense/OwnerDrawings (source_payment_id);
    # for a Unified-Sale-sourced row, straight from the parent batch.
    # Needed so CorrectTransactionModal never silently pre-fills 0 for an
    # amount that was actually routed to Home Expense/Owner Drawings.
    home_expense_amount: Decimal = Decimal("0")
    owner_drawings_amount: Decimal = Decimal("0")


# ---------- Payment Receipt (standalone, with settlement routing) ----------
class PaymentReceiptCreate(BaseModel):
    """Like PaymentCreate, but the amount is split the same three ways as a
    Unified Sale settlement: home_expense_amount / owner_drawings_amount
    bypass every Dowa account (auto-creates an Expense / OwnerDrawings row);
    whatever's left — net_settlement_amount = amount − home_expense −
    owner_drawings — is routed per destination_type, exactly like
    UnifiedSaleSettlement. The customer's balance always drops by the full
    `amount`, regardless of how it's routed afterward."""
    date: UtcDateTime
    customer_id: UUID
    amount: Decimal
    method: Literal["cash", "bank_transfer", "cheque", "online", "other"]
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None  # required if home_expense_amount > 0
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Literal["plant", "account"] = "plant"
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None  # real PaymentAccount UUID (as text) or a category label
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


class PaymentReceiptCorrect(PaymentReceiptCreate):
    """§ Bug Fix — Correction Modal Routing. Same shape as
    PaymentReceiptCreate — see PaymentCorrect for the convention. Unlike
    UnifiedSaleSettlementCorrect, this DOES let `amount` change too — a
    standalone Payment Receipt has no separate "sale side" holding the
    customer's owed amount hostage, so correcting the amount here is exactly
    as safe as correcting destination (both just reverse-then-repost the
    one Payment row and its settlement)."""
    correction_reason: str
    corrected_by: str


class PaymentReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    amount: Decimal
    method: str
    destination_type: Optional[str] = None
    target_plant_id: Optional[UUID] = None
    account_id: Optional[UUID] = None
    account_category: Optional[str] = None
    net_settlement_amount: Optional[Decimal] = None
    # Not real Payment columns — resolved in routers/payment_receipts.py from
    # the linked Expense/OwnerDrawings rows (source_payment_id) and attached
    # to the ORM row before serialization (§ Part B, destination labeling).
    # Zero unless this receipt's amount was routed there.
    home_expense_amount: Decimal = Decimal("0")
    owner_drawings_amount: Decimal = Decimal("0")
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    excess_amount: Optional[Decimal] = None
    status: str
    entered_by: str
    created_at: datetime
    # § Bug Fix — Correction Modal Routing, Case 1. Real Payment columns
    # (same ones PaymentOut already exposes) — just never surfaced here
    # before a receipt could be corrected at all.
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None


# ---------- Expense ----------
class ExpenseCreate(BaseModel):
    date: UtcDateTime
    category_id: Optional[UUID] = None  # null = Settlement-Routing Home Expense: a free-text description with no ExpenseCategory behind it
    amount: Decimal
    account_id: Optional[UUID] = None  # null = funded directly from field-collected cash, no account debited
    method: str = "cash"
    description: Optional[str] = None
    vendor: Optional[str] = None
    reference_no: Optional[str] = None
    entered_by: str
    # Employee Salary Tracking (§ Employee Salary Tracking) — required
    # (enforced in routers/expenses.py) whenever category_id is the system
    # "Salary" category; ignored/null for every other category. Reduces
    # the named Employee's current_balance by `amount`.
    employee_id: Optional[UUID] = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    category_id: Optional[UUID] = None
    amount: Decimal
    account_id: Optional[UUID]
    method: str
    description: Optional[str]
    vendor: Optional[str]
    reference_no: Optional[str]
    unified_sale_id: Optional[UUID] = None
    source_shop_sale_id: Optional[UUID] = None
    source_shop_cash_transfer_id: Optional[UUID] = None
    source_shop_customer_payment_id: Optional[UUID] = None
    # customer_id/customer_name: WHICH customer this money is tied to,
    # resolved from either of two unrelated paths that never both apply to
    # the same row —
    #   1. Plant-level: this expense bypassed a Dowa account and was funded
    #      straight out of a customer's payment (source_payment_id from a
    #      Payment Receipt's home-expense deduction, or unified_sale_id
    #      from a Unified Sale's). customer_id is a real models.Customer.id
    #      here.
    #   2. Shop-level (§ Shop Expense/Withdrawal Attribution): dual-written
    #      from a Shop's Record Shop Sale / Record Supply Customer Payment
    #      form, which had a ShopSupplyCustomer in context — resolved via
    #      source_shop_expense_transaction_id -> ShopExpenseTransaction.
    #      customer_id here is a ShopSupplyCustomer.id, NOT a Customer.id —
    #      shop_supply_customer_id carries the same value under its own
    #      name for any caller that needs to tell the two apart.
    # Never set for an expense paid from a real PaymentAccount with no
    # shop/customer context.
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    shop_supply_customer_id: Optional[UUID] = None
    # The ShopSale (if any) this expense/withdrawal was entered alongside —
    # same dual-write path as shop_supply_customer_id above.
    shop_sale_display_id: Optional[str] = None
    # Dashboard P&L / Shop Expense integration (§ Dashboard) — set only for
    # a row dual-written from a Shop's own Record Expense form
    # (routers/shops.py's create_shop_expense); null for a plant-level
    # expense entered directly on this page.
    shop_id: Optional[UUID] = None
    shop_name: Optional[str] = None
    # Delete Shop (§ Delete Shop) — permanent snapshot (e.g. "Shop Sale
    # SHSALE-000042 (Some Shop)") written once shop_id/source_shop_*_id
    # above are all cleared to NULL by a shop deletion; null for every row
    # whose shop-side origin is still live. shop_name already falls back to
    # this (see routers/expenses.py) for display compatibility — exposed
    # here too for any caller that wants the raw label specifically.
    shop_origin_label: Optional[str] = None
    # Employee Salary Tracking (§ Employee Salary Tracking) — set only for
    # a Salary-category row; employee_name resolved server-side the same
    # way customer_name/shop_name already are.
    employee_id: Optional[UUID] = None
    employee_name: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime


# ---------- Employee Salary Tracking ----------
class EmployeeCreate(BaseModel):
    name: str
    monthly_salary: Decimal
    entered_by: str


class EmployeeUpdate(BaseModel):
    """Both optional — a plain balance/status edit, not a full replace.
    Changing monthly_salary never touches past EmployeeSalaryAccrual rows
    (each is frozen at whatever the salary was for its own month, §
    EmployeeSalaryAccrual) — it only takes effect the next time this
    employee's accrual catches up to a new month."""
    monthly_salary: Optional[Decimal] = None
    status: Optional[Literal["active", "inactive"]] = None


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    monthly_salary: Decimal
    status: str
    opening_balance: Decimal
    opening_balance_month: str
    current_balance: Decimal
    entered_by: str
    created_at: datetime


class EmployeeLedgerRow(BaseModel):
    date: datetime
    kind: Literal["accrual", "payment"]
    ref_id: UUID
    display_id: str
    description: str
    accrued_amount: Decimal
    paid_amount: Decimal
    running_balance: Decimal
    entered_by: str


class EmployeeLedgerSummary(BaseModel):
    employee: EmployeeOut
    month: str
    opening_balance: Decimal
    total_accrued: Decimal
    total_paid: Decimal
    closing_balance: Decimal
    rows: list[EmployeeLedgerRow]


# ---------- Customer Ledger (computed, read-only view) ----------
class LedgerRow(BaseModel):
    date: datetime
    # "unified_sale" = one aggregated row for an entire approved Unified
    # Sale batch — its child Sale rows are never emitted individually (§ ledger aggregation).
    # "empty_cylinder_sale" = one Sell Empty Cylinders transaction.
    # "cylinder_transaction" = one standalone cylinder movement (e.g. the
    # Customer Ledger's Cyl Return/Entry action) not tied to a Sale.
    # "cylinder_return_out"/"cylinder_return_in" = one Return Cylinder /
    # Add Empty Cylinder action (§ Part B/C) — "out" on the customer whose
    # balance decreased (transfer sent away), "in" on the one it increased
    # (transfer received, or a manual_add). A "cash"-mode return's money
    # effect surfaces via its own linked "payment" row instead (never both —
    # see routers/ledger.py), since that Payment already carries the full
    # destination-routing/balance effect.
    kind: Literal[
        "sale", "payment", "unified_sale", "empty_cylinder_sale", "cylinder_transaction",
        "cylinder_return_out", "cylinder_return_in",
    ]
    ref_id: UUID
    display_id: str
    description: str
    sale_amount: Decimal
    payment_amount: Decimal
    running_balance: Decimal
    qty_118: Decimal = Decimal("0")
    qty_454: Decimal = Decimal("0")
    qty_empty: Decimal = Decimal("0")
    # Generic cylinder movement for this row, independent of size —
    # filled cylinders delivered (cyl_out) vs. cylinders received back
    # (cyl_in, includes empty-cylinder sales), for the ledger table's
    # combined "Cyl Out" / "Cyl In" columns.
    cyl_out: Decimal = Decimal("0")
    cyl_in: Decimal = Decimal("0")
    # Who posted this transaction (§2 Audit) — "" for row kinds that don't
    # carry a single entered_by (e.g. an aggregated unified_sale batch row
    # spanning several child records with possibly different entered_by).
    entered_by: str = ""
    # True only for "sale"/"payment" rows — the two kinds the Correct
    # action applies to (§1 Scope). Lets the frontend show the action only
    # where it's actually supported, without hardcoding the kind list twice.
    correctable: bool = False
    # Rate column (§3) — the per-cylinder selling rate already snapshotted
    # on the row's own Sale (models.Sale.rate_per_cylinder/rate_per_kg),
    # never recomputed here. None for "payment" and other non-Sale kinds
    # — a Payment has no rate of its own. For "unified_sale" (one
    # aggregated row can span several products/rates), rate_per_cylinder/
    # rate_per_kg stay None and unified_sale_rates carries each child
    # Sale's own rate instead, since a single blended figure would hide
    # which product was sold at which rate.
    rate_per_cylinder: Optional[Decimal] = None
    rate_per_kg: Optional[Decimal] = None
    unified_sale_rates: Optional[list[Decimal]] = None
    # GST on Sale (§ GST on Sale) — None/0 for every kind except "sale" and
    # "unified_sale". sale_amount above is already GST-inclusive
    # (grand_total); gst_amount is broken out here purely so the ledger
    # can show it as its own column without the viewer having to open the
    # underlying Sale/invoice to see how much of sale_amount was tax.
    gst_rate: Optional[Decimal] = None
    gst_amount: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")


class CorrectionHistoryRow(BaseModel):
    """One superseded (status="corrected") original transaction — kept
    for the read-only Correction History panel, never mixed into the
    running-balance rows above (§1).

    Also doubles as an Opening Balance correction row (§ Opening Balance) —
    those three kinds are read straight from AuditLog (there's no reversed-
    and-reposted pair for an in-place anchor-value edit), with the old →
    new change folded into `description` and `corrected_display_id` always
    None (see routers/ledger.py::_opening_balance_corrections)."""
    kind: Literal[
        "sale", "payment", "purchase", "company_payment",
        "customer_opening_balance", "company_opening_balance", "shop_opening_cash",
    ]
    date: datetime
    ref_id: UUID
    display_id: str
    description: str
    original_amount: Decimal
    correction_reason: str
    corrected_by: str
    corrected_at: datetime
    corrected_display_id: Optional[str] = None  # the new row that replaced it, if still findable


class OpeningBalanceUpdate(BaseModel):
    """§ Opening Balance — one field, no reversal/repost (unlike Sale/
    Payment/etc. corrections): the stored anchor value is edited in place,
    the running balance is shifted by the identical delta, and the edit is
    logged to AuditLog with a required reason."""
    new_value: Decimal
    reason: str


class CustomerLedgerSummary(BaseModel):
    customer: CustomerOut
    month: str
    opening_balance: Decimal
    total_sales: Decimal
    total_payments: Decimal
    total_118: Decimal
    total_454: Decimal
    total_kg: Decimal
    total_ton: Decimal = Decimal("0")
    total_transactions: int
    closing_balance: Decimal
    # Flag Rule (§ Monthly Rollover & Flag Rule): closing_balance > this
    # month's opening_balance (itself rolled over from the prior month's
    # closing) -> Flagged; closing_balance <= opening_balance -> Normal.
    flagged: bool = False
    rows: list[LedgerRow]
    corrections: list[CorrectionHistoryRow] = []


class CustomerFlagOut(BaseModel):
    """One row of the Flagged Accounts widget / ledger sidebar flags —
    same Flag Rule as CustomerLedgerSummary.flagged, computed in bulk
    across every customer for one month."""
    customer: CustomerOut
    month: str
    opening_balance: Decimal
    closing_balance: Decimal
    flagged: bool


# ---------- Purchase ----------
class PurchaseCreate(BaseModel):
    date: UtcDateTime
    company_id: UUID
    product_id: UUID
    quantity: Decimal
    rate_per_cylinder: Decimal
    additional_charges: Decimal = Decimal("0")
    transport_charges: Decimal = Decimal("0")
    other_charges: Decimal = Decimal("0")
    gate_pass_no: Optional[str] = None
    vehicle_no: Optional[str] = None
    driver_name: Optional[str] = None
    driver_contact: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


class PurchaseCorrect(PurchaseCreate):
    """Same shape as PurchaseCreate — see SaleCorrect for the convention."""
    correction_reason: str
    corrected_by: str


class PurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    company_id: UUID
    product_id: UUID
    quantity: Decimal
    weight_per_cylinder: Decimal
    total_kg: Decimal
    rate_per_kg: Optional[Decimal]
    rate_per_cylinder: Optional[Decimal]
    additional_charges: Decimal
    transport_charges: Decimal
    other_charges: Decimal
    total_amount: Decimal
    gate_pass_no: Optional[str]
    vehicle_no: Optional[str]
    driver_name: Optional[str]
    driver_contact: Optional[str]
    notes: Optional[str]
    status: str
    entered_by: str
    created_at: datetime
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None
    # Real FK, was simply never exposed here — see SaleOut.unified_sale_id.
    unified_sale_id: Optional[UUID] = None


# ---------- Company Payment ----------
class CompanyPaymentCreate(BaseModel):
    date: UtcDateTime
    company_id: UUID
    purchase_id: Optional[UUID] = None
    amount: Decimal
    method: Literal["cash", "bank_transfer", "cheque", "online", "other", "direct_settlement"] = "cash"
    account_id: Optional[UUID] = None  # null = 3-way settlement, customer money never entered a Dowa account
    reference_no: Optional[str] = None
    paid_by: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


class CompanyPaymentCorrect(CompanyPaymentCreate):
    """Same shape as CompanyPaymentCreate — see SaleCorrect for the convention."""
    correction_reason: str
    corrected_by: str


class CompanyPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    company_id: UUID
    purchase_id: Optional[UUID]
    amount: Decimal
    method: str
    account_id: Optional[UUID]
    reference_no: Optional[str]
    paid_by: Optional[str]
    notes: Optional[str]
    excess_amount: Optional[Decimal]
    unified_sale_id: Optional[UUID] = None
    status: str
    entered_by: str
    created_at: datetime
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None


# ---------- Company Ledger (computed, read-only view) ----------
class CompanyLedgerRow(BaseModel):
    date: datetime
    # "unified_sale" = one aggregated row for an entire approved Unified
    # Sale batch — its child Purchase rows are never emitted individually (§ ledger aggregation).
    kind: Literal["purchase", "payment", "unified_sale"]
    ref_id: UUID
    display_id: str
    description: str
    purchase_amount: Decimal
    payment_amount: Decimal
    running_balance: Decimal
    qty_118: Decimal = Decimal("0")
    qty_454: Decimal = Decimal("0")
    vehicle_no: Optional[str] = None
    # Who posted this transaction (§2 Audit); "" for aggregated unified_sale rows.
    entered_by: str = ""
    # True only for "purchase"/"payment" rows — see LedgerRow.correctable.
    correctable: bool = False


class CompanyLedgerSummary(BaseModel):
    company: CompanyOut
    month: str
    opening_balance: Decimal
    total_purchases: Decimal
    total_payments: Decimal
    total_118: Decimal
    total_454: Decimal
    total_kg: Decimal
    total_ton: Decimal = Decimal("0")
    total_transactions: int
    closing_balance: Decimal
    rows: list[CompanyLedgerRow]
    corrections: list[CorrectionHistoryRow] = []


class PlantLedgerSummaryRow(BaseModel):
    """One row of the all-plants monthly summary table (Image 1 / Image 2)."""
    company: CompanyOut
    opening_balance: Decimal
    total_118: Decimal
    total_454: Decimal
    total_kg: Decimal
    total_purchases: Decimal
    total_payments: Decimal
    closing_balance: Decimal
    # Vehicle from the most recent Purchase this plant received this month
    # (Purchase.vehicle_no) — never a second, independently-entered value.
    # vehicle_no: Optional[str] = None


# ---------- Owner Capital / Re-Investment ----------
class OwnerCapitalCreate(BaseModel):
    """destination_type == "account": account_id is required — either a real
    PaymentAccount UUID (as text) or one of the fixed bucket keys
    (office_cash | owner_home | dowa_account), resolved the same way as
    Payment Receipt / Unified Sale routing (see resolve_account_or_bucket).
    destination_type == "plant": target_plant_id is required instead —
    account_id is ignored, the amount never touches a Dowa account."""
    date: UtcDateTime
    amount: Decimal
    destination_type: Literal["account", "plant"]
    account_id: Optional[str] = None
    target_plant_id: Optional[UUID] = None
    notes: Optional[str] = None
    entered_by: str


class OwnerCapitalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    amount: Decimal
    destination_type: str
    account_id: Optional[UUID] = None
    target_plant_id: Optional[UUID] = None
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime


# ---------- Owner Drawings ----------
class OwnerDrawingsCreate(BaseModel):
    date: UtcDateTime
    amount: Decimal
    account_id: Optional[UUID] = None  # null = funded directly from field-collected cash
    notes: Optional[str] = None
    entered_by: str


class OwnerDrawingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    amount: Decimal
    account_id: Optional[UUID]
    notes: Optional[str]
    unified_sale_id: Optional[UUID] = None
    source_shop_sale_id: Optional[UUID] = None
    source_shop_cash_transfer_id: Optional[UUID] = None
    source_shop_customer_payment_id: Optional[UUID] = None
    # Dashboard P&L / Shop Expense integration (§ Dashboard) — same
    # convention as ExpenseOut.shop_id/shop_name above.
    shop_id: Optional[UUID] = None
    shop_name: Optional[str] = None
    # Delete Shop (§ Delete Shop) — see ExpenseOut.shop_origin_label above;
    # identical convention here.
    shop_origin_label: Optional[str] = None
    # § Shop Expense/Withdrawal Attribution — same convention as
    # ExpenseOut.customer_id/customer_name/shop_supply_customer_id/
    # shop_sale_display_id above (a shop owner withdrawal never has the
    # plant-level source_payment_id/unified_sale_id path, only this one).
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    shop_supply_customer_id: Optional[UUID] = None
    shop_sale_display_id: Optional[str] = None
    # Payment Receipt / Cylinder Return "cash" mode (§ Cash Management —
    # Owner Drawings Audit Ledger visibility) — set only when this row was
    # auto-created via /payment-receipts or /cylinder-returns (never both
    # this and unified_sale_id). customer_id/customer_name above are
    # populated from the linked Payment's customer in that case too, so
    # the ledger table can resolve "Customer Name" the same way it already
    # does for a unified_sale-sourced row.
    source_payment_id: Optional[UUID] = None
    source_payment_display_id: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime


# ---------- Unified Sale Engine ----------
class UnifiedSaleItem(BaseModel):
    product_id: UUID
    quantity: Decimal
    purchase_rate: Decimal  # per cylinder, what the plant charges Dowa
    selling_rate: Decimal   # per cylinder, what Dowa charges the customer


class UnifiedSaleHomeExpenseLineIn(BaseModel):
    """One categorized Home Expense line within a Unified Sale's settlement
    (§ Multi-line Categorized Home Expense) — mirrors
    ShopSaleHomeExpenseLineIn. See UnifiedSaleSettlement.home_expense_lines."""
    category_id: UUID
    amount: Decimal
    # Required whenever category_id is the system "Salary" category (§
    # Employee Salary Tracking), enforced in routers/unified_sale.py.
    employee_id: Optional[UUID] = None
    description: Optional[str] = None


class UnifiedSaleHomeExpenseLineOut(BaseModel):
    """Mirrors UnifiedSaleHomeExpenseLineIn — raw category_id/employee_id,
    not resolved names, same convention as ShopSaleHomeExpenseLineOut."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    category_id: UUID
    employee_id: Optional[UUID] = None
    amount: Decimal
    description: Optional[str] = None


class UnifiedSaleSettlement(BaseModel):
    """Settled money is split exactly three ways: home_expense_amount and
    owner_drawings_amount are entered directly (both bypass every Dowa
    account — see Expense/OwnerDrawings.account_id); whatever's left,
    (total_credit_received − home_expense − owner_drawings), is net_plant_payment
    and is routed per destination_type — it is NEVER entered directly.
    home_expense + owner_drawings must not exceed total_credit_received.

    destination_type="plant" (default): net_plant_payment goes straight to
    target_plant_id (defaults to the purchase plant itself) as a 3-way
    settlement — it never touches a Dowa cash/bank account.
    destination_type="account": net_plant_payment is deposited into
    account_id instead — either a real PaymentAccount UUID (as text) or a
    category label ("cash" / "office_cash" / "owner_home" / "dowa_account")
    when no PaymentAccount row exists yet for that bucket."""
    total_credit_received: Decimal = Decimal("0")
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None  # required if home_expense_amount > 0
    # § Multi-line Categorized Home Expense — when provided (non-empty),
    # REPLACES the single home_expense_amount/category_id fields above
    # entirely: one UnifiedSaleHomeExpenseLine + one pending Expense row
    # per entry, summed for the settlement net-amount math. Those scalar
    # fields stay only for historical rows and are ignored server-side
    # whenever this list is non-empty (see routers/unified_sale.py).
    home_expense_lines: Optional[list[UnifiedSaleHomeExpenseLineIn]] = None
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Literal["plant", "account"] = "plant"
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None
    # Free-text settlement reference (bank transfer/cheque number, etc.) —
    # optional at any point, typically filled in once it's known.
    payment_reference: Optional[str] = None


class UnifiedSaleCreate(BaseModel):
    date: UtcDateTime
    customer_id: UUID
    # None for a Payment-Only batch (§ Payment-Only Pending Approval) — no
    # purchase plant, no items. Required (enforced in
    # routers/unified_sale.py::_validate_and_load) whenever items is
    # non-empty — an actual Load always has a purchase plant.
    plant_id: Optional[UUID] = None  # maps to Company.id
    items: list[UnifiedSaleItem] = []
    # Optional, defaults to 0 — folded into total_selling_amount server-side
    # (see routers/unified_sale.py), never trusted as a pre-computed total.
    delivery_charges: Decimal = Decimal("0")
    settlement: UnifiedSaleSettlement
    gate_pass_no: Optional[str] = None
    vehicle_no: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str
    # GST on Sale, extended to Unified Sale (optional, locked at entry) —
    # free-text percentage, same manually-entered/trusted convention as
    # Sale's gst_rate. Applies to the whole batch's total_selling_amount
    # (items are never individually taxed here), computed and frozen
    # server-side — see routers/unified_sale.py.
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None


# Editing a pending batch takes the same shape as creating one — the whole
# item/settlement set is replaced, not patched field-by-field, so partial
# edits can't leave stale line items behind (§1B).
class UnifiedSaleEdit(UnifiedSaleCreate):
    pass


class UnifiedSaleSettlementCorrect(BaseModel):
    """§ Bug Fix — Correction Modal Routing. Corrects ONLY where an
    ALREADY-APPROVED settlement's money went (destination_type/
    target_plant_id/account_id) and the home_expense/owner_drawings split —
    never total_credit_received itself, which is the SALE side's concern
    (see approve_unified_sale_sale) and is untouched by this endpoint.
    Same field shape as UnifiedSaleSettlement, deliberately not a subclass
    of it — payment_reference here is genuinely optional (unlike at
    creation, an already-approved settlement may already have one)."""
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None
    # § Multi-line Categorized Home Expense — same replace-the-scalars
    # convention as UnifiedSaleSettlement.home_expense_lines, applied to a
    # correction: when non-empty, the corrected settlement's Home Expense
    # side becomes these categorized lines instead of the single amount.
    home_expense_lines: Optional[list[UnifiedSaleHomeExpenseLineIn]] = None
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Literal["plant", "account"] = "plant"
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None
    payment_reference: Optional[str] = None
    correction_reason: str
    corrected_by: str


class UnifiedSaleAmountCorrect(BaseModel):
    """§ Amount Correction for Unified-Sale-Linked Payments. Corrects ONLY
    the collected amount (total_credit_received) — the sibling of
    UnifiedSaleSettlementCorrect above, which explicitly excludes this
    field. Deliberately a separate endpoint/schema rather than adding
    `amount` there: that endpoint's whole contract is "routing only,
    amount is the sale side's concern," and this one's contract is the
    mirror image — one concern each, same as every other correctable
    transaction in this app. See routers/unified_sale.py::
    correct_unified_sale_amount for why this also has to reverse-then-
    repost the real settlement destination (account/plant balance), not
    just resync the batch's own display fields."""
    amount: Decimal
    correction_reason: str
    corrected_by: str


class UnifiedSaleBatchOut(BaseModel):
    """Lightweight list-view row — no nested child records, unlike UnifiedSaleOut."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    company_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    customer_id: UUID
    # None for a Payment-Only batch — see UnifiedSaleCreate.plant_id.
    company_id: Optional[UUID] = None
    total_selling_amount: Decimal
    total_purchase_amount: Decimal
    delivery_charges: Decimal = Decimal("0")
    total_credit_received: Decimal
    net_plant_payment: Decimal
    home_expense_amount: Decimal
    owner_drawings_amount: Decimal
    destination_type: str
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None
    vehicle_no: Optional[str] = None
    gate_pass_no: Optional[str] = None
    notes: Optional[str] = None
    payment_reference: Optional[str] = None
    # § Bug Fix — Correction Modal Routing. Null until the settlement's
    # first correction — see models.UnifiedSaleBatch.settlement_corrected_by.
    settlement_corrected_by: Optional[str] = None
    settlement_corrected_at: Optional[datetime] = None
    settlement_correction_reason: Optional[str] = None
    # GST on Sale, extended to Unified Sale — see models.UnifiedSaleBatch.
    # grand_total is what's actually posted to the customer's balance/
    # ledger; total_selling_amount above stays excl.-GST.
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    discount_amount: Decimal = Decimal("0")
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None
    gst_amount: Decimal = Decimal("0")
    grand_total: Decimal
    # --- ADD THESE NEW FIELDS ---
    qty_11_8kg: Decimal = Decimal("0")
    qty_45_4kg: Decimal = Decimal("0")
    total_kg: Decimal = Decimal("0")
    # Legacy aggregate — "approved" only once both sale_status and
    # payment_status are approved. Prefer the two fields below.
    status: str
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    sale_status: str
    sale_approved_at: Optional[datetime] = None
    sale_approved_by: Optional[str] = None
    payment_status: str
    payment_approved_at: Optional[datetime] = None
    payment_approved_by: Optional[str] = None
    entered_by: str
    created_at: datetime



class UnifiedSaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    company_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    customer_id: UUID
    # None for a Payment-Only batch — see UnifiedSaleCreate.plant_id.
    company_id: Optional[UUID] = None
    total_selling_amount: Decimal
    total_purchase_amount: Decimal
    delivery_charges: Decimal = Decimal("0")
    total_credit_received: Decimal
    net_plant_payment: Decimal
    home_expense_amount: Decimal
    owner_drawings_amount: Decimal
    destination_type: str
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None
    vehicle_no: Optional[str] = None
    gate_pass_no: Optional[str] = None
    notes: Optional[str] = None
    payment_reference: Optional[str] = None
    # § Bug Fix — Correction Modal Routing. Null until the settlement's
    # first correction — see models.UnifiedSaleBatch.settlement_corrected_by.
    settlement_corrected_by: Optional[str] = None
    settlement_corrected_at: Optional[datetime] = None
    settlement_correction_reason: Optional[str] = None
    # GST on Sale, extended to Unified Sale — see models.UnifiedSaleBatch.
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    discount_amount: Decimal = Decimal("0")
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None
    gst_amount: Decimal = Decimal("0")
    grand_total: Decimal
    # Legacy aggregate — "approved" only once both sale_status and
    # payment_status are approved. Prefer the two fields below.
    status: str
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    sale_status: str
    sale_approved_at: Optional[datetime] = None
    sale_approved_by: Optional[str] = None
    payment_status: str
    payment_approved_at: Optional[datetime] = None
    payment_approved_by: Optional[str] = None
    entered_by: str
    created_at: datetime
    # The child records this batch created, for immediate confirmation/traceability
    sales: list[SaleOut] = []
    purchases: list[PurchaseOut] = []
    plant_payment: Optional[CompanyPaymentOut] = None
    # Legacy single-Expense field — populated with the first Expense row
    # for backward compat (still correct for a single-line/legacy
    # settlement, which always has exactly 0 or 1). A multi-line
    # settlement's full picture is home_expense_lines below.
    expense: Optional[ExpenseOut] = None
    owner_drawing: Optional[OwnerDrawingsOut] = None
    # § Multi-line Categorized Home Expense — structured record, mirrors
    # ShopSaleOut.home_expense_lines. Empty for a legacy single-amount
    # settlement (see UnifiedSaleSettlement.home_expense_lines).
    home_expense_lines: list[UnifiedSaleHomeExpenseLineOut] = []


# ---------- Cylinder Tracking ----------
# Cylinder entry create request model
class CylinderTransactionCreate(BaseModel):
    customer_id: UUID
    product_id: Optional[UUID] = None
    date: Optional[UtcDateTime] = None  # defaults to now if omitted
    qty_out: Decimal = Decimal("0")  # Delivered (filled)
    qty_in: Decimal = Decimal("0")   # Returned (empty)
    transaction_type: str = "SALE_RETURN"  # SALE_RETURN | EMPTY_RECEIPT | EMPTY_SALE | ADJUSTMENT
    notes: Optional[str] = None
    entered_by: str


class CylinderTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    customer_id: UUID
    product_id: Optional[UUID]
    sale_id: Optional[UUID]
    qty_out: Decimal
    qty_in: Decimal
    transaction_type: str
    notes: Optional[str]
    status: str
    entered_by: str
    created_at: datetime


class CylinderBalanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    customer_id: UUID
    product_id: UUID
    balance: Decimal


# EmptyCylinderSaleCreate/Out (Sell Empty Cylinders' old request/response
# shapes) are retired along with routers/customers.py's POST
# .../empty-cylinders/sell — "Sell Cylinder" now reuses CylinderReturnCreate/
# Out below (mode="cash", origin="sell_cylinder"). models.EmptyCylinderSale
# itself is untouched, for historical rows only.


# ---------- Cylinder Return (Return Cylinder / Add Empty Cylinder) ----------
class CylinderReturnCreate(BaseModel):
    """One request body shape covering all 3 modes (§ models.CylinderReturn)
    — the router validates which fields are required per mode:
      - "transfer": to_customer_id required; amount/destination fields unused.
      - "cash": amount required, routed exactly like PaymentReceiptCreate
        (home_expense_amount/owner_drawings_amount bypass, destination_type
        routes the remainder to a plant or account) — see
        routers/payment_receipts.py._resolve_destination /
        utils.apply_settlement_routing, reused unchanged for this mode.
      - "manual_add": only customer_id/cylinder_size/cylinder_type/quantity
        used; a pure count increase, nothing else."""
    date: Optional[UtcDateTime] = None  # defaults to now if omitted
    customer_id: UUID
    cylinder_size: Literal["118", "454"]
    cylinder_type: Optional[Literal["cross", "pso"]] = None
    quantity: Decimal
    mode: Literal["transfer", "cash", "manual_add"]
    # Reporting-only tag (§ models.CylinderReturn.origin) — "sell_cylinder"
    # marks a row created from the Empty Cylinders page's "Sell Cylinder"
    # button so the Daily Report can keep reporting sells as their own
    # section; every other caller (Customer Ledger's Return Cylinder /
    # Add Empty Cylinder modals) leaves this at the default.
    origin: Literal["return_cylinder", "sell_cylinder"] = "return_cylinder"

    # mode == "transfer"
    to_customer_id: Optional[UUID] = None

    # mode == "cash" — same shape/meaning as PaymentReceiptCreate
    amount: Optional[Decimal] = None
    method: Literal["cash", "bank_transfer", "cheque", "online", "other"] = "cash"
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Literal["plant", "account"] = "plant"
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None
    reference_no: Optional[str] = None

    # origin == "sell_cylinder" only (a real sale, not a payment): the sale
    # is quantity * price_per_cylinder, posted to the customer's ledger as a
    # receivable. payment_received (default 0) is the optional amount
    # collected now — expenses/owner drawings come out of THAT, exactly like
    # a normal Sale's settlement, and only the remainder is routed via
    # destination_type/target_plant_id/account_id. `amount` is ignored for
    # a sell. home_expense_lines is the same multi-line shape Shop Sale /
    # Unified Sale use and replaces the scalar home_expense_amount.
    price_per_cylinder: Optional[Decimal] = None
    payment_received: Decimal = Decimal("0")
    home_expense_lines: Optional[list[UnifiedSaleHomeExpenseLineIn]] = None

    notes: Optional[str] = None
    entered_by: str


class CylinderReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    to_customer_label: Optional[str] = None  # Delete Customer/Company snapshot; NULL while live
    display_id: str
    date: datetime
    customer_id: UUID
    cylinder_size: str
    cylinder_type: Optional[str] = None
    quantity: Decimal
    mode: str
    origin: str
    to_customer_id: Optional[UUID] = None
    payment_id: Optional[UUID] = None
    price_per_cylinder: Optional[Decimal] = None
    total_amount: Optional[Decimal] = None
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime


# ---------- Reporting (§5, §6, §8) ----------
class ReportableTransactionOut(BaseModel):
    """One row inside a Daily Report section — the common shape every
    reporting adapter maps its model into (app/reporting/types.py)."""
    id: UUID
    type: str  # e.g. "sale", "purchase", "payment", "company_payment", ...
    date: datetime
    display_id: str
    description: str
    amount: Optional[Decimal] = None
    customer: Optional[str] = None
    plant: Optional[str] = None
    reference: Optional[str] = None
    entered_by: str
    approval_info: Optional[str] = None
    status: str
    # § Daily Report clean columns — see ReportableTransaction's identical
    # fields (app/reporting/types.py) for why these exist.
    cylinder_weight: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    unit: Optional[str] = None


class ReportSectionOut(BaseModel):
    key: str
    label: str
    rows: list[ReportableTransactionOut]
    financial_total: Optional[Decimal] = None


class DailySummaryOut(BaseModel):
    total_sales: Decimal
    total_delivery_charges: Decimal
    total_purchases: Decimal
    total_customer_payments: Decimal
    total_plant_payments: Decimal
    total_investments: Decimal
    total_expenses: Decimal
    total_owner_drawings: Decimal
    net_cash_movement: Decimal
    total_cylinders_out: Decimal
    total_cylinders_in: Decimal


class DailyReportDataOut(BaseModel):
    business_date: str
    sections: list[ReportSectionOut]
    summary: DailySummaryOut


class GeneratedReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    report_type: str
    business_date: str
    generated_at: datetime
    generated_by: str
    language: str
    whatsapp_status: str
    whatsapp_sent_at: Optional[datetime] = None
    whatsapp_error: Optional[str] = None


class SendWhatsAppOut(BaseModel):
    report: GeneratedReportOut
    message: str


# ---------- WhatsApp Report Recipients ----------
class WhatsAppRecipientCreate(BaseModel):
    phone_number: str
    label: Optional[str] = None


class WhatsAppRecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    phone_number: str
    label: Optional[str] = None
    active: str
    created_at: datetime


class WhatsAppSendLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    report_id: UUID
    recipient_id: UUID
    status: str
    sent_at: datetime
    error: Optional[str] = None
    # Denormalized for display without a second lookup — resolved in the
    # router from the already-joined recipient row, not a DB-level column.
    recipient_label: Optional[str] = None
    recipient_phone_number: Optional[str] = None




# ---------- Shop Management + Board Rate ----------
class BoardRateCreate(BaseModel):
    effective_date: UtcDateTime
    rate_per_kg: Decimal
    entered_by: str


class BoardRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    effective_date: datetime
    rate_per_kg: Decimal
    entered_by: str
    created_at: datetime


class ShopStockBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_id: UUID
    product_id: UUID
    source_sale_id: Optional[UUID] = None
    transaction_date: datetime
    quantity_received: Decimal
    quantity_remaining: Decimal
    load_rate_per_kg: Decimal
    source_type: str = "load"
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime
    # Display-only, resolved by the router (never stored) — the FIFO
    # Breakdown table's "Product Name" / "Source" columns. Purely additive;
    # every other field above is untouched.
    product_name: Optional[str] = None
    source_display_id: Optional[str] = None


class ShopStockBatchCreate(BaseModel):
    """Add Filled Cylinder Stock (§ Shop Management) — manually adds an
    existing batch of filled cylinders to a shop's FIFO stock, e.g.
    onboarding a shop that already has physical stock on-site, or a manual
    correction. See routers/shops.py's create_manual_stock_batch: unlike
    every other ShopStockBatch, this one has no backing Sale and never
    touches Customer.current_balance / the Dowa receivable / any Purchase
    or Payment — it only ever adds physical stock."""
    date: Optional[UtcDateTime] = None
    product_id: UUID    
    quantity: Decimal
    notes: Optional[str] = None


class ShopSaleHomeExpenseLineIn(BaseModel):
    """One categorized Home Expense line within a Shop Sale's settlement
    (§ Multi-line Categorized Home Expense) — see ShopSaleCreate.
    home_expense_lines below."""
    category_id: UUID
    amount: Decimal
    # Required whenever category_id is the system "Salary" category (§
    # Employee Salary Tracking), enforced in routers/shops.py, same as the
    # legacy home_expense_employee_id field below.
    employee_id: Optional[UUID] = None
    description: Optional[str] = None


class ShopSaleCreate(BaseModel):
    date: UtcDateTime
    product_id: UUID
    quantity: Decimal
    unit: Literal["cylinder", "kg"] = "cylinder"
    # § Board Rate — manual entry only. There is no system-wide auto-resolve
    # for Shop Sale pricing (see routers/shops.py::_apply_shop_sale) — the
    # user types this every time, no default, no pre-fill. Required (no
    # default value here) so a request missing it is rejected at the schema
    # level before ever reaching pricing logic.
    board_rate_per_kg: Decimal
    # § Selling Price override — optional. When set, this REPLACES the
    # final total_amount outright (post board-rate calculation) — NOT
    # sale_rate_per_cylinder, which stays board-rate-derived always (the
    # audit trail of what the calculation would have produced). No
    # per-cylinder math for the user: they type the final Rs amount they
    # want to charge, full stop (e.g. a round negotiated total).
    # board_rate_per_kg above is still required and still stored either
    # way, purely as a record of what was typed there.
    manual_total_amount: Optional[Decimal] = None
    # GST on Sale, extended to Shop Sale (optional, locked at entry — same
    # convention as SaleCreate/UnifiedSale's own gst_enabled/gst_rate).
    # Default off; computed via utils.compute_gst in _apply_shop_sale.
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None
    supply_customer_id: Optional[UUID] = None
    payment_type: Literal["cash", "credit"] = "cash"
    amount_received: Optional[Decimal] = None
    destination_account_id: Optional[UUID] = None  # legacy fallback
    notes: Optional[str] = None
    entered_by: str

    # Settlement routing fields — the Shop Sale form's Deductions section.
    # § Home Expense category reversion — Home Expense is category-based
    # again (same ExpenseCategory list the main Expenses page uses,
    # including the system "Salary" category), matching every other
    # settlement-routing caller (Payment Receipt, Cylinder Return).
    # home_expense_description is kept ONLY for backward-reading historical
    # rows created while the free-text version was live — never sent by
    # current forms. home_expense_employee_id is required (enforced in
    # routers/shops.py) whenever home_expense_category_id is the system
    # "Salary" category (§ Employee Salary Tracking). Owner Drawings is
    # amount-only, as always.
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None
    home_expense_description: Optional[str] = None
    home_expense_employee_id: Optional[UUID] = None
    # § Multi-line Categorized Home Expense — when provided (non-empty),
    # REPLACES the single home_expense_amount/category_id/employee_id
    # fields above entirely: one ShopSaleHomeExpenseLine + one Expense row
    # per entry, summed for the settlement net-amount math. Those scalar
    # fields stay only for historical rows and are ignored server-side
    # whenever this list is non-empty (see _apply_shop_sale).
    home_expense_lines: Optional[list[ShopSaleHomeExpenseLineIn]] = None
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Optional[Literal["plant", "account"]] = None
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None

class ShopSaleCorrect(ShopSaleCreate):
    """Same shape as ShopSaleCreate — see SaleCorrect (Ledger Corrections)
    for the convention this mirrors."""
    correction_reason: str
    corrected_by: str


class ShopSaleHomeExpenseLineOut(BaseModel):
    """Mirrors ShopSaleHomeExpenseLineIn — raw category_id/employee_id, not
    resolved names, matching the existing settlement_home_expense_category_id
    convention (the frontend already has categories/employees lists fetched
    and resolves names client-side, e.g. resolveHomeExpenseLabel)."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    category_id: UUID
    employee_id: Optional[UUID] = None
    amount: Decimal
    description: Optional[str] = None


class ShopSaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    product_id: UUID
    quantity: Decimal
    unit: str = "cylinder"
    quantity_kg: Optional[Decimal] = None
    supply_customer_id: Optional[UUID] = None
    payment_type: str = "cash"
    amount_received: Optional[Decimal] = None
    destination_account_id: Optional[UUID] = None
    board_rate_per_kg_used: Decimal
    cylinder_weight_used: Decimal
    saleable_kg_used: Optional[Decimal] = None
    sale_rate_per_cylinder: Decimal
    total_amount: Decimal
    # § Segregated Profit Centers (Dashboard) — this sale's FIFO-weighted
    # cost of goods, summed from the exact ShopStockBatch row(s) it drew
    # from (each batch's load_rate_per_kg is a frozen historical rate, set
    # at Load time — see routers/sales.py). Computed only by
    # routers/shops.py's list_shop_sales (the Dashboard's data source);
    # every other endpoint returning ShopSaleOut leaves this at its
    # default 0 rather than paying for the join.
    cogs_amount: Decimal = Decimal("0")
    manual_rate_override: bool = False
    # § Discount (optional, applied BEFORE GST — GST is computed on the discounted base; total_amount itself is never touched)
    discount_enabled: bool = False
    discount_rate: Optional[Decimal] = None
    discount_amount: Decimal = Decimal("0")
    gst_enabled: bool = False
    gst_rate: Optional[Decimal] = None
    gst_amount: Decimal = Decimal("0")
    grand_total: Decimal = Decimal("0")
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None
    settlement_destination_type: Optional[str] = None
    settlement_target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[UUID] = None
    settlement_home_expense_description: Optional[str] = None
    settlement_home_expense_category_id: Optional[UUID] = None
    settlement_home_expense_employee_id: Optional[UUID] = None
    settlement_home_expense_amount: Optional[Decimal] = None
    settlement_owner_drawings_amount: Optional[Decimal] = None
    # § Multi-line Categorized Home Expense — empty for a sale created
    # before this table existed (or one whose Home Expense used the
    # legacy single-amount path); non-empty replaces the settlement_home_
    # expense_* scalars above as the source of truth for that sale.
    home_expense_lines: list[ShopSaleHomeExpenseLineOut] = []


class ShopCashTransferCreate(BaseModel):
    """Shop Cash Transfer (§ Shop Cash Transfer) — pushes money OUT of a
    shop's real Shop Cash balance via the same 3-way split Shop Sale
    settlement uses. Always routed (never a legacy single-account
    fallback), so destination_type/target_plant_id/account_id follow the
    exact same required-ness rules resolve_settlement_destination already
    enforces for Payment Receipt/Cylinder Return/Shop Sale."""
    date: UtcDateTime
    gross_amount: Decimal
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None
    home_expense_description: Optional[str] = None  # kept only for reading historical rows
    home_expense_employee_id: Optional[UUID] = None
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Literal["plant", "account"]
    target_plant_id: Optional[UUID] = None
    account_id: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


class ShopCashTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    shop_id: UUID
    gross_amount: Decimal
    settlement_destination_type: str
    settlement_target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[UUID] = None
    settlement_home_expense_description: Optional[str] = None
    settlement_home_expense_category_id: Optional[UUID] = None
    settlement_home_expense_employee_id: Optional[UUID] = None
    settlement_home_expense_amount: Decimal
    settlement_owner_drawings_amount: Decimal
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime
    modified_at: Optional[datetime] = None
    modified_by: Optional[str] = None

# ---------- Delete shop     ------
class ShopDeletePasswordSet(BaseModel):
    new_password: str
    current_password: Optional[str] = None


class ShopDeleteRequest(BaseModel):
    password: str
# ---------- Shop Business Finance (Engine 3, §19-§26) ----------

class ShopSupplyCustomerCreate(BaseModel):
    name: str
    mobile: Optional[str] = None
    address: Optional[str] = None
    opening_balance: Decimal = Decimal("0")
    entered_by: str


class ShopSupplyCustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    shop_id: UUID
    name: str
    mobile: Optional[str] = None
    address: Optional[str] = None
    opening_balance: Decimal
    current_balance: Decimal
    status: str
    entered_by: str
    created_at: datetime


class ShopCustomerPaymentCreate(BaseModel):
    date: UtcDateTime
    supply_customer_id: UUID
    amount: Decimal
    method: str = "cash"
    # Which account receives this collection — defaults to the shop's own
    # Shop Cash account, same account choices as elsewhere. LEGACY path
    # only (RecordSupplyCustomerPaymentModal's plain flow) — ignored
    # whenever destination_type below is given, which selects settlement
    # routing instead (§ Payment Only mode, Record Shop Sale).
    account_id: Optional[UUID] = None
    # Optional traceability to the credit ShopSale being settled (§ Money
    # Routing — never required, never auto-allocated).
    shop_sale_id: Optional[UUID] = None
    notes: Optional[str] = None
    entered_by: str

    # Settlement Routing (§ Payment Only mode) — same 3-way split (Home
    # Expense / Owner Drawings / Plant-or-Account) as ShopSale/
    # ShopCashTransfer. A separate settlement_account_id (str, bucket-key-
    # capable via resolve_settlement_destination) rather than reusing
    # account_id above — that field is UUID-only and means something
    # different (the legacy path's single real PaymentAccount).
    home_expense_amount: Decimal = Decimal("0")
    home_expense_category_id: Optional[UUID] = None
    home_expense_description: Optional[str] = None  # kept only for reading historical rows
    home_expense_employee_id: Optional[UUID] = None
    owner_drawings_amount: Decimal = Decimal("0")
    destination_type: Optional[Literal["plant", "account"]] = None
    target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[str] = None


class ShopCustomerPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    shop_id: UUID
    supply_customer_id: UUID
    account_id: Optional[UUID] = None
    shop_sale_id: Optional[UUID] = None
    amount: Decimal
    method: str
    notes: Optional[str] = None
    excess_amount: Optional[Decimal] = None
    settlement_destination_type: Optional[str] = None
    settlement_target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[UUID] = None
    settlement_home_expense_description: Optional[str] = None
    settlement_home_expense_category_id: Optional[UUID] = None
    settlement_home_expense_employee_id: Optional[UUID] = None
    settlement_home_expense_amount: Optional[Decimal] = None
    settlement_owner_drawings_amount: Optional[Decimal] = None
    status: str
    entered_by: str
    created_at: datetime


class ShopSupplyCustomerLedgerRow(BaseModel):
    """One row of a Supply Customer's ledger — the shop-scoped mirror of
    LedgerRow, deliberately its own (simpler) shape: only two event kinds
    ever apply here (a shop's ShopSale/ShopCustomerPayment), never the
    Dowa-side kinds (unified_sale, empty_cylinder_sale, ...)."""
    date: datetime
    kind: Literal["sale", "payment"]
    ref_id: UUID
    display_id: str
    description: str
    # sale_amount is the OUTSTANDING contribution this row posted to
    # running_balance (see get_supply_customer_ledger — "0" for a fully
    # cash sale), NOT the sale's gross total; gross_amount below is that
    # true total, added for the Supply Customer Statement PDF (§ Shop
    # Statement's Amount/Paid pattern) without touching this field's
    # existing, already-relied-upon meaning.
    sale_amount: Decimal
    payment_amount: Decimal
    running_balance: Decimal
    rate: Optional[Decimal] = None
    entered_by: str
    # § Supply Customer Statement — structured fields (never parsed from
    # `description` above) for a "sale" row; null for "payment". Mirrors
    # ShopTransactionRow's cylinder_weight/customer_name additions for the
    # same reason: description already embeds this as free text
    # ("{product} × {qty} {unit_label}"), which is fine for internal
    # display but not a Description-free customer-facing PDF.
    gross_amount: Optional[Decimal] = None
    cylinder_weight: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    unit: Optional[Literal["cylinder", "kg"]] = None
    # Always per-KG (ShopSale.board_rate_per_kg_used), unlike `rate` above
    # which is deliberately unit-relative for the on-screen ledger (a
    # cylinder-unit row's `rate` is sale_rate_per_cylinder — see "Bug 3"
    # comment above). The Supply Customer Statement PDF needs a real
    # rate/kg figure regardless of unit — same fix already applied to the
    # Shop Statement's own Rate column (§ Rate is currently wrong) — so
    # this is a NEW field rather than changing `rate`'s existing,
    # already-relied-upon on-screen meaning.
    board_rate_per_kg: Optional[Decimal] = None
    # Where the money collected on this row was routed (§ Settlement
    # Routing) — populated for a "payment" row (Payment Only) AND now for a
    # "sale" row too (the amount collected at the point of sale, whose
    # Expense/Owner Drawings/Plant/Account split the ShopSale itself has
    # always stored). Null for a row with nothing collected or no routing
    # (the legacy plain-account collection path). Mirrors ShopTransactionRow/
    # ShopBusinessLedgerRow's identical fields; for a sale row the collected
    # figure is payment_amount above.
    settlement_destination_type: Optional[str] = None
    settlement_target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[UUID] = None
    settlement_home_expense_description: Optional[str] = None
    settlement_home_expense_category_id: Optional[UUID] = None
    settlement_home_expense_employee_id: Optional[UUID] = None
    settlement_home_expense_amount: Optional[Decimal] = None
    settlement_owner_drawings_amount: Optional[Decimal] = None
    # § Shop Customer Ledger GST columns — populated only for kind=="sale"
    # (the only kind backed by a real ShopSale); mirrors ShopTransactionRow/
    # ShopBusinessLedgerRow's identical gst_rate/gst_amount fields. Like
    # gross_amount above, sale_amount stays whatever it already meant
    # (outstanding contribution) — these are purely the tax breakout.
    gst_rate: Optional[Decimal] = None
    gst_amount: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    # § Multi-line Categorized Expense — a sale row's per-line breakdown
    # (same source of truth ShopBusinessLedgerRow uses); empty for a payment
    # row and for a legacy single-amount sale.
    home_expense_lines: list[ShopSaleHomeExpenseLineOut] = []


class ShopSupplyCustomerLedgerOut(BaseModel):
    """All-time (not month-scoped — ShopSupplyCustomer has a single
    opening_balance, not a month-anchored one like Customer's) running
    ledger for one shop's own supply customer."""
    customer: ShopSupplyCustomerOut
    opening_balance: Decimal
    total_sales: Decimal
    total_payments: Decimal
    # Cash collected at the moment of sale (a full cash sale, or a credit
    # sale's inline-settled portion) — kept separate from total_payments
    # (genuine ShopCustomerPayment rows) so opening + total_sales -
    # total_payments still reconciles exactly to closing_balance.
    total_collected_at_sale: Decimal = Decimal("0")
    total_transactions: int
    closing_balance: Decimal
    rows: list[ShopSupplyCustomerLedgerRow]


class ShopExpenseLineCreate(BaseModel):
    # Required only for line_type == "expense" — an owner_withdrawal isn't
    # a category of expense at all, so it's left unset for that line type
    # (enforced server-side in create_shop_expense, not just by the client
    # omitting it). OptionalUUID also tolerates "" as "no category".
    category_id: OptionalUUID = None
    line_type: Literal["expense", "owner_withdrawal"] = "expense"
    amount: Decimal
    description: Optional[str] = None
    # Employee Salary Tracking (§ Employee Salary Tracking) — required
    # (enforced in create_shop_expense) whenever category_id is the
    # system "Salary" category; null for every other category.
    employee_id: OptionalUUID = None


class ShopExpenseLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    category_id: Optional[UUID] = None
    category_name: Optional[str] = None
    line_type: str
    amount: Decimal
    description: Optional[str] = None
    employee_id: Optional[UUID] = None
    employee_name: Optional[str] = None


class ShopExpenseTransactionCreate(BaseModel):
    date: UtcDateTime
    lines: list[ShopExpenseLineCreate]
    # Which account is debited — defaults to the shop's own Shop Cash
    # account, same account choices as elsewhere. payment_source stays as a
    # free-text note alongside it (unchanged structure, §4).
    account_id: Optional[UUID] = None
    payment_source: Optional[str] = None
    notes: Optional[str] = None
    # Attribution (§ Shop Expense/Withdrawal Attribution) — set by Record
    # Shop Sale (both, once its own Sale exists) and Record Supply Customer
    # Payment (supply_customer_id only); left unset by the standalone
    # Record Expense form, which has neither. Never validated against the
    # line contents — this is "what was on screen when this was entered",
    # not a computed allocation.
    supply_customer_id: OptionalUUID = None
    shop_sale_id: OptionalUUID = None
    entered_by: str


class ShopExpenseTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    shop_id: UUID
    total_amount: Decimal
    account_id: Optional[UUID] = None
    payment_source: Optional[str] = None
    supply_customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    shop_sale_id: Optional[UUID] = None
    shop_sale_display_id: Optional[str] = None
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime
    lines: list[ShopExpenseLineOut] = []


class ShopCashSummary(BaseModel):
    """A historical, date-scoped VIEW of Shop Cash, derived from Engine 3's
    own transaction history (§24) — reconciles against, but is distinct
    from, `account.current_balance` on ShopDetailOut, which is the real,
    live, stored PaymentAccount balance every money movement actually posts
    to (§ Shop Cash Money Routing). Same relationship Customer.current_balance
    has to the derived monthly Customer Ledger."""
    business_date: str
    opening_cash: Decimal
    cash_retail_sales: Decimal
    supply_customer_collections: Decimal
    expenses: Decimal
    owner_withdrawals: Decimal
    dowa_payments: Decimal
    transfers_in: Decimal
    transfers_out: Decimal
    # Shop Cash Transfer (§ Shop Cash Transfer) — distinct from transfers_out
    # above (AccountTransfer, account-to-account). This is the 3-way-split
    # money movement OUT of Shop Cash via ShopCashTransfer.
    cash_transfers_out: Decimal
    # Sale/Transfer Deductions (§ Shop Cash Flow chip) — purely informational
    # totals of Home Expense / Owner Drawings bypassed via EITHER a Shop
    # Sale's or a Shop Cash Transfer's settlement routing, for this period.
    # Never folded into closing_cash — this money never touched Shop Cash.
    settlement_home_expense_total: Decimal
    settlement_owner_drawings_total: Decimal
    closing_cash: Decimal


class ShopBusinessLedgerRow(BaseModel):
    """One row of the Shop Business Ledger (§28E) — Engine 3 only: cash
    retail sales, supply-customer credit sales/collections, expenses, owner
    withdrawals, and payments to Dowa. Never a Shop's Dowa-side Load/
    Payment (those stay in the existing Transaction History section)."""
    kind: Literal[
        "cash_sale", "credit_sale", "customer_payment",
        "expense", "owner_withdrawal", "dowa_payment", "shop_cash_transfer",
    ]
    date: datetime
    ref_id: UUID
    display_id: str
    description: str
    amount: Decimal
    cash_impact: Decimal  # signed: + into Shop Cash, - out of Shop Cash
    # Where the collected amount was routed (§ Settlement Routing) — the
    # shop-side counterpart to the plant ledger's payment-received row.
    # Null for a credit sale with nothing collected (all-credit) or a pre-
    # routing-change row; populated for kind in ("cash_sale", "credit_sale",
    # "customer_payment", "shop_cash_transfer") — every row kind whose
    # underlying model actually carries settlement_* columns.
    settlement_destination_type: Optional[str] = None
    settlement_target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[UUID] = None
    settlement_home_expense_description: Optional[str] = None
    settlement_home_expense_category_id: Optional[UUID] = None
    settlement_home_expense_employee_id: Optional[UUID] = None
    settlement_home_expense_amount: Optional[Decimal] = None
    settlement_owner_drawings_amount: Optional[Decimal] = None
    # § GST visibility gap — populated only for kind in ("cash_sale",
    # "credit_sale") (the only kinds backed by a real ShopSale); amount
    # above is already grand_total-inclusive, these just break out how
    # much of it was tax. Mirrors ShopTransactionRow.gst_rate/gst_amount.
    gst_rate: Optional[Decimal] = None
    gst_amount: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    # § Multi-line Categorized Home Expense — populated only for kind in
    # ("cash_sale", "credit_sale") when that ShopSale used the multi-line
    # path; empty otherwise (settlement_home_expense_* above still carries
    # the legacy single-amount shape for older rows).
    home_expense_lines: list[ShopSaleHomeExpenseLineOut] = []
    entered_by: str
    status: str


class ShopBusinessLedgerOut(BaseModel):
    business_date: str
    cash: ShopCashSummary
    rows: list[ShopBusinessLedgerRow]


class ShopListRow(BaseModel):
    """One row of the Shops list page — live stock + today's activity +
    payable, computed on demand (never a stored running total)."""
    customer: CustomerOut
    current_stock: Decimal
    today_load: Decimal
    today_sales: Decimal
    current_balance: Decimal
    shop_cash_balance: Decimal  # the shop's own PaymentAccount.current_balance
    last_activity: Optional[datetime] = None


class ShopProductStockSummary(BaseModel):
    """Per-product daily stock position for one shop — kept per-product
    (never flattened into one ambiguous number) since a shop can stock
    more than one cylinder size, each with its own Board-Rate-derived
    sale rate (§15: cylinder weight must never be hard-coded, it's always
    read from Product.weight_kg for whichever product this row is)."""
    product_id: UUID
    product_name: str
    opening_stock: Decimal
    new_load: Decimal
    sales: Decimal
    closing_stock: Decimal
    board_rate_per_kg: Optional[Decimal] = None
    cylinder_weight: Decimal  # physical weight, from Product.weight_kg
    wastage_kg: Decimal
    saleable_kg: Decimal  # cylinder_weight - wastage_kg — what sale_rate_per_cylinder is actually computed from
    sale_rate_per_cylinder: Optional[Decimal] = None
    todays_sales_amount: Decimal


class ShopStockSummary(BaseModel):
    """Powers the Shop detail page's daily dashboard (§28) — every number
    is derived on demand from the immutable transaction logs (Sale/
    ShopStockBatch.quantity_received for Loads, ShopSale.quantity for
    Sales), never from a stored running total."""
    business_date: str
    products: list[ShopProductStockSummary]
    total_opening_stock: Decimal
    total_new_load: Decimal
    total_sales: Decimal
    total_closing_stock: Decimal
    total_sales_amount: Decimal


class ShopTransactionRow(BaseModel):
    """One row in the Shop detail page's unified transaction history table
    — covers Load/Sale/Payment/Emergency Transfer Out/Customer Payment,
    columns populated per type as relevant (§16)."""
    kind: Literal["load", "shop_sale", "payment", "emergency_transfer_out", "customer_payment"]
    date: datetime
    ref_id: UUID
    display_id: str
    description: str
    quantity: Optional[Decimal] = None
    board_rate_per_kg: Optional[Decimal] = None
    cylinder_weight: Optional[Decimal] = None
    sale_rate_per_cylinder: Optional[Decimal] = None
    load_rate_per_kg: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    # § GST on Shop Sale — populated only for kind=="shop_sale"; `amount`
    # above is already grand_total-inclusive (see get_shop_detail), these
    # just break out how much of it was tax. Mirrors LedgerRow.gst_rate/
    # gst_amount (§ Shop Statement PDF GST columns).
    gst_rate: Optional[Decimal] = None
    gst_amount: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    # Inline Settlement (§2) — populated only for kind=="shop_sale".
    amount_received: Optional[Decimal] = None
    amount_outstanding: Optional[Decimal] = None
    # § Shop Statement — the named Supply Customer on a shop_sale row, or
    # "Walk-in Customer" when none was picked (a shop_sale never requires
    # one — see routers/shops._apply_shop_sale); the actual named customer
    # for a customer_payment row (a Payment Only collection always names
    # one — see ShopCustomerPaymentCreate.supply_customer_id, required).
    # Null for every other kind (Load/Payment/Emergency Transfer have no
    # retail-customer concept).
    customer_name: Optional[str] = None
    # Where the collected amount was routed at creation time (§ Settlement
    # Routing) — null for a sale with nothing collected (all-credit) or a
    # pre-routing-change row; populated for kind in ("shop_sale",
    # "customer_payment"). Mirrors UnifiedSaleBatch's destination_type
    # pattern (see unified-sale/page.tsx's getDestinationLabel) so the shop
    # side shows the same "Routed To" info the plant side already gets.
    settlement_destination_type: Optional[str] = None
    settlement_target_plant_id: Optional[UUID] = None
    settlement_account_id: Optional[UUID] = None
    settlement_home_expense_description: Optional[str] = None
    settlement_home_expense_category_id: Optional[UUID] = None
    settlement_home_expense_employee_id: Optional[UUID] = None
    settlement_home_expense_amount: Optional[Decimal] = None
    settlement_owner_drawings_amount: Optional[Decimal] = None
    # § Multi-line Categorized Home Expense — populated only for
    # kind=="shop_sale" when that sale used the multi-line path.
    home_expense_lines: list[ShopSaleHomeExpenseLineOut] = []
    entered_by: str
    status: str
    correctable: bool = False


class ShopSaleCorrectionRow(BaseModel):
    """Correction History row for a corrected ShopSale — mirrors
    CorrectionHistoryRow's shape for Sale/Payment/Purchase/CompanyPayment."""
    date: datetime
    ref_id: UUID
    display_id: str
    description: str
    original_amount: Decimal
    correction_reason: str
    corrected_by: str
    corrected_at: datetime
    corrected_display_id: Optional[str] = None


class ShopDetailOut(BaseModel):
    customer: CustomerOut
    stock: ShopStockSummary
    cash: ShopCashSummary
    # The shop's own real PaymentAccount row — the live, stored Shop Cash
    # balance every money movement actually posts to (§ Shop Cash Money
    # Routing). `cash.closing_cash` above is the derived historical view for
    # `cash.business_date`; `account.current_balance` is the real number
    # right now — for today's date the two reconcile by construction.
    account: PaymentAccountOut
    transactions: list[ShopTransactionRow]
    corrections: list[CorrectionHistoryRow]
    shop_sale_corrections: list[ShopSaleCorrectionRow]


# ---------- Auth (§ Auth Module) ----------
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    email: str
    role: str
    status: str
    email_verified: bool
    created_at: datetime
    approved_at: Optional[datetime] = None
    approved_by: Optional[UUID] = None
    last_login_at: Optional[datetime] = None


class MeOut(BaseModel):
    authenticated: bool
    user: Optional[UserOut] = None
    csrf_token: Optional[str] = None


class LoginOut(BaseModel):
    user: UserOut
    csrf_token: str


class ApproveUserRequest(BaseModel):
    role: Literal["owner", "staff"] = "staff"


class RejectSuspendRequest(BaseModel):
    reason: Optional[str] = None


class UserAccessAuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: Optional[UUID] = None
    action: str
    performed_by: Optional[UUID] = None
    reason: Optional[str] = None
    created_at: datetime
