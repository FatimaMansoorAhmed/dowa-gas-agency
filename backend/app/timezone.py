"""Asia/Karachi calendar helpers.

Every DateTime column in this app (Sale.date, Payment.date, *.created_at,
RateEntry.timestamp, ...) stores naive UTC — set via datetime.utcnow() —
and the frontend already converts that to Asia/Karachi for display
(frontend/lib/format.ts's parseServerDate + fmtTime/fmtClock, both passing
timeZone: "Asia/Karachi"). Do NOT change those to local time: that naive-UTC
convention is what the display layer already assumes, and storing local
time there instead would silently double-shift every rendered timestamp.

What DOES need to be Karachi-local is business-CALENDAR logic — "which
month/day is it right now, for the purpose of a monthly rollover" — since
that's a local business concept, not an audit timestamp. Pakistan Standard
Time has been a fixed UTC+5 offset with no daylight saving since 2009, so a
fixed-offset timezone is exact (and avoids depending on the `tzdata`
package, which isn't installed on this Windows host's Python).
"""
from datetime import datetime, timedelta, timezone

KARACHI_TZ = timezone(timedelta(hours=5), name="Asia/Karachi")


def karachi_month_str() -> str:
    """Current calendar month in Asia/Karachi, as 'YYYY-MM' — used for
    monthly opening-balance rollover (§ Karachi Timezone Fix)."""
    return datetime.now(KARACHI_TZ).strftime("%Y-%m")


def karachi_today_str() -> str:
    """Current business date in Asia/Karachi, as 'YYYY-MM-DD' — default
    date for the Shop dashboard's daily stock summary."""
    return datetime.now(KARACHI_TZ).strftime("%Y-%m-%d")


def karachi_day_bounds(business_date: str) -> tuple[datetime, datetime]:
    """[start, end) naive-UTC bounds for one Asia/Karachi calendar day, given
    as "YYYY-MM-DD" — the business-date window every report/daily-activity
    query filters transaction dates against. Mirrors karachi_month_str's
    fixed +5h convention; every stored DateTime here is naive UTC (see
    to_naive_utc's docstring), so the boundary itself is expressed in that
    same storage convention rather than converted at query time."""
    day_start_local = datetime.strptime(business_date, "%Y-%m-%d").replace(tzinfo=KARACHI_TZ)
    day_end_local = day_start_local + timedelta(days=1)
    return (
        day_start_local.astimezone(timezone.utc).replace(tzinfo=None),
        day_end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def to_naive_utc(value: datetime) -> datetime:
    """Normalizes a datetime to naive UTC before it ever reaches a DB column.

    Root cause of the "+5h double timezone offset" bug: every DateTime
    column here is declared WITHOUT a timezone (plain `TIMESTAMP`), but the
    Postgres session's `timezone` GUC is set to Asia/Karachi. When an AWARE
    datetime (e.g. one FastAPI/Pydantic parsed from a 'Z'-suffixed ISO
    string like `new Date().toISOString()` sends, or Python's
    `datetime.now(timezone.utc)`) is bound to one of these columns, Postgres
    resolves it to an absolute instant and then converts THAT to the
    session's Asia/Karachi timezone before stripping the offset and storing
    the naive result — silently turning a UTC timestamp into Karachi
    wall-clock digits mislabeled as UTC. The frontend then applies its own
    UTC->Asia/Karachi conversion on top of that already-local value,
    producing a further +5h shift (a real 4:21 AM PKT event ends up
    displayed as 9:21 AM PKT).

    A naive input is assumed to already be correct UTC (this app's storage
    convention — see datetime.utcnow() usage throughout models.py/routers)
    and is returned unchanged. An aware input is converted to true UTC
    first, then has its tzinfo stripped, so Postgres has nothing left to
    (mis)convert.
    """
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)
