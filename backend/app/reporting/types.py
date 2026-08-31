"""Shared shapes every reporting adapter maps its model into (§8 Future-Proof
Reporting). Kept deliberately generic — the daily aggregator and PDF/print
renderers only ever work with these, never with a specific model, which is
what lets a future module register itself without touching either."""
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID


@dataclass
class ReportableTransaction:
    id: UUID
    type: str  # e.g. "sale", "purchase", "payment", "company_payment", ...
    date: datetime
    display_id: str
    description: str
    entered_by: str
    status: str
    amount: Optional[Decimal] = None
    customer: Optional[str] = None
    plant: Optional[str] = None
    reference: Optional[str] = None
    approval_info: Optional[str] = None


@dataclass
class ReportSection:
    key: str
    label: str
    rows: list[ReportableTransaction] = field(default_factory=list)
    financial_total: Optional[Decimal] = None
