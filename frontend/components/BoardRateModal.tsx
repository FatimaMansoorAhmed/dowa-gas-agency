

"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setToast(t("modals.boardRateSavedToast"));
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
          <div className="font-display font-bold text-[17px] text-ink">{t("shops.boardRate")}</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>

        <div className="font-body text-[12px] text-steel mb-4">
          {t("modals.boardRateCaption")}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.3fr] gap-4">
          <div className="flex flex-col gap-3.5">
            <Field label={t("modals.effectiveDate")}>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("modals.ratePerKg")}>
              <AmountInput value={ratePerKg} onChange={setRatePerKg} placeholder={t("modals.ratePerKgPlaceholder")} className={inputClass} />
            </Field>
            <Field label={t("rateDashboard.enteredByField")}>
              <input value={user?.name || ""} disabled className={`${inputClass} bg-paper text-steel`} />
            </Field>
            <Button variant="primary" onClick={handleSave} disabled={!effectiveDate || !ratePerKg || saving}>
              <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.saveBoardRate")}
            </Button>
            {toast && <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5"><Check size={13} /> {toast}</div>}
          </div>

          <div>
            <Eyebrow>{t("modals.rateHistory")}</Eyebrow>
            <SectionCaption>{t("modals.rateHistoryCaption")}</SectionCaption>
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr><Th>{t("modals.effectiveDate")}</Th><Th right>{t("modals.colRatePerKg")}</Th><Th>{t("customerLedger.colEnteredBy")}</Th><Th>{t("modals.colSetAt")}</Th></tr>
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
                    <tr><td colSpan={4} className="text-steel font-body text-[13px] py-3">{t("modals.noBoardRateSetYet")}</td></tr>
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
