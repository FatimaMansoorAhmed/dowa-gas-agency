"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Clock } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption } from "@/components/ui";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import { api } from "@/lib/api";
import DashboardPnLChart from "@/components/DashboardPnLChart";
import type { Company, Party, RateEntry, Customer, Sale, Purchase, Expense, OwnerDrawing, ShopSale, CustomerFlag } from "@/lib/types";

const POLL_MS = 30000;

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" reflects the Karachi calendar even off-Karachi machines.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function DashboardBody() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [latestRates, setLatestRates] = useState<RateEntry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesMTD, setSalesMTD] = useState<Sale[]>([]);
  const [purchasesMTD, setPurchasesMTD] = useState<Purchase[]>([]);
  const [expensesMTD, setExpensesMTD] = useState<Expense[]>([]);
  const [ownerDrawingsMTD, setOwnerDrawingsMTD] = useState<OwnerDrawing[]>([]);
  const [shopSalesMTD, setShopSalesMTD] = useState<ShopSale[]>([]);
  // Full-history feeds for DashboardPnLChart's Daily/Monthly/Yearly toggle
  // (§ Dashboard Chart Overhaul) — every list endpoint already returns all
  // rows when `month` is omitted, so no new backend endpoint is needed.
  // Kept separate from the *MTD state above, which the P&L card reads and
  // which this task leaves untouched.
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allPurchases, setAllPurchases] = useState<Purchase[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [allDrawings, setAllDrawings] = useState<OwnerDrawing[]>([]);
  const [flags, setFlags] = useState<CustomerFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const month = currentMonth();

  const loadAll = useCallback(async (isInitial = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const month = currentMonth();
      const [c, p, r, cu, sales, purchases, expenses, ownerDrawings, shopSales, fl, allS, allP, allE, allD] = await Promise.all([
        api.companies.list(),
        api.parties.list(),
        api.rates.latest(),
        api.customers.list(),
        api.sales.list({ month }),
        api.purchases.list({ month }),
        api.expenses.list({ month }),
        api.ownerDrawings.list(month),
        api.shops.salesList(month),
        api.ledger.customerFlags(month),
        api.sales.list(),
        api.purchases.list(),
        api.expenses.list(),
        api.ownerDrawings.list(),
      ]);

      setCompanies(c);
      setParties(p);
      setLatestRates(r);
      setCustomers(cu);
      setSalesMTD(sales);
      setPurchasesMTD(purchases);
      setExpensesMTD(expenses);
      setOwnerDrawingsMTD(ownerDrawings);
      setShopSalesMTD(shopSales);
      setFlags(fl);
      setAllSales(allS);
      setAllPurchases(allP);
      setAllExpenses(allE);
      setAllDrawings(allD);
      setLastSynced(new Date());
    } finally {
      inFlight.current = false;
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll(true);
    const id = setInterval(() => loadAll(false), POLL_MS);
    return () => clearInterval(id);
  }, [loadAll]);

  if (loading) return <div className="font-body text-steel p-10">Loading…</div>;

  // Flag Rule: this month's Closing Balance > this month's Opening Balance
  // (itself rolled over from the prior month's closing) -> Flagged.
  const flaggedAccounts = flags.filter((f) => f.flagged);
  const overpaid = customers.filter((c) => c.last_overpayment_amount && parseFloat(c.last_overpayment_amount) > 0);

  const totalSalesMTD = salesMTD.reduce((s, x) => s + parseFloat(x.total_amount), 0);
  const totalExpensesMTD = expensesMTD.reduce((s, x) => s + parseFloat(x.amount), 0);
  const hasSalesData = salesMTD.length > 0;
  const hasExpenseData = expensesMTD.length > 0;

  // Profit / Loss (§ Dashboard) — Sale Revenue − Purchase Cost (COGS) −
  // Expenses (plant + shop, combined for free now that Shop Expenses are
  // dual-written into the same /expenses table — see routers/shops.py's
  // create_shop_expense). Owner Drawings deliberately kept OUT of this
  // primary figure — OwnerDrawings' own established convention elsewhere
  // in this app is "must never reduce reported profit" — and shown as a
  // separate, clearly-labeled second line instead.
  const totalPurchasesMTD = purchasesMTD.reduce((s, x) => s + parseFloat(x.total_amount), 0);
  const totalOwnerDrawingsMTD = ownerDrawingsMTD.reduce((s, x) => s + parseFloat(x.amount), 0);
  const grossProfit = totalSalesMTD - totalPurchasesMTD;
  const netProfitLoss = grossProfit - totalExpensesMTD;
  const netProfitAfterDrawings = netProfitLoss - totalOwnerDrawingsMTD;

  // Sale / Purc / Total Tonnage cards (§ Dashboard) — total_kg is already
  // stored per row at write time (Sale/Purchase), combining both cylinder
  // types automatically; no unit branching needed. Tonnage is Sale +
  // Shop Sale kg only (Purchases deliberately excluded, per spec), using
  // the exact 1000kg=1ton constant already used in routers/ledger.py and
  // app/purchases/page.tsx — not a second copy of that conversion.
  const totalSaleKgMTD = salesMTD.reduce((s, x) => s + parseFloat(x.total_kg), 0);
  const totalPurchaseKgMTD = purchasesMTD.reduce((s, x) => s + parseFloat(x.total_kg), 0);
  const totalShopSaleKgMTD = shopSalesMTD.reduce((s, x) => s + parseFloat(x.quantity_kg || "0"), 0);
  const totalTonnageMTD = (totalSaleKgMTD + totalShopSaleKgMTD) / 1000;

  // Per-cylinder-type breakdown (enhancement to the cards above) — same
  // rows/filters, just grouped by weight_per_cylinder instead of flat-summed.
  // Sale.quantity/Purchase.quantity are already cylinder counts; ShopSale
  // has no separate "count" field but its `quantity` is stored in the exact
  // same cylinder-equivalent unit (see ShopSale model comment — it's what
  // FIFO stock math consumes), and cylinder_weight_used is the frozen
  // per-sale snapshot of Product.weight_kg, so it groups identically to
  // Sale/Purchase's weight_per_cylinder despite the different column name.
  // Only 11.8kg and 45.4kg products are active in this system today
  // (confirmed against the live Products table) so those are the two
  // buckets shown; the combined kg/ton totals above already include every
  // weight regardless, so nothing is silently dropped if a third ever exists.
  function sumQtyByWeight<T extends { quantity: string }>(rows: T[], weightOf: (r: T) => string, target: string): number {
    return rows.filter((r) => parseFloat(weightOf(r)).toFixed(1) === target).reduce((s, r) => s + parseFloat(r.quantity), 0);
  }
  const sale118 = sumQtyByWeight(salesMTD, (r) => r.weight_per_cylinder, "11.8");
  const sale454 = sumQtyByWeight(salesMTD, (r) => r.weight_per_cylinder, "45.4");
  const purc118 = sumQtyByWeight(purchasesMTD, (r) => r.weight_per_cylinder, "11.8");
  const purc454 = sumQtyByWeight(purchasesMTD, (r) => r.weight_per_cylinder, "45.4");
  const shopSale118 = sumQtyByWeight(shopSalesMTD, (r) => r.cylinder_weight_used, "11.8");
  const shopSale454 = sumQtyByWeight(shopSalesMTD, (r) => r.cylinder_weight_used, "45.4");
  const tonnage118 = sale118 + shopSale118;
  const tonnage454 = sale454 + shopSale454;

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title="Rates, sales, and customer balances, live"
        caption="Sale P&L and Purchase Summary populate automatically as sales and expenses are recorded -- everything here refreshes on its own, no reload needed."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-4">
        <Panel className="min-h-[96px]">
          <Eyebrow>Customers Flagged</Eyebrow>
          <div className={`font-display font-bold text-2xl ${flaggedAccounts.length ? "text-brand-amber" : "text-ink"}`}>{flaggedAccounts.length}</div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Total Sale Amount</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{pkr(totalSalesMTD)}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasSalesData ? `${salesMTD.length} sale${salesMTD.length === 1 ? "" : "s"} this month` : "No sales recorded yet"}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Total Expense </Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{pkr(totalExpensesMTD)}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasExpenseData ? "Expenses recorded this month" : "No purchases recorded yet — awaiting Purchase module"}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Sale</Eyebrow>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel mt-0.5">
            <span>11.8kg cylinders</span><span className="font-semibold text-ink">{sale118.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel">
            <span>45.4kg cylinders</span><span className="font-semibold text-ink">{sale454.toFixed(0)}</span>
          </div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{totalSaleKgMTD.toFixed(2)} <span className="text-sm text-steel font-normal">kg</span></div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasSalesData ? `${salesMTD.length} sale${salesMTD.length === 1 ? "" : "s"} this month` : "No sales recorded yet"}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Purc</Eyebrow>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel mt-0.5">
            <span>11.8kg cylinders</span><span className="font-semibold text-ink">{purc118.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel">
            <span>45.4kg cylinders</span><span className="font-semibold text-ink">{purc454.toFixed(0)}</span>
          </div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{totalPurchaseKgMTD.toFixed(2)} <span className="text-sm text-steel font-normal">kg</span></div>
          <div className="font-body text-[11px] text-steel mt-1">
            {purchasesMTD.length ? `${purchasesMTD.length} purchase${purchasesMTD.length === 1 ? "" : "s"} this month` : "No purchases recorded yet"}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Total Tonnage</Eyebrow>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel mt-0.5">
            <span>Total 11.8kg cylinders</span><span className="font-semibold text-ink">{tonnage118.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel">
            <span>Total 45.4kg cylinders</span><span className="font-semibold text-ink">{tonnage454.toFixed(0)}</span>
          </div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{totalTonnageMTD.toFixed(2)} <span className="text-sm text-steel font-normal">tons</span></div>
          <div className="font-body text-[11px] text-steel mt-1">
            Sale {totalSaleKgMTD.toFixed(0)}kg + Shop Sale {totalShopSaleKgMTD.toFixed(0)}kg
          </div>
        </Panel>
      </div>

      <Panel className="mb-3.5">
        <Eyebrow>Profit / Loss — {month}</Eyebrow>
        <SectionCaption>
          Sale Revenue − Purchase Cost (COGS) = Gross Profit, minus Expenses (plant + shop) = Net Profit/Loss.
          Owner Drawings are shown as a separate final step — they never reduce reported business profit, only
          personal cash taken out.
        </SectionCaption>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-1">
          <div className="rounded-lg border border-hairline bg-paper px-4 py-3.5">
            <div className="font-mono text-[10px] uppercase text-steel tracking-wide">Gross Profit</div>
            <div className={`font-display font-bold text-[26px] mt-0.5 ${grossProfit >= 0 ? "text-brand-green" : "text-brand-red"}`}>
              {pkr(grossProfit)}
            </div>
            <div className="font-mono text-[10.5px] text-steel mt-1.5 flex flex-wrap gap-x-3">
              <span>Sales {pkr(totalSalesMTD)}</span>
              <span>− COGS {pkr(totalPurchasesMTD)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-hairline bg-paper px-4 py-3.5">
            <div className="font-mono text-[10px] uppercase text-steel tracking-wide">Net Profit / Loss</div>
            <div className={`font-display font-bold text-[26px] mt-0.5 ${netProfitLoss >= 0 ? "text-brand-green" : "text-brand-red"}`}>
              {pkr(netProfitLoss)}
            </div>
            <div className="font-mono text-[10.5px] text-steel mt-1.5 flex flex-wrap gap-x-3">
              <span>Gross Profit {pkr(grossProfit)}</span>
              <span>− Expenses {pkr(totalExpensesMTD)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-hairline bg-paper px-4 py-3.5">
            <div className="font-mono text-[10px] uppercase text-steel tracking-wide">After Owner Withdrawals</div>
            <div className={`font-display font-bold text-[26px] mt-0.5 ${netProfitAfterDrawings >= 0 ? "text-ink" : "text-brand-red"}`}>
              {pkr(netProfitAfterDrawings)}
            </div>
            <div className="font-mono text-[10.5px] text-steel mt-1.5">
              Net Profit/Loss − Owner Drawings {pkr(totalOwnerDrawingsMTD)}
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-hairline">
          <DashboardPnLChart sales={allSales} purchases={allPurchases} expenses={allExpenses} drawings={allDrawings} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Panel>
          <div className="flex items-center justify-between mb-1.5">
            <Eyebrow>Latest Applied Rates</Eyebrow>
            <div className="flex items-center gap-1.5 pb-1.5">
              <span className="live-dot" />
              <span className="font-mono text-[9.5px] text-steel">
                {lastSynced ? `synced ${lastSynced.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Karachi" })}` : "syncing…"}
              </span>
            </div>
          </div>
          <SectionCaption>Most recently updated Company · Party pairs — refreshes automatically every 30s.</SectionCaption>
          <div className="flex flex-col gap-2">
            {latestRates.slice(0, 6).map((r) => {
              const company = companies.find((c) => c.id === r.company_id);
              const party = parties.find((p) => p.id === r.party_id);
              return (
                <div key={r.id} className="flex justify-between items-center px-3 py-2.5 bg-paper rounded-lg border border-hairline">
                  <div>
                    <div className="font-body text-[13px] font-semibold text-ink">
                      {company?.name} <span className="text-steel font-normal">· {party?.name}</span>
                    </div>
                    <div className="font-mono text-[10.5px] text-steel flex items-center gap-1 mt-0.5">
                      <Clock size={11} /> {fmtTime(r.timestamp)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold text-ink">{r.rate_118} <span className="text-[10px] text-steel">/11.8kg</span></div>
                    <div className="font-mono text-[11px] text-steel">{r.rate_454} /45.4kg</div>
                  </div>
                </div>
              );
            })}
            {!latestRates.length && <div className="font-body text-[13px] text-steel">No rate entries yet.</div>}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>Flagged Accounts — {month}</Eyebrow>
          <SectionCaption>
            Customers whose Closing Balance this month is above the Opening Balance it rolled over with —
            review these first. Click a customer to open their ledger.
          </SectionCaption>
          <div className="flex flex-col gap-2">
            {flaggedAccounts.map((f) => (
              <button
                key={f.customer.id}
                type="button"
                onClick={() => router.push(`/customer-ledger?id=${f.customer.id}`)}
                className="flex justify-between items-center px-3 py-2.5 rounded-lg border bg-[#FBF3E3] border-[#EBD9AE] text-left cursor-pointer w-full"
              >
                <div className="font-body text-[13px] font-semibold text-ink flex items-center gap-1.5">
                  <Flag size={13} color="#D98E04" /> {f.customer.name}
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="font-mono text-[9px] text-steel uppercase tracking-wide">Opening</div>
                    <div className="font-mono text-[11.5px] font-semibold text-ink">{pkr(f.opening_balance)}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] text-steel uppercase tracking-wide">Closing</div>
                    <div className="font-mono text-[11.5px] font-semibold text-ink">{pkr(f.closing_balance)}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] text-steel uppercase tracking-wide">Shortage</div>
                    <div className="font-mono text-[12.5px] font-bold text-brand-amber">{pkr(Math.max(0, Number(f.closing_balance) - Number(f.opening_balance)))}</div>
                  </div>
                </div>
              </button>
            ))}
            {!flaggedAccounts.length && (
              <div className="font-body text-[13px] text-steel py-4 text-center">
                No flagged customers this month.
              </div>
            )}
          </div>
          {overpaid.length > 0 && (
            <div className="mt-3 px-3 py-2.5 bg-[#FBEAEA] rounded-lg border border-[#EFC3C3]">
              {overpaid.map((c) => (
                <div key={c.id} className="font-body text-[12.5px] text-brand-red">
                  <b>{c.name}</b> paid {pkr(c.last_overpayment_amount!)} extra — sitting as credit-in-hand.
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardBody />
    </AuthGate>
  );
}