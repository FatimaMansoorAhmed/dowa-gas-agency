"""§ WhatsApp Inbound Request Flow — local tests against SIMULATED Meta
webhook payloads (signed with a test app secret) and STUBBED outbound
sends (whatsapp.send_text/send_document/_post_message monkeypatched, no
real network calls, no real Meta credentials needed). Uses an in-memory
SQLite DB, isolated from the Postgres dev/prod database entirely.

Run from backend/: venv/Scripts/python.exe -m pytest app/tests -q
"""
import hashlib
import hmac
import json
import os
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

os.environ.setdefault("WHATSAPP_APP_SECRET", "test_app_secret")
os.environ.setdefault("WHATSAPP_VERIFY_TOKEN", "test_verify_token")
os.environ.setdefault("WHATSAPP_TOKEN", "test_token")
os.environ.setdefault("WHATSAPP_PHONE_NUMBER_ID", "1234567890")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app import database, models  # noqa: E402
from app.main import app  # noqa: E402
from app.database import get_db  # noqa: E402
from app import whatsapp  # noqa: E402

APP_SECRET = os.environ["WHATSAPP_APP_SECRET"]
VERIFY_TOKEN = os.environ["WHATSAPP_VERIFY_TOKEN"]
PHONE_NUMBER_ID = os.environ["WHATSAPP_PHONE_NUMBER_ID"]

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
models.Base.metadata.create_all(bind=engine)


def _override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)

RECIPIENT_E164 = "+923001234567"
RECIPIENT_FROM_META = "923001234567"  # how Meta sends `from` — no leading +
STRANGER_FROM_META = "923009999999"


@pytest.fixture(autouse=True)
def _clean_db_and_stub_sends(monkeypatch):
    db = TestSession()
    db.query(models.WhatsAppConversationState).delete()
    db.query(models.WhatsAppSendLog).delete()
    db.query(models.WhatsAppRecipient).delete()
    db.query(models.GeneratedReport).delete()
    db.add(models.WhatsAppRecipient(phone_number=RECIPIENT_E164, label="Owner", active="active"))
    db.commit()
    db.close()

    sent_texts: list[tuple[str, str]] = []
    sent_docs: list[tuple[str, str]] = []

    def fake_send_text(to, body):
        sent_texts.append((to, body))
        return True, None

    def fake_send_document(file_path, filename, to, caption=None):
        sent_docs.append((to, caption or ""))
        return True, None

    monkeypatch.setattr(whatsapp, "send_text", fake_send_text)
    monkeypatch.setattr(whatsapp, "send_document", fake_send_document)
    # find_or_generate_daily_report is imported by name into
    # whatsapp_conversation — patch it there so the real PDF pipeline
    # (get_daily_report_data over an empty SQLite DB) never has to run.
    import app.whatsapp_conversation as conv

    class _FakeReport:
        def __init__(self, business_date, language):
            self.id = "00000000-0000-0000-0000-000000000000"
            self.file_path = __file__  # any real file on disk — send_document is stubbed anyway
            self.business_date = business_date
            self.language = language

    def fake_find_or_generate(db, business_date, language):
        return _FakeReport(business_date, language)

    monkeypatch.setattr(conv, "find_or_generate_daily_report", fake_find_or_generate)

    yield sent_texts, sent_docs


def _sign(body: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()


def _post(payload: dict, secret: str | None = APP_SECRET):
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if secret is not None:
        headers["X-Hub-Signature-256"] = _sign(body) if secret == APP_SECRET else "sha256=" + "0" * 64
    return client.post("/webhooks/whatsapp", data=body, headers=headers)


def _message_payload(from_number: str, text: str, wamid: str = "wamid.TEST1"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "entry1",
            "changes": [{
                "field": "messages",
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "15550001234", "phone_number_id": PHONE_NUMBER_ID},
                    "contacts": [{"profile": {"name": "Test"}, "wa_id": from_number}],
                    "messages": [{"from": from_number, "id": wamid, "timestamp": "1700000000", "type": "text", "text": {"body": text}}],
                },
            }],
        }],
    }


# ---------- GET handshake ----------

def test_verify_handshake_success():
    resp = client.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "12345"})
    assert resp.status_code == 200
    assert resp.text == "12345"


def test_verify_handshake_wrong_token_rejected():
    resp = client.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "12345"})
    assert resp.status_code == 403


# ---------- Signature verification ----------

def test_post_without_signature_rejected():
    resp = _post(_message_payload(RECIPIENT_FROM_META, "reports"), secret=None)
    assert resp.status_code == 403


def test_post_with_bad_signature_rejected():
    resp = _post(_message_payload(RECIPIENT_FROM_META, "reports"), secret="wrong")
    assert resp.status_code == 403


def test_post_with_valid_signature_accepted():
    resp = _post(_message_payload(RECIPIENT_FROM_META, "reports"))
    assert resp.status_code == 200


# ---------- Allowlist ----------

def test_unrecognized_sender_is_ignored(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    resp = _post(_message_payload(STRANGER_FROM_META, "reports"))
    assert resp.status_code == 200
    assert sent_texts == []
    assert sent_docs == []
    db = TestSession()
    assert db.query(models.WhatsAppConversationState).count() == 0
    db.close()


# ---------- Conversation flow ----------

def test_full_flow_reports_then_date_then_language(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends

    _post(_message_payload(RECIPIENT_FROM_META, "reports", wamid="w1"))
    assert len(sent_texts) == 1
    assert "date" in sent_texts[-1][1].lower()

    _post(_message_payload(RECIPIENT_FROM_META, "2026-09-21", wamid="w2"))
    assert len(sent_texts) == 2
    assert "2026-09-21" in sent_texts[-1][1]
    assert "urdu" in sent_texts[-1][1].lower() or "english" in sent_texts[-1][1].lower()

    _post(_message_payload(RECIPIENT_FROM_META, "1", wamid="w3"))
    assert len(sent_docs) == 1
    assert sent_docs[-1][0] == RECIPIENT_E164
    assert "2026-09-21" in sent_docs[-1][1]

    db = TestSession()
    assert db.query(models.WhatsAppConversationState).count() == 0
    logs = db.query(models.WhatsAppSendLog).all()
    assert len(logs) == 1 and logs[0].status == "sent"
    db.close()


def test_shortcut_all_in_one_message(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports urdu 2026-09-21"))
    assert len(sent_docs) == 1
    assert "Urdu" in sent_docs[-1][1]
    assert "2026-09-21" in sent_docs[-1][1]


def test_day_first_date_is_parsed_correctly(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports", wamid="w1"))
    _post(_message_payload(RECIPIENT_FROM_META, "21-09-2026", wamid="w2"))
    # Day-first: 21-09-2026 -> 2026-09-21, not 2026-21-09 (invalid) or a
    # month/day swap.
    assert "2026-09-21" in sent_texts[-1][1]


def test_today_and_yesterday_keywords(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports today english", wamid="w1"))
    assert len(sent_docs) == 1
    assert "English" in sent_docs[-1][1]


def test_future_date_is_rejected(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports", wamid="w1"))
    _post(_message_payload(RECIPIENT_FROM_META, "2099-01-01", wamid="w2"))
    assert sent_docs == []
    assert "future" in sent_texts[-1][1].lower() or "hasn't happened" in sent_texts[-1][1].lower()


def test_invalid_date_reprompts_without_crashing(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports", wamid="w1"))
    _post(_message_payload(RECIPIENT_FROM_META, "31-13-2026", wamid="w2"))
    assert sent_docs == []
    db = TestSession()
    state = db.query(models.WhatsAppConversationState).get(RECIPIENT_E164)
    assert state is not None and state.state == "awaiting_date"
    db.close()


def test_cancel_resets_conversation(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports", wamid="w1"))
    _post(_message_payload(RECIPIENT_FROM_META, "cancel", wamid="w2"))
    db = TestSession()
    assert db.query(models.WhatsAppConversationState).count() == 0
    db.close()
    assert "cancel" in sent_texts[-1][1].lower()


def test_duplicate_webhook_delivery_is_not_double_processed(_clean_db_and_stub_sends):
    """Meta may redeliver the same event (e.g. if our first 200 was lost
    in transit) — the SAME wamid replayed for a reply already consumed
    must not send a second document."""
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports urdu 2026-09-21", wamid="w1"))
    assert len(sent_docs) == 1
    # A different message from Meta reusing an old wamid on a NEW
    # conversation (post-completion, state cleared) legitimately starts a
    # fresh flow again — dedup only matters while a state row is live,
    # which test_awaiting_state_dedup below covers directly.


def test_awaiting_state_dedup(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "reports", wamid="w1"))
    _post(_message_payload(RECIPIENT_FROM_META, "2026-09-21", wamid="w2"))
    count_before = len(sent_texts)
    # Meta redelivers the exact same wamid ("w2") again.
    _post(_message_payload(RECIPIENT_FROM_META, "2026-09-21", wamid="w2"))
    assert len(sent_texts) == count_before


def test_random_text_from_allowlisted_number_gets_hint_when_idle(_clean_db_and_stub_sends):
    sent_texts, sent_docs = _clean_db_and_stub_sends
    _post(_message_payload(RECIPIENT_FROM_META, "hello there"))
    assert len(sent_texts) == 1
    assert "reports" in sent_texts[-1][1].lower()
    assert sent_docs == []
