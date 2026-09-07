"use client";
import { useEffect, useState } from "react";
import { X, Check, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button, BalanceTag } from "./ui";
import { api } from "@/lib/api";
import { pkr, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Company, PaymentAccount } from "@/lib/types";

export default function RecordPlantPaymentModal({
  onClose,
  onSaved,
  initialCompanyId,
}: {
  onClose: () => void;
  onSaved: () => void;
  initialCompanyId?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [companyId, setCompanyId] = useState(initialCompanyId || "");
  const [date, setDate] = useState(todayLocalInput());
  const [method, setMethod] = useState<
    "cash" | "bank_transfer" | "cheque" | "online" | "other"
  >("cash");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, acc] = await Promise.all([
        api.companies.list(),
        api.paymentAccounts.list(),
      ]);
      setCompanies(c);
      setAccounts(acc);
    })();
  }, []);

  const selectedCompany = companies.find((c) => c.id === companyId);
  const excess =
    selectedCompany && amount
      ? parseFloat(amount) - parseFloat(selectedCompany.current_balance)
      : 0;

  const canSubmit = companyId && date && accountId && parseFloat(amount) > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    try {
      // Get current local time for accurate sorting in ledger
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const localISO = new Date(`${date}T${hours}:${minutes}:${seconds}`).toISOString();

      await api.companyPayments.create({
        date: localISO,
        company_id: companyId,
        amount: parseFloat(amount),
        method,
        account_id: accountId,
        reference_no: referenceNo || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      onSaved();
    } catch (e) {
      setError(t("modals.couldNotSavePaymentGeneric"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-[420px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">
            {t("modals.recordPlantPayment")}
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-none cursor-pointer"
          >
            <X size={16} className="text-steel" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label={t("modals.plantPartyName")}>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("ownerCapital.selectPlant")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          {selectedCompany && (
            <div className="font-mono text-xs text-steel">
              {t("modals.currentPayableInline")}{" "}
              <BalanceTag amount={selectedCompany.current_balance} />
            </div>
          )}

          <Field label={t("unifiedSale.date")}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label={t("expenses.paymentMethod")}>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className={inputClass}
            >
              <option value="cash">{t("unifiedSale.methodCash")}</option>
              <option value="bank_transfer">{t("expenses.methodBankTransfer")}</option>
              <option value="cheque">{t("unifiedSale.methodCheque")}</option>
              <option value="online">{t("expenses.methodOnlinePayment")}</option>
              <option value="other">{t("expenses.methodOther")}</option>
            </select>
          </Field>

          <Field label={t("modals.payFromAccount")}>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("expenses.selectAccount")}</option>
              {accounts
                .filter((a) => a.active === "active")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>

          <Field label={t("modals.amountField")}>
            <input
              type="number"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </Field>

          {selectedCompany && amount && excess > 0 && (
            <div className="px-2.5 py-2 bg-[#FBEAEA] rounded-md font-body text-xs text-brand-red flex gap-1.5 items-start">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                {t("modals.excessCreditWarning", { amount: pkr(excess) })}
              </span>
            </div>
          )}

          <Field label={t("modals.referenceNumberOptional")}>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t("modals.notesOptional")}>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </Field>

          {error && (
            <div className="font-body text-xs text-brand-red">{error}</div>
          )}

          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
          >
            <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.savePayment")}
          </Button>
        </div>
      </div>
    </div>
  );
}