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
# This is the ONE place these fields live; every render function below reads
# from here (both the full _header_block and the compact shop-sale-invoice
# header), so a future correction is a one-line edit per field, not a hunt
# through the file.
#
# § GST Registration header line removed — this business is not GST-
# registered, so a "GST Regn No" line has no real value to show and never
# did (it sat as an explicit "[TO BE ADDED]" placeholder). Deliberately
# NOT the same thing as the gst_enabled/gst_rate/gst_amount feature on
# Sale/Unified Sale/Shop Sale (compute_gst, models.Sale.gst_*, etc.) —
# that's a real, working, separate feature for a BUYER who wants GST
# applied to their own transaction, completely untouched by this removal.
# This BUSINESS dict is only ever about the seller's own fixed letterhead
# facts, never about any one transaction's GST treatment.
# ============================================================================
BUSINESS = {
    "name": "DOWA Gas Agency",
    "tagline": "Agency · Karachi",
    "address_lines": [
        "M II E 1031/C, 1032/A Main Road Sher Shah,",
        "Khan Paracha Chowk,",
        "Karachi South, Lyari Town",
    ],
    "phone": "Phone: 0333-2240852",
    "email": "Email: dowagas@gmail.com",
    "ntn": "NTN: 2741131-1",
    "sales_tax": "Sales Tax No. 3277876150862",
}

PAGE_WIDTH = A4[0] - 28 * mm  # usable width after 14mm left/right margins

# Boxed / "traditional" invoice look (§ Invoice formatting pass): bordered
# header, party and details boxes, a black-gridded items table, an amount-in-
# words box, a bold company header including the Sales Tax No., and bold
# labels with normal-weight values. One switch for every per-record INVOICE
# template (Sale, Unified Sale, Shop Sale, Purchase, Payment, Plant Payment
# — everything rendered through _build). Deliberately NOT read by any
# statement (Customer, Plant, Shop, Supply Customer), which keep their own
# compact header and layout exactly as they were.
INVOICE_STYLE_V2 = True

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


def _amount_in_words_sentence(amount) -> str:
    """"(Rupees Five hundred ninety thousand only)" — the same thousands/
    millions converter as _amount_in_words above, just phrased in sentence
    case inside parentheses, the way it appears on a traditional invoice."""
    amount = Decimal(amount or 0)
    rupees = int(amount)
    paisa = int((amount - rupees) * 100)
    text = f"Rupees {_int_to_words(rupees).capitalize()}"
    if paisa:
        text += f" and {_int_to_words(paisa).lower()} paisa"
    return f"({text} only)"


def _styles():
    styles = getSampleStyleSheet()
    return {
        # ---- boxed look (INVOICE_STYLE_V2): bold company header, bold labels
        # (in <b> tags at the call site) over normal-weight values.
        "v2_tagline": ParagraphStyle("V2Tagline", parent=styles["Normal"], fontSize=9, fontName="Helvetica-Bold", textColor=colors.HexColor("#0F8B8D"), spaceAfter=0),
        "v2_address": ParagraphStyle("V2Address", parent=styles["Normal"], fontSize=8.5, fontName="Helvetica-Bold", alignment=TA_RIGHT, leading=11, textColor=colors.HexColor("#1A2B33")),
        "v2_party": ParagraphStyle("V2Party", parent=styles["Normal"], fontSize=9.5, leading=13, fontName="Helvetica"),
        "v2_words": ParagraphStyle("V2Words", parent=styles["Normal"], fontSize=9.5, leading=13, fontName="Helvetica"),

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
        "compact_reconciliation_note": ParagraphStyle("CompactReconciliationNote", parent=styles["Normal"], fontSize=6.8, leading=9, textColor=colors.HexColor("#475569")),
    }


def _header_block(s):
    """Logo + company name/tagline top-left, address+contact block
    top-right. See the LOGO comment above _logo_png for why the image is
    embedded rather than read from frontend/public/ at request time."""
    logo = Image(io.BytesIO(_logo_png()), width=18.5 * mm, height=20 * mm)
    if INVOICE_STYLE_V2:
        name_block = [
            Paragraph(BUSINESS["name"].upper(), s["company_name"]),
            Paragraph(BUSINESS["tagline"], s["v2_tagline"]),
        ]
        right_lines = BUSINESS["address_lines"] + [BUSINESS["phone"], BUSINESS["email"], BUSINESS["sales_tax"], BUSINESS["ntn"]]
        right = [Paragraph(line, s["v2_address"]) for line in right_lines]
        t = Table([[logo, name_block, right]], colWidths=[24 * mm, 76 * mm, 82 * mm])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOX", (0, 0), (-1, -1), 1.1, colors.HexColor("#1A2B33")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return [t, Spacer(1, 2 * mm)]
    name_block = [
        Paragraph(BUSINESS["name"].upper(), s["company_name"]),
        Paragraph(BUSINESS["tagline"], s["company_tagline"]),
    ]
    right_lines = BUSINESS["address_lines"] + [BUSINESS["phone"], BUSINESS["email"], BUSINESS["ntn"]]
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
    t = Table(data, colWidths=[32 * mm, 55 * mm] if INVOICE_STYLE_V2 else [32 * mm, 50 * mm])
    grid_color = colors.HexColor("#1A2B33") if INVOICE_STYLE_V2 else colors.HexColor("#CBD5E1")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75 if INVOICE_STYLE_V2 else 0.5, grid_color),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _party_and_details(s, party_title: str, party_lines: list, details_rows: list):
    if INVOICE_STYLE_V2:
        # Bordered party box beside the bordered details box; bold heading,
        # normal-weight customer details.
        party_flowables = [Paragraph(f"<b>{party_title}</b>", s["v2_party"]), Spacer(1, 1.5 * mm)] + [
            Paragraph(line, s["v2_party"]) for line in party_lines
        ]
        t = Table([[party_flowables, "", _details_box(s, details_rows)]], colWidths=[91 * mm, 4 * mm, 87 * mm])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (0, 0), 0.75, colors.HexColor("#1A2B33")),
            ("LEFTPADDING", (0, 0), (0, 0), 6), ("RIGHTPADDING", (0, 0), (0, 0), 6),
            ("TOPPADDING", (0, 0), (0, 0), 5), ("BOTTOMPADDING", (0, 0), (0, 0), 5),
            ("LEFTPADDING", (1, 0), (-1, -1), 0), ("RIGHTPADDING", (1, 0), (-1, -1), 0),
            ("TOPPADDING", (1, 0), (-1, -1), 0), ("BOTTOMPADDING", (1, 0), (-1, -1), 0),
        ]))
        return t
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
    if INVOICE_STYLE_V2:
        t.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#1A2B33")),
            ("BOX", (0, 0), (-1, -1), 1.1, colors.HexColor("#1A2B33")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E5E7EB")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1A2B33")),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t
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
    t = Table(data, colWidths=[52 * mm, 35 * mm])
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
    if INVOICE_STYLE_V2:
        totals_row = Table([["", _totals_block(s, total_rows)]], colWidths=[95 * mm, 87 * mm])
        totals_row.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(totals_row)
    else:
        story.append(_totals_block(s, total_rows))
    story.append(Spacer(1, 3 * mm))
    if INVOICE_STYLE_V2:
        words_box = Table([[Paragraph(_amount_in_words_sentence(final_amount), s["v2_words"])]], colWidths=[182 * mm])
        words_box.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#1A2B33")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(words_box)
    else:
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


def _sale_totals_rows(doc):
    """Totals rows for any sale document carrying gst_*/discount_* fields
    (Sale, UnifiedSaleBatch, ShopSale) - the full chain a customer can
    follow: Subtotal -> Discount (-) -> Discounted Subtotal -> GST (+) ->
    Grand Total. `doc` exposes total_amount OR total_selling_amount as its
    raw base. Returns a plain Decimal (today's single "Total Amount" row)
    when neither GST nor a discount applied, and today's exact Value Excl.
    Tax / GST / Grand Total rows when only GST did, so a document without
    a discount renders exactly as it did before this feature."""
    base = doc.total_selling_amount if hasattr(doc, "total_selling_amount") else doc.total_amount
    has_discount = bool(getattr(doc, "discount_enabled", False) and doc.discount_rate is not None and doc.discount_amount)
    has_gst = bool(doc.gst_enabled and doc.gst_rate is not None)
    if not has_discount and not has_gst:
        return base
    if not has_discount:
        return [
            ("Value Excl. Tax", base),
            (f"GST @ {_fmt_amount(doc.gst_rate)}%", doc.gst_amount),
            ("Grand Total", doc.grand_total),
        ]
    rows = [
        ("Subtotal", base),
        (f"Discount @ {_fmt_amount(doc.discount_rate)}% (-)", -Decimal(doc.discount_amount)),
    ]
    if has_gst:
        rows.append(("Discounted Subtotal", Decimal(base) - Decimal(doc.discount_amount)))
        rows.append((f"GST @ {_fmt_amount(doc.gst_rate)}% (+)", doc.gst_amount))
    rows.append(("Grand Total", doc.grand_total))
    return rows


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
    elif sale.company_label:
        party_lines.append(f"Plant: {sale.company_label}")

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
    totals = _sale_totals_rows(sale)

    return _build(
        "Sales Invoice", "Bill To", [customer.name if customer else (sale.customer_label or "-")] + party_lines, details_rows,
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
    elif batch.company_label:
        party_lines.append(f"Plant: {batch.company_label}")

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
    totals = _sale_totals_rows(batch)

    return _build(
        "Sales Invoice", "Bill To", [customer.name if customer else (batch.customer_label or "-")] + party_lines, details_rows,
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
        "Payment Receipt", "Received From", [customer.name if customer else (payment.customer_label or "-")] + party_lines, details_rows,
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
        "Purchase Invoice", "Supplier", [plant.name if plant else (purchase.company_label or "-")], details_rows,
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
        "Plant Payment Receipt", "Paid To", [plant.name if plant else (cp.company_label or "-")], details_rows,
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
        balance = Decimal(sale.grand_total) - Decimal(sale.amount_received)
        extra = f"Balance Due: {_fmt_amount(balance)}"
        notes = f"{notes} — {extra}" if notes else extra

    return _build(
        "Shop Sale Invoice", "Shop", [shop.name if shop else "-"] + party_lines, details_rows,
        ["Description", "Qty", "Rate", "Amount"], items_row, _sale_totals_rows(sale), sale.entered_by, notes,
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


def _statement_discount_cell(r) -> str:
    """Discount column (Discount feature) - the actual Rs amount, or a dash
    when no discount was applied to this row (same convention as the GST
    cell below). Shared by the Customer, Shop and Supply Customer
    statements."""
    if getattr(r, "discount_amount", None):
        return _fmt_amount(r.discount_amount)
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
    # Same 6 fields as _header_block (address×2, city, phone, email, NTN —
    # § Company Information, all kept, none removed — § GST Registration
    # header line removed, this business isn't GST-registered), combined
    # onto 4 lines instead of 6 (phone+email share a line) — the row-
    # height bottleneck for the whole compact header, so this is where
    # "compact, not removed" actually has to happen.
    right_lines = [
        BUSINESS["address_lines"][0],
        f"{BUSINESS['address_lines'][1]}, {BUSINESS['address_lines'][2]}",
        f"{BUSINESS['phone']}  |  {BUSINESS['email']}",
        BUSINESS["ntn"],
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


def _cash_reconciliation_note(
    s, cash: "schemas.ShopCashSummary", cash_inflows_total: Decimal, shop_cash_deductions: Decimal, total_width,
) -> Table:
    """§ Cash Metrics Reconciliation Visibility — two lines directly under
    the summary row: (1) the nested breakdown of "Total Cash Inflows (All
    Sources)" into its component sources, so that tile visibly rolls up
    from "Collected on Shop Sales" + debt recoveries/top-ups (+ transfers
    in, when nonzero) rather than needing to be taken on faith; (2) the
    full reconciliation formula plugged with this exact statement's real
    numbers, so Closing Cash is never left for the reader to verify by
    hand. Every term is already computed by shop_cash_summary/the caller —
    this never introduces a new calculation, only makes the existing one
    visible."""
    breakdown_parts = [
        f"Collected on Shop Sales {_fmt_amount(cash.cash_retail_sales)}",
        f"Debt Recoveries/Top-ups {_fmt_amount(cash.supply_customer_collections)}",
    ]
    if cash.transfers_in:
        breakdown_parts.append(f"Account Transfers In {_fmt_amount(cash.transfers_in)}")
    breakdown_line = (
        f"<b>Total Cash Inflows</b> = " + " + ".join(breakdown_parts) + f" = {_fmt_amount(cash_inflows_total)}"
    )
    formula_line = (
        f"<b>Closing Cash</b> = Opening ({_fmt_amount(cash.opening_cash)}) + Total Cash Inflows "
        f"({_fmt_amount(cash_inflows_total)}) - Shop Cash Deductions ({_fmt_amount(shop_cash_deductions)}) "
        f"= {_fmt_amount(cash.closing_cash)}"
    )
    t = Table([[Paragraph(breakdown_line, s["compact_reconciliation_note"])],
               [Paragraph(formula_line, s["compact_reconciliation_note"])]], colWidths=[total_width])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
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
_STATEMENT_COL_WIDTHS = [24 * mm, 34 * mm, 24 * mm, 24 * mm, 24 * mm, 32 * mm, 38 * mm, 38 * mm, 39 * mm]
_STATEMENT_HEADERS = ["Date", "Rate", "11.8 KG", "45.4 KG", "Discount", "GST", "Sale", "Payment", "Balance"]

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
        Paragraph(_statement_discount_cell(r), s["compact_table_cell"]),
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
        dash, dash, dash, dash, dash, dash, dash,
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


# ============================================================================
# SHOP STATEMENT — full activity log (Load/Shop Sale/Payment/Emergency
# Transfer), NOT a single-purpose payable ledger like Customer/Plant
# Statement above. A Shop's Transaction History mixes TWO unrelated
# financial concerns, both shown here but never combined into one number
# (§ Meaning of Balance):
#   1. What the shop owes Dowa — Load debits it, Payment credits it
#      (exactly the same Sale/Payment rows a Customer Statement already
#      shows, since a Shop IS a Customer row). The Balance column reflects
#      ONLY this, as a running total sourced from customer_monthly_ledger.
#   2. The shop's OWN retail business — a Shop Sale has its own Amount/
#      Paid/Due against the retail customer it was sold to (ShopSale.
#      total_amount/amount_received/amount_outstanding), and Emergency
#      Transfer is a pure stock movement. Neither ever touches the Dowa
#      payable: a Shop Sale row's Balance cell shows its OWN due (plain
#      text, not the running payable), and Emergency Transfer's is "-".
# Same compact A4-landscape layout/pagination as the two statements above;
# only the column set (adds Customer) and per-row mapping differ.
# ============================================================================

_SHOP_TYPE_LABELS = {
    "load": "Load",
    "shop_sale": "Sale",
    "payment": "Payment",
    "emergency_transfer_out": "Emergency Transfer",
    "customer_payment": "Customer Payment",
}


def _fmt_qty_clean(value) -> str:
    """Plain quantity formatting with no forced decimal padding — "2" not
    "2.0000", but a genuinely fractional quantity (e.g. a KG-based Shop
    Sale's cylinder-equivalent) still shows its real decimals. Trims
    trailing zeros via string manipulation rather than Decimal.normalize()
    (which would render a round number like 100 as "1E+2")."""
    if value is None or Decimal(value) == 0:
        return "-"
    text = f"{Decimal(value):,.4f}".rstrip("0").rstrip(".")
    return text or "0"


def _shop_statement_cylinder_type_cell(value) -> str:
    """Cylinder Type column — value is ShopTransactionRow.cylinder_weight
    (a physical weight like 11.80/45.40), never parsed from the free-text
    description (§ Shop Statement — no Description parsing). Dash for a
    row with no product at all (Payment)."""
    if value is None or Decimal(value) == 0:
        return "-"
    return f"{_fmt_qty_clean(value)} KG"


def _shop_statement_rate_cell(r: "schemas.ShopTransactionRow") -> str:
    """Rate is always per-KG on this statement — a Load's is
    ShopTransactionRow.load_rate_per_kg, a Shop Sale's is board_rate_per_kg
    (the Board Rate actually in effect on the sale date, per ShopSale.
    board_rate_per_kg_used). § Rate bug fix: this previously read
    sale_rate_per_cylinder instead of board_rate_per_kg for a Shop Sale —
    that field is the PER-CYLINDER price (board_rate_per_kg × saleable_kg,
    e.g. 230 × 45 = 10,350 for a 45.4kg cylinder), not a rate/kg at all, so
    a 2-cylinder sale showed "10,350.00" in the Rate column instead of the
    actual 230.00/kg rate. Amount (ShopTransactionRow.amount = total_amount)
    was never affected by this — only this column's own mapping was wrong."""
    if r.kind == "load" and r.load_rate_per_kg:
        return _fmt_amount(r.load_rate_per_kg)
    if r.kind == "shop_sale" and r.board_rate_per_kg:
        return _fmt_amount(r.board_rate_per_kg)
    return "-"


def _shop_statement_gst_cell(r: "schemas.ShopTransactionRow") -> str:
    """§ Shop Statement PDF GST columns — mirrors _statement_gst_cell (the
    Customer Statement's own GST column) exactly: rate% and amount
    together, or a dash when no GST was applied. Only ever populated for
    kind=="shop_sale" (see get_shop_detail); Amount above is already
    grand_total-inclusive, this just breaks out how much of it was tax."""
    if r.gst_rate and r.gst_amount:
        return f"{_fmt_amount(r.gst_rate)}% / {_fmt_amount(r.gst_amount)}"
    return "-"


# § Remove Internal Information — no ID/Description column, same principle
# already established for Customer/Plant Statement above (a display_id
# like "SHSALE-000042" and a sentence like "Shop Sale — 45.4 KG Cylinder ×
# 2.0000 · CREDIT (partial: 10000.00 paid, 10700.00 due) (fatima)" are
# internal/audit language; Type + Customer + Cylinder Type + Quantity +
# Rate + Paid below carry the same facts as structured, customer-facing
# fields instead). Customer added per its own design pass (§ Customer
# Information); GST added per § Shop Statement PDF GST columns, in the
# same Rate→GST→Amount position as the Customer Statement's own Rate→GST→
# Sale ordering — still sums to 277mm (shaved from Customer/Cylinder Type/
# Quantity/Rate/Amount/Paid to make room, Balance untouched).
_SHOP_STATEMENT_COL_WIDTHS = [18 * mm, 18 * mm, 26 * mm, 18 * mm, 14 * mm, 18 * mm, 20 * mm, 20 * mm, 33 * mm, 33 * mm, 59 * mm]
_SHOP_STATEMENT_HEADERS = ["Date", "Type", "Customer", "Cylinder Type", "Quantity", "Rate", "Discount", "GST", "Amount", "Paid", "Dowa Balance"]


def _shop_statement_row_cells(s, r: "schemas.ShopTransactionRow", balance) -> list:
    """§ Payment / Paid amount, § Meaning of Balance — a Shop Sale carries
    its OWN Amount/Paid/Due (ShopSale.total_amount/amount_received/
    amount_outstanding — the retail customer's own balance on THAT sale),
    completely independent of `balance` (the shop's running payable to
    Dowa, sourced from customer_monthly_ledger). These are deliberately
    computed from two unrelated sources and never combined — a Shop Sale
    row's Balance cell shows its own amount_outstanding, NOT `balance`;
    a Load/Payment row's Balance cell shows `balance` and never anything
    ShopSale-related. Per-kind branching below (not a generic
    truthy-value-or-dash fallback) so a genuine Rs 0 paid/due on a real
    sale still shows "0.00"/"0.00" rather than being mistaken for "not
    applicable" — only Load/Payment/Emergency Transfer's actually-N/A
    cells fall back to "-"."""
    customer_cell = r.customer_name or "-"
    cylinder_cell = _shop_statement_cylinder_type_cell(r.cylinder_weight)
    quantity_cell = _fmt_qty_clean(r.quantity)
    rate_cell = _shop_statement_rate_cell(r)
    # § Shop Statement PDF GST columns — naturally "-" for every non-
    # shop_sale kind (gst_rate/gst_amount are only ever populated for
    # kind=="shop_sale" — see get_shop_detail), so no per-kind branching
    # needed here unlike the other cells below.
    gst_cell = _shop_statement_gst_cell(r)
    bold = ParagraphStyle("CompactShopBalCell", parent=s["compact_table_cell"], fontName="Helvetica-Bold")

    if r.kind == "shop_sale":
        amount_cell = _fmt_amount(r.amount) if r.amount is not None else "-"
        paid_cell = _fmt_amount(r.amount_received) if r.amount_received is not None else "-"
        balance_cell = _fmt_amount(r.amount_outstanding) if r.amount_outstanding is not None else "-"
        balance_style = s["compact_table_cell"]  # plain — this is the SALE's own due, not the Dowa payable
    elif r.kind == "payment":
        customer_cell = "-"
        cylinder_cell = quantity_cell = rate_cell = amount_cell = "-"
        paid_cell = _fmt_amount(r.amount) if r.amount is not None else "-"
        balance_cell = _fmt_amount(balance)
        balance_style = bold  # the real running Dowa-payable balance
    elif r.kind == "load":
        customer_cell = "-"
        paid_cell = "-"
        amount_cell = _fmt_amount(r.amount) if r.amount is not None else "-"
        balance_cell = _fmt_amount(balance)
        balance_style = bold  # the real running Dowa-payable balance
    elif r.kind == "customer_payment":
        # Engine 3 only (§ get_shop_business_ledger's own docstring) — a
        # supply-customer collection never touches the shop's Dowa payable,
        # so `balance` here would incorrectly conflate two unrelated
        # concepts, exactly the mixing this function's own docstring
        # already forbids for shop_sale's amount_outstanding. Customer
        # comes from r.customer_name (always set — a Payment Only
        # collection always names one), Amount has no separate "gross"
        # concept distinct from what was paid (same as "payment" above).
        cylinder_cell = quantity_cell = rate_cell = "-"
        amount_cell = "-"
        paid_cell = _fmt_amount(r.amount) if r.amount is not None else "-"
        balance_cell = "-"
        balance_style = s["compact_table_cell"]
    else:  # emergency_transfer_out — pure stock movement, no money/balance
        customer_cell = "-"
        amount_cell = paid_cell = balance_cell = "-"
        balance_style = s["compact_table_cell"]

    return [
        Paragraph(r.date.strftime("%Y-%m-%d"), s["compact_table_cell"]),
        Paragraph(_SHOP_TYPE_LABELS.get(r.kind, r.kind), s["compact_table_cell"]),
        Paragraph(customer_cell, s["compact_table_cell"]),
        Paragraph(cylinder_cell, s["compact_table_cell"]),
        Paragraph(quantity_cell, s["compact_table_cell"]),
        Paragraph(rate_cell, s["compact_table_cell"]),
        Paragraph(_statement_discount_cell(r), s["compact_table_cell"]),
        Paragraph(gst_cell, s["compact_table_cell"]),
        Paragraph(amount_cell, s["compact_table_cell"]),
        Paragraph(paid_cell, s["compact_table_cell"]),
        Paragraph(balance_cell, balance_style),
    ]


def _shop_statement_opening_row_cells(s, opening_balance) -> list:
    # The 9 dashes are placeholders only — render_shop_statement_pdf SPANs
    # columns 0-9 over this row so only the "Dowa Payable (Opening)" label
    # (cell 0) actually renders, never sitting under the Date column as
    # though it were one (§ Opening Balance row presentation). Kept here so
    # the row still has 10 cells, matching every other row's shape (§ Shop
    # Statement PDF GST columns added a 10th). Same "Dowa Payable" naming
    # as the summary tiles above (§ Shop Statement — Dowa Payable vs Shop
    # Cash) — this row only ever concerns the Dowa Balance column, never
    # Shop Cash.
    dash = Paragraph("-", s["compact_table_cell"])
    bold = ParagraphStyle("CompactShopOpeningRow", parent=s["compact_table_cell"], fontName="Helvetica-Bold")
    return [
        Paragraph("Dowa Payable (Opening)", bold),
        dash, dash, dash, dash, dash, dash, dash, dash, dash,
        Paragraph(_fmt_amount(opening_balance), bold),
    ]


def _compact_shop_block(s, shop, month: str, total_width):
    """Shop Statement's equivalent of _compact_customer_block/_compact_
    plant_block above — same two-line shape. A shop IS a Customer row, so
    it has the same mobile/address/city_area fields Customer does."""
    party_bits = [shop.mobile] if shop.mobile else []
    addr_bits = [b for b in [shop.address, shop.city_area] if b]
    if addr_bits:
        party_bits.append(", ".join(addr_bits))
    party_suffix = f" — {' · '.join(party_bits)}" if party_bits else ""

    return [
        Paragraph("SHOP STATEMENT", s["compact_doctype"]),
        Paragraph(
            f"<b>Statement For:</b> {shop.name}{party_suffix} "
            f"&nbsp;&nbsp;|&nbsp;&nbsp; <b>Period:</b> {_statement_period_label(month)}",
            s["compact_customer_line"],
        ),
        Spacer(1, 1 * mm),
    ]


def render_shop_statement_pdf(
    shop, month: str, transactions: list["schemas.ShopTransactionRow"],
    ledger_summary: "schemas.CustomerLedgerSummary", shop_cash_summary: "schemas.ShopCashSummary",
    generated_by: str, generated_at: str,
) -> bytes:
    """Full-activity-log statement PDF for one shop/month — same compact
    A4-landscape design as render_customer_statement_pdf/render_company_
    statement_pdf (see those docstrings for the page-1 vertical-budget
    math and manual page-chunking rationale, both unchanged here). `shop`
    is a live Customer row (a Shop IS a Customer — see routers/shops.py's
    shop_statement_pdf). `transactions` is get_shop_detail's own
    ShopTransactionRow list for this shop/month (Load/Shop Sale/Payment/
    Emergency Transfer/Customer Payment all included — § Full Activity Log,
    never filter any kind out).

    Two genuinely unrelated running balances appear on this document (§
    Shop Statement — Dowa Payable vs Shop Cash, added after a customer
    mistook the two for one broken running total): `ledger_summary` is
    customer_monthly_ledger's output for this same shop_id/month — the SAME
    payable-to-Dowa math the Customer Statement already uses (a Load is
    just an ordinary Sale row against the shop, a Payment just an ordinary
    Payment row), read here, never recomputed, and merged onto the
    Load/Payment rows below by matching ref_id to ledger_summary.rows' own
    ref_id ("Dowa Balance" column). `shop_cash_summary` is
    routers/shops.py::_compute_cash_summary_range's output for the whole
    month — the shop's OWN retail cash (Shop Sale/Customer Payment
    collections actually routed into Shop Cash), completely independent of
    the Dowa payable; surfaced only as its own 3 summary tiles (Opening/
    Collected/Closing), never merged into the per-row table. Shop Sale/
    Customer Payment/Emergency Transfer rows never look anything up in
    ledger_summary — see _shop_statement_row_cells's Dowa Balance
    handling."""
    usable_width = landscape(A4)[0] - 20 * mm  # 297mm - 10mm each side = 277mm
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=6 * mm, bottomMargin=6 * mm, leftMargin=10 * mm, rightMargin=10 * mm,
    )
    s = _styles()
    story = []
    story.extend(_compact_header_block(s, usable_width))
    story.extend(_compact_shop_block(s, shop, month, usable_width))

    # get_shop_detail sorts transactions latest-first for on-screen display
    # (Global Sorting Standard) — a running-balance statement reads
    # top-to-bottom oldest-first, same reversal render_customer_statement_
    # pdf/render_company_statement_pdf already do for their own summary.rows.
    data_rows = list(reversed(transactions))
    total_shop_sales = sum((t.amount or Decimal("0") for t in transactions if t.kind == "shop_sale"), Decimal("0"))

    # § Shop Statement — Dowa Payable vs Shop Cash: "Opening/Closing
    # Balance" renamed to "Dowa Payable (Opening/Closing)" — a customer
    # mistook this for one broken running total spanning the whole
    # statement when Customer Payment rows didn't move it, since nothing
    # on the page said this figure was scoped to the Dowa payable only.
    # The Shop Cash tiles are the shop's own retail-cash story, computed
    # independently (shop_cash_summary, § docstring above) — never derived
    # from or combined with the Dowa Payable figures.
    #
    # § Cash Metrics Reconciliation Visibility — "Shop Cash (Collected)"
    # renamed "Total Cash Inflows (All Sources)" and now includes
    # transfers_in (previously silently excluded from this tile despite
    # being a real Shop Cash inflow, which meant Opening + Collected -
    # Deductions could fall short of Closing whenever a transfer-in
    # happened, even though closing_cash itself was always correct). Also,
    # "Collected on Shop Sales" is now shop_cash_summary.cash_retail_sales
    # (Shop-Cash-scoped) rather than the old all-destination sum over
    # `transactions` — the two used to measure different things (a Shop
    # Sale routed to Office Cash counted in the old figure but never in
    # Shop Cash), which meant "Collected on Shop Sales" was NOT actually a
    # subset of "Shop Cash (Collected)" despite reading like one. Now it
    # is, exactly: cash_inflows_total = cash_retail_sales +
    # supply_customer_collections + transfers_in, term-for-term.
    cash_inflows_total = (
        shop_cash_summary.cash_retail_sales + shop_cash_summary.supply_customer_collections
        + shop_cash_summary.transfers_in
    )
    # Opening + Total Cash Inflows - Deductions = Closing, exactly — every
    # term here is already computed by shop_cash_summary itself, never a
    # new calculation (§ Shop Cash reconciliation gap).
    shop_cash_deductions = (
        shop_cash_summary.expenses + shop_cash_summary.owner_withdrawals
        + shop_cash_summary.dowa_payments + shop_cash_summary.transfers_out
        + shop_cash_summary.cash_transfers_out
    )
    story.append(_compact_summary_row(s, [
        ("Dowa Payable (Opening)", _fmt_amount(ledger_summary.opening_balance), "#0B2138"),
        ("Total Loads", _fmt_amount(ledger_summary.total_sales), "#0B2138"),
        ("Total Paid to Dowa", _fmt_amount(ledger_summary.total_payments), "#1E8A5F"),
        ("Dowa Payable (Closing)", _fmt_amount(ledger_summary.closing_balance), "#0B2138"),
        ("Total Shop Sales", _fmt_amount(total_shop_sales), "#9333EA"),
        ("Shop Cash (Opening)", _fmt_amount(shop_cash_summary.opening_cash), "#0B2138"),
        ("Total Cash Inflows (All Sources)", _fmt_amount(cash_inflows_total), "#1E8A5F"),
        ("Shop Cash Deductions", _fmt_amount(shop_cash_deductions), "#9B4A4A"),
        ("Shop Cash (Closing)", _fmt_amount(shop_cash_summary.closing_cash), "#0B2138"),
    ], usable_width))
    story.append(Spacer(1, 0.8 * mm))
    story.append(_cash_reconciliation_note(s, shop_cash_summary, cash_inflows_total, shop_cash_deductions, usable_width))
    story.append(Spacer(1, 1 * mm))

    # Balance merge — Load/Payment read customer_monthly_ledger's own
    # already-computed running_balance (matched by ref_id: a Load IS that
    # Sale row's id, a Payment IS that Payment row's id); Shop Sale/
    # Emergency Transfer never touch `running` at all, so the very next
    # Load/Payment row picks up exactly where the payable left off — never
    # inflated or deflated by anything in between (§ Balance — must not
    # imply an effect).
    ledger_balance_by_ref = {row.ref_id: row.running_balance for row in ledger_summary.rows}
    running = ledger_summary.opening_balance
    rows_with_balance = []
    for t in data_rows:
        if t.kind in ("load", "payment") and t.ref_id in ledger_balance_by_ref:
            running = ledger_balance_by_ref[t.ref_id]
        rows_with_balance.append((t, running))

    header_cells = [Paragraph(f"<b>{h}</b>", s["compact_table_header"]) for h in _SHOP_STATEMENT_HEADERS]
    chunks = [rows_with_balance[i:i + STATEMENT_ROWS_PER_PAGE] for i in range(0, len(rows_with_balance), STATEMENT_ROWS_PER_PAGE)] or [[]]

    for i, chunk in enumerate(chunks):
        body_rows = [_shop_statement_row_cells(s, t, bal) for t, bal in chunk]
        if i == 0:
            body_rows = [_shop_statement_opening_row_cells(s, ledger_summary.opening_balance)] + body_rows
        if i > 0:
            story.append(PageBreak())
        table = _statement_table_chunk(s, header_cells, body_rows, _SHOP_STATEMENT_COL_WIDTHS)
        if i == 0:
            # Opening Balance row (§ Opening Balance row presentation) —
            # merges Date..Paid (columns 0-9, table row 1 since row 0 is
            # the header) into one left-aligned "Opening Balance" label so
            # it never reads as though sitting in the Date column; Balance
            # (column 10) keeps its own real value. Applied to this Table
            # instance only, after _statement_table_chunk builds it — never
            # touches that shared function or Customer/Plant Statement.
            table.setStyle(TableStyle([
                ("SPAN", (0, 1), (9, 1)),
                ("ALIGN", (0, 1), (0, 1), "LEFT"),
            ]))
        story.append(table)

    story.append(Spacer(1, 1 * mm))
    story.append(_totals_block(s, [("Closing Balance", ledger_summary.closing_balance)]))

    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 0.5 * mm))
    story.append(Paragraph(f"System-generated document — printed by {generated_by} on {generated_at}.", s["compact_footer"]))
    doc.build(story)
    return buf.getvalue()


# ============================================================================
# SUPPLY CUSTOMER STATEMENT — a shop's OWN retail customer's ledger with
# that shop (never the shop's payable to Dowa — a completely different,
# unrelated balance covered by render_shop_statement_pdf above). Simpler
# than that one: only two event kinds (sale/payment) and ONE coherent
# running balance for the whole document, so — unlike Shop Statement —
# there is no dual-concept Balance column to keep apart; every row's
# Balance is the same real running_balance customer_monthly_ledger-style
# math already produces (see routers/shops.get_supply_customer_ledger).
# All-time, not month-scoped (ShopSupplyCustomer has a single opening_
# balance, matching that endpoint's own docstring) — same compact
# A4-landscape layout/pagination as the statements above.
# ============================================================================

_SUPPLY_CUSTOMER_TYPE_LABELS = {"sale": "Sale", "payment": "Payment"}

# § Shop Customer Ledger GST columns — GST inserted between Rate and
# Amount, mirroring the Shop Statement's own GST column insertion
# (_SHOP_STATEMENT_COL_WIDTHS); still sums to 277mm.
_SUPPLY_CUSTOMER_STATEMENT_COL_WIDTHS = [20 * mm, 18 * mm, 24 * mm, 16 * mm, 18 * mm, 18 * mm, 16 * mm, 32 * mm, 32 * mm, 83 * mm]
_SUPPLY_CUSTOMER_STATEMENT_HEADERS = ["Date", "Type", "Cylinder Type", "Quantity", "Rate", "Discount", "GST", "Amount", "Paid", "Balance"]


def _supply_customer_statement_quantity_cell(r: "schemas.ShopSupplyCustomerLedgerRow") -> str:
    """Same clean-number convention as Shop Statement's Quantity column,
    with a "kg" suffix only for a unit="kg" row (a cylinder-unit row's
    Cylinder Type column already conveys the physical size; a kg-unit
    row's own quantity is a KG figure, not a cylinder count, so it needs
    the unit spelled out to avoid reading as one)."""
    if r.quantity is None:
        return "-"
    text = _fmt_qty_clean(r.quantity)
    if text == "-":
        return "-"
    return f"{text} kg" if r.unit == "kg" else text


def _supply_customer_statement_row_cells(s, r: "schemas.ShopSupplyCustomerLedgerRow") -> list:
    bold = ParagraphStyle("CompactSupplyCustBalCell", parent=s["compact_table_cell"], fontName="Helvetica-Bold")
    if r.kind == "sale":
        cylinder_cell = _shop_statement_cylinder_type_cell(r.cylinder_weight)
        quantity_cell = _supply_customer_statement_quantity_cell(r)
        # board_rate_per_kg, not `rate` — `rate` is deliberately unit-
        # relative for the on-screen ledger (per-cylinder for a cylinder-
        # unit row); this PDF's Rate column needs the real rate/kg
        # regardless of unit, same convention as the Shop Statement's own
        # Rate fix (§ Rate is currently wrong).
        rate_cell = _fmt_amount(r.board_rate_per_kg) if r.board_rate_per_kg else "-"
        gst_cell = _shop_statement_gst_cell(r)
        amount_cell = _fmt_amount(r.gross_amount) if r.gross_amount is not None else "-"
        paid_cell = _fmt_amount(r.payment_amount) if r.payment_amount is not None else "-"
    else:  # payment — no product/quantity/rate/gst/gross-amount concept at all
        cylinder_cell = quantity_cell = rate_cell = gst_cell = amount_cell = "-"
        paid_cell = _fmt_amount(r.payment_amount) if r.payment_amount is not None else "-"
    return [
        Paragraph(r.date.strftime("%Y-%m-%d"), s["compact_table_cell"]),
        Paragraph(_SUPPLY_CUSTOMER_TYPE_LABELS.get(r.kind, r.kind), s["compact_table_cell"]),
        Paragraph(cylinder_cell, s["compact_table_cell"]),
        Paragraph(quantity_cell, s["compact_table_cell"]),
        Paragraph(rate_cell, s["compact_table_cell"]),
        Paragraph(_statement_discount_cell(r) if r.kind == "sale" else "-", s["compact_table_cell"]),
        Paragraph(gst_cell, s["compact_table_cell"]),
        Paragraph(amount_cell, s["compact_table_cell"]),
        Paragraph(paid_cell, s["compact_table_cell"]),
        Paragraph(_fmt_amount(r.running_balance), bold),
    ]


def _supply_customer_statement_opening_row_cells(s, opening_balance) -> list:
    dash = Paragraph("-", s["compact_table_cell"])
    bold = ParagraphStyle("CompactSupplyCustOpeningRow", parent=s["compact_table_cell"], fontName="Helvetica-Bold")
    return [
        Paragraph("Opening Balance", bold),
        dash, dash, dash, dash, dash, dash, dash, dash,
        Paragraph(_fmt_amount(opening_balance), bold),
    ]


def render_supply_customer_statement_pdf(
    customer, ledger: "schemas.ShopSupplyCustomerLedgerOut", generated_by: str, generated_at: str,
) -> bytes:
    """All-time statement PDF for one shop's own supply customer — the
    shop-scoped mirror of render_customer_statement_pdf, same compact
    A4-landscape design (see that function's docstring for the page-1
    vertical-budget math and manual page-chunking rationale, unchanged
    here). `customer` is a live ShopSupplyCustomer row; `ledger` is
    get_supply_customer_ledger's own output for it, read here, never
    recomputed — ledger.rows is latest-first (matching the on-screen modal),
    so the Opening Balance row, being the oldest entry, is the LAST row of
    the last page rather than the first row of the first."""
    usable_width = landscape(A4)[0] - 20 * mm  # 297mm - 10mm each side = 277mm
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=6 * mm, bottomMargin=6 * mm, leftMargin=10 * mm, rightMargin=10 * mm,
    )
    s = _styles()
    story = []
    story.extend(_compact_header_block(s, usable_width))

    party_bits = [customer.mobile] if customer.mobile else []
    addr_bits = [b for b in [customer.address] if b]
    if addr_bits:
        party_bits.append(", ".join(addr_bits))
    party_suffix = f" — {' · '.join(party_bits)}" if party_bits else ""
    as_of_date = generated_at.split(" ")[0]
    story.append(Paragraph("SUPPLY CUSTOMER STATEMENT", s["compact_doctype"]))
    story.append(Paragraph(
        f"<b>Statement For:</b> {customer.name}{party_suffix} "
        f"&nbsp;&nbsp;|&nbsp;&nbsp; <b>As of:</b> {as_of_date}",
        s["compact_customer_line"],
    ))
    story.append(Spacer(1, 1 * mm))

    story.append(_compact_summary_row(s, [
        ("Opening Balance", _fmt_amount(ledger.opening_balance), "#0B2138"),
        ("Total Sales (Due)", _fmt_amount(ledger.total_sales), "#0B2138"),
        ("Collected at Sale", _fmt_amount(ledger.total_collected_at_sale), "#1E8A5F"),
        ("Total Payments", _fmt_amount(ledger.total_payments), "#1E8A5F"),
        ("Closing Balance", _fmt_amount(ledger.closing_balance), "#0B2138"),
    ], usable_width))
    story.append(Spacer(1, 1 * mm))

    header_cells = [Paragraph(f"<b>{h}</b>", s["compact_table_header"]) for h in _SUPPLY_CUSTOMER_STATEMENT_HEADERS]
    chunks = [ledger.rows[i:i + STATEMENT_ROWS_PER_PAGE] for i in range(0, len(ledger.rows), STATEMENT_ROWS_PER_PAGE)] or [[]]

    for i, chunk in enumerate(chunks):
        is_last = i == len(chunks) - 1
        body_rows = [_supply_customer_statement_row_cells(s, r) for r in chunk]
        if is_last:
            body_rows = body_rows + [_supply_customer_statement_opening_row_cells(s, ledger.opening_balance)]
        if i > 0:
            story.append(PageBreak())
        table = _statement_table_chunk(s, header_cells, body_rows, _SUPPLY_CUSTOMER_STATEMENT_COL_WIDTHS)
        if is_last:
            opening_row = len(body_rows)  # table row 0 is the header, so the last body row sits at len(body_rows)
            table.setStyle(TableStyle([
                ("SPAN", (0, opening_row), (8, opening_row)),
                ("ALIGN", (0, opening_row), (0, opening_row), "LEFT"),
            ]))
        story.append(table)

    story.append(Spacer(1, 1 * mm))
    story.append(_totals_block(s, [("Closing Balance", ledger.closing_balance)]))

    story.append(Spacer(1, 1 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 0.5 * mm))
    story.append(Paragraph(f"System-generated document — printed by {generated_by} on {generated_at}.", s["compact_footer"]))
    doc.build(story)
    return buf.getvalue()
