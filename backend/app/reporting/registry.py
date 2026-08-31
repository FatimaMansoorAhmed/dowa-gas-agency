"""The extensibility point for §8 Future-Proof Reporting: a future module
registers itself here — one function + one `register(...)` call — and it
automatically appears in the Daily PDF, the Daily Activity screen, and the
printed daily report, all of which only ever iterate `ADAPTERS`. Nothing
downstream needs to change to pick up a newly-registered section."""
from dataclasses import dataclass
from datetime import datetime
from typing import Callable
from sqlalchemy.orm import Session

from app.reporting.types import ReportableTransaction

FetchFn = Callable[[Session, datetime, datetime], list[ReportableTransaction]]


@dataclass
class ReportAdapter:
    key: str
    label: str
    fetch: FetchFn
    has_financial_total: bool = True


ADAPTERS: dict[str, ReportAdapter] = {}


def register(key: str, label: str, fetch: FetchFn, has_financial_total: bool = True) -> None:
    """Adds one section to every daily report. `fetch(db, start, end)` must
    return every ReportableTransaction of that type whose business date
    falls in `[start, end)` (naive-UTC bounds — see
    app.timezone.karachi_day_bounds)."""
    ADAPTERS[key] = ReportAdapter(key=key, label=label, fetch=fetch, has_financial_total=has_financial_total)
