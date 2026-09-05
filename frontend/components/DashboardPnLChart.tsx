"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { pkr, toKarachiDateString, todayLocalInput } from "@/lib/format";
import type { Sale, Purchase, Expense, OwnerDrawing } from "@/lib/types";

type Granularity = "daily" | "monthly" | "yearly";

const GRANULARITY_OPTIONS: { key: Granularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Totals = { sale: number; purchase: number; outflow: number };
const emptyTotals = (): Totals => ({ sale: 0, purchase: 0, outflow: 0 });
const addInto = (t: Totals, o: Totals) => { t.sale += o.sale; t.purchase += o.purchase; t.outflow += o.outflow; };
const cashResult = (t: Totals) => t.sale - t.purchase - t.outflow;

// Pure calendar-date arithmetic on a "YYYY-MM-DD" key — deliberately routed
// through Date.UTC so it never picks up the viewer's own local timezone
// (the key is already a Karachi calendar date via toKarachiDateString, so
// shifting it must stay calendar-only, not instant-based).
function shiftDay(dayKey: string, deltaDays: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function shiftMonth(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ComparisonBadge({ current, baseline, label }: { current: Totals; baseline: Totals | undefined; label: string }) {
  if (!baseline) {
    return (
      <span className="font-mono text-[10px] px-2 py-1 rounded-md bg-slate-100 text-steel whitespace-nowrap">
        No prior-period data yet
      </span>
    );
  }
  const curCR = cashResult(current);
  const baseCR = cashResult(baseline);
  const delta = curCR - baseCR;
  // % change is only meaningful against a strictly positive base — with a
  // negative or zero prior period, "percent change" has no intuitive
  // reading (e.g. −38,759 -> +18,122 is not sensibly "+147%": the % would
  // even flip direction-of-badness for two negative numbers, like −10 ->
  // −20 reading as "only" 100% worse). Fall back to a plain Rs delta there.
  const pct = baseCR > 0 ? (delta / baseCR) * 100 : null;
  const positive = delta >= 0;
  return (
    <span
      className={`font-mono text-[10px] px-2 py-1 rounded-md whitespace-nowrap ${
        positive ? "bg-[#E4F3EC] text-brand-green" : "bg-[#FBEAEA] text-brand-red"
      }`}
    >
      {positive ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct).toFixed(0)}%` : pkr(Math.abs(delta))} {label}
    </span>
  );
}

/** Dashboard P&L chart (§ Dashboard) — Sale, Purchase, and Expenses +
 * Withdrawals shown as three separate bars (never netted into one another)
 * plus an overlaid "Net Cash Movement" line = Sale − Purchase − (Expenses +
 * Withdrawals). Deliberately NOT called "Net Profit/Loss" — that label
 * belongs to the P&L card above, which keeps Owner Withdrawals out of the
 * headline figure; this chart folds Withdrawals into the same deducted
 * bucket as Expenses, so the two numbers differ on purpose and must never
 * share a name. Grouping/comparison is done client-side over the full
 * history the parent already fetches (no new backend endpoint — matches
 * how every other Dashboard figure is computed today). */
export default function DashboardPnLChart({
  sales, purchases, expenses, drawings,
}: {
  sales: Sale[]; purchases: Purchase[]; expenses: Expense[]; drawings: OwnerDrawing[];
}) {
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const today = todayLocalInput();
  const currentMonth = today.slice(0, 7);
  const currentYear = today.slice(0, 4);

  const byDay = useMemo(() => {
    const m = new Map<string, Totals>();
    const ensure = (d: string) => { if (!m.has(d)) m.set(d, emptyTotals()); return m.get(d)!; };
    for (const s of sales) ensure(toKarachiDateString(s.date)).sale += parseFloat(s.total_amount);
    for (const p of purchases) ensure(toKarachiDateString(p.date)).purchase += parseFloat(p.total_amount);
    for (const e of expenses) ensure(toKarachiDateString(e.date)).outflow += parseFloat(e.amount);
    for (const d of drawings) ensure(toKarachiDateString(d.date)).outflow += parseFloat(d.amount);
    return m;
  }, [sales, purchases, expenses, drawings]);

  const byMonth = useMemo(() => {
    const m = new Map<string, Totals>();
    for (const [day, t] of byDay) {
      const mk = day.slice(0, 7);
      if (!m.has(mk)) m.set(mk, emptyTotals());
      addInto(m.get(mk)!, t);
    }
    return m;
  }, [byDay]);

  const byYear = useMemo(() => {
    const m = new Map<string, Totals>();
    for (const [month, t] of byMonth) {
      const yk = month.slice(0, 4);
      if (!m.has(yk)) m.set(yk, emptyTotals());
      addInto(m.get(yk)!, t);
    }
    return m;
  }, [byMonth]);

  const dailyBuckets = useMemo(
    () => Array.from(byDay.entries()).filter(([d]) => d.startsWith(currentMonth)).sort(([a], [b]) => a.localeCompare(b)),
    [byDay, currentMonth]
  );
  const monthlyBuckets = useMemo(
    () => Array.from(byMonth.entries()).filter(([m]) => m.startsWith(currentYear)).sort(([a], [b]) => a.localeCompare(b)),
    [byMonth, currentYear]
  );
  const yearlyBuckets = useMemo(
    () => Array.from(byYear.entries()).sort(([a], [b]) => a.localeCompare(b)),
    [byYear]
  );

  const buckets = granularity === "daily" ? dailyBuckets : granularity === "monthly" ? monthlyBuckets : yearlyBuckets;

  const labelFor = (key: string) => {
    if (granularity === "daily") return key.slice(8, 10);
    if (granularity === "monthly") return MONTH_ABBR[Number(key.slice(5, 7)) - 1];
    return key;
  };
  const fullLabelFor = (key: string) => {
    if (granularity === "daily") return key;
    if (granularity === "monthly") return `${MONTH_ABBR[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    return key;
  };

  const data = buckets.map(([key, t]) => ({
    key,
    label: labelFor(key),
    fullLabel: fullLabelFor(key),
    "Sale": Math.round(t.sale),
    "Purchase": -Math.round(t.purchase),
    "Expenses + Withdrawals": -Math.round(t.outflow),
    "Net Cash Movement": Math.round(cashResult(t)),
  }));

  const currentTotals =
    granularity === "daily" ? byDay.get(today) ?? emptyTotals()
    : granularity === "monthly" ? byMonth.get(currentMonth) ?? emptyTotals()
    : byYear.get(currentYear) ?? emptyTotals();

  // The current month/year bucket only ever contains days up to today
  // (there's no future data to accidentally include), so it's always
  // "elapsed so far" already — but the *prior* period is a complete month
  // or year in byMonth/byYear. Comparing today's partial current period
  // against a full prior period is an apples-to-oranges swing (e.g. 4 days
  // of September vs all 31 days of August), so the baseline is windowed
  // down to the same elapsed cutoff instead of using the full prior period.
  const daysElapsed = Number(today.slice(8, 10));
  const todayMonthDay = today.slice(5, 10); // "MM-DD"
  const sumWhere = (prefix: string, keep: (day: string) => boolean): Totals => {
    const t = emptyTotals();
    for (const [day, v] of byDay) {
      if (day.startsWith(prefix) && keep(day)) addInto(t, v);
    }
    return t;
  };
  const baselineMonthKey = shiftMonth(currentMonth, -1);
  const baselineYearKey = String(Number(currentYear) - 1);
  const baselineTotals =
    granularity === "daily" ? byDay.get(shiftDay(today, -7))
    : granularity === "monthly" ? (byMonth.has(baselineMonthKey) ? sumWhere(baselineMonthKey, (d) => Number(d.slice(8, 10)) <= daysElapsed) : undefined)
    : (byYear.has(baselineYearKey) ? sumWhere(baselineYearKey, (d) => d.slice(5, 10) <= todayMonthDay) : undefined);

  const comparisonLabel =
    granularity === "daily" ? "vs same day last week"
    : granularity === "monthly" ? `vs first ${daysElapsed} day${daysElapsed === 1 ? "" : "s"} of last month`
    : `vs Jan 1–${MONTH_ABBR[Number(today.slice(5, 7)) - 1]} ${Number(today.slice(8, 10))} last year`;

  const emptyMessage =
    granularity === "daily" ? "No activity yet this month."
    : granularity === "monthly" ? "No activity yet this year."
    : "No activity recorded yet.";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="font-mono text-[10px] uppercase text-steel tracking-wide">
          Sale · Purchase · Expenses + Withdrawals · Net Cash Movement
        </div>
        <div className="flex items-center gap-2">
          <ComparisonBadge current={currentTotals} baseline={baselineTotals} label={comparisonLabel} />
          <div className="inline-flex p-1 bg-slate-100 rounded-lg text-[11px] font-semibold text-slate-600 w-fit">
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGranularity(opt.key)}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  granularity === opt.key ? "bg-[#A8D0CD] text-[#1E403C] shadow-xs font-bold" : "hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!data.length ? (
        <div className="font-body text-[13px] text-steel py-10 text-center">{emptyMessage}</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "monospace", fill: "#2D3748" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "#2D3748" }} tickLine={false} axisLine={false} tickFormatter={(v) => pkr(v)} width={70} />
            <Tooltip
              formatter={(value) => pkr(typeof value === "number" ? value : Number(value ?? 0))}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
              contentStyle={{ fontSize: 12, fontFamily: "monospace", borderRadius: 8, border: "1px solid #C5C1B4" }}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
            <Bar dataKey="Sale" fill="#1E8A5F" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Purchase" fill="#D98E04" radius={[0, 0, 3, 3]} />
            <Bar dataKey="Expenses + Withdrawals" fill="#C8102E" radius={[0, 0, 3, 3]} />
            <Line type="monotone" dataKey="Net Cash Movement" stroke="#0F8B8D" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="font-mono text-[10px] text-steel mt-2">
        Net Cash Movement = Sale − Purchase − (Expenses + Withdrawals) — differs from Net Profit/Loss above, which keeps Owner Withdrawals separate.
      </div>
    </div>
  );
}
