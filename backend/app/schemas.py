from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# ---------- Company ----------
class CompanyCreate(BaseModel):
    name: str


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str


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
    address: Optional[str] = None
    opening_balance: Decimal = Decimal("0")


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    mobile: str
    address: Optional[str]
    opening_balance: Decimal
    current_balance: Decimal
    status: str
    created_at: datetime
    opening_balance_month: str
    last_overpayment_amount: Optional[Decimal] = None
    last_overpayment_date: Optional[datetime] = None


class CustomerAdjust(BaseModel):
    kind: Literal["payment", "charge"]
    amount: Decimal
