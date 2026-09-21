"""Sends a generated PDF report over WhatsApp using the real Meta WhatsApp
Cloud API (§7) — never a fake/simulated integration. Configured via env
vars (backend/.env): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
WHATSAPP_RECIPIENT_NUMBER, WHATSAPP_TEMPLATE_NAME, and optionally
WHATSAPP_TEMPLATE_LANG (defaults to "en"). If any required var is missing,
`is_configured()` is False and the caller (routers/reports.py) must treat
that as "unavailable", never as a failure — report generation/download
must never depend on this.

The message is sent as an approved template (not a free-form "document"
message) because Meta rejects business-initiated free-form messages sent
outside a 24-hour customer-service window — which an automated daily
report always is. The template must have a document header (the PDF) and
exactly one body variable, the business date, e.g.:
"Your daily DOWA report for {{1}} is attached."
"""
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
