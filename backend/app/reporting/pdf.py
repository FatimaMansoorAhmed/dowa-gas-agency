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
import re
from decimal import Decimal
from xml.sax.saxutils import escape

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_RIGHT

from app import schemas
from app.reporting.invoice_pdf import BUSINESS, _compact_header_block, _styles as _invoice_styles

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


# Matches Arabic-script code points, including the Presentation-Forms
# blocks arabic_reshaper emits (contextual joining forms) — used to find
# which runs of a post-bidi VISUAL string are Urdu (so they can be routed
# to the Urdu font) versus plain Latin/digit/punctuation (colons, the em
# dash, dates, names) that must stay on the paragraph's default Helvetica
# font, since Noto Naskh Arabic has no glyphs for those (module docstring
# point 3).
_ARABIC_RUN = re.compile(
    "[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+"
)

# Explicit LTR embedding marks (Unicode LRE/PDF). A value like a date
# ("2026-09-07") dropped as-is into an RTL logical string gets its
# hyphen-separated number groups reordered by the bidi algorithm — the
# hyphens are "common separator" characters that pick up the surrounding
# RTL paragraph direction, so the algorithm treats each digit group as its
# own island and reshuffles them (observed: "2026-09-07" -> "07-09-2026").
# Wrapping the value in LRE...PDF forces it to resolve as one strict-LTR
# run regardless of context, so its internal order is untouched; the marks
# themselves carry no glyph and are dropped by get_display() before the
# text reaches ReportLab.
_LRE, _PDF = "‪", "‬"


def _ltr(text: str) -> str:
    """Wrap a Latin/digit value so bidi reordering can't touch its
    internal character order — see _LRE/_PDF comment above."""
    return _LRE + text + _PDF


def _mixed_line(logical: str, bold: bool = False) -> str:
    """Shape + bidi-reorder ONE full line built in natural logical reading
    order (e.g. "Label1: Value1 — Label2: Value2", with Urdu labels and
    Latin/digit values interleaved) and return markup ready to drop into a
    right-aligned Paragraph.

    Earlier versions of this function built each "Label: Value" piece by
    calling _ur()/label() on the Urdu label ALONE, then manually
    concatenating it with the (untouched) Latin value in whatever order
    was needed to make it draw in the right screen position. That works
    for exactly one pair, but breaks for a line with two label:value pairs
    joined by "—": there is no ordering of a flat, already-isolated-per-
    piece concatenation that reverses label/value *within* each pair
    without also reversing which pair comes first — reversing the whole
    chain swaps pair order along with it.

    The fix is to not pre-reorder anything by hand: build the LOGICAL
    string in natural reading order (label1, value1, dash, label2, value2
    — exactly as a human would read it aloud) using the raw, unshaped Urdu
    label text, then run arabic_reshaper + get_display ONCE over the
    entire line. The Unicode bidi algorithm (UAX#9) is specifically
    designed for "RTL paragraph with embedded LTR runs": it reverses each
    Urdu run in place, leaves each Latin/digit run's internal character
    order untouched, and positions the runs relative to each other
    correctly — i.e. it fixes each pair's internal order while preserving
    pair-to-pair sequence, which is exactly what a hand-rolled reversal
    cannot do.
    """
    visual = get_display(arabic_reshaper.reshape(logical))
    face = URDU_FONT_BOLD if bold else URDU_FONT
    out: list[str] = []
    last = 0
    for m in _ARABIC_RUN.finditer(visual):
        if m.start() > last:
            out.append(visual[last:m.start()])
        out.append(f'<font face="{face}">{m.group()}</font>')
        last = m.end()
    out.append(visual[last:])
    return "".join(out)


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


def _compact_tile_row(tiles: list[tuple], total_width) -> Table:
    """§ WhatsApp PDF Redesign — Visual-Language-Match: visual mirror of
    invoice_pdf.py's _compact_summary_row (same box/background/padding, so
    the Daily Report's summary reads as one system with the Shop
    Statement), but taking a pre-built label Paragraph per tile instead of
    a raw string — that shared function always wraps a raw string in its
    own plain-Helvetica style, which would render an Urdu label as missing
    glyphs (no <font face="..."> tag applied). Kept local to this file
    rather than generalizing the shared one, since no other caller needs
    bilingual tile labels."""
    n = len(tiles)
    col_width = total_width / n
    value_style = ParagraphStyle("DailyTileValue", fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.HexColor("#1A2B33"))
    cells = [
        [label_para, Paragraph(f'<font color="{color}">{value}</font>', value_style)]
        for label_para, value, color in tiles
    ]
    t = Table([cells], colWidths=[col_width] * n)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#C5C1B4")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C5C1B4")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAFAF8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


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

    # § WhatsApp PDF Redesign — Visual-Language-Match: landscape, same as
    # the Shop Statement, so the compact tile-row summary below has room
    # to hold all 11 metrics on one line instead of a tall 4-column grid.
    usable_width = landscape(A4)[0] - 20 * mm  # 297mm - 10mm each side = 277mm
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        topMargin=8 * mm, bottomMargin=8 * mm, leftMargin=10 * mm, rightMargin=10 * mm,
    )
    styles = getSampleStyleSheet()

    # Paragraph default font is ALWAYS Helvetica — Urdu segments opt in via
    # an explicit <font face="..."> tag from _urdu_span()/label() above, so
    # a single Paragraph can freely mix "DOWA Gas Agency" (Latin) with a
    # shaped Urdu label (see module docstring point 3).
    rtl = TA_RIGHT if is_ur else styles["Title"].alignment
    title_style = ParagraphStyle("ReportTitle", parent=styles["Title"], fontSize=14, spaceAfter=2, alignment=rtl)
    meta_style = ParagraphStyle("ReportMeta", parent=styles["Normal"], fontSize=8.5, textColor=colors.grey, alignment=rtl)
    section_style = ParagraphStyle("SectionHeading", parent=styles["Heading2"], fontSize=11, spaceBefore=8, spaceAfter=3, alignment=rtl)
    empty_style = ParagraphStyle("EmptySection", parent=styles["Normal"], fontSize=9, textColor=colors.grey, alignment=rtl)
    cell_style = ParagraphStyle("Cell", parent=styles["Normal"], fontSize=8)

    bold_font = URDU_FONT_BOLD if is_ur else "Helvetica-Bold"
    # § WhatsApp PDF Redesign — Visual-Language-Match: real logo/address
    # header block, same one the Shop Statement uses (invoice_pdf.py's
    # _compact_header_block) — company info is always plain Latin
    # regardless of report language, so it needs no Urdu-shaping at all,
    # unlike everything else in this function.
    invoice_styles = _invoice_styles()
    story = list(_compact_header_block(invoice_styles, usable_width))

    title_text = _urdu_span('روزانہ رپورٹ') if is_ur else "Daily Report"
    # Both header lines below are built as ONE logical string in natural
    # reading order — label(s) then value(s), left pair before right pair,
    # exactly as read aloud — and, in Urdu, run through _mixed_line() ONCE
    # so the bidi algorithm (not hand-rolled reversal) reorders each
    # label:value pair internally while preserving pair-to-pair sequence.
    # See _mixed_line()'s docstring for why per-piece manual reversal
    # cannot do this for a line with more than one pair.
    business_date_text = (
        _mixed_line(strings["business_date_prefix"] + _ltr(escape(data.business_date))) if is_ur
        else (label("business_date_prefix") + escape(data.business_date))
    )
    # The " — " separator is deliberately plain literal text (default
    # Helvetica), never inside a _urdu_span() tag — Noto Naskh Arabic has
    # no em-dash glyph (confirmed by inspecting its cmap), so embedding it
    # in a shaped Urdu string silently drops it. _mixed_line() leaves it on
    # Helvetica automatically since "—" falls outside _ARABIC_RUN.
    dash = " — " if is_ur else ""
    generated_text = (
        _mixed_line(
            strings["generated_by_prefix"] + _ltr(escape(generated_by)) + dash
            + strings["generated_on_prefix"] + _ltr(escape(generated_at))
        ) if is_ur else (
            label("generated_by_prefix") + escape(generated_by) + dash
            + label("generated_on_prefix") + escape(generated_at)
        )
    )

    story += [
        Paragraph(title_text, title_style),
        Paragraph(business_date_text, meta_style),
        Paragraph(generated_text, meta_style),
        Spacer(1, 2 * mm),
    ]

    tile_label_style = ParagraphStyle("DailyTileLabel", fontName=bold_font, fontSize=6, textColor=colors.HexColor("#64748B"), alignment=TA_RIGHT if is_ur else 0)

    def tile_label(key: str) -> str:
        """label(key), all-caps for English (matching every other compact
        tile row's SHOUTY style) — never .upper()'d for Urdu, which would
        uppercase the <font face="..."> tag label() already wrapped it in
        and break the font lookup, not just the (case-less) Urdu text."""
        return label(key).upper() if not is_ur else label(key)

    s = data.summary
    # § WhatsApp PDF Redesign — Visual-Language-Match: the old 4-column/
    # 6-row bordered grid replaced with one compact tile row (same visual
    # language as the Shop Statement's summary row) — all 11 metrics side
    # by side instead of stacked, so the summary costs one short row
    # instead of a page-eating block. Every figure is the exact same one
    # the old grid showed, just re-laid-out.
    story.append(_compact_tile_row([
        (Paragraph(tile_label("sales"), tile_label_style), _fmt_amount(s.total_sales), "#0B2138"),
        (Paragraph(tile_label("purchases"), tile_label_style), _fmt_amount(s.total_purchases), "#0B2138"),
        (Paragraph(tile_label("delivery_charges"), tile_label_style), _fmt_amount(s.total_delivery_charges), "#0B2138"),
        (Paragraph(tile_label("customer_payments"), tile_label_style), _fmt_amount(s.total_customer_payments), "#1E8A5F"),
        (Paragraph(tile_label("plant_payments"), tile_label_style), _fmt_amount(s.total_plant_payments), "#9B4A4A"),
        (Paragraph(tile_label("investments"), tile_label_style), _fmt_amount(s.total_investments), "#1E8A5F"),
        (Paragraph(tile_label("expenses"), tile_label_style), _fmt_amount(s.total_expenses), "#9B4A4A"),
        (Paragraph(tile_label("owner_drawings"), tile_label_style), _fmt_amount(s.total_owner_drawings), "#9B4A4A"),
        (Paragraph(tile_label("net_cash_movement"), tile_label_style), _fmt_amount(s.net_cash_movement), "#0B2138"),
        (Paragraph(tile_label("cylinders_out"), tile_label_style), str(s.total_cylinders_out), "#0B2138"),
        (Paragraph(tile_label("cylinders_in"), tile_label_style), str(s.total_cylinders_in), "#0B2138"),
    ], usable_width))
    story.append(Spacer(1, 3 * mm))

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
        # § WhatsApp PDF Redesign — Visual-Language-Match: teal header
        # background + white text, same as the Shop Statement's per-page
        # table header (invoice_pdf.py's _statement_table_chunk), replacing
        # the old plain grey header — landscape's extra width also goes
        # to wider Description/Customer-Plant columns instead of staying
        # cramped at the old portrait widths.
        table = Table(table_rows, colWidths=[18 * mm, 24 * mm, 65 * mm, 40 * mm, 25 * mm, 26 * mm, 24 * mm, 25 * mm], repeatRows=1)
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("FONTNAME", (0, 0), (-1, 0), bold_font),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F8B8D")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (-1, 0), "RIGHT" if is_ur else "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(table)

    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(f"System-generated document — printed by {escape(generated_by)} on {escape(generated_at)}.", invoice_styles["compact_footer"]))

    doc.build(story)
    return buf.getvalue()
