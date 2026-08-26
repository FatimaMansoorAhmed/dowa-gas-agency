"use client";
import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Check, X } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
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

function NewRateBody() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [partyId, setPartyId] = useState("");
  
  // States for adding Company dynamically
  const [newCompanyName, setNewCompanyName] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);

  // States for adding Party dynamically
  const [newPartyName, setNewPartyName] = useState("");
  const [addingParty, setAddingParty] = useState(false);

  const [rate118, setRate118] = useState("");
  
  // FIX 1: Auto-fill EXACT current local time on component mount
  const [timestamp, setTimestamp] = useState(() => getLocalDatetimeString());
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    const [c, p, r] = await Promise.all([api.companies.list(), api.parties.list(), api.rates.list()]);
    setCompanies(c); setParties(p); setRates(r);
  };

  useEffect(() => { 
    load(); 
    // Interval runs every minute to keep time fresh if page stays open un-submitted
    const timer = setInterval(() => {
      setTimestamp(getLocalDatetimeString());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const companyParties = parties.filter((p) => p.company_id === companyId);
  const rate454Preview = rate118 ? Math.round(parseFloat(rate118) * RATIO * 100) / 100 : null;

  // Compare Asia/Karachi calendar days, not the viewer's own local day —
  // raw `new Date(r.timestamp).toLocaleDateString()` misreads a naive
  // (marker-less) backend timestamp as local time instead of UTC.
  const todayEntries = useMemo(
    () => rates
      .filter((r) => isSameKarachiDay(r.timestamp))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [rates]
  );

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

  const handleSave = async () => {
    if (!companyId || !partyId || !rate118 || !user) return;
    
    // Pass ISO standard with offset preservation
    await api.rates.create({
      company_id: companyId, 
      party_id: partyId, 
      rate_118: parseFloat(rate118),
      entered_by: user.name, 
      timestamp: new Date(timestamp).toISOString(),
    });

    setToast("Rate saved.");
    setRate118("");
    
    // FIX 3: Reset to current live local time upon successful submission
    setTimestamp(getLocalDatetimeString());
    
    await load();
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div>
      <PageHeader eyebrow="New Rate Entry" title="Log the current rate" caption="One entry per change — nothing gets overwritten, even multiple times a day." />

      <div className="grid grid-cols-[1fr_1.3fr] gap-4">
        <Panel>
          <div className="flex flex-col gap-3.5">
            {/* Company Field */}
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
                  <Button variant="teal" onClick={handleAddCompany}><Check size={14} /> Save</Button>
                  <Button variant="outline" onClick={() => { setAddingCompany(false); setNewCompanyName(""); }}><X size={14} /> Cancel</Button>
                </div>
              )}
            </Field>

            {/* Party Field */}
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
                  <Button variant="teal" onClick={handleAddParty}><Check size={14} /> Save</Button>
                  <Button variant="outline" onClick={() => { setAddingParty(false); setNewPartyName(""); }}><X size={14} /> Cancel</Button>
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

            <Button variant="primary" onClick={handleSave} disabled={!companyId || !partyId || !rate118}>
              Save Rate Entry
            </Button>
            {toast && <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5"><Check size={13} /> {toast}</div>}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>Today&apos;s Entries</Eyebrow>
          <SectionCaption>Quick review of everything logged today, most recent first.</SectionCaption>
          <table className="w-full border-collapse">
            <thead>
              <tr><Th>Company</Th><Th>Party</Th><Th right>11.8kg</Th><Th right>45.4kg</Th><Th right>Time</Th><Th>By</Th></tr>
            </thead>
            <tbody>
              {todayEntries.map((r) => {
                const company = companies.find((c) => c.id === r.company_id);
                const party = parties.find((p) => p.id === r.party_id);
                return (
                  <tr key={r.id}>
                    <Td bold>{company?.name}</Td>
                    <Td>{party?.name}</Td>
                    <Td right mono>{r.rate_118}</Td>
                    <Td right mono color="#0F8B8D">{r.rate_454}</Td>
                    <Td right mono>{fmtTime(r.timestamp).split(",")[1]}</Td>
                    <Td>{r.entered_by}</Td>
                  </tr>
                );
              })}
              {!todayEntries.length && (
                <tr><td colSpan={6} className="text-steel font-body text-[13px] py-3">Nothing logged yet today.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

export default function NewRatePage() {
  return (
    <AuthGate>
      <NewRateBody />
    </AuthGate>
  );
}