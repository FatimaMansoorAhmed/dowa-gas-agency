"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { BoardRate } from "@/lib/types";

/** Board Rate history (§14) — the single, system-wide official daily
 * rate/kg Shop Sales are priced from. Setting a new rate never touches
 * any existing Shop Sale (§13) — every historical sale already snapshot
 * its own rate at creation time. */
function BoardRatesBody() {
  const { user } = useAuth();
  const [rates, setRates] = useState<BoardRate[]>([]);
  const [effectiveDate, setEffectiveDate] = useState(todayLocalInput());
  const [ratePerKg, setRatePerKg] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = () => api.boardRates.list().then(setRates);
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!effectiveDate || !ratePerKg || !user) return;
    setSaving(true);
    try {
      await api.boardRates.create({
        effective_date: new Date(`${effectiveDate}T00:00:00`).toISOString(),
        rate_per_kg: parseFloat(ratePerKg),
        entered_by: user.name,
      });
      setToast("Board Rate saved.");
      setRatePerKg("");
      await load();
      setTimeout(() => setToast(null), 2200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Board Rates"
        title="Daily official rate per kg"
        caption="Every Shop Sale is priced from the Board Rate in effect on its own sale date — changing today's rate never touches a past sale's amount."
      />

      <div className="grid grid-cols-[1fr_1.3fr] gap-4">
        <Panel>
          <div className="flex flex-col gap-3.5">
            <Field label="Effective Date">
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Rate per kg (Rs.)">
              <input type="number" value={ratePerKg} onChange={(e) => setRatePerKg(e.target.value)} placeholder="e.g. 370" className={inputClass} />
            </Field>
            <Field label="Entered by">
              <input value={user?.name || ""} disabled className={`${inputClass} bg-paper text-steel`} />
            </Field>
            <Button variant="primary" onClick={handleSave} disabled={!effectiveDate || !ratePerKg || saving}>
              {saving ? "Saving…" : "Save Board Rate"}
            </Button>
            {toast && <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5"><Check size={13} /> {toast}</div>}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>Rate History</Eyebrow>
          <SectionCaption>Every rate ever set — immutable, newest first.</SectionCaption>
          <table className="w-full border-collapse">
            <thead>
              <tr><Th>Effective Date</Th><Th right>Rate / kg</Th><Th>Entered By</Th><Th>Set At</Th></tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <Td bold>{r.effective_date.slice(0, 10)}</Td>
                  <Td right mono>{pkr(r.rate_per_kg)}</Td>
                  <Td>{r.entered_by}</Td>
                  <Td mono>{fmtTime(r.created_at)}</Td>
                </tr>
              ))}
              {!rates.length && (
                <tr><td colSpan={4} className="text-steel font-body text-[13px] py-3">No Board Rate set yet.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

export default function BoardRatesPage() {
  return (
    <AuthGate>
      <BoardRatesBody />
    </AuthGate>
  );
}
