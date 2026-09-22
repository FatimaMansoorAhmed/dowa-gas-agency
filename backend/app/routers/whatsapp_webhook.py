"""§ WhatsApp Inbound Request Flow — Meta's webhook endpoint: the GET
verification handshake Meta performs once when the webhook URL is
registered/saved in the App Dashboard, and the POST it calls on every
subsequent event (an inbound message, or a delivery-status update we
don't care about).

Deliberately its own router with NO auth dependencies — Meta is not a
logged-in browser session, so it carries no session cookie and no CSRF
token; require_active_user/require_csrf (as applied to every other
router in this app) would reject every legitimate call from Meta. The
real security boundary here is the POST body's X-Hub-Signature-256
signature (verified below via whatsapp.verify_signature, checked against
Meta's current official docs — see that function's docstring) plus the
WhatsAppRecipient allowlist check inside whatsapp_conversation.py; an
unrecognized sender is silently ignored even after the signature check
passes, since the signature only proves "this came from Meta", not "this
sender is allowed to see financial reports".

Both routes always return 200 once the request is authenticated (a
malformed payload, an unrecognized field, or a processing exception is
logged and swallowed, never surfaced as a 4xx/5xx) — a non-200 makes Meta
retry the same delivery with decreasing frequency for up to 7 days, which
would otherwise mean a transient bug replays the same inbound message
(and a possible duplicate reply) for a week. The one exception is a
missing/incorrect signature, which gets 403: that request did not
originate from Meta, so there's nothing to retry.
"""
import logging
import os

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app import whatsapp, whatsapp_conversation
from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/whatsapp", tags=["whatsapp-webhook"])


@router.get("")
def verify_webhook(
    hub_mode: str = Query(..., alias="hub.mode"),
    hub_verify_token: str = Query(..., alias="hub.verify_token"),
    hub_challenge: str = Query(..., alias="hub.challenge"),
):
    """Meta's one-time handshake when the webhook URL + Verify Token are
    saved in the App Dashboard (App Dashboard -> WhatsApp ->
    Configuration). Must echo hub.challenge back as plain text with a
    200 exactly when hub.mode == "subscribe" and hub.verify_token matches
    our own WHATSAPP_VERIFY_TOKEN — anything else is rejected with a 403
    so a stranger can't probe this into confirming a token."""
    expected_token = os.getenv("WHATSAPP_VERIFY_TOKEN")
    if hub_mode == "subscribe" and expected_token and hub_verify_token == expected_token:
        return Response(content=hub_challenge, media_type="text/plain")
    return Response(status_code=403)


@router.post("")
async def receive_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    logger.info("WhatsApp webhook POST received (%d bytes)", len(raw_body))
    app_secret = os.getenv("WHATSAPP_APP_SECRET")
    signature = request.headers.get("X-Hub-Signature-256")
    if not whatsapp.verify_signature(app_secret, raw_body, signature):
        logger.warning("Rejecting WhatsApp webhook POST with missing/invalid X-Hub-Signature-256")
        return Response(status_code=403)
    logger.info("WhatsApp webhook signature verified")

    try:
        payload = await request.json()
    except Exception:
        logger.warning("WhatsApp webhook POST body was not valid JSON despite a valid signature")
        return Response(status_code=200)

    try:
        _process_payload(db, payload)
    except Exception:
        # Never let a bug here turn into a 5xx -> Meta retry storm; the
        # conversation module already guards its own steps the same way,
        # this is a last-resort net for anything above that.
        logger.exception("Unhandled error processing WhatsApp webhook payload")

    return Response(status_code=200)


def _process_payload(db: Session, payload: dict) -> None:
    obj = payload.get("object")
    if obj != "whatsapp_business_account":
        logger.info("Ignoring webhook payload with object=%r (expected whatsapp_business_account)", obj)
        return
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            field = change.get("field")
            if field != "messages":
                logger.info("Ignoring webhook change with field=%r (expected messages)", field)
                continue
            value = change.get("value", {})
            messages = value.get("messages", [])
            logger.info("Webhook change field=messages, %d message(s)", len(messages))
            for message in messages:
                _process_message(db, message)
            # "statuses" (sent/delivered/read receipts for OUR outbound
            # sends) arrive on this same field with no "messages" key —
            # nothing to do with them here, so they fall through
            # untouched rather than being treated as an error.


def _process_message(db: Session, message: dict) -> None:
    from_number = message.get("from")
    masked = from_number[:4] + "…" + from_number[-3:] if from_number and len(from_number) > 7 else from_number
    msg_type = message.get("type")
    logger.info("Inbound WhatsApp message from %s, type=%s", masked, msg_type)
    if msg_type != "text":
        # Only free-form text replies drive this conversation; a sticker,
        # image, etc. from an allowlisted number is silently ignored
        # rather than confusing the state machine.
        return
    wamid = message.get("id", "")
    body = (message.get("text") or {}).get("body", "")
    if not from_number:
        return
    whatsapp_conversation.handle_inbound_message(db, from_number, body, wamid)
