# DOWA Gas Agency — Phase 2

Real, separate frontend/backend, matching the locked stack:
Next.js + TypeScript + Tailwind (frontend) · FastAPI + PostgreSQL (backend).

Run the backend first (see `backend/README.md`), then the frontend
(see `frontend/README.md`), pointing `NEXT_PUBLIC_API_URL` at the backend.

## What's built this phase
- Company → Party structure, with a "add new party" flow
- New Rate Entry (11.8kg entered, 45.4kg auto-derived server-side)
- Rate Dashboard (latest per company/party + full history + WhatsApp share)
- Customer Page (add + search + list, advance-payment convention)
- Dashboard wired to real rate + customer data; Sales/Purchase widgets are
  placeholders until those modules are built
- Overpayment / credit-in-hand detection on customer payments

## Explicitly out of scope this phase
Sales entry, Purchase entry, and any ledger postings that depend on them
(the data model already accommodates this — see `backend/app/models.py`).
