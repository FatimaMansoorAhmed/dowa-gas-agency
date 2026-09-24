"""Sell Cylinder as a real sale (sale + optional payment + receivable) vs.
Transfer (no money at all). Calls the router functions directly against an
in-memory SQLite DB — no HTTP/auth layer, isolated from Postgres.

Run from backend/: venv/Scripts/python.exe -m pytest app/tests/test_sell_cylinder.py -q
"""
import os
import sys
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app import models, schemas  # noqa: E402
from app.routers import cylinder_returns, ledger  # noqa: E402
from app.timezone import karachi_month_str  # noqa: E402

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
models.Base.metadata.create_all(bind=engine)

USER = SimpleNamespace(name="tester")


@pytest.fixture()
def db():
    s = TestSession()
    for model in (
        models.Expense, models.OwnerDrawings, models.CylinderReturn, models.Payment,
        models.PaymentAccount, models.ExpenseCategory, models.Customer,
    ):
        s.query(model).delete()
    s.commit()
    yield s
    s.close()


def _customer(db, n, cylinders=10):
    c = models.Customer(
        display_id=f"CUST-{n}", name=f"Customer {n}", mobile=f"0300000000{n}",
        empty_cylinders_118=cylinders, empty_cylinders_118_cross=cylinders, empty_cylinders=cylinders,
    )
    db.add(c)
    db.commit()
    return c


def _sell(db, customer, payment_received=0, expense_lines=None, drawings=0):
    payload = schemas.CylinderReturnCreate(
        customer_id=customer.id, cylinder_size="118", cylinder_type="cross", quantity=Decimal("5"),
        mode="cash", origin="sell_cylinder", price_per_cylinder=Decimal("20000"),
        payment_received=Decimal(payment_received), destination_type="account", account_id="office_cash",
        home_expense_lines=expense_lines, owner_drawings_amount=Decimal(drawings), entered_by="tester",
    )
    return cylinder_returns.create_cylinder_return(payload, db, USER)


def _ledger_closing(db, customer):
    summary = ledger.customer_monthly_ledger(customer.id, karachi_month_str(), db)
    return summary.closing_balance


def test_1_sale_100k_payment_0_posts_full_receivable(db):
    c = _customer(db, 1)
    cret = _sell(db, c, payment_received=0)
    db.refresh(c)
    assert cret.total_amount == Decimal("100000")
    assert cret.payment_id is None
    assert c.current_balance == Decimal("100000")
    assert c.empty_cylinders_118_cross == 5
    assert db.query(models.Payment).count() == 0
    assert _ledger_closing(db, c) == Decimal("100000")


def test_2_sale_100k_payment_30k_leaves_70k_outstanding(db):
    c = _customer(db, 2)
    cret = _sell(db, c, payment_received=30000)
    db.refresh(c)
    assert cret.payment_id is not None
    assert c.current_balance == Decimal("70000")
    payment = db.query(models.Payment).one()
    assert payment.amount == Decimal("30000") and payment.net_settlement_amount == Decimal("30000")
    assert _ledger_closing(db, c) == Decimal("70000")


def test_3_sale_100k_payment_100k_settles_fully(db):
    c = _customer(db, 3)
    _sell(db, c, payment_received=100000)
    db.refresh(c)
    assert c.current_balance == Decimal("0")
    assert _ledger_closing(db, c) == Decimal("0")


def test_expenses_and_drawings_come_out_of_payment_not_the_sale(db):
    c = _customer(db, 5)
    cat = models.ExpenseCategory(name="Fuel")
    db.add(cat)
    db.commit()
    lines = [
        schemas.UnifiedSaleHomeExpenseLineIn(category_id=cat.id, amount=Decimal("1000")),
        schemas.UnifiedSaleHomeExpenseLineIn(category_id=cat.id, amount=Decimal("500")),
    ]
    _sell(db, c, payment_received=30000, expense_lines=lines, drawings=2000)
    db.refresh(c)
    assert c.current_balance == Decimal("70000")  # expenses/drawings never change what the customer owes
    assert db.query(models.Expense).count() == 2
    assert db.query(models.OwnerDrawings).one().amount == Decimal("2000")
    assert db.query(models.Payment).one().net_settlement_amount == Decimal("26500")


def test_cancel_reverses_sale_payment_and_cylinder_balance(db):
    c = _customer(db, 6)
    cret = _sell(db, c, payment_received=30000)
    cylinder_returns.cancel_cylinder_return(cret.id, by="tester", db=db)
    db.refresh(c)
    assert c.current_balance == Decimal("0")
    assert c.empty_cylinders_118_cross == 10


def test_expenses_without_payment_rejected(db):
    c = _customer(db, 7)
    cat = models.ExpenseCategory(name="Tea")
    db.add(cat)
    db.commit()
    lines = [schemas.UnifiedSaleHomeExpenseLineIn(category_id=cat.id, amount=Decimal("100"))]
    with pytest.raises(Exception) as exc:
        _sell(db, c, payment_received=0, expense_lines=lines)
    assert "exceeds the payment received" in str(exc.value.detail)


def test_4_transfer_moves_cylinders_but_no_money_ledger_or_payment(db):
    a, b = _customer(db, 8), _customer(db, 9, cylinders=0)
    payload = schemas.CylinderReturnCreate(
        customer_id=a.id, to_customer_id=b.id, cylinder_size="118", cylinder_type="cross",
        quantity=Decimal("5"), mode="transfer", entered_by="tester",
    )
    cret = cylinder_returns.create_cylinder_return(payload, db, USER)
    db.refresh(a)
    db.refresh(b)
    assert cret.total_amount is None and cret.payment_id is None
    assert a.empty_cylinders_118_cross == 5 and b.empty_cylinders_118_cross == 5
    assert a.current_balance == 0 and b.current_balance == 0
    assert db.query(models.Payment).count() == 0
    assert _ledger_closing(db, a) == Decimal("0")


def _sell_one(db, customer, payment_received):
    payload = schemas.CylinderReturnCreate(
        customer_id=customer.id, cylinder_size="118", cylinder_type="cross", quantity=Decimal("1"),
        mode="cash", origin="sell_cylinder", price_per_cylinder=Decimal("10000"),
        payment_received=Decimal(payment_received), destination_type="account", account_id="office_cash",
        entered_by="tester",
    )
    return cylinder_returns.create_cylinder_return(payload, db, USER)


def test_immediate_payment_shown_on_the_sale_row_with_sequential_balance(db):
    c = _customer(db, 10)
    c.opening_balance = Decimal("50000")
    c.current_balance = Decimal("50000")
    db.commit()
    _sell_one(db, c, 1000)
    summary = ledger.customer_monthly_ledger(c.id, karachi_month_str(), db)
    assert summary.opening_balance == Decimal("50000")
    assert len(summary.rows) == 1  # no separate Payment Receipt row
    row = summary.rows[0]
    assert (row.sale_amount, row.payment_amount, row.running_balance) == (Decimal("10000"), Decimal("1000"), Decimal("59000"))
    assert summary.closing_balance == Decimal("59000")
    assert (summary.total_sales, summary.total_payments) == (Decimal("10000"), Decimal("1000"))
    assert db.query(models.Payment).one().amount == Decimal("1000")  # still a real Payment


def test_later_payment_stays_a_separate_row(db):
    from datetime import timedelta
    c = _customer(db, 11)
    cret = _sell_one(db, c, 0)
    db.add(models.Payment(
        display_id="PAY-LATER", date=cret.date + timedelta(minutes=5), customer_id=c.id, amount=Decimal("1000"),
        method="cash", status="active", entered_by="tester",
    ))
    db.commit()
    summary = ledger.customer_monthly_ledger(c.id, karachi_month_str(), db)
    assert len(summary.rows) == 2
    oldest_first = list(reversed(summary.rows))
    assert [(r.sale_amount, r.payment_amount, r.running_balance) for r in oldest_first] == [
        (Decimal("10000"), Decimal("0"), Decimal("10000")),
        (Decimal("0"), Decimal("1000"), Decimal("9000")),
    ]
    assert summary.closing_balance == Decimal("9000")
