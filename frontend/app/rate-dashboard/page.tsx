"use client";
import { useEffect, useMemo, useState } from "react";
import { Send, Clock, Search } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, Button, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { Company, Party, RateEntry } from "@/lib/types";

function RateDashboardBody() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [filterCompany, setFilterCompany] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [c, p, r] = await Promise.all([api.companies.list(), api.parties.list(), api.rates.list()]);
      setCompanies(c); setParties(p); setRates(r);
    })();
  }, []);

  const latestByPartyId = useMemo(() => {
    const m: Record<string, RateEntry> = {};
    rates.forEach((r) => {
      if (!m[r.party_id] || new Date(r.timestamp) > new Date(m[r.party_id].timestamp)) m[r.party_id] = r;
    });
    return m;
  }, [rates]);

  const grouped = useMemo(() => {
    const g: Record<string, RateEntry[]> = {};
    Object.values(latestByPartyId).forEach((r) => {
      g[r.company_id] = g[r.company_id] || [];
      g[r.company_id].push(r);
    });
    Object.values(g).forEach((arr) => arr.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    return g;
  }, [latestByPartyId]);

  const companyOrder = Object.keys(grouped).sort((a, b) => {
    const la = Math.max(...grouped[a].map((r) => new Date(r.timestamp).getTime()));
    const lb = Math.max(...grouped[b].map((r) => new Date(r.timestamp).getTime()));
    return lb - la;
  });

  const history = rates
  .filter((r) => filterCompany === "All" || String(r.company_id) === String(filterCompany))
  .filter((r) => {
    if (!search.trim()) return true;
    const company = companies.find((c) => String(c.id) === String(r.company_id))?.name || "";
    const party = parties.find((p) => String(p.id) === String(r.party_id))?.name || "";
    return (company + " " + party).toLowerCase().includes(search.toLowerCase());
  })
  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const shareOnWhatsApp = () => {
    let text = `*DOWA GAS AGENCY — Current Rates*\n${new Date().toLocaleDateString("en-GB")}\n\n`;
    companyOrder.forEach((cid) => {
      const company = companies.find((c) => c.id === cid);
      text += `*${company?.name}*\n`;
      grouped[cid].forEach((r) => {
        const party = parties.find((p) => p.id === r.party_id);
        text += `  ${party?.name}: ${r.rate_118} / ${r.rate_454} (11.8 / 45.4kg)\n`;
      });
      text += `\n`;
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div>
      <PageHeader
        eyebrow="Rate Dashboard"
        title="What's the rate right now"
        caption="Latest applied rate per Company · Party, plus the full timestamped history underneath."
        action={<Button variant="teal" onClick={shareOnWhatsApp}><Send size={14} /> Share on WhatsApp</Button>}
      />

      <Panel className="mb-4">
        <Eyebrow>Latest Rates</Eyebrow>
        <SectionCaption>Grouped by company, most recently updated first.</SectionCaption>
        <div className="grid grid-cols-3 gap-3">
          {companyOrder.map((cid) => {
            const company = companies.find((c) => c.id === cid);
            return (
              <div key={cid} className="border border-hairline rounded-lg px-3.5 py-3">
                <div className="font-body font-semibold text-[13.5px] text-ink mb-2">{company?.name}</div>
                <div className="flex flex-col gap-1.5">
                  {grouped[cid].map((r) => {
                    const party = parties.find((p) => p.id === r.party_id);
                    return (
                      <div key={r.id} className="flex justify-between items-baseline">
                        <span className="font-body text-xs text-steel">{party?.name}</span>
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
          {!companyOrder.length && <div className="font-body text-steel text-[13px]">No rates entered yet.</div>}
        </div>
      </Panel>

      <Panel>
        <div className="flex justify-between items-center mb-1 flex-wrap gap-2.5">
          <Eyebrow>Rate History Log</Eyebrow>
          <div className="flex gap-2">
            <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} className={`${inputClass} w-[180px] py-1.5 text-xs`}>
              <option value="All">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search size={13} className="text-steel" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or party" className="border-none outline-none font-body text-xs py-1.5 w-[180px]" />
            </div>
          </div>
        </div>
        <div className="max-h-[360px] overflow-y-auto mt-2.5">
          <table className="w-full border-collapse">
            <thead>
              <tr><Th>Company</Th><Th>Party</Th><Th right>11.8kg</Th><Th right>45.4kg</Th><Th right>Timestamp</Th><Th>Entered By</Th></tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const company = companies.find((c) => c.id === r.company_id);
                const party = parties.find((p) => p.id === r.party_id);
                return (
                  <tr key={r.id}>
                    <Td bold>{company?.name}</Td>
                    <Td>{party?.name}</Td>
                    <Td right mono>{r.rate_118}</Td>
                    <Td right mono color="#0F8B8D">{r.rate_454}</Td>
                    <Td right mono>{fmtTime(r.timestamp)}</Td>
                    <Td>{r.entered_by}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
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
