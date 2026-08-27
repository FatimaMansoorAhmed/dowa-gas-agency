from datetime import datetime
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.utils import next_display_id, resolve_account_or_bucket

router = APIRouter(prefix="/owner-capital", tags=["owner-capital"])


@router.get("", response_model=list[schemas.OwnerCapitalOut])
def list_owner_capital(
    destination_type: Optional[str] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.OwnerCapital).filter(models.OwnerCapital.status == "active")
    if destination_type:
        q = q.filter(models.OwnerCapital.destination_type == destination_type)
    rows = q.order_by(models.OwnerCapital.date.desc(), models.OwnerCapital.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


@router.post("", response_model=schemas.OwnerCapitalOut, status_code=201)
def create_owner_capital(payload: schemas.OwnerCapitalCreate, db: Session = Depends(get_db)):
    """Records owner capital injected into the business and routes it to
    exactly one destination — never both, never an unrelated Sale/Expense:

    - "account": credits ONLY the selected PaymentAccount (Office Cash /
      Home Cash / Dowa Account) with the full amount.
    - "plant": settles a plant's payable directly via the existing
      CompanyPayment accounting (excess -> advance/credit), with no
      PaymentAccount ever touched — the money never routes through Office
      Cash, Home Cash, or the Dowa Account.
    """
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be greater than 0")

    if payload.destination_type == "account":
        if not payload.account_id:
            raise HTTPException(400, "account_id is required when destination_type is 'account'")
        account = resolve_account_or_bucket(db, payload.account_id)
        if not account:
            raise HTTPException(404, "Payment account not found")

        capital = models.OwnerCapital(
            display_id=next_display_id(db, models.OwnerCapital, "RCAP", width=6),
            date=payload.date,
            amount=payload.amount,
            destination_type="account",
            account_id=account.id,
            target_plant_id=None,
            notes=payload.notes,
            status="active",
            entered_by=payload.entered_by,
        )
        db.add(capital)

        # Deposit to Account: increase ONLY the selected account balance.
        # No Sale, no Expense — a pure capital inflow, source recorded as
        # Owner Capital / Re-Investment on this row.
        account.current_balance = account.current_balance + payload.amount
        db.add(account)

        db.commit()
        db.refresh(capital)
        return capital

    # destination_type == "plant"
    if not payload.target_plant_id:
        raise HTTPException(400, "target_plant_id is required when destination_type is 'plant'")
    company = db.query(models.Company).get(payload.target_plant_id)
    if not company:
        raise HTTPException(404, "Plant not found")

    try:
        capital = models.OwnerCapital(
            display_id=next_display_id(db, models.OwnerCapital, "RCAP", width=6),
            date=payload.date,
            amount=payload.amount,
            destination_type="plant",
            account_id=None,
            target_plant_id=payload.target_plant_id,
            notes=payload.notes,
            status="active",
            entered_by=payload.entered_by,
        )
        db.add(capital)
        db.flush()

        # Direct Plant Payment: settle the payable using the exact same
        # accounting as an ordinary CompanyPayment (§ company_payments) —
        # account_id stays null, so this never routes through Office Cash,
        # Home Cash, or the Dowa Account (mirrors the 3-way settlement
        # pattern used by Payment Receipts / Unified Sale).
        excess = payload.amount - company.current_balance
        excess_amount = excess if excess > 0 else None
        company_payment = models.CompanyPayment(
            display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
            date=payload.date,
            company_id=payload.target_plant_id,
            purchase_id=None,
            amount=payload.amount,
            method="owner_capital",
            account_id=None,
            notes=f"Owner Capital (Direct) — Re-Investment {capital.display_id}",
            excess_amount=excess_amount,
            status="active",
            entered_by=payload.entered_by,
            source_owner_capital_id=capital.id,
        )
        db.add(company_payment)

        company.current_balance = company.current_balance - payload.amount
        company.last_overpayment_amount = excess_amount
        company.last_overpayment_date = payload.date if excess_amount else None
        if excess_amount:
            company.account_credit = company.account_credit + excess_amount
        db.add(company)

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Owner Capital re-investment failed, nothing was saved: {e}")

    db.refresh(capital)
    return capital


@router.patch("/{capital_id}/cancel", response_model=schemas.OwnerCapitalOut)
def cancel_owner_capital(capital_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    capital = db.query(models.OwnerCapital).get(capital_id)
    if not capital:
        raise HTTPException(404, "Owner Capital entry not found")
    if capital.status != "active":
        raise HTTPException(400, "Owner Capital entry is already cancelled")

    if capital.destination_type == "account":
        account = db.query(models.PaymentAccount).get(capital.account_id)
        if account:
            account.current_balance = account.current_balance - capital.amount
            db.add(account)
    else:
        company_payment = (
            db.query(models.CompanyPayment)
            .filter(
                models.CompanyPayment.source_owner_capital_id == capital.id,
                models.CompanyPayment.status == "active",
            )
            .first()
        )
        if company_payment:
            company = db.query(models.Company).get(company_payment.company_id)
            company.current_balance = company.current_balance + company_payment.amount
            if company_payment.excess_amount:
                company.account_credit = company.account_credit - company_payment.excess_amount
            db.add(company)
            company_payment.status = "cancelled"
            company_payment.modified_at = datetime.utcnow()
            company_payment.modified_by = by
            db.add(company_payment)

    capital.status = "cancelled"
    capital.modified_at = datetime.utcnow()
    capital.modified_by = by
    db.add(capital)

    db.commit()
    db.refresh(capital)
    return capital
