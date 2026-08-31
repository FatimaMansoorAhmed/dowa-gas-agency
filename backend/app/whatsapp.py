"""Sends a generated PDF report over WhatsApp using the real Meta WhatsApp
Cloud API (§7) — never a fake/simulated integration. Configured via 3 env
vars (backend/.env): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
WHATSAPP_RECIPIENT_NUMBER. If any are missing, `is_configured()` is False
and the caller (routers/reports.py) must treat that as "unavailable", never
as a failure — report generation/download must never depend on this.
"""
import os
from typing import Optional

import requests

GRAPH_API_BASE = "https://graph.facebook.com/v21.0"


def is_configured() -> bool:
    return bool(os.getenv("WHATSAPP_TOKEN") and os.getenv("WHATSAPP_PHONE_NUMBER_ID") and os.getenv("WHATSAPP_RECIPIENT_NUMBER"))


def send_pdf(file_path: str, filename: str, to: Optional[str] = None) -> tuple[bool, Optional[str]]:
    """Uploads the PDF to the Cloud API's /media endpoint, then sends it as
    a document message to `to` (defaults to WHATSAPP_RECIPIENT_NUMBER).
    Returns (ok, error_message) — never raises; every failure mode (missing
    config, HTTP error, network error) is captured and returned instead."""
    token = os.getenv("WHATSAPP_TOKEN")
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    recipient = to or os.getenv("WHATSAPP_RECIPIENT_NUMBER")
    if not (token and phone_number_id and recipient):
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
                "type": "document",
                "document": {"id": media_id, "filename": filename},
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
