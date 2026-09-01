"use client";
import { Layers } from "lucide-react";
import { parseServerDate } from "@/lib/format";
import type { ShopStockBatch } from "@/lib/types";

function dateOnly(iso: string) {
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", month: "short", day: "numeric" }).format(d);
}

/** Stock Batches (FIFO Breakdown & Inventory Flow) — read-only view of
 * ShopStockBatch rows exactly as the backend's FIFO consumption engine
 * sees them (routers/shops.py's _apply_shop_sale/_reverse_shop_sale
 * remain the sole authority on quantity_remaining; this component only
 * ever displays it). `batches` is always the LIVE/unfiltered list — the
 * "carrying balances" (summary bar) must never shift just because the
 * table below is narrowed to a past month, per spec. `tableBatches` is
 * what actually renders as rows, which the parent may have filtered by
 * month independently.
 *
 * Carried Over / Today's Loaded come in as props (detail.stock's own
 * total_opening_stock/total_new_load — routers/shops.py's
 * _compute_stock_summary), NOT recomputed here by filtering `batches` on
 * quantity_remaining: quantity_remaining is LIVE and already reflects
 * today's sales by the time this renders, so summing it for "before
 * today" batches would silently show today's post-sale leftovers as the
 * opening balance, not what was actually carried over — the exact
 * quantity_remaining-as-history trap the FIFO audit flagged. Net
 * Remaining is the one figure legitimately read live from `batches`
 * (quantity_remaining IS the current FIFO pointer, which is exactly what
 * "what's left right now" means). */
export default function ShopStockBatchesPanel({
  batches, tableBatches, totalOpeningStock, totalNewLoad, totalSoldToday,
  monthFilter, onMonthFilterChange, monthOptions,
}: {
  batches: ShopStockBatch[];
  tableBatches: ShopStockBatch[];
  totalOpeningStock: string; // detail.stock.total_opening_stock — carried over, derived from history
  totalNewLoad: string;      // detail.stock.total_new_load — today's loaded, derived from history
  totalSoldToday: string;
  monthFilter: string; // "" = live/all
  onMonthFilterChange: (month: string) => void;
  monthOptions: string[]; // e.g. ["2026-08", "2026-07", ...], newest first
}) {
  const carriedOver = parseFloat(totalOpeningStock) || 0;
  const todaysLoaded = parseFloat(totalNewLoad) || 0;
  const totalAvailable = carriedOver + todaysLoaded;
  const soldToday = parseFloat(totalSoldToday) || 0;
  // Ground truth, not a subtraction — the direct live sum across every
  // active batch, so this can never drift from what the table itself shows.
  const netRemaining = batches.reduce((sum, b) => sum + parseFloat(b.quantity_remaining), 0);

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Layers size={20} />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900">Stock Batches</h2>
            <p className="mt-1 text-sm text-slate-500">FIFO breakdown & inventory flow — oldest batch drains first.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Inspect month</span>
          <select
            value={monthFilter}
            onChange={(e) => onMonthFilterChange(e.target.value)}
            className="border-0 bg-transparent font-mono text-xs font-semibold text-slate-700 outline-none"
          >
            <option value="">Live (all batches)</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Inventory Flow Summary Bar — always the live/unfiltered totals,
          never affected by the "Inspect month" filter above (§4). */}
      <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-slate-50/50 px-6 py-4 sm:grid-cols-5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Carried Over</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-700">{fmt(carriedOver)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Today's Loaded</div>
          <div className="mt-1 font-mono text-sm font-semibold text-brand-green">+{fmt(todaysLoaded)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Available</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-700">{fmt(totalAvailable)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">Sold Today</div>
          <div className="mt-1 font-mono text-sm font-semibold text-brand-red">-{fmt(soldToday)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Net Remaining</div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-900">{fmt(netRemaining)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100">
              <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Received Date / Source
              </th>
              <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Product
              </th>
              <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Received
              </th>
              <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Consumed
              </th>
              <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Remaining
              </th>
              <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {tableBatches.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-400">
                  No batches for this view.
                </td>
              </tr>
            ) : (
              tableBatches.map((b, index) => {
                const received = parseFloat(b.quantity_received);
                const remaining = parseFloat(b.quantity_remaining);
                const consumed = received - remaining;
                const depleted = remaining <= 0;
                return (
                  <tr
                    key={b.id}
                    className={`border-b border-slate-100 transition-colors hover:bg-teal/[0.025] ${index % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
                  >
                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-600">
                      {dateOnly(b.transaction_date)} — {b.source_display_id ? `Load #${b.source_display_id}` : "Opening Stock"}
                    </td>
                    <td className="border-r border-slate-100 px-4 py-3 text-sm text-slate-700">
                      {b.product_name || "—"}
                    </td>
                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-700">
                      {fmt(received)}
                    </td>
                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-500">
                      {fmt(consumed)}
                    </td>
                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900">
                      {fmt(remaining)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {depleted ? (
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Depleted ({remaining.toFixed(4)})
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-slate-500">
          Oldest batch consumed first — stock drains here exactly as Shop Sales are recorded.
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
          {monthFilter ? `Historic view: ${monthFilter}` : "Live FIFO queue"}
        </span>
      </div>
    </section>
  );
}
