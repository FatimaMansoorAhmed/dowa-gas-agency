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
    # § Daily Report clean columns — structured Cylinder Type/Quantity,
    # promoted out of the free-text `description` string (which used to be
    # the only place a row's quantity showed up, e.g. "Sale × 2.0000" with
    # no product/cylinder-size context at all). Mirrors the exact same
    # fix already applied to the Shop Statement (ShopTransactionRow.
    # cylinder_weight/quantity/unit) — None for a row with no real
    # product/quantity concept (a Payment, Expense, OwnerDrawings, ...),
    # rendered as "-" by the PDF, same convention as that statement uses.
    cylinder_weight: Optional[Decimal] = None  # physical weight snapshot, e.g. 11.80/45.40
    quantity: Optional[Decimal] = None
    unit: Optional[str] = None  # "cylinder" | "kg" — only ever "kg" for a Shop Sale entered by KG


@dataclass
class ReportSection:
    key: str
    label: str
    rows: list[ReportableTransaction] = field(default_factory=list)
    financial_total: Optional[Decimal] = None
