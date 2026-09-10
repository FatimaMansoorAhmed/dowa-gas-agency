"""Renders per-record Invoice PDFs (Part B) for Sale, Payment, Purchase,
CompanyPayment and ShopSale, plus the Customer Statement (full ledger
history for one customer/month) — read-only, presentation-only, generated
on-demand and never written to disk (unlike the stored Daily Report in
pdf.py). Reuses reportlab (already a dependency). Layout follows a standard
commercial invoice: logo/company block + address block header, a details
box (Invoice No/Date/reference fields), an itemized table, totals, amount
in words, and a signature block footer.

Each render_*_invoice_pdf takes the live SQLAlchemy row straight from the
router (never a cached/pydantic copy), so a corrected record — which is
already the only "active" row a user can reach an invoice action from —
always renders its own current field values, never a superseded original.
render_customer_statement_pdf is the one exception — it takes the already-
built CustomerLedgerSummary (a Pydantic schema, not a live row) straight
from app.routers.ledger.customer_monthly_ledger, so the PDF can never show
numbers that disagree with what the Customer Ledger screen has on screen
(same guarantee as the Daily Report PDF in pdf.py).
"""
import base64
import io
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT, TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from app import schemas

# ============================================================================
# PLACEHOLDER — replace with real business details before this goes live.
# Every field below is dummy/placeholder text, not a verified real value.
# GST Regn No / NTN are deliberately left as an explicit "[TO BE ADDED]"
# marker rather than a fabricated-but-plausible-looking number — a fake tax
# ID printed on a real invoice is worse than an obviously blank one. This is
# the ONE place these fields live; every render function below reads from
# here, so swapping in real values later is a one-line edit per field, not a
# hunt through the file.
# ============================================================================
BUSINESS = {
    "name": "DOWA Gas Agency",
    "tagline": "Agency · Karachi",
    "address_lines": [
        "[Address line 1 — TO BE ADDED]",
        "[Address line 2 — TO BE ADDED]",
        "Karachi, Pakistan",
    ],
    "phone": "Phone: [TO BE ADDED]",
    "email": "Email: [TO BE ADDED]",
    "gst_regn_no": "GST Regn No: [TO BE ADDED]",
    "ntn": "NTN: [TO BE ADDED]",
}

PAGE_WIDTH = A4[0] - 28 * mm  # usable width after 14mm left/right margins

# ============================================================================
# LOGO — embedded, not read from disk at request time. backend (Railway) and
# frontend (Vercel) are separately-deployed services (see app/deps.py's
# require_csrf docstring), so the backend process cannot rely on
# frontend/public/logo.png existing on its filesystem in production. Instead
# this is a one-time-generated base64 PNG (cropped to the logo's own bounding
# box, alpha-thresholded to drop the faint outer glow, downscaled to 320px
# tall — plenty for a ~19mm header image) checked into this same directory,
# so the backend deploy is self-contained with no second raw copy of the
# image floating around to drift out of sync by hand. frontend/public/logo.png
# remains the one source-of-truth artwork file; _logo_b64.txt is a generated
# derivative of it, regenerated with:
#
#   python -c "from PIL import Image; import base64, io; \
#     im = Image.open('frontend/public/logo.png').convert('RGBA'); \
#     a = im.split()[-1]; m = a.point(lambda p: 255 if p > 40 else 0); \
#     im = im.crop(m.getbbox()); h = 320; w = round(im.size[0] * h / im.size[1]); \
#     im = im.resize((w, h), Image.LANCZOS); buf = io.BytesIO(); \
#     im.save(buf, 'PNG', optimize=True); \
#     open('backend/app/reporting/_logo_b64.txt', 'w').write(base64.b64encode(buf.getvalue()).decode())"
#
# (run from the repo root, with Pillow installed — it already is, as a hard
# dependency of reportlab).
# ============================================================================
_LOGO_B64_PATH = Path(__file__).with_name("_logo_b64.txt")
_logo_png_bytes: bytes | None = None


def _logo_png() -> bytes:
    """Cached decoded PNG bytes. Returns raw bytes rather than a shared
    file-like object — reportlab's Image flowable reads its source stream
    to completion on construction, so a single shared BytesIO would come up
    empty on every render after the first; callers wrap this in a fresh
    io.BytesIO() each time instead."""
    global _logo_png_bytes
    if _logo_png_bytes is None:
        _logo_png_bytes = base64.b64decode(_LOGO_B64_PATH.read_text().strip())
    return _logo_png_bytes


def _fmt_amount(value) -> str:
    if value is None:
        return ""
    return f"{Decimal(value):,.2f}"


def _fmt_qty(value, decimals: int = 0) -> str:
    """Plain thousands-separated number, no forced 2-decimal money padding
    — mirrors frontend/lib/format.ts's fmtNumber() for quantities/KG/ton on
    the Customer Ledger summary cards (as opposed to _fmt_amount above,
    which is for cash amounts)."""
    if value is None:
        value = 0
    return f"{Decimal(value):,.{decimals}f}"


# ---------------------------------------------------------------------------
# Amount-in-words — no existing helper/library for this in the codebase
# (checked: not in requirements.txt, no num2words, no in-repo utility), so a
# small self-contained converter lives here rather than adding a dependency
# for one line of text per invoice.
# ---------------------------------------------------------------------------
_ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _three_digit_words(n: int) -> str:
    parts = []
    if n >= 100:
        parts.append(_ONES[n // 100] + " Hundred")
        n %= 100
    if n >= 20:
        tens_word = _TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else "")
        parts.append(tens_word)
    elif n > 0:
        parts.append(_ONES[n])
    return " ".join(parts)


def _int_to_words(n: int) -> str:
    if n == 0:
        return "Zero"
    scales = [(1_000_000_000, "Billion"), (1_000_000, "Million"), (1_000, "Thousand"), (1, "")]
    parts = []
    for value, name in scales:
        if n >= value:
            count, n = divmod(n, value)
            parts.append(f"{_three_digit_words(count)} {name}".strip())
    return " ".join(parts)


def _amount_in_words(amount) -> str:
    amount = Decimal(amount or 0)
    rupees = int(amount)
    paisa = int((amount - rupees) * 100)
    words = f"Rupees {_int_to_words(rupees)}"
    if paisa:
        words += f" and {_int_to_words(paisa)} Paisa"
    return words + " Only"


def _styles():
    styles = getSampleStyleSheet()
    return {
        "company_name": ParagraphStyle("CompanyName", parent=styles["Title"], fontSize=18, leading=21, alignment=0, spaceAfter=0),
        "company_tagline": ParagraphStyle("CompanyTagline", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#0F8B8D"), spaceAfter=0),
        "address_right": ParagraphStyle("AddressRight", parent=styles["Normal"], fontSize=8.5, alignment=TA_RIGHT, leading=11, textColor=colors.HexColor("#334155")),
        "doctype": ParagraphStyle("DocType", parent=styles["Heading1"], fontSize=14, alignment=TA_CENTER, spaceBefore=8, spaceAfter=8, textColor=colors.HexColor("#1A2B33")),
        "section": ParagraphStyle("SectionHeading", parent=styles["Heading2"], fontSize=10, spaceBefore=0, spaceAfter=3, textColor=colors.HexColor("#1A2B33")),
        "normal": ParagraphStyle("InvoiceNormal", parent=styles["Normal"], fontSize=9.5, leading=13),
        "meta": ParagraphStyle("InvoiceMeta", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569")),
        "label_cell": ParagraphStyle("LabelCell", parent=styles["Normal"], fontSize=8.5, textColor=colors.HexColor("#475569")),
        "value_cell": ParagraphStyle("ValueCell", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#1A2B33")),
        "words": ParagraphStyle("AmountWords", parent=styles["Normal"], fontSize=9.5, fontName="Helvetica-Oblique", spaceBefore=4),
        "sig_line": ParagraphStyle("SigLine", parent=styles["Normal"], fontSize=9.5, alignment=TA_CENTER),
        "sig_label": ParagraphStyle("SigLabel", parent=styles["Normal"], fontSize=8, alignment=TA_CENTER, textColor=colors.HexColor("#475569")),
        "footer": ParagraphStyle("InvoiceFooter", parent=styles["Normal"], fontSize=7.5, alignment=TA_CENTER, textColor=colors.grey),
        # ---- Compact/ledger-style variants — Customer Statement only
        # (§ Compact Customer Statement redesign). The styles above stay
        # exactly as they were for the 5 per-record invoice types and the
        # Plant Statement, which all keep the original portrait/commercial-
        # invoice look; these exist so the statement can be genuinely
        # denser (smaller company header, single-line summary, ~7.5pt
        # table rows) without touching anything else's sizing.
        "compact_company_name": ParagraphStyle("CompactCompanyName", parent=styles["Title"], fontSize=13, leading=15, alignment=0, spaceAfter=0),
        "compact_company_tagline": ParagraphStyle("CompactCompanyTagline", parent=styles["Normal"], fontSize=7, textColor=colors.HexColor("#0F8B8D"), spaceAfter=0),
        "compact_address_right": ParagraphStyle("CompactAddressRight", parent=styles["Normal"], fontSize=6.5, alignment=TA_RIGHT, leading=7.8, textColor=colors.HexColor("#334155")),
        "compact_doctype": ParagraphStyle("CompactDocType", parent=styles["Heading1"], fontSize=11, alignment=0, spaceBefore=0, spaceAfter=0, textColor=colors.HexColor("#1A2B33")),
        "compact_customer_line": ParagraphStyle("CompactCustomerLine", parent=styles["Normal"], fontSize=8.5, leading=10.5, textColor=colors.HexColor("#1A2B33")),
        "compact_summary_label": ParagraphStyle("CompactSummaryLabel", parent=styles["Normal"], fontSize=6, textColor=colors.HexColor("#64748B")),
        "compact_summary_value": ParagraphStyle("CompactSummaryValue", parent=styles["Normal"], fontSize=8.5, fontName="Helvetica-Bold", textColor=colors.HexColor("#1A2B33")),
        "compact_table_cell": ParagraphStyle("CompactTableCell", parent=styles["Normal"], fontSize=7.5, leading=8.2, textColor=colors.HexColor("#1A2B33")),
        "compact_table_header": ParagraphStyle("CompactTableHeader", parent=styles["Normal"], fontSize=7.5, leading=8.2, fontName="Helvetica-Bold", textColor=colors.white),
        "compact_footer": ParagraphStyle("CompactFooter", parent=styles["Normal"], fontSize=6.5, alignment=TA_CENTER, textColor=colors.grey),
    }


def _header_block(s):
    """Logo + company name/tagline top-left, address+contact block
    top-right. See the LOGO comment above _logo_png for why the image is
    embedded rather than read from frontend/public/ at request time."""
    logo = Image(io.BytesIO(_logo_png()), width=18.5 * mm, height=20 * mm)
    name_block = [
        Paragraph(BUSINESS["name"].upper(), s["company_name"]),
        Paragraph(BUSINESS["tagline"], s["company_tagline"]),
    ]
    right_lines = BUSINESS["address_lines"] + [BUSINESS["phone"], BUSINESS["email"], BUSINESS["gst_regn_no"], BUSINESS["ntn"]]
    right = [Paragraph(line, s["address_right"]) for line in right_lines]

    t = Table([[logo, name_block, right]], colWidths=[22 * mm, 78 * mm, 82 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (1, 0), (1, -1), 4),
    ]))
    return [t, Spacer(1, 3 * mm), HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#0F8B8D")), Spacer(1, 3 * mm)]


def _details_box(s, rows: list):
    data = [[Paragraph(f"<b>{label}</b>", s["label_cell"]), Paragraph(str(value) if value else "-", s["value_cell"])] for label, value in rows]
    t = Table(data, colWidths=[32 * mm, 50 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _party_and_details(s, party_title: str, party_lines: list, details_rows: list):
    party_flowables = [Paragraph(party_title, s["section"])] + [Paragraph(line, s["normal"]) for line in party_lines]
    t = Table([[party_flowables, _details_box(s, details_rows)]], colWidths=[97 * mm, 85 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 0),
    ]))
    return t


def _items_table(s, headers: list, rows: list):
    """rows: one or more line-item rows — a plain per-Sale/Payment/Purchase
    invoice passes a single row (via _build's auto-wrap below); the
    Unified Sale combined invoice (§ One Invoice for Multi-Item Sales)
    passes one row per child Sale, all on the same document instead of a
    separate invoice each."""
    data = [headers] + rows
    t = Table(data, colWidths=[82 * mm, 30 * mm, 35 * mm, 35 * mm])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F8B8D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _totals_block(s, rows: list[tuple[str, object]]):
    """rows: one or more (label, amount) pairs, rendered top-to-bottom —
    a plain invoice gets a single "Total Amount" row; a GST-enabled Sale
    (§ GST on Sale) gets Value Excl. Tax / GST / Grand Total stacked in
    the same table instead of a second block, so the layout stays
    identical to today's single-row invoice when GST is off."""
    data = [[row_label, _fmt_amount(amount)] for row_label, amount in rows]
    t = Table(data, colWidths=[40 * mm, 35 * mm])
    t.hAlign = "RIGHT"
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10.5),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#1A2B33")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F0FAF9")),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _signature_block(s, prepared_by: str):
    t = Table(
        [
            ["", ""],
            [Paragraph("_" * 28, s["sig_line"]), Paragraph("_" * 28, s["sig_line"])],
            [Paragraph(f"Prepared By: {prepared_by}", s["sig_label"]), Paragraph(f"Authorized Signature — For {BUSINESS['name']}", s["sig_label"])],
        ],
        colWidths=[91 * mm, 91 * mm], rowHeights=[14 * mm, None, None],
    )
    t.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


def _build(doc_type: str, party_title: str, party_lines: list, details_rows: list,
           items_headers: list, items_row: list, total_amount, entered_by: str, notes: str | None,
           generated_by: str, generated_at: str) -> bytes:
    # total_amount is normally a single Decimal ("Total Amount" row); a
    # GST-enabled Sale instead passes a list of (label, amount) rows (§ GST
    # on Sale) — every other document type is untouched by this and keeps
    # rendering its plain single-row total exactly as before.
    if isinstance(total_amount, list):
        total_rows = total_amount
        final_amount = total_rows[-1][1]
    else:
        total_rows = [("Total Amount", total_amount)]
        final_amount = total_amount

    # items_row is normally a single flat row; the Unified Sale combined
    # invoice (§ One Invoice for Multi-Item Sales) passes a list of rows
    # instead — one per line item, all on this one document.
    items_rows = items_row if (items_row and isinstance(items_row[0], list)) else [items_row]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=14 * mm, bottomMargin=14 * mm, leftMargin=14 * mm, rightMargin=14 * mm,
    )
    s = _styles()
    story = []
    story.extend(_header_block(s))
    story.append(Paragraph(doc_type.upper(), s["doctype"]))
    story.append(_party_and_details(s, party_title, party_lines, details_rows))
    story.append(Spacer(1, 6 * mm))
    story.append(_items_table(s, items_headers, items_rows))
    story.append(Spacer(1, 4 * mm))
    story.append(_totals_block(s, total_rows))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(f"Amount in Words: {_amount_in_words(final_amount)}", s["words"]))
    if notes:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(f"Notes: {notes}", s["meta"]))
    story.append(Spacer(1, 18 * mm))
    story.append(_signature_block(s, entered_by))
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(f"System-generated document — printed by {generated_by} on {generated_at}.", s["footer"]))
    doc.build(story)
    return buf.getvalue()


def render_sale_invoice_pdf(sale, generated_by: str, generated_at: str) -> bytes:
    customer = sale.customer
    product = sale.product
    plant = sale.company

    party_lines = []
    if customer:
        if customer.mobile:
            party_lines.append(customer.mobile)
        addr_bits = [b for b in [customer.address, customer.city_area] if b]
        if addr_bits:
            party_lines.append(", ".join(addr_bits))
    if plant:
        party_lines.append(f"Plant: {plant.name}")

    details_rows = [
        ("Invoice No", sale.display_id),
        ("Date", sale.date.strftime("%Y-%m-%d")),
        ("Gate Pass No", sale.gate_pass_no),
        ("Vehicle No", sale.vehicle_no),
    ]

    rate = sale.rate_per_cylinder if sale.rate_per_cylinder is not None else sale.rate_per_kg
    items_row = [product.name if product else "-", _fmt_amount(sale.quantity), _fmt_amount(rate), _fmt_amount(sale.total_amount)]

    # GST on Sale (§ GST on Sale) — Value Excl. Tax / GST / Grand Total
    # stacked in the totals block; a GST-off sale keeps today's single
    # "Total Amount" row (see _build's isinstance check) with no empty tax rows.
    if sale.gst_enabled and sale.gst_rate is not None:
        totals = [
            ("Value Excl. Tax", sale.total_amount),
            (f"GST @ {_fmt_amount(sale.gst_rate)}%", sale.gst_amount),
            ("Grand Total", sale.grand_total),
        ]
    else:
        totals = sale.total_amount

    return _build(
        "Sales Invoice", "Bill To", [customer.name if customer else "-"] + party_lines, details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, totals, sale.entered_by, sale.notes,
        generated_by, generated_at,
    )


def render_unified_sale_invoice_pdf(batch, sales: list, generated_by: str, generated_at: str) -> bytes:
    """One combined invoice for an entire Unified Sale batch (§ One Invoice
    for Multi-Item Sales) — every active child Sale (one per product/
    cylinder size) renders as its own line item on THIS SAME document,
    under the batch's own display_id and one unified total, instead of
    each child Sale producing its own separate invoice via
    render_sale_invoice_pdf. The underlying per-product Sale rows still
    exist (FIFO stock, cylinder balances, and tonnage all key off them
    individually) — only the invoice/presentation layer is unified here."""
    customer = batch.customer
    plant = batch.company

    party_lines = []
    if customer:
        if customer.mobile:
            party_lines.append(customer.mobile)
        addr_bits = [b for b in [customer.address, customer.city_area] if b]
        if addr_bits:
            party_lines.append(", ".join(addr_bits))
    if plant:
        party_lines.append(f"Plant: {plant.name}")

    details_rows = [
        ("Invoice No", batch.display_id),
        ("Date", batch.date.strftime("%Y-%m-%d")),
        ("Gate Pass No", batch.gate_pass_no),
        ("Vehicle No", batch.vehicle_no),
    ]

    active_sales = [s for s in sales if s.status == "active"]
    items_rows = []
    for s in active_sales:
        product = s.product
        rate = s.rate_per_cylinder if s.rate_per_cylinder is not None else s.rate_per_kg
        items_rows.append([product.name if product else "-", _fmt_amount(s.quantity), _fmt_amount(rate), _fmt_amount(s.total_amount)])
    if batch.delivery_charges:
        items_rows.append(["Delivery Charges", "-", "-", _fmt_amount(batch.delivery_charges)])
    if not items_rows:
        # A pure-settlement batch (no items, credit-only) has nothing to
        # list — still render a valid (if empty-looking) table rather than
        # letting _build's single-row auto-wrap misinterpret an empty list.
        items_rows.append(["-", "-", "-", "-"])

    # GST on Sale, extended to Unified Sale (§ GST on Sale) — same Value
    # Excl. Tax / GST / Grand Total breakdown as the plain Sale invoice,
    # keyed off the BATCH's own total_selling_amount/gst_amount/grand_total
    # (never a sum of the child Sales' own totals, which carry no GST
    # individually).
    if batch.gst_enabled and batch.gst_rate is not None:
        totals = [
            ("Value Excl. Tax", batch.total_selling_amount),
            (f"GST @ {_fmt_amount(batch.gst_rate)}%", batch.gst_amount),
            ("Grand Total", batch.grand_total),
        ]
    else:
        totals = batch.total_selling_amount

    return _build(
        "Sales Invoice", "Bill To", [customer.name if customer else "-"] + party_lines, details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_rows, totals, batch.entered_by, batch.notes,
        generated_by, generated_at,
    )


def render_payment_invoice_pdf(payment, generated_by: str, generated_at: str) -> bytes:
    customer = payment.customer

    party_lines = []
    if customer and customer.mobile:
        party_lines.append(customer.mobile)

    details_rows = [
        ("Receipt No", payment.display_id),
        ("Date", payment.date.strftime("%Y-%m-%d")),
        ("Method", (payment.method or "-").replace("_", " ").title()),
        ("Account", payment.account.name if payment.account else "-"),
        ("Reference No", payment.reference_no),
    ]

    description = f"Payment received against Sale #{payment.sale.display_id}" if payment.sale else "Payment received"
    items_row = [description, "1", _fmt_amount(payment.amount), _fmt_amount(payment.amount)]

    notes = payment.notes
    if payment.excess_amount:
        extra = f"Excess (advance/credit): {_fmt_amount(payment.excess_amount)}"
        notes = f"{notes} — {extra}" if notes else extra

    return _build(
        "Payment Receipt", "Received From", [customer.name if customer else "-"] + party_lines, details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, payment.amount, payment.received_by or payment.entered_by, notes,
        generated_by, generated_at,
    )


def render_purchase_invoice_pdf(purchase, generated_by: str, generated_at: str) -> bytes:
    plant = purchase.company
    product = purchase.product

    details_rows = [
        ("Invoice No", purchase.display_id),
        ("Date", purchase.date.strftime("%Y-%m-%d")),
        ("Gate Pass No", purchase.gate_pass_no),
        ("Vehicle No", purchase.vehicle_no),
        ("Driver", f"{purchase.driver_name}{f' ({purchase.driver_contact})' if purchase.driver_contact else ''}" if purchase.driver_name else None),
    ]

    rate = purchase.rate_per_cylinder if purchase.rate_per_cylinder is not None else purchase.rate_per_kg
    items_row = [product.name if product else "-", _fmt_amount(purchase.quantity), _fmt_amount(rate), _fmt_amount(purchase.total_amount)]

    notes = purchase.notes
    charges = f"Additional: {_fmt_amount(purchase.additional_charges)} | Transport: {_fmt_amount(purchase.transport_charges)} | Other: {_fmt_amount(purchase.other_charges)}"
    notes = f"{notes} — {charges}" if notes else charges

    return _build(
        "Purchase Invoice", "Supplier", [plant.name if plant else "-"], details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, purchase.total_amount, purchase.entered_by, notes,
        generated_by, generated_at,
    )


def render_company_payment_invoice_pdf(cp, generated_by: str, generated_at: str) -> bytes:
    plant = cp.company

    details_rows = [
        ("Receipt No", cp.display_id),
        ("Date", cp.date.strftime("%Y-%m-%d")),
        ("Method", (cp.method or "-").replace("_", " ").title()),
        ("Account", cp.account.name if cp.account else "-"),
        ("Reference No", cp.reference_no),
    ]

    description = f"Payment against Purchase #{cp.purchase.display_id}" if cp.purchase else "Plant payment"
    items_row = [description, "1", _fmt_amount(cp.amount), _fmt_amount(cp.amount)]

    notes = cp.notes
    if cp.excess_amount:
        extra = f"Excess (advance/credit): {_fmt_amount(cp.excess_amount)}"
        notes = f"{notes} — {extra}" if notes else extra

    return _build(
        "Plant Payment Receipt", "Paid To", [plant.name if plant else "-"], details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, cp.amount, cp.paid_by or cp.entered_by, notes,
        generated_by, generated_at,
    )


def render_shop_sale_invoice_pdf(sale, generated_by: str, generated_at: str) -> bytes:
    shop = sale.customer
    product = sale.product

    party_lines = []
    if sale.supply_customer:
        party_lines.append(f"Customer: {sale.supply_customer.name}")

    details_rows = [
        ("Invoice No", sale.display_id),
        ("Date", sale.date.strftime("%Y-%m-%d")),
        ("Payment Type", (sale.payment_type or "-").title()),
        ("Amount Received", _fmt_amount(sale.amount_received) if sale.amount_received is not None else None),
    ]

    unit_label = "KG" if sale.unit == "kg" else "Cylinder"
    qty_display = _fmt_amount(sale.quantity_kg) if sale.unit == "kg" and sale.quantity_kg is not None else _fmt_amount(sale.quantity)
    items_row = [product.name if product else "-", f"{qty_display} {unit_label}", _fmt_amount(sale.sale_rate_per_cylinder), _fmt_amount(sale.total_amount)]

    notes = sale.notes
    if sale.payment_type == "credit" and sale.amount_received is not None:
        balance = Decimal(sale.total_amount) - Decimal(sale.amount_received)
        extra = f"Balance Due: {_fmt_amount(balance)}"
        notes = f"{notes} — {extra}" if notes else extra

    return _build(
        "Shop Sale Invoice", "Shop", [shop.name if shop else "-"] + party_lines, details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, sale.total_amount, sale.entered_by, notes,
        generated_by, generated_at,
    )


def _statement_period_label(month: str) -> str:
    from datetime import datetime as _dt
    try:
        return _dt.strptime(month, "%Y-%m").strftime("%B %Y")
    except ValueError:
        return month


def _statement_rate_cell(r: "schemas.LedgerRow") -> str:
    """Mirrors the Customer Ledger screen's own Rate-column logic exactly
    (frontend/app/customer-ledger/page.tsx) — a unified_sale row shows every
    child Sale's own rate (never one blended figure), everything else falls
    back to rate_per_cylinder or a dash. Deliberately does NOT also check
    rate_per_kg — the on-screen table doesn't either, so a kg-priced row
    reads as a dash here too, matching what the statement is a PDF copy of."""
    if r.kind == "unified_sale" and r.unified_sale_rates:
        return ", ".join(_fmt_amount(x) for x in r.unified_sale_rates)
    if r.rate_per_cylinder:
        return _fmt_amount(r.rate_per_cylinder)
    return "-"


def _statement_gst_cell(r: "schemas.LedgerRow") -> str:
    """Mirrors the Customer Ledger screen's own GST column (§ GST on
    Sale) — rate% and amount together, or a dash when no GST was applied.
    sale_amount is already grand_total-inclusive; this just breaks out how
    much of it was tax."""
    if r.gst_rate and r.gst_amount:
        return f"{_fmt_amount(r.gst_rate)}% / {_fmt_amount(r.gst_amount)}"
    return "-"


def _statement_qty_cell(value) -> str:
    """Mirrors the Customer Ledger screen's own 11.8kg/45.4kg columns
    (frontend/app/customer-ledger/page.tsx: `parseFloat(r.qty_118) ?
    r.qty_118 : "—"`) — a dash (this PDF's own empty-cell convention,
    see _statement_rate_cell/_statement_gst_cell above) when this row
    sold none of this specific size, the plain quantity otherwise."""
    if not value or Decimal(value) == 0:
        return "-"
    return _fmt_qty(value)


def _summary_metrics_row(s, metrics: list[tuple[str, str, str]]) -> Table:
    """One row of bordered 'summary card' cells — label on top (small,
    uppercase, gray), value below (bold, optionally colored) — the PDF
    equivalent of the Panel/Eyebrow summary cards on the Customer Ledger
    screen (frontend/app/customer-ledger/page.tsx's "Financial Stats" /
    "Cylinder Inventory Stats" grids). `metrics` is (label, value,
    hex_color_for_value); every value here is read straight off the same
    CustomerLedgerSummary the screen renders — see render_customer_statement_pdf
    below — never recomputed."""
    label_style = ParagraphStyle("CardLabel", parent=s["label_cell"], fontSize=7, textColor=colors.HexColor("#64748B"))
    value_style = ParagraphStyle("CardValue", parent=s["value_cell"], fontSize=11, fontName="Helvetica-Bold")

    n = len(metrics)
    col_width = PAGE_WIDTH / n
    cells = [
        [Paragraph(label.upper(), label_style), Paragraph(f'<font color="{color}">{value}</font>', value_style)]
        for label, value, color in metrics
    ]
    t = Table([cells], colWidths=[col_width] * n)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#C5C1B4")),
        ("INNERGRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#C5C1B4")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFAF8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


# ============================================================================
# COMPACT LAYOUT — Customer Statement only (§ Compact Customer Statement
# redesign, A4 landscape). None of these touch _header_block/_details_box/
# _party_and_details/_summary_metrics_row above, which stay exactly as they
# were for the 5 per-record invoice types and the Plant Statement (both
# still portrait, both still using the original "commercial invoice" look).
# ============================================================================

def _compact_header_block(s, total_width):
    """Same logo-left / name-left / contact-right shape as _header_block,
    just sized down: ~13mm-tall logo instead of ~20mm, 6.5pt contact text
    instead of 8.5pt. Company info is unabridged (§ Company Information —
    keep this) — only the presentation shrinks, per the redesign's own
    "compact, not removed" instruction for this block."""
    logo = Image(io.BytesIO(_logo_png()), width=13 * mm, height=14 * mm)
    name_block = [
        Paragraph(BUSINESS["name"].upper(), s["compact_company_name"]),
        Paragraph(BUSINESS["tagline"], s["compact_company_tagline"]),
    ]
    # Same 7 fields as _header_block (address×2, city, phone, email, GST,
    # NTN — § Company Information, all kept, none removed), combined onto
    # 4 lines instead of 7 (phone+email share a line, GST+NTN share a
    # line) — the row-height bottleneck for the whole compact header, so
    # this is where "compact, not removed" actually has to happen.
    right_lines = [
        BUSINESS["address_lines"][0],
        f"{BUSINESS['address_lines'][1]}, {BUSINESS['address_lines'][2]}",
        f"{BUSINESS['phone']}  |  {BUSINESS['email']}",
        f"{BUSINESS['gst_regn_no']}  |  {BUSINESS['ntn']}",
    ]
    right = [Paragraph(line, s["compact_address_right"]) for line in right_lines]

    name_col = 62 * mm
    logo_col = 16 * mm
    right_col = total_width - name_col - logo_col
    t = Table([[logo, name_block, right]], colWidths=[logo_col, name_col, right_col])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (1, 0), (1, -1), 3),
    ]))
    return [
        t, Spacer(1, 1 * mm),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#0F8B8D")),
        Spacer(1, 1 * mm),
    ]


def _compact_customer_block(s, customer, month: str, total_width):
    """Title + "Statement For" + period, all on two compact lines instead
    of a centered heading followed by a whole details-box row (§ Statement
    Title, § Customer Section). No Customer ID (§ Remove Internal System
    Information) — party_bits is only mobile/address/city, the same
    customer-facing fields _party_and_details already used, just inlined
    instead of boxed."""
    party_bits = []
    if customer.mobile:
        party_bits.append(customer.mobile)
    addr_bits = [b for b in [customer.address, customer.city_area] if b]
    if addr_bits:
        party_bits.append(", ".join(addr_bits))
    party_suffix = f" — {' · '.join(party_bits)}" if party_bits else ""

    return [
        Paragraph("CUSTOMER STATEMENT", s["compact_doctype"]),
        Paragraph(
            f"<b>Statement For:</b> {customer.name}{party_suffix} "
            f"&nbsp;&nbsp;|&nbsp;&nbsp; <b>Period:</b> {_statement_period_label(month)}",
            s["compact_customer_line"],
        ),
        Spacer(1, 1 * mm),
    ]


def _compact_plant_block(s, company, month: str, total_width):
    """Plant Statement's equivalent of _compact_customer_block above — same
    two-line shape, just Company has no address/city_area field to show
    (unlike Customer), so party_bits is mobile-only."""
    party_bits = [company.mobile] if company.mobile else []
    party_suffix = f" — {' · '.join(party_bits)}" if party_bits else ""

    return [
        Paragraph("PLANT STATEMENT", s["compact_doctype"]),
        Paragraph(
            f"<b>Statement For:</b> {company.name}{party_suffix} "
            f"&nbsp;&nbsp;|&nbsp;&nbsp; <b>Period:</b> {_statement_period_label(month)}",
            s["compact_customer_line"],
        ),
        Spacer(1, 1 * mm),
    ]


def _compact_summary_row(s, metrics: list[tuple[str, str, str]], total_width) -> Table:
    """Single-row compact grid version of _summary_metrics_row — label
    above value in each cell, same visual language, but ~1/3 the row
    height (2pt padding instead of 6, no card border/background) so the
    whole financial summary (§ Summary) costs one short row instead of
    two boxed ones."""
    n = len(metrics)
    col_width = total_width / n
    cells = [
        [Paragraph(label.upper(), s["compact_summary_label"]),
         Paragraph(f'<font color="{color}">{value}</font>', s["compact_summary_value"])]
        for label, value, color in metrics
    ]
    t = Table([cells], colWidths=[col_width] * n)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#C5C1B4")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C5C1B4")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFAF8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


# § Customer-facing field selection — deliberately narrower than the
# Customer Ledger screen (frontend/app/customer-ledger/page.tsx), which
# still shows ID/Description on screen for staff. Those two are internal/
# reporting-oriented (a display_id like "USALE-000019" and a description
# like "Unified Sale — sale & settlement" are both system/audit language,
# not something a customer needs to reconcile what they were charged), so
# this PDF drops them entirely rather than just shrinking them — the
# customer only needs WHEN + the actual financial/quantity facts. Their
# freed width goes to the remaining 8 columns, still summing to 277mm
# (the usable width on A4 LANDSCAPE with 10mm margins, 297mm - 20mm — see
# render_customer_statement_pdf's SimpleDocTemplate), with Balance getting
# the largest share since it's the one column that must stay unmistakably
# readable (§ Balance — "clearly visible").
_STATEMENT_COL_WIDTHS = [24 * mm, 34 * mm, 24 * mm, 24 * mm, 32 * mm, 38 * mm, 38 * mm, 63 * mm]
_STATEMENT_HEADERS = ["Date", "Rate", "11.8 KG", "45.4 KG", "GST", "Sale", "Payment", "Balance"]

# Target row count on the tightest page (page 1, which carries the company
# header/customer line/summary row above the table — see the budget math
# in render_customer_statement_pdf's docstring). Every other page gets the
# same per-row height, just with more headroom below the last row — see
# § 35 Entries Per Page / § Pagination: reportlab's automatic table-split
# would let a roomier continuation page hold more than this, which is why
# rows are chunked into fixed-size Tables (one per page) below instead of
# built as one giant auto-flowing Table.
STATEMENT_ROWS_PER_PAGE = 35


def _statement_row_cells(s, r: "schemas.LedgerRow") -> list:
    return [
        Paragraph(r.date.strftime("%Y-%m-%d"), s["compact_table_cell"]),
        Paragraph(_statement_rate_cell(r), s["compact_table_cell"]),
        Paragraph(_statement_qty_cell(r.qty_118), s["compact_table_cell"]),
        Paragraph(_statement_qty_cell(r.qty_454), s["compact_table_cell"]),
        Paragraph(_statement_gst_cell(r), s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.sale_amount) if r.sale_amount else "-", s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.payment_amount) if r.payment_amount else "-", s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.running_balance), ParagraphStyle("CompactBalCell", parent=s["compact_table_cell"], fontName="Helvetica-Bold")),
    ]


def _statement_opening_row_cells(s, opening_balance) -> list:
    # No Description column to carry the "Opening Balance" label anymore
    # (§ Remove ID/Description) — the Date cell takes it instead, same
    # left-aligned position a date would otherwise occupy.
    dash = Paragraph("-", s["compact_table_cell"])
    bold = ParagraphStyle("CompactOpeningRow", parent=s["compact_table_cell"], fontName="Helvetica-Bold")
    return [
        Paragraph("Opening Balance", bold),
        dash, dash, dash, dash, dash, dash,
        Paragraph(_fmt_amount(opening_balance), bold),
    ]


def _statement_table_chunk(s, header_cells: list, body_rows: list[list], col_widths: list) -> Table:
    """One page's worth of a compact statement's transaction table —
    shared by Customer and Plant Statement (col_widths is the one thing
    that differs between them). header_cells repeated row 0, then up to
    STATEMENT_ROWS_PER_PAGE (+1 on the very first chunk, for the Opening
    Balance row) body rows. Never spans more than one page by
    construction (see render_customer_statement_pdf/render_company_
    statement_pdf's chunking loops), so repeatRows=1 here is a safety
    net, not the primary pagination mechanism — § Pagination's "repeat
    header on every page" is really satisfied by every chunk already
    including its own header row, and "never cut a row between pages" by
    chunks never being tall enough to need splitting in the first place."""
    data = [header_cells] + body_rows
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("LEADING", (0, 0), (-1, -1), 8.2),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F8B8D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    return t


def render_customer_statement_pdf(summary: "schemas.CustomerLedgerSummary", generated_by: str, generated_at: str) -> bytes:
    """Full-statement PDF for one customer/month — reuses the exact
    CustomerLedgerSummary the Customer Ledger screen renders on screen
    (app.routers.ledger.customer_monthly_ledger), so this can never disagree
    with what's on screen (same convention as the Daily Report PDF).

    § Compact Customer Statement redesign — A4 LANDSCAPE, ~35 transaction
    rows/page, dense ledger look rather than a commercial-invoice one.
    Nothing about WHAT is calculated changes (still the same summary
    object, same LedgerRow fields, same _statement_rate_cell/_statement_
    gst_cell/_statement_qty_cell logic as before) — only the PRESENTATION
    and which fields are shown (no Customer ID) change.

    Page-1 vertical budget (10mm margins, so 190mm usable height), the
    tightest of any page since it alone carries the header/customer-line/
    summary above the table:
      compact header block   ~18mm  (13mm logo/name row + rule + spacers)
      title + customer line   ~9mm  (2 short Paragraphs)
      summary row              ~8mm  (1 row, 2pt padding)
      spacer before table      ~2mm
      totals + footer (after)  ~12mm (only actually lands on the LAST
                                       page, but budgeted on every page
                                       so a short statement — see below —
                                       never has it collide with row 35)
      ---------------------------------
      overhead                ~49mm  →  190 - 49 = 141mm for the table

    STATEMENT_ROWS_PER_PAGE (35) + 1 header + 1 Opening Balance row = 37
    table rows must fit in ~141mm → ~3.8mm/row, which is what the 7.5pt
    font / 8.6pt leading / 1pt top+bottom padding in _statement_table_chunk
    is tuned for (empirically confirmed by rendering real 35/36/50/70-row
    statements — see the PR/commit description for the actual measurements).

    Pagination (§ Pagination): rather than one giant Table and relying on
    reportlab's automatic cross-page split (which would let emptier
    continuation pages — no header/summary above them — hold noticeably
    more than 35 rows, since they'd have ~180mm instead of ~141mm to fill),
    the data is chunked into fixed STATEMENT_ROWS_PER_PAGE-row groups up
    front and each chunk becomes its OWN Table, separated by an explicit
    PageBreak(). This is what makes every page — not just page 1 — land at
    the same ~35 rows: a full page's worth of *table* height budget, used
    for a full page's worth of chunk, regardless of how much of that
    budget is actually available on the page it lands on."""
    customer = summary.customer

    usable_width = landscape(A4)[0] - 20 * mm  # 297mm - 10mm each side = 277mm
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=6 * mm, bottomMargin=6 * mm, leftMargin=10 * mm, rightMargin=10 * mm,
    )
    s = _styles()
    story = []
    story.extend(_compact_header_block(s, usable_width))
    story.extend(_compact_customer_block(s, customer, summary.month, usable_width))

    # Summary — Opening/Sales/Payments/Closing plus the cylinder totals
    # that were previously a second card row, now merged into the one
    # compact row (§ Summary — "also keep other important...totals...
    # make this section compact"). Same values, same source (`summary`),
    # just laid out as 9 cells instead of 4 + 5 stacked.
    story.append(_compact_summary_row(s, [
        ("Opening Balance", _fmt_amount(summary.opening_balance), "#0B2138"),
        ("Total Sales", _fmt_amount(summary.total_sales), "#0B2138"),
        ("Total Payments", _fmt_amount(summary.total_payments), "#1E8A5F"),
        ("Closing Balance", _fmt_amount(summary.closing_balance), "#0B2138"),
        ("11.8 KG Sold", _fmt_qty(summary.total_118), "#D98E04"),
        ("45.4 KG Sold", _fmt_qty(summary.total_454), "#9333EA"),
        ("Total KG", _fmt_qty(summary.total_kg), "#0B2138"),
        ("Total Ton", _fmt_qty(summary.total_ton, decimals=2), "#0B2138"),
        ("Empty Cyl (11.8/45.4)", f"{_fmt_qty(customer.empty_cylinders_118)}/{_fmt_qty(customer.empty_cylinders_454)}", "#0B2138"),
    ], usable_width))
    story.append(Spacer(1, 1 * mm))

    # summary.rows is latest-first for on-screen display (Global Sorting
    # Standard); a running-balance statement reads top-to-bottom
    # oldest-first, so this puts it back in the order it was actually built in.
    data_rows = list(reversed(summary.rows))
    header_cells = [Paragraph(f"<b>{h}</b>", s["compact_table_header"]) for h in _STATEMENT_HEADERS]
    chunks = [data_rows[i:i + STATEMENT_ROWS_PER_PAGE] for i in range(0, len(data_rows), STATEMENT_ROWS_PER_PAGE)] or [[]]

    for i, chunk in enumerate(chunks):
        body_rows = [_statement_row_cells(s, r) for r in chunk]
        if i == 0:
            body_rows = [_statement_opening_row_cells(s, summary.opening_balance)] + body_rows
        if i > 0:
            story.append(PageBreak())
        story.append(_statement_table_chunk(s, header_cells, body_rows, _STATEMENT_COL_WIDTHS))

    story.append(Spacer(1, 1 * mm))
    story.append(_totals_block(s, [("Closing Balance", summary.closing_balance)]))

    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 0.5 * mm))
    story.append(Paragraph(f"System-generated document — printed by {generated_by} on {generated_at}.", s["compact_footer"]))
    doc.build(story)
    return buf.getvalue()


def _company_statement_qty_cell(value) -> str:
    """Same convention as _statement_qty_cell above, for a
    CompanyLedgerRow's qty_118/qty_454 instead of a customer LedgerRow's."""
    if not value or Decimal(value) == 0:
        return "-"
    return _fmt_qty(value)


# § Plant Statement mirrors the Customer Statement's column removal
# exactly ("same implementation goes for plant ledger") — ID and
# Description dropped for the identical reason (display_id like
# "PUR-000019" / description like "Purchase — ..." are internal/audit
# language, not something the plant needs to reconcile a delivery
# against). Time and Vehicle are kept (unlike Customer Statement, which
# has neither) since a plant delivery is meaningfully identified by
# when + which vehicle, not by an internal reference. Purchase replaces
# Sale as the debit column (CompanyLedgerRow.purchase_amount vs.
# LedgerRow.sale_amount) and there is no Rate/GST for plant purchases.
# Widths sum to 277mm, the same A4-landscape usable width as the
# Customer Statement's _STATEMENT_COL_WIDTHS (297mm - 10mm each side).
_PLANT_STATEMENT_COL_WIDTHS = [24 * mm, 16 * mm, 34 * mm, 22 * mm, 22 * mm, 44 * mm, 44 * mm, 71 * mm]
_PLANT_STATEMENT_HEADERS = ["Date", "Time", "Vehicle", "11.8 KG", "45.4 KG", "Purchase", "Payment", "Balance"]


def _plant_statement_row_cells(s, r: "schemas.CompanyLedgerRow") -> list:
    return [
        Paragraph(r.date.strftime("%Y-%m-%d"), s["compact_table_cell"]),
        Paragraph(r.date.strftime("%H:%M"), s["compact_table_cell"]),
        Paragraph(r.vehicle_no or "-", s["compact_table_cell"]),
        Paragraph(_company_statement_qty_cell(r.qty_118), s["compact_table_cell"]),
        Paragraph(_company_statement_qty_cell(r.qty_454), s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.purchase_amount) if r.purchase_amount else "-", s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.payment_amount) if r.payment_amount else "-", s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.running_balance), ParagraphStyle("CompactPlantBalCell", parent=s["compact_table_cell"], fontName="Helvetica-Bold")),
    ]


def _plant_statement_opening_row_cells(s, opening_balance) -> list:
    # No Description column to carry the "Opening Balance" label (§ Remove
    # ID/Description) — same fix as _statement_opening_row_cells: the
    # label moves into the Date cell instead.
    dash = Paragraph("-", s["compact_table_cell"])
    bold = ParagraphStyle("CompactPlantOpeningRow", parent=s["compact_table_cell"], fontName="Helvetica-Bold")
    return [
        Paragraph("Opening Balance", bold),
        dash, dash, dash, dash, dash, dash,
        Paragraph(_fmt_amount(opening_balance), bold),
    ]


def render_company_statement_pdf(summary: "schemas.CompanyLedgerSummary", generated_by: str, generated_at: str) -> bytes:
    """Full-statement PDF for one plant/month — the Plant Ledger's
    equivalent of render_customer_statement_pdf above, same "reuses the
    exact summary the screen renders" guarantee (see
    app.routers.ledger.company_monthly_ledger), and now the same compact
    A4-LANDSCAPE / ~35-rows-per-page / no-ID-no-Description design
    ("same implementation goes for plant ledger") — see that function's
    docstring for the full page-1 vertical-budget math and the reasoning
    for manual page-chunking over reportlab's automatic Table split; both
    apply here unchanged since the shared building blocks
    (_compact_header_block, _compact_summary_row, _statement_table_chunk,
    STATEMENT_ROWS_PER_PAGE) are identical, only the column set and
    per-row field mapping differ (see _PLANT_STATEMENT_COL_WIDTHS/
    _PLANT_STATEMENT_HEADERS/_plant_statement_row_cells above)."""
    company = summary.company

    usable_width = landscape(A4)[0] - 20 * mm  # 297mm - 10mm each side = 277mm
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=6 * mm, bottomMargin=6 * mm, leftMargin=10 * mm, rightMargin=10 * mm,
    )
    s = _styles()
    story = []
    story.extend(_compact_header_block(s, usable_width))
    story.extend(_compact_plant_block(s, company, summary.month, usable_width))

    # Summary — Opening/Purchases/Payments/Closing plus the cylinder
    # totals, merged into one compact row exactly like the Customer
    # Statement's own summary row (previously two stacked
    # _summary_metrics_row calls, 4 metrics each).
    story.append(_compact_summary_row(s, [
        ("Opening Balance", _fmt_amount(summary.opening_balance), "#0B2138"),
        ("Total Purchases", _fmt_amount(summary.total_purchases), "#0B2138"),
        ("Total Paid", _fmt_amount(summary.total_payments), "#1E8A5F"),
        ("Closing Balance", _fmt_amount(summary.closing_balance), "#0B2138"),
        ("11.8 KG Purchased", _fmt_qty(summary.total_118), "#D98E04"),
        ("45.4 KG Purchased", _fmt_qty(summary.total_454), "#9333EA"),
        ("Total KG", _fmt_qty(summary.total_kg), "#0B2138"),
        ("Total Ton", _fmt_qty(summary.total_ton, decimals=2), "#0B2138"),
    ], usable_width))
    story.append(Spacer(1, 1 * mm))

    # summary.rows is latest-first for on-screen display (Global Sorting
    # Standard); a running-balance statement reads top-to-bottom
    # oldest-first, same reasoning as render_customer_statement_pdf above.
    data_rows = list(reversed(summary.rows))
    header_cells = [Paragraph(f"<b>{h}</b>", s["compact_table_header"]) for h in _PLANT_STATEMENT_HEADERS]
    chunks = [data_rows[i:i + STATEMENT_ROWS_PER_PAGE] for i in range(0, len(data_rows), STATEMENT_ROWS_PER_PAGE)] or [[]]

    for i, chunk in enumerate(chunks):
        body_rows = [_plant_statement_row_cells(s, r) for r in chunk]
        if i == 0:
            body_rows = [_plant_statement_opening_row_cells(s, summary.opening_balance)] + body_rows
        if i > 0:
            story.append(PageBreak())
        story.append(_statement_table_chunk(s, header_cells, body_rows, _PLANT_STATEMENT_COL_WIDTHS))

    story.append(Spacer(1, 1 * mm))
    story.append(_totals_block(s, [("Closing Balance", summary.closing_balance)]))

    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 0.5 * mm))
    story.append(Paragraph(f"System-generated document — printed by {generated_by} on {generated_at}.", s["compact_footer"]))
    doc.build(story)
    return buf.getvalue()
