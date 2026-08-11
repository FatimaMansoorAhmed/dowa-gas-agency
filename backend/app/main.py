import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.database import Base, engine
from app.routers import companies, parties, rates, customers

load_dotenv()

app = FastAPI(title="DOWA Gas Agency API", version="0.1.0")

origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router)
app.include_router(parties.router)
app.include_router(rates.router)
app.include_router(customers.router)


@app.on_event("startup")
def on_startup():
    # Simple, boring table creation for this phase — swap for Alembic
    # migrations once the schema needs to evolve without dropping data.
    Base.metadata.create_all(bind=engine)


@app.get("/")
def health():
    return {"status": "ok", "service": "dowa-gas-agency-api"}
