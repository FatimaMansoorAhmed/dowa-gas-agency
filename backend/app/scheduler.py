"""Auto-generates the Daily Report every day at 12:00 PM Asia/Karachi,
additively — the manual "Generate Report" button (POST /reports/daily/
generate) keeps working exactly as before, unaffected by this job; the two
just insert separate GeneratedReport rows into the same table (no
uniqueness constraint on business_date — see models.GeneratedReport).

Runs as an in-process background thread (apscheduler.BackgroundScheduler)
started once from main.py's startup event — this app is a single
long-lived process (Railway), so no separate worker/cron infra is needed.
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database import SessionLocal
from app.routers.reports import _generate_daily_report
from app.timezone import KARACHI_TZ, karachi_today_str

logger = logging.getLogger(__name__)

SCHEDULED_GENERATED_BY = "Scheduler (12:00 PM)"

_scheduler: BackgroundScheduler | None = None


def _run_scheduled_daily_report() -> None:
    db = SessionLocal()
    try:
        _generate_daily_report(db, karachi_today_str(), SCHEDULED_GENERATED_BY)
        logger.info("Scheduled daily report generated for %s", karachi_today_str())
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
