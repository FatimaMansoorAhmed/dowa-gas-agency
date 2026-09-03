from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.reporting.invoice_pdf import render_payment_invoice_pdf
from app.timezone import KARACHI_TZ
from app.utils import next_display_id, resync_unified_sale_batch_totals

router = APIRouter(prefix="/payments", tags=["payments"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.PaymentOut])
def list_payments(
    customer_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Payment).filter(models.Payment.status == "active")
    if customer_id:
        q = q.filter(models.Payment.customer_id == customer_id)
    rows = q.order_by(models.Payment.date.desc(), models.Payment.created_at.desc()).all()
    if month:
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


def _apply_payment(db: Session, payload: schemas.PaymentCreate, entered_by: str) -> models.Payment:
    """Create-time posting logic, shared by create_payment and
    correct_payment (§1)."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    account = db.query(models.PaymentAccount).get(payload.account_id)
    if not account:
        raise HTTPException(404, "Payment account not found")
    source_account = None
    if payload.source_account_id:
        source_account = db.query(models.PaymentAccount).get(payload.source_account_id)
        if not source_account:
            raise HTTPException(404, "Source account not found")
    if payload.sale_id:
        sale = db.query(models.Sale).get(payload.sale_id)
        if not sale or sale.customer_id != payload.customer_id:
            raise HTTPException(400, "Sale does not belong to this customer")

    # Overpayment / advance convention (§18, and the same rule used on the
    # Customer page's quick payment action — this is now the single place
    # that logic lives, so both surfaces stay in sync automatically).
    excess = payload.amount - customer.current_balance
    excess_amount = excess if excess > 0 else None

    payment = models.Payment(
        display_id=next_display_id(db, models.Payment, "PAY", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        sale_id=payload.sale_id,
        amount=payload.amount,
        method=payload.method,
        account_id=payload.account_id,
        source_account_id=payload.source_account_id,
        reference_no=payload.reference_no,
        received_by=payload.received_by,
        notes=payload.notes,
        excess_amount=excess_amount,
        status="active",
        entered_by=entered_by,
    )
    db.add(payment)

    # Customer balance: New Balance = Previous − Payment (§13). Going
    # negative here IS the advance/credit — never clamped to zero.
    customer.current_balance = customer.current_balance - payload.amount
    customer.last_transaction_at = payload.date
    customer.last_overpayment_amount = excess_amount
    customer.last_overpayment_date = payload.date if excess_amount else None
    if excess_amount:
        customer.account_credit = customer.account_credit + excess_amount
    db.add(customer)

    # Cash/Bank ledger: money IN (§8, §12) — a customer payment increases
    # the account it was received into. Never touches an expense account.
    account.current_balance = account.current_balance + payload.amount
    db.add(account)

    # Shop Cash Money Routing (§3) — when the payer is a shop paying down
    # its Dowa payable out of its own tracked cash (or another chosen
    # account), that source account is decremented in the SAME transaction.
    # Null for an ordinary individual customer's payment — no tracked
    # source, nothing to debit here.
    if source_account:
        source_account.current_balance = source_account.current_balance - payload.amount
        db.add(source_account)

    return payment


def _reverse_payment(db: Session, payment: models.Payment) -> None:
    """Undoes exactly what _apply_payment posted. Shared by cancel_payment
    and correct_payment (§1)."""
    customer = db.query(models.Customer).get(payment.customer_id)
    customer.current_balance = customer.current_balance + payment.amount
    if payment.excess_amount:
        customer.account_credit = customer.account_credit - payment.excess_amount
    db.add(customer)

    # account_id is null for a Payment whose money hasn't landed in any
    # Dowa account yet (e.g. a Unified Sale's total_credit_received,
    # routed onward at settlement — see approve_unified_sale_sale) —
    # same "null means no tracked destination to touch" reasoning the
    # source_account_id guard below already applies. Skip the mutation
    # entirely rather than crash on a None account.
    if payment.account_id:
        account = db.query(models.PaymentAccount).get(payment.account_id)
        if account:
            account.current_balance = account.current_balance - payment.amount
            db.add(account)

    if payment.source_account_id:
        source_account = db.query(models.PaymentAccount).get(payment.source_account_id)
        if source_account:
            source_account.current_balance = source_account.current_balance + payment.amount
            db.add(source_account)


@router.post("", response_model=schemas.PaymentOut, status_code=201)
def create_payment(
    payload: schemas.PaymentCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    payment = _apply_payment(db, payload, current_user.name)
    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/cancel", response_model=schemas.PaymentOut)
def cancel_payment(payment_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    payment = db.query(models.Payment).get(payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    if payment.status != "active":
        raise HTTPException(400, "Payment is already cancelled")

    _reverse_payment(db, payment)

    payment.status = "cancelled"
    payment.modified_at = datetime.utcnow()
    payment.modified_by = by
    db.add(payment)

    db.commit()
    db.refresh(payment)
    return payment


@router.patch("/{payment_id}/correct", response_model=schemas.PaymentOut)
def correct_payment(
    payment_id: UUID, payload: schemas.PaymentCorrect, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Ledger Correction (§1) — see correct_sale in routers/sales.py for
    the full pattern this mirrors."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.Payment).get(payment_id)
    if not original:
        raise HTTPException(404, "Payment not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active payment can be corrected")

    _reverse_payment(db, original)

    original.status = "corrected"
    original.corrected_by = current_user.name
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_payment(db, payload, current_user.name)
    corrected.corrected_from_id = original.id
    # Same fix as correct_sale in routers/sales.py — preserve the Unified
    # Sale batch link across a correction, since PaymentCreate/PaymentCorrect
    # carry no unified_sale_id field for the form to send it.
    corrected.unified_sale_id = original.unified_sale_id
    db.add(corrected)
    db.flush()
    resync_unified_sale_batch_totals(db, corrected.unified_sale_id)

    db.commit()
    db.refresh(corrected)
    return corrected


@router.get("/{payment_id}/invoice")
def get_payment_invoice(
    payment_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Read-only, on-demand invoice PDF (Part B) — never stored to disk.
    See get_sale_invoice in routers/sales.py for why a corrected record
    always renders its own current values."""
    payment = db.query(models.Payment).get(payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_payment_invoice_pdf(payment, current_user.name, generated_at)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{payment.display_id}.pdf"'},
    )