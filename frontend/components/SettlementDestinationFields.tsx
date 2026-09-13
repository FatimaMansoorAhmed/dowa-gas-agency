"use client";
import { Building2, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass } from "@/components/ui";
import AmountInput from "@/components/AmountInput";
import { pkr } from "@/lib/format";
import type { Company, PaymentAccount, ExpenseCategory, DestinationType } from "@/lib/types";

/** The "Deductions" + "Route Remaining Balance" sections shared by every
 * settlement-routing flow in the app: PaymentReceiptModal (Part A) and
 * ReturnCylinderModal's "Convert to Cash" path (Part B) — both post through
 * the same /payment-receipts-style backend routing (see
 * utils.apply_settlement_routing), so both render the SAME fields rather
 * than each defining their own copy. Pulled out of what was originally
 * inline JSX in app/payments/page.tsx. */

export type SpecialAccount = "office_cash" | "owner_home" | "dowa_account" | "bank" | "shop_cash";

type CommonProps = {
  grossAmount: number;
  companies: Company[];
  accounts: PaymentAccount[];
  // Only passed by the 3 shop-side settlement features (Shop Sale, Shop
  // Cash Transfer, Shop Customer Payment) — routes the remaining balance
  // into THIS shop's own Shop Cash PaymentAccount (account_id="shop_cash",
  // resolved server-side via resolve_settlement_destination's shop param)
  // instead of one of the 3 global buckets. Payment Receipt/Cylinder
  // Return never pass this, so the option never appears for them.
  shopContext?: { id: string; name: string };

  homeExpenseAmount: string;
  onHomeExpenseAmountChange: (v: string) => void;
  ownerDrawingsAmount: string;
  onOwnerDrawingsAmountChange: (v: string) => void;

  destinationType: DestinationType;
  onDestinationTypeChange: (v: DestinationType) => void;
  targetPlantId: string;
  onTargetPlantIdChange: (v: string) => void;
  specialAccount: SpecialAccount;
  onSpecialAccountChange: (v: SpecialAccount) => void;
  accountId: string;
  onAccountIdChange: (v: string) => void;
};

type CategoryModeProps = {
  expenseCategories: ExpenseCategory[];
  homeExpenseCatId: string;
  onHomeExpenseCatIdChange: (v: string) => void;
  homeExpenseDescription?: never;
  onHomeExpenseDescriptionChange?: never;
};

type DescriptionModeProps = {
  expenseCategories?: never;
  homeExpenseCatId?: never;
  onHomeExpenseCatIdChange?: never;
  homeExpenseDescription: string;
  onHomeExpenseDescriptionChange: (v: string) => void;
};

type Props = CommonProps & (CategoryModeProps | DescriptionModeProps);

export default function SettlementDestinationFields({
  grossAmount, companies, accounts, shopContext,
  homeExpenseAmount, onHomeExpenseAmountChange,
  homeExpenseDescription, onHomeExpenseDescriptionChange,
  homeExpenseCatId, onHomeExpenseCatIdChange,
  expenseCategories,
  ownerDrawingsAmount, onOwnerDrawingsAmountChange,
  destinationType, onDestinationTypeChange,
  targetPlantId, onTargetPlantIdChange,
  specialAccount, onSpecialAccountChange,
  accountId, onAccountIdChange,
}: Props) {
  const { t } = useTranslation();
  const homeExpense = parseFloat(homeExpenseAmount) || 0;
  const ownerDrawings = parseFloat(ownerDrawingsAmount) || 0;
  const netRemaining = Math.max(0, grossAmount - homeExpense - ownerDrawings);

  return (
    <>
      {/* DEDUCTIONS SECTION */}
      <div className="p-3.5 bg-paper rounded-lg border border-hairline space-y-3">
        <div className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">{t("modals.deductionsOptional")}</div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t("modals.homeExpensePkr")}>
            <AmountInput value={homeExpenseAmount} onChange={onHomeExpenseAmountChange} placeholder="0" className={inputClass} />
          </Field>
          {expenseCategories && onHomeExpenseCatIdChange ? (
            <Field label={t("expenses.categoryLabel")}>
              <select value={homeExpenseCatId} onChange={(e) => onHomeExpenseCatIdChange(e.target.value)} className={inputClass}>
                <option value="">{t("modals.selectCategory2")}</option>
                {expenseCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={t("modals.homeExpenseDescription")}>
              <input
                value={homeExpenseDescription || ""}
                onChange={(e) => onHomeExpenseDescriptionChange?.(e.target.value)}
                placeholder={t("modals.homeExpenseDescriptionPlaceholder")}
                className={inputClass}
              />
            </Field>
          )}
        </div>

        <Field label={t("modals.ownerDrawingsAmountPkr")}>
          <AmountInput value={ownerDrawingsAmount} onChange={onOwnerDrawingsAmountChange} placeholder="0" className={inputClass} />
        </Field>
      </div>

      {/* FLEXIBLE SETTLEMENT SECTION — hidden entirely once Home Expense +
          Owner Drawings consume the whole amount (netRemaining <= 0).
          Previously this stayed visible with "Plant Settlement" sitting
          visually pre-selected/highlighted and no plant chosen — technically
          harmless (the backend skips requiring one when nothing is left to
          route, and neither field is sent), but confusing: it looked like a
          live, required choice. Hiding it removes that ambiguity outright. */}
      {netRemaining > 0 ? (
        <div className="p-3.5 bg-slate-50 rounded-lg border border-hairline space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">
              {t("modals.routeRemainingBalanceTo2", { amount: pkr(netRemaining) })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onDestinationTypeChange("plant")}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                destinationType === "plant" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
              }`}
            >
              <Building2 size={13} /> {t("unifiedSale.plantSettlementOption")}
            </button>
            <button
              type="button"
              onClick={() => onDestinationTypeChange("account")}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                destinationType === "account" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
              }`}
            >
              <Wallet size={13} /> {t("unifiedSale.accountDepositOption")}
            </button>
          </div>

          {destinationType === "plant" ? (
            <Field label={t("modals.selectPlantLedger")}>
              <select value={targetPlantId} onChange={(e) => onTargetPlantIdChange(e.target.value)} className={inputClass}>
                <option value="">{t("modals.selectTargetPlant")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="space-y-2">
              <Field label={t("modals.selectDestinationAccount")}>
                <select value={specialAccount} onChange={(e) => onSpecialAccountChange(e.target.value as SpecialAccount)} className={inputClass}>
                  {shopContext && <option value="shop_cash">{t("shops.shopCash")}</option>}
                  <option value="office_cash">{t("payments.officeCash")}</option>
                  <option value="owner_home">{t("payments.ownerHome")}</option>
                  <option value="dowa_account">{t("payments.dowaAccount")}</option>
                  <option value="bank">{t("modals.specificBankAccount")}</option>
                </select>
              </Field>

              {specialAccount === "bank" && (
                <Field label={t("modals.targetBankAccount")}>
                  <select value={accountId} onChange={(e) => onAccountIdChange(e.target.value)} className={inputClass}>
                    <option value="">{t("modals.selectBankAccount")}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.kind})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          )}
        </div>
      ) : (
        grossAmount > 0 && (
          <div className="p-3 bg-slate-50 rounded-lg border border-hairline font-body text-xs text-steel">
            {t("modals.nothingLeftToRoute")}
          </div>
        )
      )}
    </>
  );
}
