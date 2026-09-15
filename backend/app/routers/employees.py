from datetime import datetime
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.utils import next_display_id
from app.timezone import karachi_month_str

router = APIRouter(prefix="/employees", tags=["employees"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


def _next_month_str(month: str) -> str:
    year, mo = int(month[:4]), int(month[5:7])
    return f"{year + 1}-01" if mo == 12 else f"{year}-{mo + 1:02d}"


def _accrue_if_needed(db: Session, employee: models.Employee, by: str = "system") -> None:
    """Lazily catches this employee's accrued salary up to the real
    current month — see EmployeeSalaryAccrual's own docstring for why this
    creates one persisted, immutable row per missed month (frozen at
    whatever monthly_salary was then) rather than just bumping
    current_balance by a number. Idempotent per month via the "does a row
    already exist for (employee, month)" check — never a while-loop
    boundary alone — so calling this twice in the same month, or on an
    employee who's already fully caught up, is always a safe no-op. Only
    for status=='active' employees — an inactive one simply stops
    accruing new salary but keeps whatever balance/history they have.

    opening_balance/opening_balance_month end up representing "the balance
    at the START of the current month, before the current month's own
    accrual" — that accrual is only rolled into current_balance, never
    into opening_balance, exactly mirroring how a Load/Purchase posts on
    top of Company's own opening_balance rather than being folded into it."""
    if employee.status != "active":
        return

    current_month = karachi_month_str()
    month_cursor = employee.opening_balance_month

    while month_cursor <= current_month:
        existing = (
            db.query(models.EmployeeSalaryAccrual)
            .filter(
                models.EmployeeSalaryAccrual.employee_id == employee.id,
                models.EmployeeSalaryAccrual.month == month_cursor,
            )
            .first()
        )
        if not existing:
            db.add(models.EmployeeSalaryAccrual(
                display_id=next_display_id(db, models.EmployeeSalaryAccrual, "SALACC", width=6),
                employee_id=employee.id,
                month=month_cursor,
                date=datetime.strptime(month_cursor, "%Y-%m"),
                amount=employee.monthly_salary,
                status="active",
                entered_by=by,
            ))
            db.flush()
            employee.current_balance = employee.current_balance + employee.monthly_salary

        if month_cursor < current_month:
            # This month is now fully in the past — roll the opening
            # snapshot past it, same as Company's own monthly rollover.
            employee.opening_balance = employee.current_balance

        month_cursor = _next_month_str(month_cursor)

    employee.opening_balance_month = current_month
    db.add(employee)


@router.get("", response_model=list[schemas.EmployeeOut])
def list_employees(db: Session = Depends(get_db)):
    employees = db.query(models.Employee).order_by(models.Employee.name).all()
    for e in employees:
        _accrue_if_needed(db, e)
    db.commit()
    for e in employees:
        db.refresh(e)
    return employees


@router.post("", response_model=schemas.EmployeeOut, status_code=201)
def create_employee(
    payload: schemas.EmployeeCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    if payload.monthly_salary <= 0:
        raise HTTPException(400, "Monthly salary must be positive")
    employee = models.Employee(
        name=payload.name,
        monthly_salary=payload.monthly_salary,
        status="active",
        opening_balance=Decimal("0"),
        opening_balance_month=karachi_month_str(),
        current_balance=Decimal("0"),
        entered_by=current_user.name,
    )
    db.add(employee)
    db.flush()
    # Post this employee's very first month immediately — otherwise the
    # first time anyone sees them isn't reflected until _accrue_if_needed
    # runs on a later read, which is still correct but leaves the "just
    # created" moment showing a confusing 0 balance.
    _accrue_if_needed(db, employee, by=current_user.name)
    db.commit()
    db.refresh(employee)
    return employee


@router.get("/{employee_id}", response_model=schemas.EmployeeOut)
def get_employee(employee_id: UUID, db: Session = Depends(get_db)):
    employee = db.query(models.Employee).get(employee_id)
    if not employee:
        raise HTTPException(404, "Employee not found")
    _accrue_if_needed(db, employee)
    db.commit()
    db.refresh(employee)
    return employee


@router.patch("/{employee_id}", response_model=schemas.EmployeeOut)
def update_employee(employee_id: UUID, payload: schemas.EmployeeUpdate, db: Session = Depends(get_db)):
    """A salary correction previously only affected FUTURE months —
    EmployeeSalaryAccrual rows are immutable-once-posted by design (see
    _accrue_if_needed's docstring), so changing monthly_salary here used to
    leave the CURRENT month's already-frozen accrual/current_balance
    untouched, making the edit look like a no-op until next month. Fixed
    by correcting the current month's own accrual row (and the balance it
    fed) by the exact delta when one already exists — mirrors the
    Sale/Payment "correct" convention elsewhere in this app (fix the
    record actually affected, never touch anything already rolled into a
    past month's closed opening_balance)."""
    employee = db.query(models.Employee).get(employee_id)
    if not employee:
        raise HTTPException(404, "Employee not found")

    if payload.monthly_salary is not None:
        if payload.monthly_salary <= 0:
            raise HTTPException(400, "Monthly salary must be positive")
        # Catch up to the current month FIRST, at the OLD salary (same
        # lazy accrual every other endpoint here already relies on) — so
        # there's a current-month row to correct below even if this is
        # the first read of the month.
        _accrue_if_needed(db, employee)
        current_month = karachi_month_str()
        current_accrual = (
            db.query(models.EmployeeSalaryAccrual)
            .filter(
                models.EmployeeSalaryAccrual.employee_id == employee.id,
                models.EmployeeSalaryAccrual.month == current_month,
                models.EmployeeSalaryAccrual.status == "active",
            )
            .first()
        )
        if current_accrual is not None and current_accrual.amount != payload.monthly_salary:
            delta = payload.monthly_salary - current_accrual.amount
            current_accrual.amount = payload.monthly_salary
            employee.current_balance = employee.current_balance + delta
            db.add(current_accrual)
        employee.monthly_salary = payload.monthly_salary

    if payload.status is not None:
        employee.status = payload.status

    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


@router.get("/{employee_id}/ledger", response_model=schemas.EmployeeLedgerSummary)
def get_employee_ledger(
    employee_id: UUID,
    month: str = Query(..., description="YYYY-MM, e.g. 2026-09"),
    db: Session = Depends(get_db),
):
    """Mirrors /ledger/customer/{id} and /ledger/company/{id} exactly —
    same rolling-monthly-opening-balance convention (and the same
    known limitation already documented on company_monthly_ledger:
    correct for the current month / most recent rollover, not
    necessarily every arbitrarily-old past month)."""
    employee = db.query(models.Employee).get(employee_id)
    if not employee:
        raise HTTPException(404, "Employee not found")
    _accrue_if_needed(db, employee)
    db.commit()
    db.refresh(employee)

    month_start = datetime.strptime(month, "%Y-%m")
    year, mo = month_start.year, month_start.month
    next_month = datetime(year + 1, 1, 1) if mo == 12 else datetime(year, mo + 1, 1)

    all_accruals = (
        db.query(models.EmployeeSalaryAccrual)
        .filter(models.EmployeeSalaryAccrual.employee_id == employee_id, models.EmployeeSalaryAccrual.status == "active")
        .order_by(models.EmployeeSalaryAccrual.date)
        .all()
    )
    all_payments = (
        db.query(models.Expense)
        .filter(models.Expense.employee_id == employee_id, models.Expense.status == "active")
        .order_by(models.Expense.date)
        .all()
    )

    opening = employee.opening_balance
    for a in all_accruals:
        if a.date < month_start:
            opening += a.amount
    for p in all_payments:
        if p.date < month_start:
            opening -= p.amount

    month_accruals = [a for a in all_accruals if month_start <= a.date < next_month]
    month_payments = [p for p in all_payments if month_start <= p.date < next_month]

    events = (
        [{"date": a.date, "kind": "accrual", "obj": a} for a in month_accruals]
        + [{"date": p.date, "kind": "payment", "obj": p} for p in month_payments]
    )
    events.sort(key=lambda e: e["date"])

    rows: list[schemas.EmployeeLedgerRow] = []
    running = opening
    total_accrued = Decimal("0")
    total_paid = Decimal("0")
    for e in events:
        if e["kind"] == "accrual":
            a: models.EmployeeSalaryAccrual = e["obj"]
            running += a.amount
            total_accrued += a.amount
            rows.append(schemas.EmployeeLedgerRow(
                date=a.date, kind="accrual", ref_id=a.id, display_id=a.display_id,
                description=f"Salary — {a.month}",
                accrued_amount=a.amount, paid_amount=Decimal("0"),
                running_balance=running, entered_by=a.entered_by,
            ))
        else:
            p: models.Expense = e["obj"]
            running -= p.amount
            total_paid += p.amount
            rows.append(schemas.EmployeeLedgerRow(
                date=p.date, kind="payment", ref_id=p.id, display_id=p.display_id,
                description=f"Salary Paid · {p.method}" + (f" — {p.description}" if p.description else ""),
                accrued_amount=Decimal("0"), paid_amount=p.amount,
                running_balance=running, entered_by=p.entered_by,
            ))

    return schemas.EmployeeLedgerSummary(
        employee=employee, month=month, opening_balance=opening,
        total_accrued=total_accrued, total_paid=total_paid,
        closing_balance=running, rows=rows,
    )
