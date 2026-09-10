import type { RateEntry } from "./types";

// Sentinel for "this rate genuinely has no party" in a <select> — matches
// rate-dashboard/page.tsx's NO_PARTY_VALUE so both places behave the same.
export const NO_PARTY_VALUE = "__no_party__";

// One key per (company, party) pair. "none" for no-party rather than the
// literal string "null" — matches the backend's own NULL-safe grouping in
// routers/rates.latest_rates (plain `party_id = NULL` never matches in
// SQL, so both sides group no-party rows under one explicit key instead).
export function rateKey(companyId: string, partyId: string | null | undefined): string {
  return `${companyId}::${partyId ?? "none"}`;
}

// Reduces a flat rates.latest() list (one row per (company, party) pair
// already, but still a flat array) down to a lookup by that pair — the
// same composite-key reduction rate-dashboard/page.tsx's latestByPartyId
// already does; every caller resolving "the rate for this company+party"
// should go through this instead of re-deriving it (e.g. filtering by
// company_id alone and taking the most recent row silently picks whichever
// party happened to have the newest entry, which is the exact bug this
// exists to prevent).
export function latestRateByKey(rates: RateEntry[]): Record<string, RateEntry> {
  const m: Record<string, RateEntry> = {};
  rates.forEach((r) => {
    const key = rateKey(r.company_id, r.party_id);
    if (!m[key] || new Date(r.timestamp).getTime() > new Date(m[key].timestamp).getTime()) {
      m[key] = r;
    }
  });
  return m;
}

// partyId: a real party's id, NO_PARTY_VALUE ("explicitly no party"), or
// "" (no selection made yet — e.g. a company with >1 party where the user
// hasn't chosen one). "" resolves to undefined rather than guessing.
export function resolveRate(
  rates: RateEntry[],
  companyId: string | null | undefined,
  partyId: string
): RateEntry | undefined {
  if (!companyId || partyId === "") return undefined;
  const normalizedPartyId = partyId === NO_PARTY_VALUE ? null : partyId;
  return latestRateByKey(rates)[rateKey(companyId, normalizedPartyId)];
}
