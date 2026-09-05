

"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { Field, inputClass, Button, Eyebrow, SectionCaption, Th, Td } from "./ui";
import AmountInput from "./AmountInput";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { BoardRate } from "@/lib/types";

/** Board Rate entry + history (§14) — the single, system-wide official
 * daily rate/kg Shop Sales are priced from. Setting a new rate never
 * touches any existing Shop Sale (§13) — every historical sale already
 * snapshot its own rate at creation time. Same form + log previously at
 * the standalone /board-rates page, now a modal opened from the Shops
 * page (see "Board Rate" button next to "Add Shop"). */
export default function BoardRateModal({ onClose }: { onClose: () => void }) {
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
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-[720px] max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Board Rate</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>

        <div className="font-body text-[12px] text-steel mb-4">
          Every Shop Sale is priced from the Board Rate in effect on its own sale date — changing today's rate never touches a past sale's amount.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.3fr] gap-4">
          <div className="flex flex-col gap-3.5">
            <Field label="Effective Date">
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Rate per kg (Rs.)">
              <AmountInput value={ratePerKg} onChange={setRatePerKg} placeholder="e.g. 370" className={inputClass} />
            </Field>
            <Field label="Entered by">
              <input value={user?.name || ""} disabled className={`${inputClass} bg-paper text-steel`} />
            </Field>
            <Button variant="primary" onClick={handleSave} disabled={!effectiveDate || !ratePerKg || saving}>
              <Check size={14} /> {saving ? "Saving…" : "Save Board Rate"}
            </Button>
            {toast && <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5"><Check size={13} /> {toast}</div>}
          </div>

          <div>
            <Eyebrow>Rate History</Eyebrow>
            <SectionCaption>Every rate ever set — immutable, newest first.</SectionCaption>
            <div className="max-h-[360px] overflow-auto">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
