"""Auto-generates the Daily Report every night at 12:00 AM (midnight)
Asia/Karachi for the business day that has just ended, additively — the
manual "Generate Report" button (POST /reports/daily/generate) keeps working
exactly as before, unaffected by this job; the two just insert separate
GeneratedReport rows into the same table (no uniqueness constraint on
business_date — see models.GeneratedReport).

Because the job fires the instant a new day starts, "today" would be an
empty day: the report is always for YESTERDAY's business date.

§ WhatsApp Recipients & Daily Scheduler — immediately after generating,
also auto-sends the Urdu report to every active WhatsAppRecipient, but
ONLY when the whatsapp_auto_send_enabled AppSetting is on ("true") and at
least one active recipient exists. The outcome is rolled up onto the Urdu
report's own whatsapp_status ("sent" only when every recipient was reached,
otherwise "failed"), so the Reports list shows it without opening the
per-recipient log. Fully additive to the existing manual Reports-page "Send
via WhatsApp" button, which keeps working unchanged regardless of this
setting.

Missed-run tolerance — this job lives in an in-memory scheduler, so a
restart at midnight would otherwise skip the whole day silently:
  * misfire_grace_time: a run delayed (busy process/thread) still fires as
    long as it is less than MISFIRE_GRACE_SECONDS late.
  * startup catch-up: if the process comes back up within CATCHUP_WINDOW
    after midnight and no scheduled report exists yet for yesterday, it is
    generated (and sent) once, right then.

Runs as an in-process background thread (apscheduler.BackgroundScheduler)
started once from main.py's startup event — this app is a single
long-lived process, so no separate worker/cron infra is needed.
"""
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app import models
from app.database import SessionLocal
from app.routers.reports import _generate_daily_report, send_report_to_recipient, WHATSAPP_AUTO_SEND_SETTING_KEY
from app.timezone import KARACHI_TZ

logger = logging.getLogger(__name__)

SCHEDULED_GENERATED_BY = "Scheduler (12:00 AM)"
MISFIRE_GRACE_SECONDS = 3 * 60 * 60
CATCHUP_WINDOW = timedelta(hours=3)

_scheduler: BackgroundScheduler | None = None


def _scheduled_business_date() -> str:
    """The day the midnight run reports on — yesterday in Karachi. Still
    correct for a run that is late by up to the grace/catch-up window,
    since those are all still "the morning after"."""
    return (datetime.now(KARACHI_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")


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
    delivered = 0
    for recipient in recipients:
        try:
            ok, error = send_report_to_recipient(db, ur_report, recipient)
            if ok:
                delivered += 1
            else:
                logger.warning("Scheduled WhatsApp auto-send to %s failed: %s", recipient.phone_number, error)
        except Exception:
            # One recipient's failure must never block the rest — same
            # never-crash-the-process guarantee _run_scheduled_daily_report
            # already gives report generation itself.
            logger.exception("Scheduled WhatsApp auto-send to %s raised", recipient.phone_number)

    if delivered:
        ur_report.whatsapp_sent_at = datetime.utcnow()
    if delivered == len(recipients):
        ur_report.whatsapp_status = "sent"
        ur_report.whatsapp_error = None
    else:
        ur_report.whatsapp_status = "failed"
        ur_report.whatsapp_error = f"Not delivered to {len(recipients) - delivered} of {len(recipients)} recipients"
    db.add(ur_report)
    db.commit()


def _run_scheduled_daily_report() -> None:
    db = SessionLocal()
    try:
        business_date = _scheduled_business_date()
        reports = _generate_daily_report(db, business_date, SCHEDULED_GENERATED_BY)
        logger.info("Scheduled daily report generated for %s", business_date)
        _run_scheduled_whatsapp_auto_send(db, reports)
    except Exception:
        # A failed auto-generation must never crash the process or block
        # the next day's run — the manual button remains available as a
        # fallback regardless.
        logger.exception("Scheduled daily report generation failed")
        db.rollback()
    finally:
        db.close()


def _catch_up_missed_run() -> None:
    """Startup safety net for a restart that overlapped midnight."""
    now = datetime.now(KARACHI_TZ)
    if now - now.replace(hour=0, minute=0, second=0, microsecond=0) > CATCHUP_WINDOW:
        return
    business_date = _scheduled_business_date()
    db = SessionLocal()
    try:
        already = (
            db.query(models.GeneratedReport)
            .filter(
                models.GeneratedReport.generated_by == SCHEDULED_GENERATED_BY,
                models.GeneratedReport.business_date == business_date,
            )
            .first()
        )
    finally:
        db.close()
    if already:
        return
    logger.warning("Midnight report for %s was missed — running it now", business_date)
    _run_scheduled_daily_report()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler(timezone=KARACHI_TZ)
    _scheduler.add_job(
        _run_scheduled_daily_report,
        trigger=CronTrigger(hour=0, minute=0, timezone=KARACHI_TZ),
        id="daily_report_midnight",
        replace_existing=True,
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
        coalesce=True,
        max_instances=1,
    )
    # One-off, in the background, so startup itself never waits on PDF
    # rendering or the WhatsApp API.
    _scheduler.add_job(
        _catch_up_missed_run,
        trigger="date",
        run_date=datetime.now(KARACHI_TZ) + timedelta(seconds=10),
        id="catch_up_missed_midnight_run",
        replace_existing=True,
    )
    _scheduler.start()
    return _scheduler
