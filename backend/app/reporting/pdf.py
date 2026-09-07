"""Renders the Daily Report PDF (§5) from DailyReportDataOut — the exact
same object the Daily Activity screen renders on-screen and prints
(app.reporting.daily.get_daily_report_data), so the PDF can never show
numbers that disagree with what's on screen.

§ Phase D3 — Daily Report Urdu translation: every generation produces one
English PDF and one Urdu PDF from this same function (language="en"/"ur").
Urdu text needs real work ReportLab does not do on its own:

  1. Shaping + bidi reordering (arabic_reshaper + python-bidi) — without
     this, ReportLab draws the raw logical-order Unicode code points with
     no contextual letter-joining, unreadable for Arabic-script text.
     `_ur()` is the single choke point every Urdu UI string passes through.
  2. A font whose cmap actually has glyphs for the shaped output. This
     ruled out Noto Nastaliq Urdu (the visually "proper" Nastaliq style)
     despite being the original plan: it only maps base Arabic code points
     and relies on an OpenType GSUB shaping engine for contextual forms —
     which ReportLab does not have — so the Presentation-Forms code points
     arabic_reshaper produces have NO glyph in that font at all (silently
     blank text, confirmed by rendering and inspecting the font's cmap).
     Noto Naskh Arabic maps the full Presentation-Forms block directly, so
     the reshape+bidi approach actually has glyphs to draw — this is the
     Naskh half of the original "Nastaliq/Naskh-capable" requirement.
  3. Noto Naskh Arabic is Arabic-script-only — it has NO Latin letters,
     digits are present but not punctuation like em-dash. Every string
     that mixes Urdu labels with Latin/numeric data (a brand name, a
     generated-by name, a date, an amount) must therefore keep the Latin
     portion in the paragraph's default (Helvetica) font and wrap ONLY the
     Urdu portion in an inline `<font face="...">` tag — see `_urdu_span()`.
"""
import io
import os
from decimal import Decimal
from xml.sax.saxutils import escape

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_RIGHT

from app import schemas

FONTS_DIR = os.path.join(os.path.dirname(__file__), "fonts")
URDU_FONT = "NotoNaskhArabic"
URDU_FONT_BOLD = "NotoNaskhArabic-Bold"

_fonts_registered = False


def _ensure_urdu_font_registered() -> None:
    global _fonts_registered
    if _fonts_registered:
        return
    pdfmetrics.registerFont(TTFont(URDU_FONT, os.path.join(FONTS_DIR, "NotoNaskhArabic-Regular.ttf")))
    pdfmetrics.registerFont(TTFont(URDU_FONT_BOLD, os.path.join(FONTS_DIR, "NotoNaskhArabic-Bold.ttf")))
    _fonts_registered = True


def _ur(text: str) -> str:
    """Shape + bidi-reorder one piece of Urdu text for ReportLab. reshape()
    does contextual letter-joining, get_display() reorders it into the
    visual (left-to-right-storage) order ReportLab expects, since ReportLab
    itself has no bidi algorithm."""
    return get_display(arabic_reshaper.reshape(text))


def _urdu_span(text: str, bold: bool = False) -> str:
    """A shaped Urdu string wrapped for embedding inside a Paragraph that
    otherwise defaults to Helvetica — see module docstring point 3."""
    face = URDU_FONT_BOLD if bold else URDU_FONT
    return f'<font face="{face}">{_ur(text)}</font>'


# Fixed section-key -> Urdu label map. Reuses the exact wording already
# locked in the domain-terms glossary and used across the frontend
# (dailyActivity.*, nav.expenses, unifiedSale.ownerDrawings, cashBook.*) for
# every key that has a direct precedent. The remaining five keys
# (cylinder_activity, empty_cylinder_sales, shop_sales,
# shop_customer_payments, account_transfers) have no exact frontend match
# yet — built as straightforward compounds of already-locked terms
# (فروخت=Sales, دکان=Shop, سلنڈر=Cylinder, خالی=Empty) rather than new
# vocabulary, but flagged for review since they weren't in the reviewed
# glossary artifact.
_SECTION_LABELS_UR: dict[str, str] = {
    "sales": "فروخت",
    "purchases": "خریداری",
    "customer_payments": "گاہک ادائیگیاں",
    "plant_payments": "پلانٹ ادائیگیاں",
    "investments": "سرمایہ کاری",
    "expenses": "اخراجات",
    "owner_drawings": "مالک کے ذاتی اخراجات",
    "cylinder_activity": "سلنڈر کی سرگرمی (فروخت کے علاوہ)",
    "empty_cylinder_sales": "خالی سلنڈر کی فروخت",
    "shop_sales": "دکان کی فروخت",
    "shop_customer_payments": "دکان گاہک ادائیگیاں",
    "shop_expenses": "دکان کے اخراجات",
    "shop_owner_withdrawals": "دکان مالک کی نکاسی",
    "account_transfers": "اکاؤنٹ ٹرانسفرز",
    "delivery_charges": "ترسیل کے اخراجات",
}

_STRINGS_UR = {
    "daily_summary": "روزانہ کا خلاصہ",
    "sales": "فروخت",
    "delivery_charges": "ترسیل کے اخراجات",
    "purchases": "خریداری",
    "customer_payments": "گاہک ادائیگیاں",
    "plant_payments": "پلانٹ ادائیگیاں",
    "investments": "سرمایہ کاری",
    "expenses": "اخراجات",
    "owner_drawings": "مالک کے ذاتی اخراجات",
    "net_cash_movement": "خالص نقد آمد و رفت",
    "cylinders_out": "باہر جانے والے سلنڈر",
    "cylinders_in": "واپس آنے والے سلنڈر",
    "no_activity": "اس تاریخ کے لیے کوئی سرگرمی نہیں۔",
    "total_prefix": "کل: ",
    "business_date_prefix": "کاروباری تاریخ: ",
    "generated_by_prefix": "تیار کنندہ: ",
    "generated_on_prefix": "تاریخ: ",
    "col_date": "تاریخ و وقت",
    "col_id": "آئی ڈی",
    "col_description": "تفصیل",
    "col_customer_plant": "گاہک یا پلانٹ",
    "col_reference": "حوالہ",
    "col_entered_by": "درج کنندہ",
    "col_status": "حیثیت",
    "col_amount": "رقم",
}

_STRINGS_EN = {
    "daily_summary": "Daily Summary",
    "sales": "Sales",
    "delivery_charges": "Delivery Charges",
    "purchases": "Purchases",
    "customer_payments": "Customer Payments",
    "plant_payments": "Plant Payments",
    "investments": "Investments",
    "expenses": "Expenses",
    "owner_drawings": "Owner Drawings",
    "net_cash_movement": "Net Cash Movement",
    "cylinders_out": "Cylinders Out",
    "cylinders_in": "Cylinders In",
    "no_activity": "No activity for this date.",
    "total_prefix": "Total: ",
    "business_date_prefix": "Business Date: ",
    "generated_by_prefix": "Generated by ",
    "generated_on_prefix": " on ",
    "col_date": "Date/Time",
    "col_id": "ID",
    "col_description": "Description",
    "col_customer_plant": "Customer/Plant",
    "col_reference": "Reference",
    "col_entered_by": "Entered By",
    "col_status": "Status",
    "col_amount": "Amount",
}


def _fmt_amount(value) -> str:
    if value is None:
        return ""
    return f"{Decimal(value):,.2f}"


def render_daily_report_pdf(
    data: "schemas.DailyReportDataOut", generated_by: str, generated_at: str, language: str = "en",
) -> bytes:
    is_ur = language == "ur"
    strings = _STRINGS_UR if is_ur else _STRINGS_EN

    def label(key: str, bold: bool = False) -> str:
        """A pure UI-copy string (no interpolated Latin data) — plain text
        in English, shaped+font-tagged in Urdu."""
        return _urdu_span(strings[key], bold=bold) if is_ur else strings[key]

    def header_cell(key: str) -> str:
        """Table header text — never mixed-script, so no font tag needed;
        the header row's own FONTNAME (set on the Table below) already
        carries the right font for the whole cell."""
        return _ur(strings[key]) if is_ur else strings[key]

    def section_label(section) -> str:
        text = _SECTION_LABELS_UR.get(section.key, section.label) if is_ur else section.label
        return _urdu_span(text, bold=True) if is_ur else text

    if is_ur:
        _ensure_urdu_font_registered()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=16 * mm, bottomMargin=16 * mm, leftMargin=14 * mm, rightMargin=14 * mm,
    )
    styles = getSampleStyleSheet()

    # Paragraph default font is ALWAYS Helvetica — Urdu segments opt in via
    # an explicit <font face="..."> tag from _urdu_span()/label() above, so
    # a single Paragraph can freely mix "DOWA Gas Agency" (Latin) with a
    # shaped Urdu label (see module docstring point 3).
    rtl = TA_RIGHT if is_ur else styles["Title"].alignment
    title_style = ParagraphStyle("ReportTitle", parent=styles["Title"], fontSize=16, spaceAfter=2, alignment=rtl)
    meta_style = ParagraphStyle("ReportMeta", parent=styles["Normal"], fontSize=9, textColor=colors.grey, alignment=rtl)
    section_style = ParagraphStyle("SectionHeading", parent=styles["Heading2"], fontSize=12, spaceBefore=12, spaceAfter=4, alignment=rtl)
    empty_style = ParagraphStyle("EmptySection", parent=styles["Normal"], fontSize=9, textColor=colors.grey, alignment=rtl)
    cell_style = ParagraphStyle("Cell", parent=styles["Normal"], fontSize=8)

    title_text = f"DOWA Gas Agency — {_urdu_span('روزانہ رپورٹ') if is_ur else 'Daily Report'}"
    # Urdu label:value order (§ Urdu label:value ordering bug) — label(key)
    # already shapes+bidi-reorders the Urdu text in ISOLATION (get_display()
    # only sees that one piece), so its own internal word order is correct
    # RTL. But this whole paragraph is right-aligned (alignment=rtl above)
    # and ReportLab draws left-to-right in plain Python-concatenation
    # order with no bidi pass of its own — so whichever piece comes LAST in
    # the f-string ends up drawn furthest right, i.e. read FIRST by an RTL
    # reader once the line is shifted to hug the right margin. label+value
    # (the natural-looking logical order) therefore rendered as
    # value-then-label visually — the value ended up rightmost, read
    # before the label. Fixed by reversing to value-then-label in the
    # Python string, in Urdu ONLY, so the label (last in this order) lands
    # rightmost: the value is a plain LTR run either way, so its own
    # internal digit order is unaffected by which side of the label it's on.
    business_date_text = (
        (escape(data.business_date) + label("business_date_prefix")) if is_ur
        else (label("business_date_prefix") + escape(data.business_date))
    )
    # The " — " separator is deliberately plain literal text (default
    # Helvetica), never inside a _urdu_span() tag — Noto Naskh Arabic has
    # no em-dash glyph (confirmed by inspecting its cmap), so embedding it
    # in a shaped Urdu string silently drops it.
    dash = " — " if is_ur else ""
    # Same reversal as business_date_text above, applied to the whole
    # "by X — on Y" chain: for a right-aligned RTL line, the piece that
    # should be read FIRST (label 1) must be LAST in draw order, so the
    # entire logical sequence [label1, value1, dash, label2, value2] is
    # reversed piece-by-piece (not just swapped within each pair) —
    # verified empirically against the rendered PDF's actual glyph
    # x-positions, not assumed.
    generated_text = (
        (
            escape(generated_at) + label("generated_on_prefix") + dash
            + escape(generated_by) + label("generated_by_prefix")
        ) if is_ur else (
            label("generated_by_prefix") + escape(generated_by) + dash
            + label("generated_on_prefix") + escape(generated_at)
        )
    )

    story = [
        Paragraph(title_text, title_style),
        Paragraph(business_date_text, meta_style),
        Paragraph(generated_text, meta_style),
        Spacer(1, 8 * mm),
    ]

    bold_font = URDU_FONT_BOLD if is_ur else "Helvetica-Bold"
    label_style = ParagraphStyle("SLabel", fontName=bold_font, fontSize=9, alignment=TA_RIGHT if is_ur else 0)

    s = data.summary
    summary_rows = [
        [label("sales", bold=True), _fmt_amount(s.total_sales), label("purchases", bold=True), _fmt_amount(s.total_purchases)],
        [label("delivery_charges", bold=True), _fmt_amount(s.total_delivery_charges), "", ""],
        [label("customer_payments", bold=True), _fmt_amount(s.total_customer_payments), label("plant_payments", bold=True), _fmt_amount(s.total_plant_payments)],
        [label("investments", bold=True), _fmt_amount(s.total_investments), label("expenses", bold=True), _fmt_amount(s.total_expenses)],
        [label("owner_drawings", bold=True), _fmt_amount(s.total_owner_drawings), label("net_cash_movement", bold=True), _fmt_amount(s.net_cash_movement)],
        [label("cylinders_out", bold=True), str(s.total_cylinders_out), label("cylinders_in", bold=True), str(s.total_cylinders_in)],
    ]
    # Labels (col 0/2) use the language-aware bold font (bare UI copy,
    # never mixed with Latin data, so a Paragraph carries the <font> tag
    # cleanly); values (col 1/3) are always plain Latin digits, so they
    # stay on Helvetica as plain table-cell strings regardless of language.
    summary_table = Table(
        [[Paragraph(v, label_style) if i in (0, 2) else v for i, v in enumerate(row)] for row in summary_rows],
        colWidths=[45 * mm, 40 * mm, 45 * mm, 40 * mm],
    )
    summary_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("ALIGN", (3, 0), (3, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(Paragraph(label("daily_summary"), section_style))
    story.append(summary_table)

    header = [
        header_cell("col_date"), header_cell("col_id"), header_cell("col_description"), header_cell("col_customer_plant"),
        header_cell("col_reference"), header_cell("col_entered_by"), header_cell("col_status"), header_cell("col_amount"),
    ]
    for section in data.sections:
        if section.financial_total is not None:
            total_text = label("total_prefix") + escape(_fmt_amount(section.financial_total))
            heading = f"{section_label(section)} — {total_text}"
        else:
            heading = section_label(section)
        story.append(Paragraph(heading, section_style))
        if not section.rows:
            story.append(Paragraph(label("no_activity"), empty_style))
            continue
        table_rows = [header]
        # Row data (description, customer/plant, reference, entered_by,
        # status) is user-entered/proper-noun content, not UI copy — it is
        # never translated in either language, only the column headers and
        # section labels above are, so these cells always stay on Helvetica.
        for r in section.rows:
            table_rows.append([
                r.date.strftime("%H:%M"),
                r.display_id,
                Paragraph(escape(r.description), cell_style),
                r.customer or r.plant or "",
                r.reference or "",
                r.entered_by,
                r.approval_info or r.status,
                _fmt_amount(r.amount),
            ])
        table = Table(table_rows, colWidths=[16 * mm, 22 * mm, 45 * mm, 30 * mm, 20 * mm, 22 * mm, 22 * mm, 20 * mm], repeatRows=1)
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("FONTNAME", (0, 0), (-1, 0), bold_font),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (-1, 0), "RIGHT" if is_ur else "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(table)

    doc.build(story)
    return buf.getvalue()
