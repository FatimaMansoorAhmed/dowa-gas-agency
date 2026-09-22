"""Sends a generated PDF report over WhatsApp using the real Meta WhatsApp
Cloud API (§7) — never a fake/simulated integration. Configured via env
vars (backend/.env): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
WHATSAPP_RECIPIENT_NUMBER, WHATSAPP_TEMPLATE_NAME, and optionally
WHATSAPP_TEMPLATE_LANG (defaults to "en"). If any required var is missing,
`is_configured()` is False and the caller (routers/reports.py) must treat
that as "unavailable", never as a failure — report generation/download
must never depend on this.

The scheduled/manual "Send via WhatsApp" button's message is sent as an
approved template (not a free-form "document" message) because Meta
rejects business-initiated free-form messages sent outside a 24-hour
customer-service window — which a business-initiated send always is. The
template must have a document header (the PDF) and exactly one body
variable, the business date, e.g.:
"Your daily DOWA report for {{1}} is attached."

§ WhatsApp Inbound Request Flow adds send_text/send_document below: a
reply to an inbound "reports" message is USER-initiated, so it's sent
free-form inside the 24-hour service window Meta opens the instant that
inbound message arrives — no template needed there, and Meta rejects a
template reply in-window with the same "re-engagement" friction it
otherwise reserves for out-of-window sends. Gated by
is_reply_configured() (token + phone number id only — the reply flow has
no fixed WHATSAPP_RECIPIENT_NUMBER/TEMPLATE_NAME to require).
"""
import hashlib
import hmac
import logging
import os
import re
from typing import Optional

import requests

logger = logging.getLogger(__name__)

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

PK_MOBILE_E164 = re.compile(r"\+923\d{9}")


def normalize_phone_number(raw: str) -> str:
    """Canonical E.164 form (+923001234567) for a Pakistan mobile number, or
    ValueError with a user-readable message. Meta matches recipients against
    its allowed list by exact number, so "0300…" and "+92300…" are different
    recipients to it (error #131030) even though they look alike to a person.

    Accepts the ways numbers get typed or pasted: 0300 1234567, 300-1234567,
    923001234567, 0092 300 1234567, +92 300 1234567, and the common slip
    +92 0300 1234567 (trunk 0 kept). Rejects anything that isn't a
    Pakistan mobile number. frontend/lib/phone.ts mirrors these rules."""
    s = (raw or "").strip()
    if not s:
        raise ValueError("Phone number is required")
    if re.search(r"[^\d\s\-().+]", s) or "+" in s[1:]:
        raise ValueError("Phone number may only contain digits, spaces, dashes and a leading +")
    digits = re.sub(r"\D", "", s)
    if s.startswith("+"):
        if not digits.startswith("92"):
            raise ValueError("Only Pakistan numbers (+92) are supported")
        rest = digits[2:]
    elif digits.startswith("0092"):
        rest = digits[4:]
    elif digits.startswith("92") and len(digits) >= 12:
        rest = digits[2:]
    elif digits.startswith("0"):
        rest = digits[1:]
    else:
        rest = digits
    if len(rest) == 11 and rest.startswith("0"):
        rest = rest[1:]
    e164 = "+92" + rest
    if not PK_MOBILE_E164.fullmatch(e164):
        raise ValueError("Enter a valid Pakistan mobile number, e.g. +92 300 1234567")
    return e164


def is_configured() -> bool:
    return bool(
        os.getenv("WHATSAPP_TOKEN")
        and os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        and os.getenv("WHATSAPP_RECIPIENT_NUMBER")
        and os.getenv("WHATSAPP_TEMPLATE_NAME")
    )


def send_pdf(file_path: str, filename: str, business_date: str, to: Optional[str] = None) -> tuple[bool, Optional[str]]:
    """Uploads the PDF to the Cloud API's /media endpoint, then sends it as
    the document header of the WHATSAPP_TEMPLATE_NAME template (body
    variable {{1}} = business_date) to `to` (defaults to
    WHATSAPP_RECIPIENT_NUMBER). Returns (ok, error_message) — never raises;
    every failure mode (missing config, HTTP error, network error) is
    captured and returned instead."""
    token = os.getenv("WHATSAPP_TOKEN")
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    recipient = to or os.getenv("WHATSAPP_RECIPIENT_NUMBER")
    template_name = os.getenv("WHATSAPP_TEMPLATE_NAME")
    template_lang = os.getenv("WHATSAPP_TEMPLATE_LANG", "en")
    if not (token and phone_number_id and recipient and template_name):
        return False, "WhatsApp not configured"

    headers = {"Authorization": f"Bearer {token}"}
    try:
        with open(file_path, "rb") as f:
            media_resp = requests.post(
                f"{GRAPH_API_BASE}/{phone_number_id}/media",
                headers=headers,
                data={"messaging_product": "whatsapp", "type": "application/pdf"},
                files={"file": (filename, f, "application/pdf")},
                timeout=30,
            )
        media_resp.raise_for_status()
        media_id = media_resp.json()["id"]

        send_resp = requests.post(
            f"{GRAPH_API_BASE}/{phone_number_id}/messages",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "messaging_product": "whatsapp",
                "to": recipient,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {"code": template_lang},
                    "components": [
                        {
                            "type": "header",
                            "parameters": [
                                {"type": "document", "document": {"id": media_id, "filename": filename}}
                            ],
                        },
                        {
                            "type": "body",
                            "parameters": [{"type": "text", "text": business_date}],
                        },
                    ],
                },
            },
            timeout=30,
        )
        send_resp.raise_for_status()
        # Meta accepting the message is not the same as the phone receiving
        # it — the id is what to look up in Meta's console if a report
        # "sent" here never shows up on the handset.
        try:
            message_id = send_resp.json()["messages"][0]["id"]
        except Exception:
            message_id = "?"
        logger.info("WhatsApp accepted message %s to %s", message_id, f"{recipient[:4]}…{recipient[-3:]}")
        return True, None
    except requests.RequestException as e:
        detail = ""
        try:
            detail = e.response.text[:300] if e.response is not None else ""
        except Exception:
            pass
        return False, f"{e}" + (f" — {detail}" if detail else "")


# ---------- § WhatsApp Inbound Request Flow ----------

def is_reply_configured() -> bool:
    """Narrower than is_configured() above: replying inside an inbound
    conversation only ever needs the token + phone number id (the `to` is
    whoever just messaged us, not a fixed WHATSAPP_RECIPIENT_NUMBER, and
    there's no template involved)."""
    return bool(os.getenv("WHATSAPP_TOKEN") and os.getenv("WHATSAPP_PHONE_NUMBER_ID"))


def _mask(number: str) -> str:
    return number[:4] + "…" + number[-3:] if number and len(number) > 7 else "?"


def _post_message(payload: dict) -> tuple[bool, Optional[str]]:
    token = os.getenv("WHATSAPP_TOKEN")
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    to = payload.get("to", "")
    if not (token and phone_number_id):
        logger.warning("WhatsApp reply to %s not sent: WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID not configured", _mask(to))
        return False, "WhatsApp not configured"
    try:
        resp = requests.post(
            f"{GRAPH_API_BASE}/{phone_number_id}/messages",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"messaging_product": "whatsapp", **payload},
            timeout=30,
        )
        resp.raise_for_status()
        logger.info("WhatsApp %s reply accepted by Graph API for %s", payload.get("type"), _mask(to))
        return True, None
    except requests.RequestException as e:
        detail = ""
        try:
            detail = e.response.text[:300] if e.response is not None else ""
        except Exception:
            pass
        logger.warning("WhatsApp %s reply to %s rejected by Graph API: %s%s", payload.get("type"), _mask(to), e, f" — {detail}" if detail else "")
        return False, f"{e}" + (f" — {detail}" if detail else "")


def send_text(to: str, body: str) -> tuple[bool, Optional[str]]:
    """Free-form text reply — the conversational prompts/confirmations in
    the "reports" flow (asking for a date, asking for a language,
    reporting an error). `to` must already be the E.164 number that just
    messaged us; Meta only accepts a free-form send while that number's
    24-hour service window is open, which it always is right after they
    messaged us."""
    return _post_message({"to": to, "type": "text", "text": {"body": body}})


def send_document(file_path: str, filename: str, to: str, caption: Optional[str] = None) -> tuple[bool, Optional[str]]:
    """Free-form document reply — the actual report PDF, sent inside the
    inbound conversation's service window (see send_text). Same
    upload-then-send shape as send_pdf() above, but as a plain document
    message (no template/business_date body variable) since this is a
    reply, not a business-initiated send."""
    token = os.getenv("WHATSAPP_TOKEN")
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    if not (token and phone_number_id):
        return False, "WhatsApp not configured"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        with open(file_path, "rb") as f:
            media_resp = requests.post(
                f"{GRAPH_API_BASE}/{phone_number_id}/media",
                headers=headers,
                data={"messaging_product": "whatsapp", "type": "application/pdf"},
                files={"file": (filename, f, "application/pdf")},
                timeout=30,
            )
        media_resp.raise_for_status()
        media_id = media_resp.json()["id"]
    except requests.RequestException as e:
        detail = ""
        try:
            detail = e.response.text[:300] if e.response is not None else ""
        except Exception:
            pass
        return False, f"{e}" + (f" — {detail}" if detail else "")

    document: dict = {"id": media_id, "filename": filename}
    if caption:
        document["caption"] = caption
    return _post_message({"to": to, "type": "document", "document": document})


def verify_signature(app_secret: str, raw_body: bytes, signature_header: Optional[str]) -> bool:
    """Validates Meta's X-Hub-Signature-256 header on an inbound webhook
    POST — the one thing standing between this endpoint and anyone on the
    internet who can guess its URL and POST a forged "message" claiming
    to be from an allowlisted number, so getting this wrong is worse than
    not having it (§ WhatsApp Inbound Request Flow — verified against
    Meta's official Graph API webhooks docs, "Validating Payloads":
    https://developers.facebook.com/docs/graph-api/webhooks/getting-started).
    Meta signs the raw, exact request body (not a re-serialized/re-parsed
    version of it — re-serializing JSON can change field order/whitespace
    and would silently break this) with HMAC-SHA256 keyed by the app's
    App Secret, sent as the header value "sha256=<hex digest>". Comparison
    uses hmac.compare_digest to avoid a timing side-channel."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    if not app_secret:
        return False
    expected = hmac.new(app_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    provided = signature_header[len("sha256="):]
    return hmac.compare_digest(expected, provided)
