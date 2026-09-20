from datetime import datetime
from uuid import UUID
import json as _json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf, require_owner
from app.timezone import karachi_month_str
from app.utils import log_audit, pending_block

router = APIRouter(prefix="/companies", tags=["companies"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


def _current_month() -> str:
    return karachi_month_str()


def _roll_month_if_needed(company: models.Company, db: Session):
    """Same monthly rollover as Customer: opening balance for the payable
    resets to whatever the running balance was at month start, so the
    Plant Ledger's monthly view is always internally consistent."""
    month = _current_month()
    if company.opening_balance_month != month:
        company.opening_balance = company.current_balance
        company.opening_balance_month = month
        db.add(company)
        db.commit()
        db.refresh(company)
    return company


@router.get("", response_model=list[schemas.CompanyOut])
def list_companies(db: Session = Depends(get_db)):
    companies = db.query(models.Company).order_by(models.Company.name).all()
    return [_roll_month_if_needed(c, db) for c in companies]


@router.get("/{company_id}", response_model=schemas.CompanyOut)
def get_company(company_id: UUID, db: Session = Depends(get_db)):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    return _roll_month_if_needed(company, db)


# RATE DASHBOARD VISIBILITY (§ Rate Dashboard part b) — scoped purely to
# whether this company's card shows on the Rate Dashboard. Does not touch
# Company.active-style status (there isn't one) or any RateEntry row — the
# company keeps working everywhere else (Purchases, Sales, Plant Ledger,
# Executive Dashboard). Same PATCH-toggle shape as
# payment_accounts.deactivate_account, reversible in either direction.
@router.patch("/{company_id}/hide-from-rate-dashboard", response_model=schemas.CompanyOut)
def hide_company_from_rate_dashboard(company_id: UUID, db: Session = Depends(get_db)):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    company.hidden_from_rate_dashboard = True
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


@router.patch("/{company_id}/show-on-rate-dashboard", response_model=schemas.CompanyOut)
def show_company_on_rate_dashboard(company_id: UUID, db: Session = Depends(get_db)):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    company.hidden_from_rate_dashboard = False
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


@router.post("", response_model=schemas.CompanyOut, status_code=201)
def create_company(payload: schemas.CompanyCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Company).filter(models.Company.name == payload.name).first()
    if existing:
        raise HTTPException(400, "Company already exists")
    company = models.Company(
        name=payload.name,
        mobile=payload.mobile,
        opening_balance=payload.opening_balance,
        opening_balance_date=payload.opening_balance_date or datetime.utcnow(),
        current_balance=payload.opening_balance,
        opening_balance_month=_current_month(),
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


# CORRECT OPENING BALANCE (§ Opening Balance) — same pattern as Customer's
# (routers/customers.py::correct_customer_opening_balance): edit the stored
# anchor, shift current_balance by the identical delta so it never drifts
# from what company_monthly_ledger derives, log to AuditLog with a
# required reason. NOTE (flagged during the Opening Balance audit, left
# out of scope for this change): unlike Customer, a Company's
# opening_balance is a rolling monthly snapshot (_roll_month_if_needed
# above resets it to current_balance on the next request after a month
# rolls over) rather than a fixed year-anchor — company_monthly_ledger's
# derivation is only correct for whichever month's rollover most recently
# ran, a pre-existing bug unrelated to this endpoint.
@router.patch("/{company_id}/opening-balance", response_model=schemas.CompanyOut)
def correct_company_opening_balance(
    company_id: UUID,
    payload: schemas.OpeningBalanceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")

    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required to correct the Opening Balance")

    old_value = company.opening_balance
    delta = payload.new_value - old_value
    company.opening_balance = payload.new_value
    company.current_balance = company.current_balance + delta
    db.add(company)
    log_audit(db, "company", company.id, "update", current_user.name,
              field="opening_balance", old=old_value, new=payload.new_value, reason=reason)
    db.commit()
    db.refresh(company)
    return company


@router.delete("/{company_id}")
def delete_company(
    company_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_owner),
):
    """Delete Company/Plant — the Company row is HARD-deleted and its
    outstanding payable is written off. Its Parties and their RateEntry
    history are deleted along with it (unlike transactions, which all stay).
    Every past Purchase/CompanyPayment/Sale/Unified Sale keeps pointing at
    the now-dangling UUID (FK constraints dropped, see migrations) and gets
    a permanent company_label snapshot for display; nothing already settled
    is reversed. Blocked while anything is still pending against this
    plant. Owner-only, no password gate."""
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")

    B = models.UnifiedSaleBatch
    pending_batches = (
        db.query(B)
        .filter(
            or_(B.company_id == company_id, B.target_plant_id == company_id),
            or_(B.sale_status == "pending", B.payment_status == "pending"),
        ).all()
    )
    pending_purchases = db.query(models.Purchase).filter(models.Purchase.company_id == company_id, models.Purchase.status == "pending").all()
    pending_cpay = db.query(models.CompanyPayment).filter(models.CompanyPayment.company_id == company_id, models.CompanyPayment.status == "pending").all()
    pending_sales = db.query(models.Sale).filter(models.Sale.company_id == company_id, models.Sale.status == "pending").all()
    pending_block([
        ("Unified Sale", [b.display_id for b in pending_batches]),
        ("Purchase", [x.display_id for x in pending_purchases]),
        ("Company Payment", [x.display_id for x in pending_cpay]),
        ("Sale", [x.display_id for x in pending_sales]),
    ])

    label = company.name
    written_off = {
        "current_balance": str(company.current_balance),
        "account_credit": str(company.account_credit or 0),
    }
    party_ids = [p.id for p in db.query(models.Party).filter(models.Party.company_id == company_id).all()]
    try:
        for model in (models.Sale, models.Purchase, models.CompanyPayment, models.UnifiedSaleBatch):
            db.query(model).filter(model.company_id == company_id).update(
                {model.company_label: label}, synchronize_session=False,
            )
        db.query(models.RateEntry).filter(models.RateEntry.company_id == company_id).delete(synchronize_session=False)
        db.query(models.Party).filter(models.Party.company_id == company_id).delete(synchronize_session=False)
        log_audit(
            db, "company", company.id, "delete", current_user.name,
            field="written_off", old=_json.dumps({**written_off, "parties_deleted": len(party_ids)}), new="0",
            reason=f"Deleted plant {label}; outstanding payable written off, parties and rate history deleted",
        )
        db.delete(company)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(400, f"Cannot delete — this plant is still referenced by records this delete does not cover: {e.orig}")
    return {"deleted": True, "name": label, "written_off": written_off}
