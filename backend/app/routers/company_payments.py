from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.reporting.invoice_pdf import render_company_payment_invoice_pdf
from app.timezone import KARACHI_TZ
from app.utils import next_display_id

router = APIRouter(prefix="/company-payments", tags=["company-payments"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.CompanyPaymentOut])
def list_company_payments(
    company_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.CompanyPayment).filter(models.CompanyPayment.status == "active")
    if company_id:
        q = q.filter(models.CompanyPayment.company_id == company_id)
    rows = q.order_by(models.CompanyPayment.date.desc(), models.CompanyPayment.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


def _apply_company_payment(db: Session, payload: schemas.CompanyPaymentCreate, entered_by: str) -> models.CompanyPayment:
    """Create-time posting logic, shared by create_company_payment and
    correct_company_payment (§1)."""
    company = db.query(models.Company).get(payload.company_id)
    if not company:
        raise HTTPException(404, "Company not found")

    account = None
    if payload.account_id:
        account = db.query(models.PaymentAccount).get(payload.account_id)
        if not account:
            raise HTTPException(404, "Payment account not found")

    if payload.purchase_id:
        purchase = db.query(models.Purchase).get(payload.purchase_id)
        if not purchase or purchase.company_id != payload.company_id:
            raise HTTPException(400, "Purchase does not belong to this company")

    # Same advance/overpayment convention as the customer side, mirrored:
    # paying a plant more than it's owed becomes account_credit (an
    # advance to that plant), never a silently-wrong negative payable.
    excess = payload.amount - company.current_balance
    excess_amount = excess if excess > 0 else None

    payment = models.CompanyPayment(
        display_id=next_display_id(db, models.CompanyPayment, "CPAY", width=6),
        date=payload.date,
        company_id=payload.company_id,
        purchase_id=payload.purchase_id,
        amount=payload.amount,
        method=payload.method,
        account_id=payload.account_id,
        reference_no=payload.reference_no,
        paid_by=payload.paid_by,
        notes=payload.notes,
        excess_amount=excess_amount,
        status="active",
        entered_by=entered_by,
    )
    db.add(payment)

    # Payable goes down either way. The account only moves if one was
    # actually funded — a 3-way settlement (account_id null) means this
    # money went straight from customer to plant, never through Dowa's
    # own cash/bank, so there's nothing to debit there.
    company.current_balance = company.current_balance - payload.amount
    company.last_overpayment_amount = excess_amount
    company.last_overpayment_date = payload.date if excess_amount else None
    if excess_amount:
        company.account_credit = company.account_credit + excess_amount
    db.add(company)

    if account:
        account.current_balance = account.current_balance - payload.amount
        db.add(account)

    return payment


def _reverse_company_payment(db: Session, payment: models.CompanyPayment) -> None:
    """Undoes exactly what _apply_company_payment posted. Shared by
    cancel_company_payment and correct_company_payment (§1)."""
    company = db.query(models.Company).get(payment.company_id)
    company.current_balance = company.current_balance + payment.amount
    if payment.excess_amount:
        company.account_credit = company.account_credit - payment.excess_amount
    db.add(company)

    account = db.query(models.PaymentAccount).get(payment.account_id)
    if account:
        account.current_balance = account.current_balance + payment.amount
        db.add(account)


@router.post("", response_model=schemas.CompanyPaymentOut, status_code=201)
def create_company_payment(
    payload: schemas.CompanyPaymentCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    payment = _apply_company_payment(db, payload, current_user.name)
    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/cancel", response_model=schemas.CompanyPaymentOut)
def cancel_company_payment(payment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    payment = db.query(models.CompanyPayment).get(payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status != "active":
        raise HTTPException(400, "Payment is already cancelled")

    _reverse_company_payment(db, payment)

    payment.status = "cancelled"
    payment.modified_at = datetime.utcnow()
    payment.modified_by = by
    db.add(payment)

    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/correct", response_model=schemas.CompanyPaymentOut)
def correct_company_payment(
    payment_id: UUID, payload: schemas.CompanyPaymentCorrect, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Ledger Correction (§1) — see correct_sale in routers/sales.py for
    the full pattern this mirrors."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.CompanyPayment).get(payment_id)
    if not original:
        raise HTTPException(404, "Payment not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active payment can be corrected")

    _reverse_company_payment(db, original)

    original.status = "corrected"
    original.corrected_by = current_user.name
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_company_payment(db, payload, current_user.name)
    corrected.corrected_from_id = original.id
    db.add(corrected)

    db.commit()
    db.refresh(corrected)
    return corrected


@router.get("/{payment_id}/invoice")
def get_company_payment_invoice(
    payment_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Read-only, on-demand invoice PDF (Part B) — never stored to disk.
    See get_sale_invoice in routers/sales.py for why a corrected record
    always renders its own current values."""
    cp = db.query(models.CompanyPayment).get(payment_id)
    if not cp:
        raise HTTPException(404, "Payment not found")
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_company_payment_invoice_pdf(cp, current_user.name, generated_at)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{cp.display_id}.pdf"'},
    )