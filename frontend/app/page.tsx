"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Clock } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption } from "@/components/ui";
import { pkr, fmtTime, todayLocalInput, isSameKarachiDay } from "@/lib/format";
import { api } from "@/lib/api";
import DashboardPnLChart from "@/components/DashboardPnLChart";
import type { Company, Party, RateEntry, Customer, Sale, Purchase, Expense, OwnerDrawing, ShopSale, CustomerFlag } from "@/lib/types";

const POLL_MS = 30000;

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" reflects the Karachi calendar even off-Karachi machines.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

// § Dashboard P&L UI (§ Profit/Loss UI refinement) — same visual language
// as the KPI cards above (Eyebrow-style mono uppercase label + a bold
// font-display figure), just reused at two sizes: PnLStat for the
// Combined card's tile grid, PnLRow for a channel card's stacked list.
function PnLStat({ label, value, prominent = false }: { label: string; value: number; prominent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-widest uppercase text-steel mb-1">{label}</div>
      <div className={`font-display font-bold ${prominent ? "text-[24px]" : "text-lg"} ${prominent ? (value >= 0 ? "text-brand-green" : "text-brand-red") : "text-ink"}`}>
        {pkr(value)}
      </div>
    </div>
  );
}

function PnLRow({ label, value, prominent = false }: { label: string; value: number; prominent?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${prominent ? "mt-1.5 pt-2 border-t border-hairline" : "py-0.5"}`}>
      <span className={`font-mono text-[11px] tracking-wide uppercase ${prominent ? "text-ink font-semibold" : "text-steel"}`}>{label}</span>
      <span className={`font-display font-bold ${prominent ? `text-[20px] ${value >= 0 ? "text-brand-green" : "text-brand-red"}` : "text-[14px] text-ink"}`}>
        {pkr(value)}
      </span>
    </div>
  );
}

function DashboardBody() {
  const router = useRouter();
  const { t } = useTranslation();
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

  if (loading) return <div className="font-body text-steel p-10">{t("common.loading")}</div>;

  // Flag Rule: this month's Closing Balance > this month's Opening Balance
  // (itself rolled over from the prior month's closing) -> Flagged.
  const flaggedAccounts = flags.filter((f) => f.flagged);
  const overpaid = customers.filter((c) => c.last_overpayment_amount && parseFloat(c.last_overpayment_amount) > 0);

  const totalSalesMTD = salesMTD.reduce((s, x) => s + parseFloat(x.total_amount), 0);
  const totalExpensesMTD = expensesMTD.reduce((s, x) => s + parseFloat(x.amount), 0);
  const hasSalesData = salesMTD.length > 0;
  const hasExpenseData = expensesMTD.length > 0;

  // Segregated Profit Centers (§ Dashboard — Wholesale/Shop P&L) — Wholesale
  // and Shop are two independent businesses sharing one ledger, so pooling
  // Shop's expenses into a Wholesale-revenue-only Gross Profit (the old
  // behavior here) understated Net Profit by exactly however much Shop
  // spent, with nothing on the revenue side to offset it. Every Shop-
  // originated Expense row is identifiable from data that already exists —
  // either shop_id (set directly by the standalone Shop Expense form and
  // the multi-line Shop Sale Home Expense path) or one of the source_shop_
  // *_id lineage FKs (set by apply_settlement_routing for Shop Cash
  // Transfer/Shop Customer Payment/legacy single-amount Shop Sale Home
  // Expense, which never set shop_id itself) or shop_origin_label (the
  // permanent snapshot Delete Shop leaves once the shop itself is gone) —
  // never a new column, just recognizing the FKs Expense already has.
  const isShopExpense = (e: Expense) =>
    !!(e.shop_id || e.source_shop_sale_id || e.source_shop_cash_transfer_id || e.source_shop_customer_payment_id || e.shop_origin_label);
  const wholesaleExpensesMTD = expensesMTD.filter((e) => !isShopExpense(e));
  const shopExpensesMTD = expensesMTD.filter(isShopExpense);
  const wholesaleExpensesTotal = wholesaleExpensesMTD.reduce((s, x) => s + parseFloat(x.amount), 0);
  const shopExpensesTotal = shopExpensesMTD.reduce((s, x) => s + parseFloat(x.amount), 0);

  // Wholesale channel — Sale/Purchase already exclude Shop entirely (a
  // Shop's Load posts to the Sale table too, but that IS a real Wholesale
  // transaction — Dowa selling to the shop at the wholesale rate — so it
  // belongs here, not double-counted as Shop revenue).
  const totalPurchasesMTD = purchasesMTD.reduce((s, x) => s + parseFloat(x.total_amount), 0);
  const wholesaleGrossProfit = totalSalesMTD - totalPurchasesMTD;
  const wholesaleNetProfit = wholesaleGrossProfit - wholesaleExpensesTotal;

  // Shop channel — Sales from the existing shopSalesMTD feed; COGS from
  // each sale's own cogs_amount (routers/shops.py's list_shop_sales,
  // computed from the FIFO ShopStockBatch(es) it actually drew from at
  // that batch's frozen Load-time rate — the only Shop cost data that
  // already exists and is reliable; nothing here is estimated).
  const shopSalesTotal = shopSalesMTD.reduce((s, x) => s + parseFloat(x.total_amount), 0);
  const shopCOGSTotal = shopSalesMTD.reduce((s, x) => s + parseFloat(x.cogs_amount || "0"), 0);
  const shopGrossProfit = shopSalesTotal - shopCOGSTotal;
  const shopNetProfit = shopGrossProfit - shopExpensesTotal;

  // Combined — the sum of the two already-complete channel P&Ls (never a
  // pooled-revenue/pooled-cost recomputation), so it can never silently
  // drift from Wholesale + Shop again.
  const combinedSales = totalSalesMTD + shopSalesTotal;
  const combinedCOGS = totalPurchasesMTD + shopCOGSTotal;
  const combinedGrossProfit = wholesaleGrossProfit + shopGrossProfit;
  const combinedExpenses = wholesaleExpensesTotal + shopExpensesTotal;
  const combinedNetProfit = wholesaleNetProfit + shopNetProfit;

  // Owner Drawings stay a single Combined-level line, exactly as before —
  // OwnerDrawings' own established convention elsewhere in this app is
  // "must never reduce reported profit," shown separately rather than
  // split per channel (not requested, and Drawings aren't tied to either
  // channel specifically).
  const totalOwnerDrawingsMTD = ownerDrawingsMTD.reduce((s, x) => s + parseFloat(x.amount), 0);
  const netProfitAfterDrawings = combinedNetProfit - totalOwnerDrawingsMTD;

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
        eyebrow={t("nav.dashboard")}
        title={t("dashboard.title")}
        caption={t("dashboard.caption")}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-4">
        <Panel className="min-h-[96px]">
          <Eyebrow>{t("dashboard.customersFlagged")}</Eyebrow>
          <div className={`font-display font-bold text-2xl ${flaggedAccounts.length ? "text-brand-amber" : "text-ink"}`}>{flaggedAccounts.length}</div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>{t("dashboard.totalSaleAmount")}</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{pkr(combinedSales)}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasSalesData || shopSalesMTD.length
              ? t("dashboard.salesThisMonth", { count: salesMTD.length + shopSalesMTD.length })
              : t("dashboard.noSalesYet")}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>{t("dashboard.totalExpense")}</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{pkr(totalExpensesMTD)}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasExpenseData ? t("dashboard.expensesRecordedThisMonth") : t("dashboard.noPurchasesAwaiting")}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>{t("nav.sale")}</Eyebrow>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel mt-0.5">
            <span>{t("dashboard.cylinders118")}</span><span className="font-semibold text-ink">{sale118.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel">
            <span>{t("dashboard.cylinders454")}</span><span className="font-semibold text-ink">{sale454.toFixed(0)}</span>
          </div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{totalSaleKgMTD.toFixed(2)} <span className="text-sm text-steel font-normal">kg</span></div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasSalesData ? t("dashboard.salesThisMonth", { count: salesMTD.length }) : t("dashboard.noSalesYet")}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>{t("dashboard.purc")}</Eyebrow>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel mt-0.5">
            <span>{t("dashboard.cylinders118")}</span><span className="font-semibold text-ink">{purc118.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel">
            <span>{t("dashboard.cylinders454")}</span><span className="font-semibold text-ink">{purc454.toFixed(0)}</span>
          </div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{totalPurchaseKgMTD.toFixed(2)} <span className="text-sm text-steel font-normal">kg</span></div>
          <div className="font-body text-[11px] text-steel mt-1">
            {purchasesMTD.length ? t("dashboard.purchasesThisMonth", { count: purchasesMTD.length }) : t("dashboard.noPurchasesYet")}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>{t("dashboard.totalTonnage")}</Eyebrow>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel mt-0.5">
            <span>{t("dashboard.totalCylinders118")}</span><span className="font-semibold text-ink">{tonnage118.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline justify-between font-body text-[11px] text-steel">
            <span>{t("dashboard.totalCylinders454")}</span><span className="font-semibold text-ink">{tonnage454.toFixed(0)}</span>
          </div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{totalTonnageMTD.toFixed(2)} <span className="text-sm text-steel font-normal">tons</span></div>
          <div className="font-body text-[11px] text-steel mt-1">
            {t("dashboard.saleShopSaleBreakdown", { sale: totalSaleKgMTD.toFixed(0), shop: totalShopSaleKgMTD.toFixed(0) })}
          </div>
        </Panel>
      </div>

      <Panel className="mb-3.5">
        <div className="flex items-baseline justify-between flex-wrap gap-1 mb-4">
          <h2 className="font-display font-bold text-[16px] text-ink">{t("dashboard.pnlEyebrow")}</h2>
          <span className="font-mono text-[10.5px] text-steel">{month}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PnLStat label={t("dashboard.rowSales")} value={combinedSales} />
          <PnLStat label={t("dashboard.rowCogs")} value={combinedCOGS} />
          <PnLStat label={t("dashboard.rowGrossProfit")} value={combinedGrossProfit} prominent />
          <PnLStat label={t("dashboard.rowExpenses")} value={combinedExpenses} />
          <PnLStat label={t("dashboard.rowOwnerWithdrawals")} value={totalOwnerDrawingsMTD} />
          <PnLStat label={t("dashboard.rowNetProfit")} value={combinedNetProfit} prominent />
          <PnLStat label={t("dashboard.afterOwnerWithdrawals")} value={netProfitAfterDrawings} prominent />
        </div>

        <div className="mt-5 pt-4 border-t border-hairline">
          <h3 className="font-display font-bold text-[14px] text-ink mb-3">{t("dashboard.channelBreakdownEyebrow")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Panel className="!bg-paper">
              <Eyebrow>{t("dashboard.wholesaleChannel")}</Eyebrow>
              <PnLRow label={t("dashboard.rowSales")} value={totalSalesMTD} />
              <PnLRow label={t("dashboard.rowCogs")} value={totalPurchasesMTD} />
              <PnLRow label={t("dashboard.rowGrossProfit")} value={wholesaleGrossProfit} prominent />
              <PnLRow label={t("dashboard.rowExpenses")} value={wholesaleExpensesTotal} />
              <PnLRow label={t("dashboard.rowNetProfit")} value={wholesaleNetProfit} prominent />
            </Panel>
            <Panel className="!bg-paper">
              <Eyebrow>{t("dashboard.shopChannel")}</Eyebrow>
              <PnLRow label={t("dashboard.rowSales")} value={shopSalesTotal} />
              <PnLRow label={t("dashboard.rowCogs")} value={shopCOGSTotal} />
              <PnLRow label={t("dashboard.rowGrossProfit")} value={shopGrossProfit} prominent />
              <PnLRow label={t("dashboard.rowExpenses")} value={shopExpensesTotal} />
              <PnLRow label={t("dashboard.rowNetProfit")} value={shopNetProfit} prominent />
            </Panel>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-hairline">
          <DashboardPnLChart sales={allSales} purchases={allPurchases} expenses={allExpenses} drawings={allDrawings} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Panel>
          <div className="flex items-center justify-between mb-1.5">
            <Eyebrow>{t("dashboard.latestAppliedRates")}</Eyebrow>
            <div className="flex items-center gap-1.5 pb-1.5">
              <span className="live-dot" />
              <span className="font-mono text-[9.5px] text-steel">
                {lastSynced
                  ? t("dashboard.synced", { time: lastSynced.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Karachi" }) })
                  : t("dashboard.syncing")}
              </span>
            </div>
          </div>
          <SectionCaption>{t("dashboard.latestRatesCaption")}</SectionCaption>
          <div className="flex flex-col gap-2">
            {latestRates.slice(0, 6).map((r) => {
              const company = companies.find((c) => c.id === r.company_id);
              const party = parties.find((p) => p.id === r.party_id);
              const isToday = isSameKarachiDay(r.timestamp);
              return (
                <div key={r.id} className="flex justify-between items-center px-3 py-2.5 bg-paper rounded-lg border border-hairline">
                  <div>
                    <div className="font-body text-[13px] font-semibold text-ink">
                      {company?.name} <span className="text-steel font-normal">· {party?.name}</span>
                    </div>
                    <div className={`font-mono text-[10.5px] flex items-center gap-1 mt-0.5 ${isToday ? "text-steel" : "text-amber-600"}`}>
                      <Clock size={11} />
                      {isToday ? fmtTime(r.timestamp) : t("dashboard.lastEntered", { time: fmtTime(r.timestamp) })}
                    </div>
                  </div>
                  <div className="text-right">
                    {isToday ? (
                      <>
                        <div className="font-mono text-sm font-semibold text-ink">{r.rate_118} <span className="text-[10px] text-steel">/11.8kg</span></div>
                        <div className="font-mono text-[11px] text-steel">{r.rate_454} /45.4kg</div>
                      </>
                    ) : (
                      <div className="font-mono text-[12px] italic text-amber-600">{t("dashboard.notEnteredToday")}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {!latestRates.length && <div className="font-body text-[13px] text-steel">{t("dashboard.noRateEntries")}</div>}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>{t("dashboard.flaggedAccountsEyebrow", { month })}</Eyebrow>
          <SectionCaption>
            {t("dashboard.flaggedAccountsCaption")}
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
                    <div className="font-mono text-[9px] text-steel uppercase tracking-wide">{t("dashboard.opening")}</div>
                    <div className="font-mono text-[11.5px] font-semibold text-ink">{pkr(f.opening_balance)}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] text-steel uppercase tracking-wide">{t("dashboard.closing")}</div>
                    <div className="font-mono text-[11.5px] font-semibold text-ink">{pkr(f.closing_balance)}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] text-steel uppercase tracking-wide">{t("dashboard.shortage")}</div>
                    <div className="font-mono text-[12.5px] font-bold text-brand-amber">{pkr(Math.max(0, Number(f.closing_balance) - Number(f.opening_balance)))}</div>
                  </div>
                </div>
              </button>
            ))}
            {!flaggedAccounts.length && (
              <div className="font-body text-[13px] text-steel py-4 text-center">
                {t("dashboard.noFlaggedCustomers")}
              </div>
            )}
          </div>
          {overpaid.length > 0 && (
            <div className="mt-3 px-3 py-2.5 bg-[#FBEAEA] rounded-lg border border-[#EFC3C3]">
              {overpaid.map((c) => (
                <div key={c.id} className="font-body text-[12.5px] text-brand-red">
                  <Trans
                    i18nKey="dashboard.overpaidLine"
                    values={{ name: c.name, amount: pkr(c.last_overpayment_amount!) }}
                    components={{ bold: <b /> }}
                  />
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