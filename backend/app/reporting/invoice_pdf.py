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
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image
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


def _items_table(s, headers: list, row: list):
    data = [headers, row]
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


def _totals_block(s, total_amount, label="Total Amount"):
    t = Table([[label, _fmt_amount(total_amount)]], colWidths=[40 * mm, 35 * mm])
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
    story.append(_items_table(s, items_headers, items_row))
    story.append(Spacer(1, 4 * mm))
    story.append(_totals_block(s, total_amount))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(f"Amount in Words: {_amount_in_words(total_amount)}", s["words"]))
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

    return _build(
        "Sales Invoice", "Bill To", [customer.name if customer else "-"] + party_lines, details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, sale.total_amount, sale.entered_by, sale.notes,
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


def _statement_table(s, summary: "schemas.CustomerLedgerSummary"):
    headers = ["Date", "ID", "Description", "Rate", "Sale", "Payment", "Balance"]
    header_row = [Paragraph(f"<b>{h}</b>", s["value_cell"]) for h in headers]
    data = [header_row]

    opening_row_style = ParagraphStyle("OpeningRow", parent=s["value_cell"], fontName="Helvetica-Bold")
    data.append([
        Paragraph("-", s["value_cell"]), Paragraph("-", s["value_cell"]),
        Paragraph("Opening Balance", opening_row_style),
        Paragraph("-", s["value_cell"]), Paragraph("-", s["value_cell"]), Paragraph("-", s["value_cell"]),
        Paragraph(_fmt_amount(summary.opening_balance), opening_row_style),
    ])

    # summary.rows is latest-first for on-screen display (Global Sorting
    # Standard); a running-balance statement reads top-to-bottom
    # oldest-first, so this puts it back in the order it was actually built in.
    for r in reversed(summary.rows):
        data.append([
            Paragraph(r.date.strftime("%Y-%m-%d"), s["value_cell"]),
            Paragraph(r.display_id, s["value_cell"]),
            Paragraph(r.description, s["value_cell"]),
            Paragraph(_statement_rate_cell(r), s["value_cell"]),
            Paragraph(_fmt_amount(r.sale_amount) if r.sale_amount else "-", s["value_cell"]),
            Paragraph(_fmt_amount(r.payment_amount) if r.payment_amount else "-", s["value_cell"]),
            Paragraph(_fmt_amount(r.running_balance), ParagraphStyle("BalCell", parent=s["value_cell"], fontName="Helvetica-Bold")),
        ])

    t = Table(data, colWidths=[23 * mm, 25 * mm, 47 * mm, 20 * mm, 22 * mm, 22 * mm, 23 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F8B8D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#F8FAFC")),
        ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def render_customer_statement_pdf(summary: "schemas.CustomerLedgerSummary", generated_by: str, generated_at: str) -> bytes:
    """Full-statement PDF for one customer/month — reuses the exact
    CustomerLedgerSummary the Customer Ledger screen renders on screen
    (app.routers.ledger.customer_monthly_ledger), so this can never disagree
    with what's on screen (same convention as the Daily Report PDF)."""
    customer = summary.customer

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=14 * mm, bottomMargin=14 * mm, leftMargin=14 * mm, rightMargin=14 * mm,
    )
    s = _styles()
    story = []
    story.extend(_header_block(s))
    story.append(Paragraph("Customer Statement", s["doctype"]))

    party_lines = []
    if customer.mobile:
        party_lines.append(customer.mobile)
    addr_bits = [b for b in [customer.address, customer.city_area] if b]
    if addr_bits:
        party_lines.append(", ".join(addr_bits))

    details_rows = [
        ("Statement Period", _statement_period_label(summary.month)),
        ("Customer ID", customer.display_id),
        ("Opening Balance", _fmt_amount(summary.opening_balance)),
        ("Total Sales", _fmt_amount(summary.total_sales)),
        ("Total Payments", _fmt_amount(summary.total_payments)),
    ]
    story.append(_party_and_details(s, "Statement For", [customer.name] + party_lines, details_rows))
    story.append(Spacer(1, 5 * mm))

    story.append(_statement_table(s, summary))
    story.append(Spacer(1, 4 * mm))
    story.append(_totals_block(s, summary.closing_balance, label="Closing Balance"))

    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(f"System-generated document — printed by {generated_by} on {generated_at}.", s["footer"]))
    doc.build(story)
    return buf.getvalue()
