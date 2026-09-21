import os
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, whatsapp
from app.deps import require_active_user, require_csrf
from app.reporting.daily import get_daily_report_data
from app.reporting.pdf import render_daily_report_pdf
from app.timezone import KARACHI_TZ

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_active_user), Depends(require_csrf)])

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "generated_reports")


@router.get("", response_model=list[schemas.GeneratedReportOut])
def list_reports(
    report_type: str | None = Query(None),
    date_from: str | None = Query(None, description="YYYY-MM-DD"),
    date_to: str | None = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    q = db.query(models.GeneratedReport)
    if report_type:
        q = q.filter(models.GeneratedReport.report_type == report_type)
    if date_from:
        q = q.filter(models.GeneratedReport.business_date >= date_from)
    if date_to:
        q = q.filter(models.GeneratedReport.business_date <= date_to)
    return q.order_by(models.GeneratedReport.generated_at.desc()).all()


@router.get("/daily/{business_date}/data", response_model=schemas.DailyReportDataOut)
def daily_report_data(business_date: str, db: Session = Depends(get_db)):
    """Powers the Daily Activity screen/print AND is what the PDF below is
    rendered from — same aggregator, so screen/PDF/print can never disagree (§5)."""
    try:
        datetime.strptime(business_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "business_date must be YYYY-MM-DD")
    return get_daily_report_data(db, business_date)


@router.get("/{report_id}", response_model=schemas.GeneratedReportOut)
def get_report(report_id: UUID, db: Session = Depends(get_db)):
    report = db.query(models.GeneratedReport).get(report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    return report


@router.get("/{report_id}/view")
def view_report(report_id: UUID, db: Session = Depends(get_db)):
    """Same file as /download below, but Content-Disposition: inline — the
    Eye icon on the Reports page opens this in a new tab so the browser's
    built-in PDF viewer renders it, instead of triggering a save-file
    dialog. Must NOT set filename= directly on FileResponse: Starlette
    defaults content_disposition_type to "attachment" whenever filename is
    given, forcing a download regardless of content_disposition_type — so
    filename is passed via content_disposition_type + filename together to
    get "inline" while still naming the file if the viewer chooses to save it."""
    report = db.query(models.GeneratedReport).get(report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    if not os.path.exists(report.file_path):
        raise HTTPException(404, "Report file is no longer on disk")
    filename = f"daily-report-{report.business_date}.pdf"
    return FileResponse(
        report.file_path, media_type="application/pdf", filename=filename,
        content_disposition_type="inline",
    )


@router.get("/{report_id}/download")
def download_report(report_id: UUID, db: Session = Depends(get_db)):
    report = db.query(models.GeneratedReport).get(report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    if not os.path.exists(report.file_path):
        raise HTTPException(404, "Report file is no longer on disk")
    filename = f"daily-report-{report.business_date}.pdf"
    return FileResponse(report.file_path, media_type="application/pdf", filename=filename)


def _generate_daily_report(db: Session, business_date: str, generated_by: str) -> list[models.GeneratedReport]:
    """Shared by the manual "Generate Report" endpoint below and the midnight
    scheduled job (app/scheduler.py) — same data/PDF/row-insert behavior
    either way, so a scheduled report is indistinguishable in every respect
    except its generated_by tag.

    Produces BOTH an English and an Urdu PDF every time (§ Phase D3): the
    Urdu one is what actually gets sent to the Owner over WhatsApp
    (send_report_whatsapp below refuses to send anything else); English
    exists purely so it's viewable/downloadable on the Reports page for
    reference. Generation and sending were already separate steps in this
    codebase before this change, so generating both up front here — rather
    than lazily rendering Urdu at send-time — keeps that separation intact
    and costs nothing (PDF rendering has no external calls)."""
    data = get_daily_report_data(db, business_date)
    generated_at_str = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")

    reports: list[models.GeneratedReport] = []
    os.makedirs(STORAGE_DIR, exist_ok=True)
    for language in ("en", "ur"):
        pdf_bytes = render_daily_report_pdf(data, generated_by, generated_at_str, language=language)

        filename = f"daily_{business_date}_{language}_{uuid4().hex[:8]}.pdf"
        file_path = os.path.join(STORAGE_DIR, filename)
        with open(file_path, "wb") as f:
            f.write(pdf_bytes)

        report = models.GeneratedReport(
            report_type="daily",
            business_date=business_date,
            file_path=file_path,
            generated_by=generated_by,
            language=language,
            whatsapp_status="not_sent",
        )
        db.add(report)
        reports.append(report)

    db.commit()
    for report in reports:
        db.refresh(report)
    return reports


@router.post("/daily/generate", response_model=list[schemas.GeneratedReportOut], status_code=201)
def generate_daily_report(
    business_date: str = Query(..., description="YYYY-MM-DD"),
    generated_by: str = Query(...),
    db: Session = Depends(get_db),
):
    """Generates (or re-generates — §6 "Regenerate") the Daily Report PDF
    for one business date, saves it to disk, and records TWO NEW
    GeneratedReport rows (English + Urdu, §Phase D3) — regenerating never
    overwrites or deletes an earlier run, so a report that was already sent
    over WhatsApp keeps its own history entry untouched."""
    try:
        datetime.strptime(business_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "business_date must be YYYY-MM-DD")

    return _generate_daily_report(db, business_date, generated_by)


@router.post("/{report_id}/send-whatsapp", response_model=schemas.SendWhatsAppOut)
def send_report_whatsapp(report_id: UUID, to: str | None = Query(None), db: Session = Depends(get_db)):
    """Never lets a WhatsApp failure — or missing configuration — break
    anything: the report row/file are untouched either way, only
    whatsapp_status/whatsapp_error change (§7)."""
    report = db.query(models.GeneratedReport).get(report_id)
    if not report:
        raise HTTPException(404, "Report not found")

    if report.language != "ur":
        raise HTTPException(400, "Only the Urdu version of a report can be sent over WhatsApp.")

    if not whatsapp.is_configured():
        report.whatsapp_status = "unavailable"
        report.whatsapp_error = None
        db.add(report)
        db.commit()
        db.refresh(report)
        return schemas.SendWhatsAppOut(report=report, message="WhatsApp not configured/unavailable")

    if not os.path.exists(report.file_path):
        raise HTTPException(404, "Report file is no longer on disk")

    filename = f"Daily_Report_{report.business_date}.pdf"
    ok, error = whatsapp.send_pdf(report.file_path, filename, report.business_date, to=to)

    report.whatsapp_status = "sent" if ok else "failed"
    report.whatsapp_sent_at = datetime.utcnow() if ok else report.whatsapp_sent_at
    report.whatsapp_error = None if ok else error
    db.add(report)
    db.commit()
    db.refresh(report)
    return schemas.SendWhatsAppOut(report=report, message="Sent via WhatsApp" if ok else f"WhatsApp send failed: {error}")


# ---------- WhatsApp Recipients & Daily Scheduler ----------
# § WhatsApp Recipients & Daily Scheduler — a stored recipient list +
# on/off toggle for the 12:00 AM scheduled job (app/scheduler.py) to send
# the day's Urdu report to automatically, rather than the send-whatsapp
# endpoint above staying manual-trigger-only forever. Kept in this same
# file (not a separate router) since it's entirely report-scoped — never
# a general-purpose WhatsApp feature.

WHATSAPP_AUTO_SEND_SETTING_KEY = "whatsapp_auto_send_enabled"


def send_report_to_recipient(
    db: Session, report: models.GeneratedReport, recipient: models.WhatsAppRecipient,
) -> tuple[bool, str | None]:
    """The scheduler's per-recipient send — never raises (same guarantee
    as send_report_whatsapp above), and always writes a WhatsAppSendLog
    row so per-recipient delivery stays visible even though GeneratedReport.
    whatsapp_status itself is a single scalar (meaningless once there's
    more than one recipient). Deliberately NOT shared code with
    send_report_whatsapp's manual single-send path above — that endpoint's
    existing behavior (updating report.whatsapp_status/sent_at/error
    directly) stays untouched; this is purely additive."""
    if not os.path.exists(report.file_path):
        ok, error = False, "Report file is no longer on disk"
    else:
        filename = f"Daily_Report_{report.business_date}.pdf"
        ok, error = whatsapp.send_pdf(report.file_path, filename, report.business_date, to=recipient.phone_number)

    db.add(models.WhatsAppSendLog(
        report_id=report.id, recipient_id=recipient.id,
        status="sent" if ok else "failed", error=None if ok else error,
    ))
    return ok, error


@router.get("/whatsapp/recipients", response_model=list[schemas.WhatsAppRecipientOut])
def list_whatsapp_recipients(db: Session = Depends(get_db)):
    return db.query(models.WhatsAppRecipient).order_by(models.WhatsAppRecipient.created_at).all()


@router.post("/whatsapp/recipients", response_model=schemas.WhatsAppRecipientOut, status_code=201)
def create_whatsapp_recipient(payload: schemas.WhatsAppRecipientCreate, db: Session = Depends(get_db)):
    try:
        phone_number = whatsapp.normalize_phone_number(payload.phone_number)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Rows saved before normalization existed may not be in E.164 form, so
    # compare in normalized form where they can be normalized at all.
    for existing in db.query(models.WhatsAppRecipient).all():
        try:
            same = whatsapp.normalize_phone_number(existing.phone_number) == phone_number
        except ValueError:
            same = existing.phone_number == phone_number
        if same:
            hint = "" if existing.active == "active" else " (removed — use its Re-add button)"
            raise HTTPException(400, f"{phone_number} is already in the recipient list{hint}")
    recipient = models.WhatsAppRecipient(phone_number=phone_number, label=(payload.label or "").strip() or None, active="active")
    db.add(recipient)
    db.commit()
    db.refresh(recipient)
    return recipient


@router.patch("/whatsapp/recipients/{recipient_id}/deactivate", response_model=schemas.WhatsAppRecipientOut)
def deactivate_whatsapp_recipient(recipient_id: UUID, db: Session = Depends(get_db)):
    """Deactivate, never delete — a WhatsAppSendLog row's recipient_id
    would otherwise dangle (§ WhatsAppSendLog docstring)."""
    recipient = db.query(models.WhatsAppRecipient).get(recipient_id)
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    recipient.active = "inactive"
    db.add(recipient)
    db.commit()
    db.refresh(recipient)
    return recipient


@router.patch("/whatsapp/recipients/{recipient_id}/activate", response_model=schemas.WhatsAppRecipientOut)
def activate_whatsapp_recipient(recipient_id: UUID, db: Session = Depends(get_db)):
    recipient = db.query(models.WhatsAppRecipient).get(recipient_id)
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    recipient.active = "active"
    db.add(recipient)
    db.commit()
    db.refresh(recipient)
    return recipient


@router.get("/whatsapp/auto-send", response_model=schemas.WhatsAppAutoSendSettingOut)
def get_whatsapp_auto_send(db: Session = Depends(get_db)):
    row = db.query(models.AppSetting).get(WHATSAPP_AUTO_SEND_SETTING_KEY)
    return schemas.WhatsAppAutoSendSettingOut(enabled=bool(row and row.value == "true"))


@router.put("/whatsapp/auto-send", response_model=schemas.WhatsAppAutoSendSettingOut)
def set_whatsapp_auto_send(payload: schemas.WhatsAppAutoSendSettingOut, db: Session = Depends(get_db)):
    row = db.query(models.AppSetting).get(WHATSAPP_AUTO_SEND_SETTING_KEY)
    value = "true" if payload.enabled else "false"
    if row:
        row.value = value
    else:
        row = models.AppSetting(key=WHATSAPP_AUTO_SEND_SETTING_KEY, value=value)
    db.add(row)
    db.commit()
    return schemas.WhatsAppAutoSendSettingOut(enabled=payload.enabled)


@router.get("/{report_id}/whatsapp-log", response_model=list[schemas.WhatsAppSendLogOut])
def get_report_whatsapp_log(report_id: UUID, db: Session = Depends(get_db)):
    logs = (
        db.query(models.WhatsAppSendLog)
        .filter(models.WhatsAppSendLog.report_id == report_id)
        .order_by(models.WhatsAppSendLog.sent_at.desc())
        .all()
    )
    recipients = {r.id: r for r in db.query(models.WhatsAppRecipient).all()}
    return [
        schemas.WhatsAppSendLogOut(
            id=l.id, report_id=l.report_id, recipient_id=l.recipient_id, status=l.status,
            sent_at=l.sent_at, error=l.error,
            recipient_label=recipients[l.recipient_id].label if l.recipient_id in recipients else None,
            recipient_phone_number=recipients[l.recipient_id].phone_number if l.recipient_id in recipients else None,
        )
        for l in logs
    ]
