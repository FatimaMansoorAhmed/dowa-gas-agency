from datetime import datetime
from decimal import Decimal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.deps import require_active_user, require_csrf
from app.reporting.invoice_pdf import render_sale_invoice_pdf
from app.routers.purchases import _correct_purchase_internal, _reverse_purchase
from app.timezone import KARACHI_TZ
from app.utils import next_display_id, adjust_cylinder_balance, resync_unified_sale_batch_totals

router = APIRouter(prefix="/sales", tags=["sales"], dependencies=[Depends(require_active_user), Depends(require_csrf)])


def _log(db: Session, entity_type: str, entity_id, action: str, by: str, field=None, old=None, new=None):
    db.add(models.AuditLog(
        entity_type=entity_type, entity_id=entity_id, action=action,
        field=field, old_value=str(old) if old is not None else None,
        new_value=str(new) if new is not None else None, performed_by=by,
    ))


@router.get("", response_model=list[schemas.SaleOut])
def list_sales(
    customer_id: UUID | None = Query(None),
    month: str | None = Query(None, description="YYYY-MM, filters by sale.date"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Sale).filter(models.Sale.status == "active")
    if customer_id:
        q = q.filter(models.Sale.customer_id == customer_id)
    rows = q.order_by(models.Sale.date.desc(), models.Sale.created_at.desc()).all()
    if month:
        # Filtered in Python rather than SQL so this behaves identically on
        # SQLite (local dev) and Postgres (production) without dialect-specific date functions.
        rows = [r for r in rows if r.date.strftime("%Y-%m") == month]
    return rows


def _consume_shop_stock_for_emergency_transfer(db: Session, sale: models.Sale, shop_id, product_id, quantity) -> None:
    """FIFO-deducts `quantity` of `product_id` from `shop_id`'s existing
    ShopStockBatch rows, oldest first — same loop pattern as
    routers/shops.py's _apply_shop_sale, reused here rather than
    duplicated by intent. Raises (before any commit) if the shop doesn't
    have enough — the caller's transaction is never partially applied,
    see _apply_sale/create_sale's single db.commit() at the very end."""
    batches = (
        db.query(models.ShopStockBatch)
        .filter(
            models.ShopStockBatch.customer_id == shop_id,
            models.ShopStockBatch.product_id == product_id,
            models.ShopStockBatch.status == "active",
            models.ShopStockBatch.quantity_remaining > 0,
        )
        .order_by(models.ShopStockBatch.transaction_date.asc(), models.ShopStockBatch.created_at.asc())
        .all()
    )
    available = sum((b.quantity_remaining for b in batches), start=Decimal("0"))
    if available < quantity:
        raise HTTPException(
            400,
            f"Insufficient stock at this shop for this product — only {available} cylinder(s) available, {quantity} requested",
        )

    remaining = quantity
    for batch in batches:
        if remaining <= 0:
            break
        take = min(batch.quantity_remaining, remaining)
        batch.quantity_remaining = batch.quantity_remaining - take
        db.add(batch)
        db.add(models.EmergencyTransferBatchConsumption(sale_id=sale.id, shop_stock_batch_id=batch.id, quantity_consumed=take))
        remaining -= take


def _restore_shop_stock_for_emergency_transfer(db: Session, sale: models.Sale) -> None:
    """Undoes exactly what _consume_shop_stock_for_emergency_transfer did —
    restores quantity_remaining onto the EXACT original batches it was
    taken from (never a new adjustment batch), so each batch's
    transaction_date/created_at, and therefore its FIFO ordering, is
    never disturbed by a correction or cancellation (confirmed design,
    see routers/sales.py module notes)."""
    consumptions = (
        db.query(models.EmergencyTransferBatchConsumption)
        .filter(models.EmergencyTransferBatchConsumption.sale_id == sale.id)
        .all()
    )
    for c in consumptions:
        batch = db.query(models.ShopStockBatch).get(c.shop_stock_batch_id)
        if batch:
            batch.quantity_remaining = batch.quantity_remaining + c.quantity_consumed
            db.add(batch)
        db.delete(c)
    # This session is autoflush=False (database.py) — without an explicit
    # flush here, a correction's immediately-following re-deduction query
    # (_consume_shop_stock_for_emergency_transfer, run moments later in the
    # SAME request) would issue its SELECT against the database before
    # these UPDATEs/DELETEs are sent, reading stale pre-restore quantities
    # and silently discarding the restoration. Confirmed by testing: this
    # is exactly what happened before this flush was added.
    db.flush()


def _apply_sale(db: Session, payload: schemas.SaleCreate, entered_by: str) -> models.Sale:
    """Create-time posting logic: builds the Sale row, posts it to the
    customer's balance, and creates its linked CylinderTransaction. Shared
    by create_sale and correct_sale (§1) so both post identically."""
    customer = db.query(models.Customer).get(payload.customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    product = db.query(models.Product).get(payload.product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if payload.company_id:
        company = db.query(models.Company).get(payload.company_id)
        if not company:
            raise HTTPException(404, "Company not found")

    total_kg = payload.quantity * product.weight_kg
    total_amount = payload.quantity * payload.rate_per_cylinder
    rate_per_kg = round(float(payload.rate_per_cylinder) / float(product.weight_kg), 2) if product.weight_kg else None

    # GST on Sale (optional, locked at entry) — gst_amount is computed once
    # here, from total_amount and the rate in effect at this exact moment,
    # then frozen forever on the row (never recalculated later even if
    # gst_rate is edited elsewhere or the concept of a "current" rate
    # changes). grand_total is what actually posts to the customer's
    # balance/ledger below — total_amount itself is never touched, so
    # Dashboard/P&L/Tonnage (all keyed off total_amount) stay unaffected.
    gst_enabled = bool(payload.gst_enabled and payload.gst_rate)
    gst_amount = (total_amount * payload.gst_rate / Decimal("100")) if gst_enabled else Decimal("0")
    grand_total = total_amount + gst_amount

    sale = models.Sale(
        display_id=next_display_id(db, models.Sale, "SALE", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        product_id=payload.product_id,
        company_id=payload.company_id,
        quantity=payload.quantity,
        weight_per_cylinder=product.weight_kg,
        total_kg=total_kg,
        rate_per_kg=rate_per_kg,
        rate_per_cylinder=payload.rate_per_cylinder,
        total_amount=total_amount,
        gst_enabled=gst_enabled,
        gst_rate=payload.gst_rate if gst_enabled else None,
        gst_amount=gst_amount,
        grand_total=grand_total,
        gate_pass_no=payload.gate_pass_no,
        vehicle_no=payload.vehicle_no,
        notes=payload.notes,
        status="active",
        entered_by=entered_by,
        emergency_transfer_shop_id=payload.emergency_transfer_shop_id,
    )
    db.add(sale)
    db.flush()  # assigns sale.id so the audit log row / cylinder txn can reference it

    # Core formula (§13): New Customer Balance = Previous + Sale − Payment.
    # A sale alone only ever adds to what's owed. Posts grand_total (incl.
    # GST, the customer's real liability), never total_amount — GST is
    # money owed by the customer, not business revenue.
    customer.current_balance = customer.current_balance + grand_total
    customer.last_transaction_at = payload.date
    db.add(customer)

    # Every sale dispatches filled cylinders and, optionally, takes back
    # empties on the spot — recorded as a linked CylinderTransaction so the
    # per-customer/per-product cylinder balance never has to be reconciled
    # by hand (§3, critical edge case).
    cylinder_txn = models.CylinderTransaction(
        display_id=next_display_id(db, models.CylinderTransaction, "CYL", width=6),
        date=payload.date,
        customer_id=payload.customer_id,
        product_id=payload.product_id,
        sale_id=sale.id,
        qty_out=payload.quantity,
        qty_in=payload.cylinders_returned,
        status="active",
        entered_by=entered_by,
    )
    db.add(cylinder_txn)
    adjust_cylinder_balance(db, payload.customer_id, payload.product_id, payload.quantity - payload.cylinders_returned)

    # Shop Management (§ Shop spec, "one transaction, no duplication"): a
    # Load is ALWAYS just an ordinary Sale — when the recipient is a shop,
    # this is the ONLY place a stock batch is ever created, atomically with
    # the Sale itself. There is no separate "enter a shop load" endpoint.
    if customer.customer_type == "shop":
        batch = models.ShopStockBatch(
            customer_id=customer.id,
            product_id=product.id,
            source_sale_id=sale.id,
            transaction_date=payload.date,
            quantity_received=payload.quantity,
            quantity_remaining=payload.quantity,
            load_rate_per_kg=(payload.rate_per_cylinder / product.weight_kg) if product.weight_kg else 0,
            status="active",
            entered_by=entered_by,
        )
        db.add(batch)

    # Emergency Transfer (§ Shop — Emergency Transfer) — mutually exclusive
    # with the branch above by construction (the customer here is never a
    # shop; validated in create_emergency_transfer). FIFO-deducts from the
    # NAMED shop's existing stock instead of creating a new batch.
    if payload.emergency_transfer_shop_id:
        _consume_shop_stock_for_emergency_transfer(
            db, sale, payload.emergency_transfer_shop_id, payload.product_id, payload.quantity
        )

    return sale


def _reverse_sale(db: Session, sale: models.Sale, by: str) -> None:
    """Undoes exactly what _apply_sale posted — the customer balance and
    the linked CylinderTransaction — without touching sale.status itself
    (the caller decides "cancelled" vs "corrected"). Shared by cancel_sale
    and correct_sale (§1)."""
    customer = db.query(models.Customer).get(sale.customer_id)
    customer.current_balance = customer.current_balance - sale.grand_total
    db.add(customer)

    cylinder_txn = (
        db.query(models.CylinderTransaction)
        .filter(models.CylinderTransaction.sale_id == sale.id, models.CylinderTransaction.status == "active")
        .first()
    )
    if cylinder_txn:
        adjust_cylinder_balance(db, cylinder_txn.customer_id, cylinder_txn.product_id, -(cylinder_txn.qty_out - cylinder_txn.qty_in))
        cylinder_txn.status = "cancelled"
        cylinder_txn.modified_at = datetime.utcnow()
        cylinder_txn.modified_by = by
        db.add(cylinder_txn)

    # Shop Management — reverse the batch this Load created, if any. Stock
    # must never go negative: refuse if any of it has already been sold
    # (a Shop Sale consumed from it, so quantity_remaining < quantity_received).
    batch = (
        db.query(models.ShopStockBatch)
        .filter(models.ShopStockBatch.source_sale_id == sale.id, models.ShopStockBatch.status == "active")
        .first()
    )
    if batch:
        if batch.quantity_remaining < batch.quantity_received:
            raise HTTPException(
                400,
                "This Load's stock has already been partially or fully sold — "
                "correct/cancel the related Shop Sale(s) first before cancelling or correcting this Load",
            )
        batch.status = "cancelled"
        db.add(batch)

    # Emergency Transfer (§ Shop — Emergency Transfer) — restores stock
    # into the exact original batches it was FIFO-deducted from (see
    # _restore_shop_stock_for_emergency_transfer's docstring for why never
    # a new adjustment batch). No availability guard needed here, unlike
    # the Load-reversal branch above — giving stock back can never make it
    # negative.
    if sale.emergency_transfer_shop_id:
        _restore_shop_stock_for_emergency_transfer(db, sale)


@router.post("", response_model=schemas.SaleOut, status_code=201)
def create_sale(
    payload: schemas.SaleCreate, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    sale = _apply_sale(db, payload, current_user.name)
    _log(db, "sale", sale.id, "create", current_user.name, new=str(sale.total_amount))
    db.commit()
    db.refresh(sale)
    return sale


@router.patch("/{sale_id}/cancel", response_model=schemas.SaleOut)
def cancel_sale(sale_id: UUID, by: str = Query(...), db: Session = Depends(get_db)):
    """Voids a sale without deleting it (§16) and reverses its effect on the
    customer's balance so the ledger stays correct.

    Unified-Sale-linked Purchase cascade (§ Delete/Reverse an Approved
    Sale) — same guard + cascade correct_sale already applies, ported here
    so cancel achieves the SAME full reversal a correction does. Without
    this, cancelling a Unified-Sale Sale line left its paired Purchase —
    and the plant's Company.current_balance — silently stale, and the
    batch's own cached totals (total_selling_amount/grand_total/etc., read
    directly by the Customer/Company Ledger's "unified_sale" row) drifted
    from what's actually still posted (§ resync_unified_sale_batch_totals's
    own docstring, the USALE-000003 stale-total bug)."""
    sale = db.query(models.Sale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Sale not found")
    if sale.status != "active":
        raise HTTPException(400, "Sale is already cancelled")

    linked_purchase = _find_active_linked_purchase(db, sale.unified_sale_id, sale.product_id)
    if linked_purchase:
        existing_payment = (
            db.query(models.CompanyPayment)
            .filter(
                models.CompanyPayment.purchase_id == linked_purchase.id,
                models.CompanyPayment.status == "active",
            )
            .first()
        )
        if existing_payment:
            raise HTTPException(
                400,
                f"Cannot cancel this Sale — its linked Purchase {linked_purchase.display_id} already has "
                f"Company Payment {existing_payment.display_id} recorded against it. Cancel or correct that "
                f"Company Payment first, then retry this cancellation.",
            )

    _reverse_sale(db, sale, by)

    sale.status = "cancelled"
    sale.modified_at = datetime.utcnow()
    sale.modified_by = by
    db.add(sale)

    _log(db, "sale", sale.id, "cancel", by, old="active", new="cancelled")

    if linked_purchase:
        _reverse_purchase(db, linked_purchase)
        linked_purchase.status = "cancelled"
        linked_purchase.modified_at = datetime.utcnow()
        linked_purchase.modified_by = by
        db.add(linked_purchase)

    db.flush()
    resync_unified_sale_batch_totals(db, sale.unified_sale_id)

    db.commit()
    db.refresh(sale)
    return sale


def _find_active_linked_purchase(db: Session, unified_sale_id, product_id) -> "models.Purchase | None":
    """The Purchase counterpart _create_pending_children created alongside
    this Sale line (same unified_sale_id + product_id) — the same match
    key purchaseRateFor() uses on the frontend. Only ever one live match
    expected per (batch, product); a batch with two lines of the same
    product is an existing ambiguity purchaseRateFor() already has too,
    not something this introduces."""
    if not unified_sale_id:
        return None
    return (
        db.query(models.Purchase)
        .filter(
            models.Purchase.unified_sale_id == unified_sale_id,
            models.Purchase.product_id == product_id,
            models.Purchase.status == "active",
        )
        .first()
    )


@router.patch("/{sale_id}/correct", response_model=schemas.SaleOut)
def correct_sale(
    sale_id: UUID, payload: schemas.SaleCorrect, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Ledger Correction (§1): reverses this sale's effect, marks it
    "corrected" (kept forever, never deleted), and posts a brand-new Sale
    with the corrected values — traceable back via corrected_from_id.

    Unified-Sale-linked Purchase cascade (§ Purchase/Plant Ledger sync):
    a Sale created via Unified Sale always has a matching Purchase line
    (same unified_sale_id + product_id, see _create_pending_children) that
    drives the Purchase Plant's payable. Correcting only the Sale side used
    to leave that Purchase — and the plant's Company.current_balance —
    silently stale (e.g. customer ledger shows 3 cylinders sold, plant
    payable still reflects 2 purchased). Guarded upfront by a CompanyPayment
    check: if money has already been paid out against that specific
    Purchase (CompanyPayment.purchase_id), block the whole correction
    rather than let the Purchase amount shift out from under an
    already-made payment — same conservative shape as _reverse_sale's
    ShopStockBatch guard below."""
    if not payload.correction_reason.strip():
        raise HTTPException(400, "correction_reason is required")

    original = db.query(models.Sale).get(sale_id)
    if not original:
        raise HTTPException(404, "Sale not found")
    if original.status != "active":
        raise HTTPException(400, "Only an active sale can be corrected")

    # Pre-flight, before any mutation: only guard when this correction would
    # actually change the linked Purchase's quantity — a correction that
    # leaves quantity untouched (fixing a typo'd gate_pass_no, say) never
    # cascades, so it must never be blocked by a payment against a Purchase
    # it wouldn't even touch.
    linked_purchase = _find_active_linked_purchase(db, original.unified_sale_id, original.product_id)
    if linked_purchase and linked_purchase.quantity != payload.quantity:
        existing_payment = (
            db.query(models.CompanyPayment)
            .filter(
                models.CompanyPayment.purchase_id == linked_purchase.id,
                models.CompanyPayment.status == "active",
            )
            .first()
        )
        if existing_payment:
            raise HTTPException(
                400,
                f"Cannot correct this Sale — its linked Purchase {linked_purchase.display_id} already has "
                f"Company Payment {existing_payment.display_id} recorded against it. Correct or cancel that "
                f"Company Payment first, then retry this correction.",
            )

    _reverse_sale(db, original, current_user.name)

    original.status = "corrected"
    original.corrected_by = current_user.name
    original.corrected_at = datetime.utcnow()
    original.correction_reason = payload.correction_reason
    db.add(original)
    db.flush()

    corrected = _apply_sale(db, payload, current_user.name)
    corrected.corrected_from_id = original.id
    # _apply_sale has no way to know this — SaleCreate/SaleCorrect carry no
    # unified_sale_id field (it's not something the correction form lets
    # anyone edit). Without this, correcting a Unified-Sale-originated Sale
    # silently detaches the repost from its batch: the batch's own line-item
    # list (get_unified_sale) loses the row, and the customer ledger's
    # kind="unified_sale" aggregate row drops its rate — while the repost
    # shows up as an orphaned standalone kind="sale" ledger line instead
    # (routers/ledger.py filters sales by unified_sale_id.is_(None) to pick
    # which bucket a Sale belongs in).
    corrected.unified_sale_id = original.unified_sale_id
    db.add(corrected)
    db.flush()

    # Cascade to the linked Purchase (§ Purchase/Plant Ledger sync) — same
    # reverse-then-repost shape as the Sale/Customer side above, via the
    # shared helper purchases.py also uses for its own /correct endpoint
    # (so the corrected Purchase keeps its unified_sale_id either way).
    # Only when quantity actually differs — see the guard above for why.
    if linked_purchase and linked_purchase.quantity != corrected.quantity:
        old_purchase_total = linked_purchase.total_amount
        purchase_payload = schemas.PurchaseCorrect(
            date=linked_purchase.date, company_id=linked_purchase.company_id,
            product_id=linked_purchase.product_id, quantity=corrected.quantity,
            rate_per_cylinder=linked_purchase.rate_per_cylinder,
            additional_charges=linked_purchase.additional_charges,
            transport_charges=linked_purchase.transport_charges,
            other_charges=linked_purchase.other_charges,
            gate_pass_no=linked_purchase.gate_pass_no, vehicle_no=linked_purchase.vehicle_no,
            driver_name=linked_purchase.driver_name, driver_contact=linked_purchase.driver_contact,
            notes=linked_purchase.notes, entered_by=linked_purchase.entered_by,
            correction_reason=f"Auto-corrected: linked Sale {original.display_id} quantity "
                               f"{original.quantity} -> {corrected.quantity}",
            corrected_by=current_user.name,
        )
        corrected_purchase = _correct_purchase_internal(db, linked_purchase, purchase_payload, current_user.name)
        _log(
            db, "purchase", linked_purchase.id, "correct (cascaded from sale correction)", current_user.name,
            old=str(old_purchase_total), new=str(corrected_purchase.total_amount),
        )

    resync_unified_sale_batch_totals(db, corrected.unified_sale_id)

    _log(db, "sale", original.id, "correct", current_user.name, old=str(original.total_amount), new=str(corrected.total_amount))

    db.commit()
    db.refresh(corrected)
    return corrected


@router.get("/{sale_id}/invoice")
def get_sale_invoice(
    sale_id: UUID, db: Session = Depends(get_db),
    current_user: models.User = Depends(require_active_user),
):
    """Read-only, on-demand invoice PDF (Part B) — never stored to disk.
    Renders straight from the live row, so a corrected Sale (a fresh row
    with its own id) always produces an invoice with its own current
    values; the superseded original is no longer reachable from any active
    list this action is offered from."""
    sale = db.query(models.Sale).get(sale_id)
    if not sale:
        raise HTTPException(404, "Sale not found")
    generated_at = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_sale_invoice_pdf(sale, current_user.name, generated_at)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{sale.display_id}.pdf"'},
    )