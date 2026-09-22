"""§ WhatsApp Inbound Request Flow — the "reports" conversation itself:
matching an inbound sender against the WhatsAppRecipient allowlist,
parsing "reports" / a date / a language out of free-form message text,
and driving the WhatsAppConversationState machine that remembers which
step a phone number is on between one stateless webhook delivery and the
next (app/routers/whatsapp_webhook.py calls into this module; it does no
message-content logic of its own).

State machine, per phone_number:
  * no row (or a stale one — see STALE_AFTER) = idle, waiting for the
    trigger word.
  * "awaiting_date"     = trigger seen, still need a business_date.
  * "awaiting_language" = business_date known, still need "ur"/"en".
Sending "reports" at any point restarts the conversation from scratch —
this module never resumes a stale or superseded state.

Every branch replies over WhatsApp (whatsapp.send_text/send_document) and
returns without raising; a send failure or PDF-generation failure is
reported back to the user as a message, never surfaced as a 500 to
Meta's webhook caller (app/routers/whatsapp_webhook.py always acks 200
regardless).
"""
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app import models, whatsapp
from app.routers.reports import find_or_generate_daily_report
from app.timezone import KARACHI_TZ

logger = logging.getLogger(__name__)

TRIGGER_WORD = "reports"
STALE_AFTER = timedelta(minutes=10)

_ARABIC_INDIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

_LANGUAGE_TOKENS = {
    "1": "ur", "urdu": "ur", "ur": "ur", "اردو": "ur",
    "2": "en", "english": "en", "en": "en", "انگریزی": "en",
}

_ISO_DATE_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$")
_DAY_FIRST_DATE_RE = re.compile(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$")
_DATE_LIKE_RE = re.compile(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$")

LANGUAGE_LABEL = {"ur": "Urdu / اردو", "en": "English"}


def _karachi_today() -> str:
    return datetime.now(KARACHI_TZ).strftime("%Y-%m-%d")


def _normalize_token(token: str) -> str:
    return token.strip().translate(_ARABIC_INDIC_DIGITS).lower()


def parse_language_token(token: str) -> str | None:
    return _LANGUAGE_TOKENS.get(_normalize_token(token))


def parse_date_token(token: str, today: str | None = None) -> tuple[str | None, str | None]:
    """Returns (business_date, error). business_date is "YYYY-MM-DD" (the
    same convention get_daily_report_data/_generate_daily_report already
    require) on success. On failure, business_date is None; error is a
    user-facing reason ONLY when the token looked like an attempted date
    (digits + a separator) — an unrelated word (e.g. "urdu") is neither a
    match nor an error, so the caller can keep looking for a date
    elsewhere in the message instead of complaining about it.

    Accepts "today"/"yesterday", ISO YYYY-MM-DD (the convention used
    everywhere else in this app), and day-first DD-MM-YYYY (§ Confirmed
    date input) — both with "-" or "/" as the separator. Rejects a
    syntactically valid date that's in the future: a report can't exist
    yet for a day that hasn't started."""
    today = today or _karachi_today()
    normalized = _normalize_token(token)

    if normalized == "today":
        return today, None
    if normalized == "yesterday":
        d = datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)
        return d.strftime("%Y-%m-%d"), None

    m = _ISO_DATE_RE.match(normalized)
    if m:
        y, mo, d = m.groups()
        try:
            business_date = datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
        except ValueError:
            return None, "That's not a real date. Use YYYY-MM-DD, e.g. 2026-09-21."
        if business_date > today:
            return None, f"{business_date} hasn't happened yet — I can't report on the future."
        return business_date, None

    m = _DAY_FIRST_DATE_RE.match(normalized)
    if m:
        d, mo, y = m.groups()
        try:
            business_date = datetime(int(y), int(mo), int(d)).strftime("%Y-%m-%d")
        except ValueError:
            return None, "That's not a real date. Use DD-MM-YYYY, e.g. 21-09-2026."
        if business_date > today:
            return None, f"{business_date} hasn't happened yet — I can't report on the future."
        return business_date, None

    if _DATE_LIKE_RE.match(normalized):
        return None, "I couldn't read that date. Use YYYY-MM-DD or DD-MM-YYYY, e.g. 2026-09-21 or 21-09-2026."

    return None, None


def _echo_date(business_date: str) -> str:
    """Human-readable form alongside the ISO one, e.g. "2026-09-21 (Sun,
    21 Sep 2026)" — the confirmation-by-echo that catches a day-first/
    month-first slip (§ Confirmed date input) without an extra round
    trip: the very next prompt shows both forms of what was understood."""
    d = datetime.strptime(business_date, "%Y-%m-%d")
    return f"{business_date} ({d.strftime('%a, %d %b %Y')})"


def _resolve_recipient(db: Session, sender_e164: str) -> models.WhatsAppRecipient | None:
    """Matches an already-normalized sender number against the active
    WhatsAppRecipient allowlist — normalizing each stored row the same
    way create_whatsapp_recipient does, so a legacy/differently-formatted
    stored number still matches correctly rather than silently failing
    (or, worse, colliding with the wrong row). Exact string equality
    only — no partial/suffix matching."""
    for recipient in db.query(models.WhatsAppRecipient).filter(models.WhatsAppRecipient.active == "active").all():
        try:
            normalized = whatsapp.normalize_phone_number(recipient.phone_number)
        except ValueError:
            normalized = recipient.phone_number
        if normalized == sender_e164:
            return recipient
    return None


def _get_state(db: Session, phone_number: str) -> models.WhatsAppConversationState | None:
    state = db.query(models.WhatsAppConversationState).get(phone_number)
    if state and (datetime.utcnow() - state.updated_at) > STALE_AFTER:
        db.delete(state)
        db.commit()
        return None
    return state


def _set_state(db: Session, phone_number: str, state: str, pending_date: str | None, pending_language: str | None, wamid: str) -> None:
    row = db.query(models.WhatsAppConversationState).get(phone_number)
    if row is None:
        row = models.WhatsAppConversationState(phone_number=phone_number)
    row.state = state
    row.pending_date = pending_date
    row.pending_language = pending_language
    row.last_wamid = wamid
    db.add(row)
    db.commit()


def _clear_state(db: Session, phone_number: str) -> None:
    row = db.query(models.WhatsAppConversationState).get(phone_number)
    if row:
        db.delete(row)
        db.commit()


def _send_report(db: Session, recipient: models.WhatsAppRecipient, business_date: str, language: str) -> None:
    """Finds/generates the report and sends it, logging the attempt to
    WhatsAppSendLog either way (§ Reuse WhatsAppSendLog for audit trail)
    — same table the old scheduler auto-send used, now also covering
    on-request sends."""
    to = recipient.phone_number
    try:
        report = find_or_generate_daily_report(db, business_date, language)
    except Exception:
        logger.exception("On-request report generation failed for %s / %s", business_date, language)
        whatsapp.send_text(to, f"Sorry, I couldn't generate the report for {business_date}. Please try again shortly, or use the app directly.")
        return

    filename = f"Daily_Report_{business_date}.pdf"
    caption = f"DOWA Gas Agency — Daily Report for {business_date} ({LANGUAGE_LABEL[language]})"
    ok, error = whatsapp.send_document(report.file_path, filename, to, caption=caption)

    db.add(models.WhatsAppSendLog(
        report_id=report.id, recipient_id=recipient.id,
        status="sent" if ok else "failed", error=None if ok else error,
    ))
    db.commit()

    if not ok:
        logger.warning("WhatsApp on-request send to %s failed: %s", to, error)
        whatsapp.send_text(to, "Sorry, I generated the report but couldn't send it over WhatsApp. Please try again shortly.")


def handle_inbound_message(db: Session, from_number: str, text: str, wamid: str) -> None:
    """Entry point called once per inbound text message the webhook
    accepts (app/routers/whatsapp_webhook.py already verified the
    signature and that this is a `messages` payload before calling in).
    Does the allowlist check itself — the caller only knows this is SOME
    WhatsApp message, not that it's from someone permitted to see
    financial reports."""
    try:
        sender_e164 = whatsapp.normalize_phone_number(from_number)
    except ValueError:
        logger.info("Ignoring inbound WhatsApp message from a non-Pakistan-mobile sender")
        return

    masked = sender_e164[:4] + "…" + sender_e164[-3:]
    recipient = _resolve_recipient(db, sender_e164)
    if not recipient:
        logger.info("Ignoring inbound WhatsApp message from unrecognized number %s", masked)
        return
    logger.info("Sender %s matched allowlist recipient id=%s", masked, recipient.id)

    body = (text or "").strip()
    if not body:
        return

    tokens = body.split()
    state = _get_state(db, sender_e164)
    logger.info("Message body=%r, existing state=%s", body, state.state if state else None)

    if tokens and _normalize_token(tokens[0]) == TRIGGER_WORD:
        logger.info("Trigger word matched for %s, starting conversation", masked)
        _start_conversation(db, sender_e164, tokens[1:], wamid)
        return

    normalized_body = _normalize_token(body)
    if normalized_body == "cancel":
        if state:
            _clear_state(db, sender_e164)
            whatsapp.send_text(sender_e164, "Cancelled. Send *reports* to start again.")
        return

    if state is None:
        whatsapp.send_text(sender_e164, 'Send *reports* to request a Daily Report.')
        return

    if state.last_wamid == wamid:
        # Meta redelivered a webhook we already handled — never process
        # the same reply twice (e.g. sending a second copy of the PDF).
        return

    if state.state == "awaiting_date":
        _handle_date_reply(db, sender_e164, state, body, wamid)
    elif state.state == "awaiting_language":
        _handle_language_reply(db, sender_e164, recipient, state, body, wamid)
    else:  # pragma: no cover - defensive; state is one of the two values above
        _clear_state(db, sender_e164)


def _start_conversation(db: Session, sender_e164: str, extra_tokens: list[str], wamid: str) -> None:
    """Handles the trigger message itself, including shortcuts packed
    into the same message (e.g. "reports urdu 2026-09-21") — always a
    fresh start, overwriting whatever state existed before."""
    business_date: str | None = None
    language: str | None = None
    date_error: str | None = None

    for token in extra_tokens:
        lang = parse_language_token(token)
        if lang and language is None:
            language = lang
            continue
        parsed_date, error = parse_date_token(token)
        if parsed_date and business_date is None:
            business_date = parsed_date
        elif error and date_error is None:
            date_error = error

    if date_error:
        whatsapp.send_text(sender_e164, date_error + " Send *reports* to start again.")
        _clear_state(db, sender_e164)
        return

    if business_date and language:
        _clear_state(db, sender_e164)
        whatsapp.send_text(sender_e164, f"Sending the {LANGUAGE_LABEL[language]} report for {_echo_date(business_date)}…")
        recipient = _resolve_recipient(db, sender_e164)
        if recipient:
            _send_report(db, recipient, business_date, language)
        return

    if business_date:
        _set_state(db, sender_e164, "awaiting_language", business_date, None, wamid)
        whatsapp.send_text(sender_e164, f"Report for {_echo_date(business_date)} — Urdu or English? Reply 1 for Urdu / اردو, 2 for English.")
        return

    _set_state(db, sender_e164, "awaiting_date", None, language, wamid)
    whatsapp.send_text(
        sender_e164,
        "Which date's report would you like? Reply with a date (YYYY-MM-DD or DD-MM-YYYY, "
        "e.g. 2026-09-21 or 21-09-2026), or \"today\" / \"yesterday\".",
    )


def _handle_date_reply(db: Session, sender_e164: str, state: models.WhatsAppConversationState, body: str, wamid: str) -> None:
    business_date, error = parse_date_token(body)
    if not business_date:
        _set_state(db, sender_e164, "awaiting_date", None, state.pending_language, wamid)
        whatsapp.send_text(
            sender_e164,
            (error or "I didn't understand that date.")
            + ' Reply with a date (YYYY-MM-DD or DD-MM-YYYY), or "today" / "yesterday".',
        )
        return

    if state.pending_language:
        language = state.pending_language
        _clear_state(db, sender_e164)
        whatsapp.send_text(sender_e164, f"Sending the {LANGUAGE_LABEL[language]} report for {_echo_date(business_date)}…")
        recipient = _resolve_recipient(db, sender_e164)
        if recipient:
            _send_report(db, recipient, business_date, language)
        return

    _set_state(db, sender_e164, "awaiting_language", business_date, None, wamid)
    whatsapp.send_text(sender_e164, f"Report for {_echo_date(business_date)} — Urdu or English? Reply 1 for Urdu / اردو, 2 for English.")


def _handle_language_reply(
    db: Session, sender_e164: str, recipient: models.WhatsAppRecipient,
    state: models.WhatsAppConversationState, body: str, wamid: str,
) -> None:
    language = parse_language_token(body)
    if not language:
        _set_state(db, sender_e164, "awaiting_language", state.pending_date, None, wamid)
        whatsapp.send_text(sender_e164, "Please reply 1 for Urdu / اردو, or 2 for English.")
        return

    business_date = state.pending_date
    _clear_state(db, sender_e164)
    whatsapp.send_text(sender_e164, f"Sending the {LANGUAGE_LABEL[language]} report for {_echo_date(business_date)}…")
    _send_report(db, recipient, business_date, language)
