from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf

router = APIRouter(prefix="/payment-accounts", tags=["payment-accounts"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


@router.get("", response_model=list[schemas.PaymentAccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(models.PaymentAccount).order_by(models.PaymentAccount.name).all()


@router.post("", response_model=schemas.PaymentAccountOut, status_code=201)
def create_account(payload: schemas.PaymentAccountCreate, db: Session = Depends(get_db)):
    existing = db.query(models.PaymentAccount).filter(models.PaymentAccount.name == payload.name).first()
    if existing:
        raise HTTPException(400, "Account already exists")
    account = models.PaymentAccount(
        name=payload.name, kind=payload.kind, account_type=payload.account_type, shop_id=payload.shop_id,
        opening_balance=payload.opening_balance, current_balance=payload.opening_balance,
        active="active",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.post("/transfer", response_model=schemas.AccountTransferOut)
def transfer_between_accounts(
    payload: schemas.AccountTransferCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Moves real money between two PaymentAccount rows the agency actually
    holds (e.g. Office Cash -> Dowa Account) — debits the source and
    credits the destination in one transaction. No overdraft: the source
    must already hold at least `amount`."""
    if payload.from_account_id == payload.to_account_id:
        raise HTTPException(400, "Source and destination accounts must be different")
    if payload.amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    from_account = db.query(models.PaymentAccount).get(payload.from_account_id)
    if not from_account:
        raise HTTPException(404, "Source account not found")
    to_account = db.query(models.PaymentAccount).get(payload.to_account_id)
    if not to_account:
        raise HTTPException(404, "Destination account not found")

    if from_account.current_balance < payload.amount:
        raise HTTPException(400, "Insufficient balance in source account")

    from_account.current_balance = from_account.current_balance - payload.amount
    to_account.current_balance = to_account.current_balance + payload.amount
    db.add(from_account)
    db.add(to_account)

    # Persisted audit-trail row (§ Transfer Audit Trail) — previously this
    # endpoint only mutated the two balances with no queryable history at
    # all. Written atomically with the balance mutations above.
    db.add(models.AccountTransfer(
        from_account_id=from_account.id, to_account_id=to_account.id,
        amount=payload.amount, notes=payload.notes, entered_by=current_user.name,
    ))

    db.commit()
    db.refresh(from_account)
    db.refresh(to_account)
    return schemas.AccountTransferOut(from_account=from_account, to_account=to_account)


@router.get("/transfers", response_model=list[schemas.AccountTransferRecordOut])
def list_transfers(
    account_id: UUID | None = None,
    db: Session = Depends(get_db),
):
    """Audit trail for /payment-accounts/transfer — optionally scoped to
    transfers touching one specific account (either side)."""
    q = db.query(models.AccountTransfer)
    if account_id:
        q = q.filter(
            (models.AccountTransfer.from_account_id == account_id) | (models.AccountTransfer.to_account_id == account_id)
        )
    return q.order_by(models.AccountTransfer.date.desc(), models.AccountTransfer.created_at.desc()).all()


@router.patch("/{account_id}/deactivate", response_model=schemas.PaymentAccountOut)
def deactivate_account(account_id: UUID, db: Session = Depends(get_db)):
    account = db.query(models.PaymentAccount).get(account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    account.active = "inactive"
    db.add(account)
    db.commit()
    db.refresh(account)
    return account