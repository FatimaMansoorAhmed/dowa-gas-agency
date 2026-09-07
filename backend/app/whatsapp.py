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
import os
from typing import Optional

import requests

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"


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
        return True, None
    except requests.RequestException as e:
        detail = ""
        try:
            detail = e.response.text[:300] if e.response is not None else ""
        except Exception:
            pass
        return False, f"{e}" + (f" — {detail}" if detail else "")
