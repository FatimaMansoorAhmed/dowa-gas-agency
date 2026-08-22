import type { AccountType, PaymentAccount } from "./types";

// The only 4 fixed cash/bank buckets a Unified Sale or Payment Receipt can
// be routed to when the destination isn't a plant — kept in one place so
// every page renders the exact same label for the exact same value.
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
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
  // Agar ISO string mein pehle se Z ya offset nahi hai, toh local input handle karein
  return new Date(hasTimezone ? iso : iso.replace(" ", "T"));
};

export const fmtTime = (iso: string) => {
  if (!iso) return "—";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Karachi",
  });
};

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