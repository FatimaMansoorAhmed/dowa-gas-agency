import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/dowa_gas")

# For local quick-start without Postgres installed, you can instead set:
#   DATABASE_URL=sqlite:///./dowa_local.db
# in your .env — everything below works unchanged either way.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
else:
    # The default pool (5 + 10 overflow) is smaller than the burst a page
    # load fires (the Dashboard alone issues ~14 requests at once), so
    # requests queued for a free connection. pre_ping drops dead connections
    # (e.g. after a database restart) instead of failing the first request.
    engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()