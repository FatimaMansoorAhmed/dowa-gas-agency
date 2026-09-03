"use client";

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { pkr, toKarachiDateString } from "@/lib/format";
import type { Sale, Purchase, Expense, OwnerDrawing } from "@/lib/types";

/** Dashboard P&L chart (§ Dashboard) — daily bars for the two raw inputs
 * (Sale Margin, Expenses + Withdrawals) plus an overlaid line for the
 * derived Net Profit, across the days elapsed so far in the current
 * month. Same month-scope as the P&L card above it — grouping is done
 * client-side over the same already-fetched list responses, no new
 * backend endpoint (matches how every other Dashboard figure is
 * computed today). */
export default function DashboardPnLChart({
  sales, purchases, expenses, drawings,
}: {
  sales: Sale[]; purchases: Purchase[]; expenses: Expense[]; drawings: OwnerDrawing[];
}) {
  const days = new Map<string, { margin: number; outflow: number }>();
  const ensure = (d: string) => {
    if (!days.has(d)) days.set(d, { margin: 0, outflow: 0 });
    return days.get(d)!;
  };
  for (const s of sales) ensure(toKarachiDateString(s.date)).margin += parseFloat(s.total_amount);
  for (const p of purchases) ensure(toKarachiDateString(p.date)).margin -= parseFloat(p.total_amount);
  for (const e of expenses) ensure(toKarachiDateString(e.date)).outflow += parseFloat(e.amount);
  for (const d of drawings) ensure(toKarachiDateString(d.date)).outflow += parseFloat(d.amount);

  const data = Array.from(days.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      day: date.slice(8, 10),
      fullDate: date,
      "Sale Margin": Math.round(v.margin),
      "Expenses + Withdrawals": -Math.round(v.outflow),
      "Net Profit": Math.round(v.margin - v.outflow),
    }));

  if (!data.length) {
    return <div className="font-body text-[13px] text-steel py-10 text-center">No activity yet this month.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE0" />
        <XAxis dataKey="day" tick={{ fontSize: 11, fontFamily: "monospace", fill: "#2D3748" }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fontFamily: "monospace", fill: "#2D3748" }} tickLine={false} axisLine={false} tickFormatter={(v) => pkr(v)} width={70} />
        <Tooltip
          formatter={(value) => pkr(typeof value === "number" ? value : Number(value ?? 0))}
          labelFormatter={(day, payload) => (payload?.[0]?.payload?.fullDate ? payload[0].payload.fullDate : `Day ${day}`)}
          contentStyle={{ fontSize: 12, fontFamily: "monospace", borderRadius: 8, border: "1px solid #C5C1B4" }}
        />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
        <Bar dataKey="Sale Margin" fill="#1E8A5F" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Expenses + Withdrawals" fill="#C8102E" radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="Net Profit" stroke="#0F8B8D" strokeWidth={2.5} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
