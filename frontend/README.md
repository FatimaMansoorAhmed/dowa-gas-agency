# DOWA Gas Agency — Frontend (Next.js + TypeScript + Tailwind)

## Local setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and point `NEXT_PUBLIC_API_URL` at your
   running backend (default `http://localhost:8000`).
3. `npm run dev` → http://localhost:3000

You'll land on `/login` first — pick CEO or Staff and enter a name (no password,
per spec: both roles have full access, this just tags who entered what).

## Deploying to Vercel

1. Push this `frontend/` folder to your repo, import it into Vercel, set the root
   directory to `frontend/`.
2. Set env var `NEXT_PUBLIC_API_URL` to your deployed Railway backend URL.
3. Deploy.

## Structure

- `app/` — App Router pages: `/` (Dashboard), `/new-rate`, `/rate-dashboard`, `/customers`, `/login`
- `components/` — `Shell` (sidebar + top bar), `AuthGate` (redirects to /login if not signed in), `ui.tsx` (Panel/Th/Td/Button/etc, same design tokens as the pitch prototype)
- `lib/api.ts` — typed fetch wrapper for the FastAPI backend
- `lib/auth.tsx` — simple localStorage-based session (name + role), no server-side auth per spec
