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

from pydantic import AfterValidator, BaseModel, ConfigDict

from app.timezone import to_naive_utc

# Every inbound "when did this happen" field goes through this — see
# to_naive_utc's docstring for why: the Postgres session's `timezone` GUC
# is Asia/Karachi, so an aware datetime bound to one of this app's naive
# DateTime columns gets silently shifted by Postgres before storage, then
# shifted again on display, producing a +5h "double timezone offset" bug
# (§ Double Timezone Offset Fix). Every *Create/*Update schema's date /
# timestamp field below uses this instead of plain `datetime`.
UtcDateTime = Annotated[datetime, AfterValidator(to_naive_utc)]


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
    party_id: UUID
    rate_118: Decimal
    entered_by: str
    timestamp: Optional[UtcDateTime] = None  # defaults to now if omitted; editable for backdating


class RateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    company_id: UUID
    party_id: UUID
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
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    excess_amount: Optional[Decimal] = None
    status: str
    entered_by: str
    created_at: datetime


# ---------- Expense ----------
class ExpenseCreate(BaseModel):
    date: UtcDateTime
    category_id: UUID
    amount: Decimal
    account_id: Optional[UUID] = None  # null = funded directly from field-collected cash, no account debited
    method: str = "cash"
    description: Optional[str] = None
    vendor: Optional[str] = None
    reference_no: Optional[str] = None
    entered_by: str


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    category_id: UUID
    amount: Decimal
    account_id: Optional[UUID]
    method: str
    description: Optional[str]
    vendor: Optional[str]
    reference_no: Optional[str]
    unified_sale_id: Optional[UUID] = None
    # Set only when this expense bypassed a Dowa account and was funded
    # straight out of a customer's payment (source_payment_id from a Payment
    # Receipt's home-expense deduction, or unified_sale_id from a Unified
    # Sale's) — never set for an expense paid from a real PaymentAccount.
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime


# ---------- Customer Ledger (computed, read-only view) ----------
class LedgerRow(BaseModel):
    date: datetime
    # "unified_sale" = one aggregated row for an entire approved Unified
    # Sale batch — its child Sale rows are never emitted individually (§ ledger aggregation).
    # "empty_cylinder_sale" = one Sell Empty Cylinders transaction.
    # "cylinder_transaction" = one standalone cylinder movement (e.g. the
    # Customer Ledger's Cyl Return/Entry action) not tied to a Sale.
    kind: Literal["sale", "payment", "unified_sale", "empty_cylinder_sale", "cylinder_transaction"]
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


class CorrectionHistoryRow(BaseModel):
    """One superseded (status="corrected") original transaction — kept
    for the read-only Correction History panel, never mixed into the
    running-balance rows above (§1)."""
    kind: Literal["sale", "payment", "purchase", "company_payment"]
    date: datetime
    ref_id: UUID
    display_id: str
    description: str
    original_amount: Decimal
    correction_reason: str
    corrected_by: str
    corrected_at: datetime
    corrected_display_id: Optional[str] = None  # the new row that replaced it, if still findable


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
    status: str
    entered_by: str
    created_at: datetime


# ---------- Unified Sale Engine ----------
class UnifiedSaleItem(BaseModel):
    product_id: UUID
    quantity: Decimal
    purchase_rate: Decimal  # per cylinder, what the plant charges Dowa
    selling_rate: Decimal   # per cylinder, what Dowa charges the customer


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
    plant_id: UUID  # maps to Company.id
    items: list[UnifiedSaleItem] = []
    settlement: UnifiedSaleSettlement
    gate_pass_no: Optional[str] = None
    vehicle_no: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


# Editing a pending batch takes the same shape as creating one — the whole
# item/settlement set is replaced, not patched field-by-field, so partial
# edits can't leave stale line items behind (§1B).
class UnifiedSaleEdit(UnifiedSaleCreate):
    pass


class UnifiedSaleBatchOut(BaseModel):
    """Lightweight list-view row — no nested child records, unlike UnifiedSaleOut."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    company_id: UUID
    total_selling_amount: Decimal
    total_purchase_amount: Decimal
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
    display_id: str
    date: datetime
    customer_id: UUID
    company_id: UUID
    total_selling_amount: Decimal
    total_purchase_amount: Decimal
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
    expense: Optional[ExpenseOut] = None
    owner_drawing: Optional[OwnerDrawingsOut] = None
    
    
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


# ---------- Empty Cylinder Sale (Sell Empty Cylinders action) ----------
class EmptyCylinderSaleCreate(BaseModel):
    # customer_id is NOT here — it comes from the URL path
    # (/customers/{customer_id}/empty-cylinders/sell), not the request body.
    date: Optional[UtcDateTime] = None  # defaults to now if omitted
    cylinder_size: Literal["118", "454"]
    # Optional for backward compatibility: omitted means the untyped
    # legacy sell path (deducts only the size total, same as before this
    # feature existed). Provided means the exact size+type combination is
    # checked and deducted (§ Empty Cylinder Sale).
    cylinder_type: Optional[Literal["cross", "pso"]] = None
    quantity: Decimal
    amount: Decimal
    notes: Optional[str] = None
    entered_by: str


class EmptyCylinderSaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    cylinder_size: str
    cylinder_type: Optional[str] = None
    quantity: Decimal
    amount: Decimal
    notes: Optional[str]
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


class ReportSectionOut(BaseModel):
    key: str
    label: str
    rows: list[ReportableTransactionOut]
    financial_total: Optional[Decimal] = None


class DailySummaryOut(BaseModel):
    total_sales: Decimal
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
    whatsapp_status: str
    whatsapp_sent_at: Optional[datetime] = None
    whatsapp_error: Optional[str] = None


class SendWhatsAppOut(BaseModel):
    report: GeneratedReportOut
    message: str


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
    status: str
    entered_by: str
    created_at: datetime
    # Display-only, resolved by the router (never stored) — the FIFO
    # Breakdown table's "Product Name" / "Source" columns. Purely additive;
    # every other field above is untouched.
    product_name: Optional[str] = None
    source_display_id: Optional[str] = None


class ShopSaleCreate(BaseModel):
    date: UtcDateTime
    product_id: UUID
    quantity: Decimal  # in whichever `unit` is chosen — cylinders, or KG
    unit: Literal["cylinder", "kg"] = "cylinder"
    # Supply Customers (§25) — a named shop customer; "credit" requires one.
    supply_customer_id: Optional[UUID] = None
    payment_type: Literal["cash", "credit"] = "cash"
    # Inline Settlement (§2) — how much was actually collected now. Omitted
    # (None) means "fully paid" for a cash sale, "fully credit" (0) for a
    # credit sale — today's original behavior, unchanged unless specified.
    # A credit sale may set this anywhere from 0 up to the (server-computed)
    # total_amount for a partial payment; the server rejects anything else.
    amount_received: Optional[Decimal] = None
    # Which account received amount_received — defaults to this shop's own
    # Shop Cash account when amount_received > 0 and this is left unset.
    destination_account_id: Optional[UUID] = None
    notes: Optional[str] = None
    entered_by: str


class ShopSaleCorrect(ShopSaleCreate):
    """Same shape as ShopSaleCreate — see SaleCorrect (Ledger Corrections)
    for the convention this mirrors."""
    correction_reason: str
    corrected_by: str


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
    notes: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime
    corrected_by: Optional[str] = None
    corrected_at: Optional[datetime] = None
    correction_reason: Optional[str] = None
    corrected_from_id: Optional[UUID] = None


class ShopStockAdjustmentCreate(BaseModel):
    date: UtcDateTime
    product_id: UUID
    adjustment_type: Literal["return", "adjustment"]
    quantity_delta: Decimal  # signed: positive = stock in, negative = stock out
    reason: Optional[str] = None
    entered_by: str


class ShopStockAdjustmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    product_id: UUID
    adjustment_type: str
    quantity_delta: Decimal
    reason: Optional[str] = None
    status: str
    entered_by: str
    created_at: datetime


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
    # Shop Cash account, same account choices as elsewhere.
    account_id: Optional[UUID] = None
    # Optional traceability to the credit ShopSale being settled (§ Money
    # Routing — never required, never auto-allocated).
    shop_sale_id: Optional[UUID] = None
    notes: Optional[str] = None
    entered_by: str


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
    status: str
    entered_by: str
    created_at: datetime


class ShopExpenseLineCreate(BaseModel):
    # Required only for line_type == "expense" — an owner_withdrawal isn't
    # a category of expense at all, so it's left unset for that line type
    # (enforced server-side in create_shop_expense, not just by the client
    # omitting it).
    category_id: Optional[UUID] = None
    line_type: Literal["expense", "owner_withdrawal"] = "expense"
    amount: Decimal
    description: Optional[str] = None


class ShopExpenseLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    category_id: Optional[UUID] = None
    category_name: Optional[str] = None
    line_type: str
    amount: Decimal
    description: Optional[str] = None


class ShopExpenseTransactionCreate(BaseModel):
    date: UtcDateTime
    lines: list[ShopExpenseLineCreate]
    # Which account is debited — defaults to the shop's own Shop Cash
    # account, same account choices as elsewhere. payment_source stays as a
    # free-text note alongside it (unchanged structure, §4).
    account_id: Optional[UUID] = None
    payment_source: Optional[str] = None
    notes: Optional[str] = None
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
    closing_cash: Decimal


class ShopBusinessLedgerRow(BaseModel):
    """One row of the Shop Business Ledger (§28E) — Engine 3 only: cash
    retail sales, supply-customer credit sales/collections, expenses, owner
    withdrawals, and payments to Dowa. Never a Shop's Dowa-side Load/
    Payment (those stay in the existing Transaction History section)."""
    kind: Literal[
        "cash_sale", "credit_sale", "customer_payment",
        "expense", "owner_withdrawal", "dowa_payment",
    ]
    date: datetime
    ref_id: UUID
    display_id: str
    description: str
    amount: Decimal
    cash_impact: Decimal  # signed: + into Shop Cash, - out of Shop Cash
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
    today_returns: Decimal
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
    returns: Decimal
    adjustments: Decimal
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
    Sales, ShopStockAdjustment.quantity_delta for Returns/Adjustments),
    never from a stored running total."""
    business_date: str
    products: list[ShopProductStockSummary]
    total_opening_stock: Decimal
    total_new_load: Decimal
    total_sales: Decimal
    total_returns: Decimal
    total_adjustments: Decimal
    total_closing_stock: Decimal
    total_sales_amount: Decimal


class ShopTransactionRow(BaseModel):
    """One row in the Shop detail page's unified transaction history table
    — covers Load/Sale/Return/Adjustment/Payment, columns populated per
    type as relevant (§16)."""
    kind: Literal["load", "shop_sale", "return", "adjustment", "payment"]
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
    # Inline Settlement (§2) — populated only for kind=="shop_sale".
    amount_received: Optional[Decimal] = None
    amount_outstanding: Optional[Decimal] = None
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
