"use client";

import { useEffect, useState } from "react";
import { X, Check, ArrowUpRight, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Field, inputClass, Button } from "./ui";
import AmountInput from "./AmountInput";
import SettlementDestinationFields, { SpecialAccount } from "./SettlementDestinationFields";
import { api, apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput, pkr } from "@/lib/format";

import type { PaymentAccount, Company, DestinationType } from "@/lib/types";

/**
 * Shop Cash Transfer — pushes money OUT of a shop's real Shop Cash balance
 * via the same 3-way settlement split Record Shop Sale uses (Home Expense /
 * Owner Drawings / Plant-or-Account). Unlike a sale, there's no product/
 * quantity/FIFO here — just an amount drawn down from an EXISTING balance,
 * so the amount is validated client-side against availableBalance (the
 * server re-validates against the real stored balance regardless).
 */
export default function ShopCashTransferModal({
  shopId,
  availableBalance,
  onClose,
  onSaved,
}: {
  shopId: string;
  availableBalance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Deliberately does NOT pass shopContext to SettlementDestinationFields
  // below (§ Shop Cash destination) — unlike Shop Sale/Shop Customer
  // Payment, a Transfer's whole point is pushing money OUT of Shop Cash, so
  // offering "Shop Cash" as where the net amount routes BACK TO would be
  // circular (debited up front, then re-credited to the same account).

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [date, setDate] = useState(todayLocalInput());
  const [grossAmount, setGrossAmount] = useState("");

  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseDescription, setHomeExpenseDescription] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType>("account");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [specialAccount, setSpecialAccount] = useState<SpecialAccount>("office_cash");
  const [accountId, setAccountId] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.paymentAccounts.list().then((a) => setAccounts(a.filter((x) => x.active === "active")));
  }, []);

  useEffect(() => {
    api.companies.list().then((c) => setCompanies(c.filter((x: any) => (x.status ? x.status === "active" : true))));
  }, []);

  const gross = parseFloat(grossAmount) || 0;
  const exceedsBalance = gross > availableBalance;

  const resolveAccountId = (): string | undefined => {
    if (destinationType !== "account") return undefined;
    if (specialAccount === "bank") return accountId || undefined;
    return specialAccount; // "office_cash", "owner_home", "dowa_account"
  };

  const canSubmit = !!date && gross > 0 && !exceedsBalance;

  const submit = async () => {
    if (!canSubmit || !user) return;

    setSaving(true);
    setError(null);

    try {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const isoDate = new Date(`${date}T${hh}:${mm}:${ss}`).toISOString();

      const payload: any = {
        date: isoDate,
        gross_amount: gross,
        home_expense_amount: parseFloat(homeExpenseAmount) || 0,
        home_expense_description: homeExpenseDescription.trim() || undefined,
        owner_drawings_amount: parseFloat(ownerDrawingsAmount) || 0,
        destination_type: destinationType,
        notes: notes || undefined,
        entered_by: user.name,
      };

      if (destinationType === "plant") {
        payload.target_plant_id = targetPlantId || undefined;
      } else {
        payload.account_id = resolveAccountId();
      }

      await api.shops.cashTransfers.create(shopId, payload);
      onSaved();
    } catch (e: any) {
      const msg = apiErrorMessage(e, "");
      setError(
        msg.includes("Insufficient")
          ? t("shopDetail.insufficientShopCash")
          : apiErrorMessage(e, t("modals.couldNotSaveSaleGeneric"))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,33,56,0.58)] p-4 sm:p-6">
      <div className="flex w-full max-w-2xl max-h-[94vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5 sm:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
              <ArrowUpRight size={20} />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-ink">
                {t("shopDetail.transferOut")}
              </h2>
              <p className="mt-1 font-body text-xs text-slate-500">
                {t("shopDetail.transferOutCaption")}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            aria-label={t("unifiedSale.close")}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-transparent text-steel transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-ink disabled:opacity-40 cursor-pointer"
          >
            <X size={19} />
          </button>
        </div>

        {/* FORM BODY */}
        <div className="overflow-y-auto px-7 py-7 sm:px-8">
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t("shopDetail.liveAccountBalance")}
              </span>
              <p className="mt-1 font-display text-lg font-bold text-slate-800">
                {pkr(availableBalance)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label={t("modals.saleDateLabel")}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} h-12`} />
              </Field>

              <Field label={t("shopDetail.transferAmountPkr")}>
                <AmountInput value={grossAmount} onChange={setGrossAmount} placeholder="0" className={`${inputClass} h-12`} />
              </Field>
            </div>

            {exceedsBalance && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3">
                <p className="font-body text-xs text-brand-red">{t("shopDetail.insufficientShopCash")}</p>
              </div>
            )}

            {gross > 0 && !exceedsBalance && (
              <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
                <SettlementDestinationFields
                  grossAmount={gross}
                  companies={companies}
                  accounts={accounts}
                  homeExpenseAmount={homeExpenseAmount}
                  onHomeExpenseAmountChange={setHomeExpenseAmount}
                  homeExpenseDescription={homeExpenseDescription}
                  onHomeExpenseDescriptionChange={setHomeExpenseDescription}
                  ownerDrawingsAmount={ownerDrawingsAmount}
                  onOwnerDrawingsAmountChange={setOwnerDrawingsAmount}
                  destinationType={destinationType}
                  onDestinationTypeChange={setDestinationType}
                  targetPlantId={targetPlantId}
                  onTargetPlantIdChange={setTargetPlantId}
                  specialAccount={specialAccount}
                  onSpecialAccountChange={setSpecialAccount}
                  accountId={accountId}
                  onAccountIdChange={setAccountId}
                />
              </section>
            )}

            <section>
              <div className="mb-3 flex items-center gap-2">
                <FileText size={15} className="text-teal" />
                <h3 className="font-display text-sm font-bold text-slate-800">
                  {t("modals.additionalInformation")}
                </h3>
              </div>
              <Field label={t("modals.notesOptional")}>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={`${inputClass} min-h-[90px] resize-y py-3`}
                />
              </Field>
            </section>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
                <p className="font-body text-sm text-brand-red">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50/80 px-7 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            {gross > 0 ? (
              <>
                <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  {t("shopDetail.transferAmountPkr")}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold text-slate-800">{pkr(gross)}</p>
              </>
            ) : (
              <p className="font-body text-xs text-slate-500">{t("modals.completeSaleDetailsToContinue")}</p>
            )}
          </div>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-6 py-3 font-body text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer sm:flex-none"
            >
              {t("unifiedSale.cancel")}
            </button>

            <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
              <Check size={15} />
              {saving ? t("unifiedSale.saving") : t("shopDetail.transferOut")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
