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
from typing import Optional, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# ---------- Company ----------
class CompanyCreate(BaseModel):
    name: str
    mobile: Optional[str] = None
    opening_balance: Decimal = Decimal("0")
    opening_balance_date: Optional[datetime] = None


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
    timestamp: Optional[datetime] = None  # defaults to now if omitted; editable for backdating


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
    opening_balance_date: Optional[datetime] = None


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


class PaymentAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    kind: str
    opening_balance: Decimal
    current_balance: Decimal
    active: str


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
    date: datetime
    customer_id: UUID
    product_id: UUID
    company_id: Optional[UUID] = None
    quantity: Decimal
    rate_per_cylinder: Decimal  # what the agency actually charges per cylinder for this line
    gate_pass_no: Optional[str] = None
    vehicle_no: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


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


# ---------- Payment ----------
class PaymentCreate(BaseModel):
    date: datetime
    customer_id: UUID
    sale_id: Optional[UUID] = None
    amount: Decimal
    method: Literal["cash", "bank_transfer", "cheque", "online", "other"]
    account_id: UUID
    reference_no: Optional[str] = None
    received_by: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    sale_id: Optional[UUID]
    amount: Decimal
    method: str
    account_id: UUID
    reference_no: Optional[str]
    received_by: Optional[str]
    notes: Optional[str]
    excess_amount: Optional[Decimal]
    status: str
    entered_by: str
    created_at: datetime


# ---------- Payment Receipt (standalone, with settlement routing) ----------
class PaymentReceiptCreate(BaseModel):
    """Like PaymentCreate, but the amount is split the same three ways as a
    Unified Sale settlement: home_expense_amount / owner_drawings_amount
    bypass every Dowa account (auto-creates an Expense / OwnerDrawings row);
    whatever's left — net_settlement_amount = amount − home_expense −
    owner_drawings — is routed per destination_type, exactly like
    UnifiedSaleSettlement. The customer's balance always drops by the full
    `amount`, regardless of how it's routed afterward."""
    date: datetime
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
    date: datetime
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
    status: str
    entered_by: str
    created_at: datetime


# ---------- Customer Ledger (computed, read-only view) ----------
class LedgerRow(BaseModel):
    date: datetime
    # "unified_sale" = one aggregated row for an entire approved Unified
    # Sale batch — its child Sale rows are never emitted individually (§ ledger aggregation).
    kind: Literal["sale", "payment", "unified_sale"]
    ref_id: UUID
    display_id: str
    description: str
    sale_amount: Decimal
    payment_amount: Decimal
    running_balance: Decimal
    qty_118: Decimal = Decimal("0")
    qty_454: Decimal = Decimal("0")


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
    rows: list[LedgerRow]


# ---------- Purchase ----------
class PurchaseCreate(BaseModel):
    date: datetime
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


# ---------- Company Payment ----------
class CompanyPaymentCreate(BaseModel):
    date: datetime
    company_id: UUID
    purchase_id: Optional[UUID] = None
    amount: Decimal
    method: Literal["cash", "bank_transfer", "cheque", "online", "other", "direct_settlement"] = "cash"
    account_id: Optional[UUID] = None  # null = 3-way settlement, customer money never entered a Dowa account
    reference_no: Optional[str] = None
    paid_by: Optional[str] = None
    notes: Optional[str] = None
    entered_by: str


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


# ---------- Owner Drawings ----------
class OwnerDrawingsCreate(BaseModel):
    date: datetime
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


class UnifiedSaleCreate(BaseModel):
    date: datetime
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
    # --- ADD THESE NEW FIELDS ---
    qty_11_8kg: Decimal = Decimal("0")
    qty_45_4kg: Decimal = Decimal("0")
    total_kg: Decimal = Decimal("0")
    status: str
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
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
    status: str
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    entered_by: str
    created_at: datetime
    # The child records this batch created, for immediate confirmation/traceability
    sales: list[SaleOut] = []
    purchases: list[PurchaseOut] = []
    plant_payment: Optional[CompanyPaymentOut] = None
    expense: Optional[ExpenseOut] = None
    owner_drawing: Optional[OwnerDrawingsOut] = None
    
    
# ---------- Cylinder Tracking ----------
class CylinderTransactionCreate(BaseModel):
    date: datetime
    customer_id: UUID
    product_id: UUID
    qty_out: Decimal = Decimal("0")
    qty_in: Decimal = Decimal("0")
    notes: Optional[str] = None
    entered_by: str


class CylinderTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_id: str
    date: datetime
    customer_id: UUID
    product_id: UUID
    sale_id: Optional[UUID]
    qty_out: Decimal
    qty_in: Decimal
    notes: Optional[str]
    status: str
    entered_by: str
    created_at: datetime


class CylinderBalanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    customer_id: UUID
    product_id: UUID
    balance: Decimal


class PlantLedgerSummaryRow(BaseModel):
    company: CompanyOut
    opening_balance: Decimal
    total_118: Decimal
    total_454: Decimal
    total_kg: Decimal
    total_purchases: Decimal
    total_payments: Decimal
    closing_balance: Decimal
