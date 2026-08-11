import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Numeric, DateTime, ForeignKey, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator, CHAR

from app.database import Base


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
    name = Column(String, nullable=False)
    mobile = Column(String, nullable=False)
    address = Column(String, nullable=True)
    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    current_balance = Column(Numeric(14, 2), nullable=False, default=0)
    status = Column(String, nullable=False, default="active")  # active | inactive
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    opening_balance_month = Column(String, nullable=False, default=lambda: datetime.utcnow().strftime("%Y-%m"))

    # Advance convention: a NEGATIVE current_balance means the customer has
    # paid ahead of what they owe. It must never be treated as a debt.
    last_overpayment_amount = Column(Numeric(14, 2), nullable=True)
    last_overpayment_date = Column(DateTime, nullable=True)
