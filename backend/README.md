# DOWA Gas Agency — Backend (FastAPI + PostgreSQL)

## Local setup

1. Create a virtualenv and install deps:
   ```
   python -m venv venv
   source venv/bin/activate        # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
   - For real Postgres: `postgresql://user:password@localhost:5432/dowa_gas`
   - For a quick local test without installing Postgres: `sqlite:///./dowa_local.db`

3. Seed the database (creates tables + the 13 plants, sample parties/rates, sample customers):
   ```
   python -m app.seed
   ```

4. Run the API:
   ```
   uvicorn app.main:app --reload --port 8000
   ```

   Docs at http://localhost:8000/docs

## Deploying to Railway

1. Push this `backend/` folder to your repo.
2. Create a new Railway project → Add a PostgreSQL plugin → Railway gives you a `DATABASE_URL`.
3. Add a service from your repo, set the root directory to `backend/`, set env vars
   `DATABASE_URL` (from the Postgres plugin) and `CORS_ORIGINS` (your Vercel frontend URL).
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Run `python -m app.seed` once via Railway's shell/console to seed initial data.

## Endpoints

- `GET /companies`, `POST /companies`
- `GET /parties?company_id=`, `POST /parties`
- `GET /rates?company_id=&party_id=&since=`, `GET /rates/latest`, `POST /rates`
- `GET /customers?search=&status=`, `POST /customers`,
  `PATCH /customers/{id}/adjust` (body: `{"kind": "payment"|"charge", "amount": number}`),
  `PATCH /customers/{id}/status?status=active|inactive`

## Notes

- Tables are created with `Base.metadata.create_all` on startup — fine for this phase.
  Switch to Alembic migrations once the schema needs to change without losing data.
- Every rate entry is immutable — nothing is ever overwritten, matching the "multiple
  entries per day" requirement. `/rates/latest` returns only the most recent row per party.
- 45.4kg rate is always server-derived from the 11.8kg rate (ratio 45.4/11.8) — the
  frontend only ever sends `rate_118`.
- Customer `opening_balance` auto-rolls to the prior `current_balance` at the start of
  each new calendar month, so the "balance growing this month" flag re-evaluates monthly.
