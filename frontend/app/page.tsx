"use client";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Clock, Plus, X } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Button, Field, inputClass } from "@/components/ui";
import { pkr, fmtTime, monthKey } from "@/lib/format";
import { api } from "@/lib/api";
import type { Company, Party, RateEntry, Customer } from "@/lib/types";

function DashboardBody() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [latestRates, setLatestRates] = useState<RateEntry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State for adding Company dynamically
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, p, r, cu] = await Promise.all([
        api.companies.list(),
        api.parties.list(),
        api.rates.latest(),
        api.customers.list(),
      ]);
      setCompanies(c);
      setParties(p);
      setLatestRates(r);
      setCustomers(cu);
      setLoading(false);
    })();
  }, []);

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    setAddingCompany(true);
    try {
      // API call to persist new company
      const createdCompany = await api.companies.create(newCompanyName.trim());
      // Optimistically/dynamically update company list state without page refresh
      setCompanies((prev) => [...prev, createdCompany]);
      setNewCompanyName("");
      setIsModalOpen(false);
    } catch (error) {
      console.error("Failed to save company:", error);
    } finally {
      setAddingCompany(false);
    }
  };

  if (loading) return <div className="font-body text-steel p-10">Loading…</div>;

  const latestRateEntry = latestRates[0];
  const latestCompany = companies.find((c) => c.id === latestRateEntry?.company_id);
  const latestParty = parties.find((p) => p.id === latestRateEntry?.party_id);

  const movement = customers.map((c) => {
    const change = parseFloat(c.current_balance) - parseFloat(c.opening_balance);
    return { ...c, change, growing: change > 0 };
  });
  const flagged = movement.filter((c) => c.growing);
  const overpaid = customers.filter(
    (c) => c.last_overpayment_amount && parseFloat(c.last_overpayment_amount) > 0
  );

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title="Rates and customer balances, live"
        caption="Sales and Purchase widgets go live once those modules are built — everything below is wired to real rate and customer data today."
        action={
          <Button onClick={() => setIsModalOpen(true)} variant="teal">
            <Plus size={16} /> Add Company
          </Button>
        }
      />

      {/* Top Section: All 6 KPI / Summary Cards side by side */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-4">
        <Panel className="min-h-[96px]">
          <Eyebrow>Companies Tracked</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{companies.length}</div>
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Parties Tracked</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{parties.length}</div>
        </Panel>

        {/* Updated Card: Displays Latest Rate Entered */}
        <Panel className="min-h-[96px]">
          <Eyebrow>Latest Rate</Eyebrow>
          {latestRateEntry ? (
            <div>
              <div className="font-display font-bold text-xl text-teal">
                {latestRateEntry.rate_118}{" "}
                <span className="text-[11px] font-normal text-steel">/11.8kg</span>
              </div>
              <div className="font-mono text-[10px] text-steel truncate">
                {latestCompany?.name || "Company"}
              </div>
            </div>
          ) : (
            <div className="font-mono text-xs text-steel">No rates</div>
          )}
        </Panel>

        <Panel className="min-h-[96px]">
          <Eyebrow>Customers Flagged</Eyebrow>
          <div
            className={`font-display font-bold text-2xl ${
              flagged.length ? "text-brand-amber" : "text-ink"
            }`}
          >
            {flagged.length}
          </div>
        </Panel>

        {/* Moved into Top Row */}
        <Panel className="min-h-[96px] bg-paper">
          <Eyebrow>Sale P&amp;L</Eyebrow>
          <div className="font-display font-bold text-lg text-steel">Rs. 0.00</div>
          <div className="font-mono text-[10px] text-steel">Pending Sales Module</div>
        </Panel>

        {/* Moved into Top Row */}
        <Panel className="min-h-[96px] bg-paper">
          <Eyebrow>Purchase Summary</Eyebrow>
          <div className="font-display font-bold text-lg text-steel">Rs. 0.00</div>
          <div className="font-mono text-[10px] text-steel">Pending Purchase Module</div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3.5 mb-4">
        <Panel>
          <Eyebrow>Latest Applied Rates</Eyebrow>
          <SectionCaption>Most recently updated Company · Party pairs, at a glance.</SectionCaption>
          <div className="flex flex-col gap-2">
            {latestRates.slice(0, 6).map((r) => {
              const company = companies.find((c) => c.id === r.company_id);
              const party = parties.find((p) => p.id === r.party_id);
              return (
                <div
                  key={r.id}
                  className="flex justify-between items-center px-3 py-2.5 bg-paper rounded-lg border border-hairline"
                >
                  <div>
                    <div className="font-body text-[13px] font-semibold text-ink">
                      {company?.name} <span className="text-steel font-normal">· {party?.name}</span>
                    </div>
                    <div className="font-mono text-[10.5px] text-steel flex items-center gap-1 mt-0.5">
                      <Clock size={11} /> {fmtTime(r.timestamp)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold text-ink">
                      {r.rate_118} <span className="text-[10px] text-steel">/11.8kg</span>
                    </div>
                    <div className="font-mono text-[11px] text-steel">{r.rate_454} /45.4kg</div>
                  </div>
                </div>
              );
            })}
            {!latestRates.length && (
              <div className="font-body text-[13px] text-steel">No rate entries yet.</div>
            )}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>Customer Balance Movement — {monthKey(new Date().toISOString())}</Eyebrow>
          <SectionCaption>Flags any customer whose balance is running above where the month opened.</SectionCaption>
          <div className="flex flex-col gap-2">
            {movement.map((c) => (
              <div
                key={c.id}
                className={`flex justify-between items-center px-3 py-2.5 rounded-lg border ${
                  c.growing ? "bg-[#FBF3E3] border-[#EBD9AE]" : "bg-paper border-hairline"
                }`}
              >
                <div>
                  <div className="font-body text-[13px] font-semibold text-ink">{c.name}</div>
                  <div className="font-mono text-[10.5px] text-steel">{c.mobile}</div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 justify-end">
                    {c.growing ? (
                      <TrendingUp size={13} color="#D98E04" />
                    ) : (
                      <TrendingDown size={13} color="#1E8A5F" />
                    )}
                    <span
                      className={`font-mono text-[12.5px] font-semibold ${
                        c.growing ? "text-brand-amber" : "text-brand-green"
                      }`}
                    >
                      {pkr(Math.abs(c.change))}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-steel">
                    opened {pkr(c.opening_balance)}
                  </div>
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

      {/* Inline Modal for Quick Adding New Company */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white border border-hairline rounded-xl p-6 w-full max-w-md shadow-lg relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-steel hover:text-ink"
            >
              <X size={18} />
            </button>
            <Eyebrow>New Company Entity</Eyebrow>
            <h2 className="font-display font-bold text-xl text-ink mb-4">Add Company</h2>
            <form onSubmit={handleAddCompany} className="flex flex-col gap-4">
              <Field label="Company Name">
                <input
                  type="text"
                  required
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="e.g. Bouch Power Pvt Ltd"
                  className={inputClass}
                />
              </Field>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="teal" disabled={addingCompany}>
                  {addingCompany ? "Saving…" : "Save Company"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
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