"use client";
import { useEffect, useMemo, useState } from "react";
import { Send, Clock, Search, X, PlusCircle, Check } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, Th, Td, Button, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtTime, isSameKarachiDay } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Company, Party, RateEntry } from "@/lib/types";

const RATIO = 45.4 / 11.8;

// HELPER: Exact Local Datetime for <input type="datetime-local" />
const getLocalDatetimeString = (d = new Date()) => {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

function RateDashboardBody() {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [filterCompany, setFilterCompany] = useState("All");
  const [search, setSearch] = useState("");

  // WhatsApp Selling Rate Modal States
  const [showShareModal, setShowShareModal] = useState(false);
  const [sellingRates, setSellingRates] = useState<Record<string, { rate_118: string; rate_454: string }>>({});

  // --- New Rate Entry Modal State (merged from new-rate/page.tsx) ---
  const [showNewRateModal, setShowNewRateModal] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");
  const [addingParty, setAddingParty] = useState(false);
  const [rate118, setRate118] = useState("");
  const [timestamp, setTimestamp] = useState(() => getLocalDatetimeString());
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const [c, p, r] = await Promise.all([
        api.companies.list().catch(() => []),
        api.parties.list().catch(() => []),
        api.rates.list().catch(() => []),
      ]);
      setCompanies(c || []);
      setParties(p || []);
      setRates(r || []);
    } catch (err) {
      console.error("Failed to load rate dashboard data:", err);
    }
  };

  useEffect(() => {
    load();
    // Keep the New Rate modal's timestamp fresh if it's left open unsubmitted.
    const timer = setInterval(() => {
      setTimestamp(getLocalDatetimeString());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const latestByPartyId = useMemo(() => {
    const m: Record<string, RateEntry> = {};
    rates.forEach((r) => {
      const key = String(r.party_id);
      if (!m[key] || new Date(r.timestamp).getTime() > new Date(m[key].timestamp).getTime()) {
        m[key] = r;
      }
    });
    return m;
  }, [rates]);

  const grouped = useMemo(() => {
    const g: Record<string, RateEntry[]> = {};
    Object.values(latestByPartyId).forEach((r) => {
      const cid = String(r.company_id);
      g[cid] = g[cid] || [];
      g[cid].push(r);
    });
    Object.values(g).forEach((arr) =>
      arr.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    );
    return g;
  }, [latestByPartyId]);

  const companyOrder = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      const la = Math.max(...grouped[a].map((r) => new Date(r.timestamp).getTime()));
      const lb = Math.max(...grouped[b].map((r) => new Date(r.timestamp).getTime()));
      return lb - la;
    });
  }, [grouped]);

  const history = useMemo(() => {
    return rates
      .filter((r) => filterCompany === "All" || String(r.company_id) === String(filterCompany))
      .filter((r) => {
        if (!search.trim()) return true;
        const company = companies.find((c) => String(c.id) === String(r.company_id))?.name || "";
        const party = parties.find((p) => String(p.id) === String(r.party_id))?.name || "";
        return (company + " " + party).toLowerCase().includes(search.toLowerCase());
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [rates, filterCompany, search, companies, parties]);

  // Compare Asia/Karachi calendar days, not the viewer's own local day —
  // raw `new Date(r.timestamp).toLocaleDateString()` misreads a naive
  // (marker-less) backend timestamp as local time instead of UTC.
  const todayEntries = useMemo(
    () => rates
      .filter((r) => isSameKarachiDay(r.timestamp))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [rates]
  );

  // Pre-fill selling rates modal when opened
  const handleOpenShareModal = () => {
    const initialRates: Record<string, { rate_118: string; rate_454: string }> = {};
    companyOrder.forEach((cid) => {
      initialRates[cid] = { rate_118: "", rate_454: "" };
    });
    setSellingRates(initialRates);
    setShowShareModal(true);
  };

  const handleRateChange = (cid: string, field: "rate_118" | "rate_454", value: string) => {
    setSellingRates((prev) => ({
      ...prev,
      [cid]: { ...prev[cid], [field]: value },
    }));
  };

  const sendWhatsAppSellingRates = () => {
    let text = `*DOWA GAS AGENCY — Today's Selling Rates*\nDate: ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Karachi" })}\n\n`;
    let hasEntries = false;

    companyOrder.forEach((cid) => {
      const company = companies.find((c) => String(c.id) === String(cid));
      const sRate = sellingRates[cid];

      if (sRate && (sRate.rate_118 || sRate.rate_454)) {
        hasEntries = true;
        text += `*${company?.name || "Company"}*\n`;
        text += `  • Selling Rate: ${sRate.rate_118 || "—"} / ${sRate.rate_454 || "—"} (11.8kg / 45.4kg)\n\n`;
      }
    });

    if (!hasEntries) {
      alert("Please enter selling rates for at least one company before sharing.");
      return;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    setShowShareModal(false);
  };

  // --- New Rate Entry handlers (merged from new-rate/page.tsx) ---
  const companyParties = parties.filter((p) => p.company_id === companyId);
  const rate454Preview = rate118 ? Math.round(parseFloat(rate118) * RATIO * 100) / 100 : null;

  const resetNewRateForm = () => {
    setCompanyId("");
    setPartyId("");
    setRate118("");
    setNewCompanyName("");
    setAddingCompany(false);
    setNewPartyName("");
    setAddingParty(false);
    setTimestamp(getLocalDatetimeString());
  };

  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return;
    const c = await api.companies.create({ name: newCompanyName.trim() });
    setCompanies((prev) => [...prev, c]);
    setCompanyId(c.id);
    setPartyId("");
    setNewCompanyName("");
    setAddingCompany(false);
  };

  const handleAddParty = async () => {
    if (!newPartyName.trim() || !companyId) return;
    const p = await api.parties.create(companyId, newPartyName.trim());
    setParties((prev) => [...prev, p]);
    setPartyId(p.id);
    setNewPartyName("");
    setAddingParty(false);
  };

  const handleSaveRate = async () => {
    if (!companyId || !partyId || !rate118 || !user) return;
    await api.rates.create({
      company_id: companyId,
      party_id: partyId,
      rate_118: parseFloat(rate118),
      entered_by: user.name,
      timestamp: new Date(timestamp).toISOString(),
    });

    setToast("Rate saved.");
    setRate118("");
    setTimestamp(getLocalDatetimeString());
    await load();
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Rate Dashboard"
        title="What's the rate right now"
        caption="Latest applied rate per Company · Party, plus the full timestamped history underneath."
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => { resetNewRateForm(); setShowNewRateModal(true); }}>
              <PlusCircle size={14} /> Add New Rate
            </Button>
            <Button variant="teal" onClick={handleOpenShareModal}>
              <Send size={14} /> Share Selling Rates on WhatsApp
            </Button>
          </div>
        }
      />

      <Panel className="mb-4">
        <Eyebrow>Latest Rates</Eyebrow>
        <SectionCaption>Grouped by company, most recently updated first.</SectionCaption>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {companyOrder.map((cid) => {
            const company = companies.find((c) => String(c.id) === String(cid));
            return (
              <div key={cid} className="border border-hairline rounded-lg px-3.5 py-3">
                <div className="font-body font-semibold text-[13.5px] text-ink mb-2">
                  {company?.name || "Unknown Company"}
                </div>
                <div className="flex flex-col gap-1.5">
                  {grouped[cid].map((r) => {
                    const party = parties.find((p) => String(p.id) === String(r.party_id));
                    return (
                      <div key={r.id} className="flex justify-between items-baseline">
                        <span className="font-body text-xs text-steel">{party?.name || "Party"}</span>
                        <span className="text-right">
                          <span className="font-mono text-[13px] font-semibold text-ink">{r.rate_118}</span>
                          <span className="font-mono text-[10.5px] text-steel"> / {r.rate_454}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="font-mono text-[9.5px] text-steel mt-2 flex items-center gap-1">
                  <Clock size={10} /> updated {fmtTime(grouped[cid][0].timestamp)}
                </div>
              </div>
            );
          })}
          {!companyOrder.length && (
            <div className="font-body text-steel text-[13px] col-span-3">No rates entered yet.</div>
          )}
        </div>
      </Panel>

      <Panel>
        <div className="flex justify-between items-center mb-1 flex-wrap gap-2.5">
          <Eyebrow>Rate History Log</Eyebrow>
          <div className="flex gap-2">
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className={`${inputClass} w-[180px] py-1.5 text-xs`}
            >
              <option value="All">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search size={13} className="text-steel" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company or party"
                className="border-none outline-none font-body text-xs py-1.5 w-[180px]"
              />
            </div>
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto mt-2.5">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Party</Th>
                <Th right>11.8kg</Th>
                <Th right>45.4kg</Th>
                <Th right>Timestamp</Th>
                <Th>Entered By</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const company = companies.find((c) => String(c.id) === String(r.company_id));
                const party = parties.find((p) => String(p.id) === String(r.party_id));
                return (
                  <tr key={r.id}>
                    <Td bold>{company?.name || "—"}</Td>
                    <Td>{party?.name || "—"}</Td>
                    <Td right mono>{r.rate_118}</Td>
                    <Td right mono color="#0F8B8D">{r.rate_454}</Td>
                    <Td right mono>{fmtTime(r.timestamp)}</Td>
                    <Td>{r.entered_by}</Td>
                  </tr>
                );
              })}
              {!history.length && (
                <tr>
                  <td colSpan={6} className="text-steel text-[13px] py-3 text-center">
                    No rate entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* NEW RATE ENTRY MODAL (merged from new-rate/page.tsx) */}
      {showNewRateModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-3 sm:p-5 flex items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNewRateModal(false); }}
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <div>
                <Eyebrow>New Rate Entry</Eyebrow>
                <div className="font-body text-xs text-steel mt-1">
                  One entry per change — nothing gets overwritten, even multiple times a day.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewRateModal(false)}
                className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-3.5">
              <Field label="Company">
                {!addingCompany ? (
                  <div className="flex gap-1.5">
                    <select
                      value={companyId}
                      onChange={(e) => { setCompanyId(e.target.value); setPartyId(""); }}
                      className={`${inputClass} flex-1`}
                    >
                      <option value="">Select company</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <Button variant="outline" onClick={() => setAddingCompany(true)}>
                      <PlusCircle size={14} /> Add
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      placeholder="New company name"
                      className={`${inputClass} flex-1`}
                    />
                    <Button variant="teal" onClick={handleAddCompany}><Check size={14} /></Button>
                    <Button variant="outline" onClick={() => { setAddingCompany(false); setNewCompanyName(""); }}><X size={14} /></Button>
                  </div>
                )}
              </Field>

              <Field label="Party">
                {!addingParty ? (
                  <div className="flex gap-1.5">
                    <select value={partyId} onChange={(e) => setPartyId(e.target.value)} disabled={!companyId} className={`${inputClass} flex-1`}>
                      <option value="">{companyId ? "Select party" : "Select company first"}</option>
                      {companyParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <Button variant="outline" onClick={() => setAddingParty(true)} disabled={!companyId}>
                      <PlusCircle size={14} /> Add
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input autoFocus value={newPartyName} onChange={(e) => setNewPartyName(e.target.value)} placeholder="New party name" className={`${inputClass} flex-1`} />
                    <Button variant="teal" onClick={handleAddParty}><Check size={14} /></Button>
                    <Button variant="outline" onClick={() => { setAddingParty(false); setNewPartyName(""); }}><X size={14} /></Button>
                  </div>
                )}
              </Field>

              <Field label="Rate — 11.8kg (domestic)">
                <input type="number" value={rate118} onChange={(e) => setRate118(e.target.value)} placeholder="e.g. 3410" className={inputClass} />
              </Field>

              <div className="flex justify-between items-center px-3 py-2.5 bg-paper rounded-lg border border-hairline">
                <span className="font-mono text-[11px] text-steel">Auto-calculated · 45.4kg (commercial)</span>
                <span className="font-display font-bold text-base text-teal">{rate454Preview ?? "—"}</span>
              </div>

              <Field label="Timestamp">
                <input type="datetime-local" value={timestamp} onChange={(e) => setTimestamp(e.target.value)} className={inputClass} />
              </Field>

              <Field label="Entered by">
                <input value={user?.name || ""} disabled className={`${inputClass} bg-paper text-steel`} />
              </Field>

              <Button
                variant="primary"
                onClick={async () => { await handleSaveRate(); setShowNewRateModal(false); }}
                disabled={!companyId || !partyId || !rate118}
              >
                Save Rate Entry
              </Button>
              {toast && <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5"><Check size={13} /> {toast}</div>}

              {/* Quick preview of today's entries, inline in the modal */}
              {todayEntries.length > 0 && (
                <div className="border-t border-hairline pt-3 mt-1">
                  <div className="font-mono text-[10px] uppercase text-steel mb-1.5">Today&apos;s Entries</div>
                  <div className="max-h-[140px] overflow-y-auto flex flex-col gap-1">
                    {todayEntries.map((r) => {
                      const company = companies.find((c) => c.id === r.company_id);
                      const party = parties.find((p) => p.id === r.party_id);
                      return (
                        <div key={r.id} className="flex justify-between text-xs font-body">
                          <span>{company?.name} · {party?.name}</span>
                          <span className="font-mono text-steel">{r.rate_118} / {r.rate_454}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Selling Rates Dialog */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 relative border border-hairline">
            <button
              onClick={() => setShowShareModal(false)}
              className="absolute top-4 right-4 text-steel hover:text-ink"
            >
              <X size={18} />
            </button>
            <Eyebrow>WhatsApp Selling Rates</Eyebrow>
            <h3 className="font-display font-bold text-lg text-ink mb-1">Enter Selling Rates to Send</h3>
            <p className="text-xs text-steel mb-4">
              Enter custom selling rates for the companies you want to include. Blank entries won't be sent.
            </p>

            <div className="max-h-[300px] overflow-y-auto flex flex-col gap-3 pr-1 mb-5">
              {companyOrder.map((cid) => {
                const company = companies.find((c) => String(c.id) === String(cid));
                return (
                  <div key={cid} className="p-3 border border-hairline rounded-lg bg-gray-50 flex flex-col gap-2">
                    <span className="font-body text-xs font-semibold text-ink">{company?.name || "Company"}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-steel block mb-0.5">Selling Rate (11.8kg)</label>
                        <input
                          type="text"
                          placeholder="e.g. 2800"
                          value={sellingRates[cid]?.rate_118 || ""}
                          onChange={(e) => handleRateChange(cid, "rate_118", e.target.value)}
                          className={`${inputClass} text-xs py-1`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-steel block mb-0.5">Selling Rate (45.4kg)</label>
                        <input
                          type="text"
                          placeholder="e.g. 10500"
                          value={sellingRates[cid]?.rate_454 || ""}
                          onChange={(e) => handleRateChange(cid, "rate_454", e.target.value)}
                          className={`${inputClass} text-xs py-1`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowShareModal(false)}>
                Cancel
              </Button>
              <Button variant="teal" onClick={sendWhatsAppSellingRates}>
                <Send size={14} /> Send via WhatsApp
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RateDashboardPage() {
  return (
    <AuthGate>
      <RateDashboardBody />
    </AuthGate>
  );
}