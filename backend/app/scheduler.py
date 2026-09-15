"""Auto-generates the Daily Report every day at 12:00 PM Asia/Karachi,
additively — the manual "Generate Report" button (POST /reports/daily/
generate) keeps working exactly as before, unaffected by this job; the two
just insert separate GeneratedReport rows into the same table (no
uniqueness constraint on business_date — see models.GeneratedReport).

§ WhatsApp Recipients & Daily Scheduler — immediately after generating,
also auto-sends the Urdu report to every active WhatsAppRecipient, but
ONLY when the whatsapp_auto_send_enabled AppSetting is on ("true") and at
least one active recipient exists. Fully additive to the existing manual
Reports-page "Send via WhatsApp" button, which keeps working unchanged
regardless of this setting.

Runs as an in-process background thread (apscheduler.BackgroundScheduler)
started once from main.py's startup event — this app is a single
long-lived process (Railway), so no separate worker/cron infra is needed.
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app import models
from app.database import SessionLocal
from app.routers.reports import _generate_daily_report, send_report_to_recipient, WHATSAPP_AUTO_SEND_SETTING_KEY
from app.timezone import KARACHI_TZ, karachi_today_str

logger = logging.getLogger(__name__)

SCHEDULED_GENERATED_BY = "Scheduler (12:00 PM)"

_scheduler: BackgroundScheduler | None = None


def _run_scheduled_whatsapp_auto_send(db, reports: list[models.GeneratedReport]) -> None:
    setting = db.query(models.AppSetting).get(WHATSAPP_AUTO_SEND_SETTING_KEY)
    if not (setting and setting.value == "true"):
        return
    recipients = db.query(models.WhatsAppRecipient).filter(models.WhatsAppRecipient.active == "active").all()
    if not recipients:
        return
    # Same "Urdu only" rule as the manual send-whatsapp endpoint
    # (routers/reports.py's send_report_whatsapp) — English exists purely
    # for on-screen reference/download, never sent over WhatsApp.
    ur_report = next((r for r in reports if r.language == "ur"), None)
    if not ur_report:
        return
    for recipient in recipients:
        try:
            ok, error = send_report_to_recipient(db, ur_report, recipient)
            if not ok:
                logger.warning("Scheduled WhatsApp auto-send to %s failed: %s", recipient.phone_number, error)
        except Exception:
            # One recipient's failure must never block the rest — same
            # never-crash-the-process guarantee _run_scheduled_daily_report
            # already gives report generation itself.
            logger.exception("Scheduled WhatsApp auto-send to %s raised", recipient.phone_number)
    db.commit()


def _run_scheduled_daily_report() -> None:
    db = SessionLocal()
    try:
        reports = _generate_daily_report(db, karachi_today_str(), SCHEDULED_GENERATED_BY)
        logger.info("Scheduled daily report generated for %s", karachi_today_str())
        _run_scheduled_whatsapp_auto_send(db, reports)
    except Exception:
        # A failed auto-generation must never crash the process or block
        # the next day's run — the manual button remains available as a
        # fallback regardless.
        logger.exception("Scheduled daily report generation failed")
        db.rollback()
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler(timezone=KARACHI_TZ)
    _scheduler.add_job(
        _run_scheduled_daily_report,
        trigger=CronTrigger(hour=12, minute=0, timezone=KARACHI_TZ),
        id="daily_report_12pm",
        replace_existing=True,
    )
    _scheduler.start()
    return _scheduler
