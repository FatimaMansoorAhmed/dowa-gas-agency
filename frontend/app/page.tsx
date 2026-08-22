"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption } from "@/components/ui";
import { pkr, fmtTime, monthKey } from "@/lib/format";
import { api } from "@/lib/api";
import type { Company, Party, RateEntry, Customer, Sale, Expense } from "@/lib/types";

const POLL_MS = 30000;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function DashboardBody() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [latestRates, setLatestRates] = useState<RateEntry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesMTD, setSalesMTD] = useState<Sale[]>([]);
  const [expensesMTD, setExpensesMTD] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const loadAll = useCallback(async (isInitial = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const month = currentMonth();
      const [c, p, r, cu, sales, expenses] = await Promise.all([
        api.companies.list(),
        api.parties.list(),
        api.rates.latest(),
        api.customers.list(),
        api.sales.list({ month }),
        api.expenses.list({ month }),
      ]);

      setCompanies(c);
      setParties(p);
      setLatestRates(r);
      setCustomers(cu);
      setSalesMTD(sales);
      setExpensesMTD(expenses);
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

  // Sab se aakhri enter kia hua rate
  const latestEntry = latestRates.length > 0 ? latestRates[0] : null;
  const latestCompany = companies.find((c) => c.id === latestEntry?.company_id);
  const latestParty = parties.find((p) => p.id === latestEntry?.party_id);

  const movement = customers.map((c) => {
    const change = parseFloat(c.current_balance) - parseFloat(c.opening_balance);
    return { ...c, change, growing: change > 0 };
  });
  const flagged = movement.filter((c) => c.growing);
  const overpaid = customers.filter((c) => c.last_overpayment_amount && parseFloat(c.last_overpayment_amount) > 0);

  const totalSalesMTD = salesMTD.reduce((s, x) => s + parseFloat(x.total_amount), 0);
  const totalExpensesMTD = expensesMTD.reduce((s, x) => s + parseFloat(x.amount), 0);
  const hasSalesData = salesMTD.length > 0;
  const hasExpenseData = expensesMTD.length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title="Rates, sales, and customer balances, live"
        caption="Sale P&L and Purchase Summary populate automatically as sales and expenses are recorded -- everything here refreshes on its own, no reload needed."
      />

      <div className="grid grid-cols-3 gap-3.5 mb-4">
        <Panel className="min-h-[96px]">
          <Eyebrow>Companies Tracked</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{companies.length}</div>
        </Panel>
        
        <Panel className="min-h-[96px]">
          <Eyebrow>Parties Tracked</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{parties.length}</div>
        </Panel>

        {/* LATEST RATE BLOCK (Includes both 11.8kg and 45.4kg) */}
        <Panel className="min-h-[96px]">
          <Eyebrow>Latest Rate</Eyebrow>
          {latestEntry ? (
            <div>
              <div className="font-display font-bold text-2xl text-teal">
                {latestEntry.rate_118} <span className="text-sm text-steel font-normal">/11.8kg</span>
              </div>
              <div className="font-mono text-sm font-semibold text-steel mt-0.5">
                {latestEntry.rate_454} <span className="text-xs font-normal">/45.4kg</span>
              </div>
              <div className="font-body text-[11px] text-steel mt-1 truncate">
                {latestCompany?.name || "Company"} {latestParty?.name ? `· ${latestParty.name}` : ""}
              </div>
            </div>
          ) : (
            <div className="font-display font-bold text-xl text-steel">—</div>
          )}
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Customers Flagged</Eyebrow>
          <div className={`font-display font-bold text-2xl ${flagged.length ? "text-brand-amber" : "text-ink"}`}>{flagged.length}</div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Sale P&amp;L (MTD)</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{pkr(totalSalesMTD)}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasSalesData ? `${salesMTD.length} sale${salesMTD.length === 1 ? "" : "s"} this month` : "No sales recorded yet"}
          </div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Purchase Summary (MTD)</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{pkr(totalExpensesMTD)}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            {hasExpenseData ? "Expenses recorded this month" : "No purchases recorded yet — awaiting Purchase module"}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <Panel>
          <div className="flex items-center justify-between mb-1.5">
            <Eyebrow>Latest Applied Rates</Eyebrow>
            <div className="flex items-center gap-1.5 pb-1.5">
              <span className="live-dot" />
              <span className="font-mono text-[9.5px] text-steel">
                {lastSynced ? `synced ${lastSynced.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "syncing…"}
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
          <Eyebrow>Customer Balance Movement — {monthKey(new Date().toISOString())}</Eyebrow>
          <SectionCaption>Flags any customer whose balance is running above where the month opened.</SectionCaption>
          <div className="flex flex-col gap-2">
            {movement.map((c) => (
              <div key={c.id} className={`flex justify-between items-center px-3 py-2.5 rounded-lg border ${c.growing ? "bg-[#FBF3E3] border-[#EBD9AE]" : "bg-paper border-hairline"}`}>
                <div>
                  <div className="font-body text-[13px] font-semibold text-ink">{c.name}</div>
                  <div className="font-mono text-[10.5px] text-steel">{c.mobile}</div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 justify-end">
                    {c.growing ? <TrendingUp size={13} color="#D98E04" /> : <TrendingDown size={13} color="#1E8A5F" />}
                    <span className={`font-mono text-[12.5px] font-semibold ${c.growing ? "text-brand-amber" : "text-brand-green"}`}>{pkr(Math.abs(c.change))}</span>
                  </div>
                  <div className="font-mono text-[10px] text-steel">opened {pkr(c.opening_balance)}</div>
                </div>
              </div>
            ))}
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