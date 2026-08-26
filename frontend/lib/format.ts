import type { AccountType, PaymentAccount } from "./types";

// The only 4 fixed cash/bank buckets a Unified Sale or Payment Receipt can
// be routed to when the destination isn't a plant — kept in one place so
// every page renders the exact same label for the exact same value.
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {

  office_cash: "Office Cash",
  owner_home: "Owner Home",
  dowa_account: "Dawa Account",
};

const isAccountType = (v: string): v is AccountType => v in ACCOUNT_TYPE_LABELS;

// Resolves a stored account_id/account_category into a display label. The
// value is either one of the 4 fixed category keys above, or (only for
// older records saved before routing was locked to those 4) a real
// PaymentAccount UUID — this still resolves those correctly.
export const resolveAccountLabel = (
  accountId: string | null | undefined,
  accounts: PaymentAccount[] = []
): string => {
  if (!accountId) return ACCOUNT_TYPE_LABELS.office_cash;
  if (isAccountType(accountId)) return ACCOUNT_TYPE_LABELS[accountId];
  const real = accounts.find((a) => a.id === accountId);
  if (real) return real.name;
  return accountId.replace(/_/g, " ").toUpperCase();
};

export const pkr = (n: number | string) => {
  const num = typeof n === "string" ? parseFloat(n) : n;
  const neg = num < 0;
  const v = Math.abs(Math.round(num || 0));
  return (neg ? "-" : "") + "Rs " + v.toLocaleString("en-US");
};

// Backend timestamps are sometimes naive (no trailing Z / offset) — e.g.
// "2026-08-20T05:00:00". Without a timezone marker, `new Date(...)`
// interprets that string as LOCAL time instead of UTC, so a naive UTC
// instant gets displayed several hours off (PKT is UTC+5). Treat any
// marker-less string as UTC before parsing so it converts to the viewer's
// local time correctly — every date parse in the app should go through this.
export const parseServerDate = (iso: string): Date => {
  if (!iso) return new Date();
  
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
  
  // ✅ Agar timezone marker na ho, to "T" lagayein aur aakhir mein "Z" append karein taake UTC treat ho
  const cleanIso = iso.replace(" ", "T");
  return new Date(hasTimezone ? iso : `${cleanIso}Z`);
};

// "Today" for <input type="date"> defaults and similar — computed in
// Asia/Karachi explicitly, so it's correct even when the viewer's own
// machine clock/timezone isn't Karachi. `new Date().toISOString().slice(0,
// 10)` is the wrong tool here: that's the UTC calendar date, which runs a
// day behind Karachi's between midnight and 5am PKT (§ Karachi Timezone Fix).
export const todayLocalInput = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

// Formats a server timestamp as its Asia/Karachi calendar date
// ("YYYY-MM-DD") — the correct basis for comparing against a date
// picker's value, or for deriving a "YYYY-MM" / "YYYY" filter key. Every
// day/month/year "Day"/"Month"/"Year" list filter in the app should
// compare through this. Never derive these via
// `new Date(iso).getFullYear()/getMonth()/getDate()` or
// `.toISOString().slice(...)`: a marker-less backend timestamp handed
// straight to `new Date()` is parsed as the *viewer's own* local time, not
// UTC (see parseServerDate) — so a "Day" filter comparing that against a
// picker value can silently return zero matches (§ Day-wise Date Filtering
// Mismatch).
export const toKarachiDateString = (iso: string): string => {
  if (!iso) return "";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
};

// True when a server timestamp and `reference` (default: now) fall on the
// same Asia/Karachi calendar day — for "is this today" checks.
export const isSameKarachiDay = (iso: string, reference: Date = new Date()): boolean => {
  if (!iso) return false;
  const day = toKarachiDateString(iso);
  if (!day) return false;
  return day === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(reference);
};

// The single canonical "display a server timestamp" helper — every date
// shown in the UI should go through this (§ Double Timezone Offset Fix:
// Global Frontend Formatting Helper). Deliberately parses via
// parseServerDate rather than `new Date(dateString)` directly: the backend
// returns naive timestamps (no 'Z'/offset — see app/timezone.py's
// to_naive_utc), and a marker-less string handed straight to `new Date()`
// is parsed as the *viewer's own* local time instead of UTC, which would
// reintroduce the exact double-offset bug this fixes at the display layer.
export function formatTimestamp(dateString: string): string {
  if (!dateString) return "";
  const d = parseServerDate(dateString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Karachi",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// fmtTime is formatTimestamp's established name throughout the app — kept
// as an alias so there is exactly one implementation, never two that can
// drift apart.
export const fmtTime = formatTimestamp;

export const fmtClock = (iso: string) => {
  if (!iso) return "—";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Karachi", // 👈 Timezone lazmi set karein
  });
};

export const monthKey = (iso: string) => {
  const d = parseServerDate(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};