"""Structural reference data the app requires to function — distinct from
app/seed.py, which is a one-time, manually-run demo/mock data script.

Product rows (cylinder types) are config, not transactional data: they must
exist even on a database that has been fully wiped of customers/sales/
payments before going live. This runs on every startup and only ever
inserts a missing Product row — it never touches any other table.
"""

import logging

from app import models
from app.database import SessionLocal

logger = logging.getLogger(__name__)

_REQUIRED_PRODUCTS = [
    ("11.8 KG Cylinder", 11.8),
    ("45.4 KG Cylinder", 45.4),
]


def ensure_reference_data() -> None:
    db = SessionLocal()
    try:
        for name, weight_kg in _REQUIRED_PRODUCTS:
            exists = db.query(models.Product).filter(models.Product.name == name).first()
            if exists:
                continue
            db.add(models.Product(name=name, weight_kg=weight_kg, active="active"))
            db.commit()
            logger.info("ensure_reference_data: created missing Product %r", name)
    except Exception:
        db.rollback()
        logger.exception("ensure_reference_data: failed to ensure reference Product rows")
    finally:
        db.close()
