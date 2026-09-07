"use client";
import { useState } from "react";
import { X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import type { Company } from "@/lib/types";

export default function NewPlantModal({
  onClose, onCreated, initialName,
}: { onClose: () => void; onCreated: (c: Company) => void; initialName?: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName || "");
  const [mobile, setMobile] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const company = await api.companies.create({
        name: name.trim(),
        mobile: mobile.trim() || undefined,
        opening_balance: parseFloat(openingBalance) || 0,
      });
      onCreated(company);
    } catch (e) {
      setError(t("modals.couldNotCreatePlant"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-[360px]">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">{t("modals.newPlantFormTitle")}</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label={t("modals.plantNameLabel")}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label={t("modals.mobileOptional")}>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder={t("modals.mobilePlaceholder")} className={inputClass} />
          </Field>
          <Field label={t("modals.openingBalance")}>
            <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0" className={inputClass} />
          </Field>
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!name.trim() || saving}>
            <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.savePlant")}
          </Button>
        </div>
      </div>
    </div>
  );
}
