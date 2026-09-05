import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.database import Base, engine
from app.migrations import run_startup_migrations
from app.scheduler import start_scheduler
from app.routers import (
    companies, parties, rates, customers, products, payment_accounts,
    expense_categories, sales, payments, payment_receipts, expenses, ledger, purchases, company_payments,
    cylinder_transactions,owner_drawings, unified_sale, owner_capital, reports, board_rates, shops,
    auth, users, emergency_transfers, cylinder_returns,
)

load_dotenv()

app = FastAPI(
    title="DOWA Gas Agency API", 
    version="0.1.0",
    redirect_slashes=False
)

origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(companies.router)
app.include_router(parties.router)
app.include_router(rates.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(payment_accounts.router)
app.include_router(expense_categories.router)
app.include_router(sales.router)
app.include_router(payments.router)
app.include_router(payment_receipts.router)
app.include_router(expenses.router)
app.include_router(ledger.router)
app.include_router(purchases.router)
app.include_router(company_payments.router)
app.include_router(cylinder_transactions.router)
app.include_router(cylinder_returns.router)
app.include_router(owner_drawings.router)
app.include_router(unified_sale.router)
app.include_router(emergency_transfers.router)
app.include_router(owner_capital.router)
app.include_router(reports.router)
app.include_router(board_rates.router)
app.include_router(shops.router)


@app.on_event("startup")
def on_startup():
    # Simple, boring table creation for this phase — swap for Alembic
    # migrations once the schema needs to evolve without dropping data.
    Base.metadata.create_all(bind=engine)
    # create_all() only creates missing tables, not missing columns on
    # tables that already exist — this adds any new nullable/defaulted
    # columns models.py has picked up since the DB was first created.
    run_startup_migrations(engine)
    start_scheduler()


@app.get("/")
def health():
    return {"status": "ok", "service": "dowa-gas-agency-api"}