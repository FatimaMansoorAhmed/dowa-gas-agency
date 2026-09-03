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


@router.get("/{report_id}/download")
def download_report(report_id: UUID, db: Session = Depends(get_db)):
    report = db.query(models.GeneratedReport).get(report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    if not os.path.exists(report.file_path):
        raise HTTPException(404, "Report file is no longer on disk")
    filename = f"daily-report-{report.business_date}.pdf"
    return FileResponse(report.file_path, media_type="application/pdf", filename=filename)


def _generate_daily_report(db: Session, business_date: str, generated_by: str) -> models.GeneratedReport:
    """Shared by the manual "Generate Report" endpoint below and the 12 PM
    scheduled job (app/scheduler.py) — same data/PDF/row-insert behavior
    either way, so a scheduled report is indistinguishable in every respect
    except its generated_by tag."""
    data = get_daily_report_data(db, business_date)
    generated_at_str = datetime.now(KARACHI_TZ).strftime("%Y-%m-%d %H:%M")
    pdf_bytes = render_daily_report_pdf(data, generated_by, generated_at_str)

    os.makedirs(STORAGE_DIR, exist_ok=True)
    filename = f"daily_{business_date}_{uuid4().hex[:8]}.pdf"
    file_path = os.path.join(STORAGE_DIR, filename)
    with open(file_path, "wb") as f:
        f.write(pdf_bytes)

    report = models.GeneratedReport(
        report_type="daily",
        business_date=business_date,
        file_path=file_path,
        generated_by=generated_by,
        whatsapp_status="not_sent",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.post("/daily/generate", response_model=schemas.GeneratedReportOut, status_code=201)
def generate_daily_report(
    business_date: str = Query(..., description="YYYY-MM-DD"),
    generated_by: str = Query(...),
    db: Session = Depends(get_db),
):
    """Generates (or re-generates — §6 "Regenerate") the Daily Report PDF
    for one business date, saves it to disk, and records a NEW
    GeneratedReport row — regenerating never overwrites or deletes an
    earlier run, so a report that was already sent over WhatsApp keeps its
    own history entry untouched."""
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

    if not whatsapp.is_configured():
        report.whatsapp_status = "unavailable"
        report.whatsapp_error = None
        db.add(report)
        db.commit()
        db.refresh(report)
        return schemas.SendWhatsAppOut(report=report, message="WhatsApp not configured/unavailable")

    if not os.path.exists(report.file_path):
        raise HTTPException(404, "Report file is no longer on disk")

    filename = f"daily-report-{report.business_date}.pdf"
    ok, error = whatsapp.send_pdf(report.file_path, filename, to=to)

    report.whatsapp_status = "sent" if ok else "failed"
    report.whatsapp_sent_at = datetime.utcnow() if ok else report.whatsapp_sent_at
    report.whatsapp_error = None if ok else error
    db.add(report)
    db.commit()
    db.refresh(report)
    return schemas.SendWhatsAppOut(report=report, message="Sent via WhatsApp" if ok else f"WhatsApp send failed: {error}")
