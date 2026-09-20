"use client";
import { useState } from "react";
import { X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "./ui";
import { apiErrorMessage } from "@/lib/api";
import { pkr } from "@/lib/format";

/** § Opening Balance — one small modal shared by all 3 correctable anchors
 * (Customer, Company, Shop Cash). Unlike CorrectTransactionModal, there's
 * no reversal/repost here: the backend edits the stored value in place and
 * shifts the running balance by the identical delta, so the form only
 * needs the new value + a required reason. */
export default function EditOpeningBalanceModal({
  title,
  currentValue,
  onClose,
  onSave,
  currentBalance,
  fieldLabel,
  note,
}: {
  title: string;
  currentValue: number;
  onClose: () => void;
  onSave: (newValue: number, reason: string) => Promise<void>;
  // Optional — when given, shows what the running balance becomes as the
  // value is edited (the balance shifts by the same delta). Used by Cash
  // Management's "Add Money", where the balance IS the figure being adjusted.
  currentBalance?: number;
  fieldLabel?: string;
  note?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(currentValue));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = value.trim().length > 0 && !isNaN(parseFloat(value)) && reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(parseFloat(value), reason);
    } catch (e) {
      setError(apiErrorMessage(e, t("modals.couldNotSaveOpeningBalance")));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4 sm:p-6">
      <div className="bg-white rounded-xl px-5 py-6 sm:px-6 w-full max-w-[420px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">{title}</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer">
            <X size={16} className="text-steel" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label={fieldLabel || t("modals.newOpeningBalanceLabel")}>
            <input
              type="number"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label={t("modals.reasonForCorrection")}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder={t("modals.reasonPlaceholder")}
            />
          </Field>

          {currentBalance != null && !isNaN(parseFloat(value)) && (
            <div className="font-mono text-xs text-ink bg-paper border border-hairline rounded-md px-3 py-2">
              {t("modals.balanceWillBecome", { from: pkr(currentBalance), to: pkr(currentBalance + (parseFloat(value) - currentValue)) })}
            </div>
          )}

          <div className="font-body text-[11px] text-steel">
            {note || t("modals.openingBalanceChangeNote")}
          </div>

          {error && <div className="font-body text-xs text-brand-red">{error}</div>}

          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.saveCorrection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
