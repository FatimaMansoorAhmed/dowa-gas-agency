"use client";
import { Building2, Wallet } from "lucide-react";
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

export type SpecialAccount = "office_cash" | "owner_home" | "dowa_account" | "bank";

interface Props {
  grossAmount: number;
  companies: Company[];
  accounts: PaymentAccount[];
  expenseCategories: ExpenseCategory[];

  homeExpenseAmount: string;
  onHomeExpenseAmountChange: (v: string) => void;
  homeExpenseCatId: string;
  onHomeExpenseCatIdChange: (v: string) => void;
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
}

export default function SettlementDestinationFields({
  grossAmount, companies, accounts, expenseCategories,
  homeExpenseAmount, onHomeExpenseAmountChange,
  homeExpenseCatId, onHomeExpenseCatIdChange,
  ownerDrawingsAmount, onOwnerDrawingsAmountChange,
  destinationType, onDestinationTypeChange,
  targetPlantId, onTargetPlantIdChange,
  specialAccount, onSpecialAccountChange,
  accountId, onAccountIdChange,
}: Props) {
  const homeExpense = parseFloat(homeExpenseAmount) || 0;
  const ownerDrawings = parseFloat(ownerDrawingsAmount) || 0;
  const netRemaining = Math.max(0, grossAmount - homeExpense - ownerDrawings);

  return (
    <>
      {/* DEDUCTIONS SECTION */}
      <div className="p-3.5 bg-paper rounded-lg border border-hairline space-y-3">
        <div className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">Deductions (Optional)</div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Home Expense (PKR)">
            <AmountInput value={homeExpenseAmount} onChange={onHomeExpenseAmountChange} placeholder="0" className={inputClass} />
          </Field>
          <Field label="Category">
            <select value={homeExpenseCatId} onChange={(e) => onHomeExpenseCatIdChange(e.target.value)} className={inputClass}>
              <option value="">Select Category</option>
              {expenseCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Owner Drawings Amount (PKR)">
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
              Route Remaining Balance ({pkr(netRemaining)}) To
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
              <Building2 size={13} /> Plant Settlement
            </button>
            <button
              type="button"
              onClick={() => onDestinationTypeChange("account")}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                destinationType === "account" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
              }`}
            >
              <Wallet size={13} /> Account Deposit
            </button>
          </div>

          {destinationType === "plant" ? (
            <Field label="Select Plant Ledger">
              <select value={targetPlantId} onChange={(e) => onTargetPlantIdChange(e.target.value)} className={inputClass}>
                <option value="">Select Target Plant</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="space-y-2">
              <Field label="Select Destination Account">
                <select value={specialAccount} onChange={(e) => onSpecialAccountChange(e.target.value as SpecialAccount)} className={inputClass}>
                  <option value="office_cash">Office Cash</option>
                  <option value="owner_home">Owner Home Account</option>
                  <option value="dowa_account">Dowa Account</option>
                  <option value="bank">Specific Bank Account</option>
                </select>
              </Field>

              {specialAccount === "bank" && (
                <Field label="Target Bank Account">
                  <select value={accountId} onChange={(e) => onAccountIdChange(e.target.value)} className={inputClass}>
                    <option value="">Select Bank Account</option>
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
            Nothing left to route — Home Expense + Owner Drawings covers the full amount.
          </div>
        )
      )}
    </>
  );
}
