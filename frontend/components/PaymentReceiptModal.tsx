"use client";
import { useEffect, useState } from "react";
import { X, Wallet } from "lucide-react";
import { Field, inputClass, Button } from "@/components/ui";
import AmountInput from "@/components/AmountInput";
import SettlementDestinationFields, { SpecialAccount } from "@/components/SettlementDestinationFields";
import { api } from "@/lib/api";
import { todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { findBucketAccount } from "@/lib/accounts";
import type { Customer, Company, PaymentAccount, ExpenseCategory, DestinationType } from "@/lib/types";

/** Payment Receipt (§ Part A — Payment-Only mode) — records a customer
 * payment with the SAME 4-way destination split /payment-receipts has
 * always supported (Home Expense / Owner Drawings bypass every Dowa
 * account, the remainder routes to a Plant or an Account): originally
 * only reachable from the Payments Register page (app/payments/page.tsx,
 * which now renders this same modal instead of its own inline copy of
 * this form) — pulled out here so the Sale page can open it too without
 * duplicating the destination-routing logic. */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultCustomerId?: string;
}

export default function PaymentReceiptModal({ isOpen, onClose, onSuccess, defaultCustomerId }: Props) {
  const { user } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);

  const [date, setDate] = useState(todayLocalInput());
  const [customerId, setCustomerId] = useState(defaultCustomerId || "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [totalCreditReceived, setTotalCreditReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");

  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseCatId, setHomeExpenseCatId] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");

  const [destinationType, setDestinationType] = useState<DestinationType>("plant");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [specialAccount, setSpecialAccount] = useState<SpecialAccount>("office_cash");
  const [accountId, setAccountId] = useState("");

  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const [cList, compList, accList, catList] = await Promise.all([
          api.customers.list(),
          api.companies.list(),
          api.paymentAccounts.list(),
          api.expenseCategories.list(),
        ]);
        setCustomers(cList);
        setCompanies(compList);
        setAccounts(accList);
        setExpenseCategories(catList);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load form data.");
      }
    })();
    if (defaultCustomerId) setCustomerId(defaultCustomerId);
  }, [isOpen, defaultCustomerId]);

  if (!isOpen) return null;

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const filteredCustomers = customers.filter(
    (c) =>
      !customerSearch.trim() ||
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.mobile.includes(customerSearch) ||
      c.display_id.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const grossAmount = parseFloat(totalCreditReceived) || 0;
  const homeExpense = parseFloat(homeExpenseAmount) || 0;
  const ownerDrawings = parseFloat(ownerDrawingsAmount) || 0;
  const netRemaining = Math.max(0, grossAmount - homeExpense - ownerDrawings);

  const canSubmit =
    !!customerId &&
    grossAmount > 0 &&
    !!date &&
    // Nothing left to route (Home Expense/Owner Drawings consumed the
    // whole amount) — a Plant/Account pick would be decorative, so don't
    // block submission on it.
    (netRemaining <= 0 || (destinationType === "plant" ? !!targetPlantId : specialAccount === "bank" ? !!accountId : true));

  const resetForm = () => {
    setDate(todayLocalInput());
    setCustomerId(defaultCustomerId || "");
    setCustomerSearch("");
    setTotalCreditReceived("");
    setPaymentMethod("cash");
    setHomeExpenseAmount("");
    setHomeExpenseCatId("");
    setOwnerDrawingsAmount("");
    setDestinationType("plant");
    setTargetPlantId("");
    setSpecialAccount("office_cash");
    setAccountId("");
    setReferenceNo("");
    setNotes("");
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);

    let finalAccountId = accountId;
    if (destinationType === "account" && specialAccount !== "bank") {
      const bucketAccount = findBucketAccount(accounts, specialAccount);
      finalAccountId = bucketAccount ? bucketAccount.id : specialAccount;
    }

    try {
      // Stamp the picked calendar date with the actual current time-of-day
      // (same convention every sibling modal uses, e.g.
      // RecordSupplyCustomerPaymentModal) — plain `new Date(date)` on a
      // date-only string defaults to 00:00:00 UTC, which every receipt
      // entered the same day then displays as the same fixed 5:00 AM PKT
      // instead of its real creation time.
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");

      await api.paymentReceipts.create({
        date: new Date(`${date}T${hh}:${mm}:${ss}`).toISOString(),
        customer_id: customerId,
        amount: grossAmount,
        method: paymentMethod,
        home_expense_amount: homeExpense > 0 ? homeExpense : undefined,
        home_expense_category_id: homeExpense > 0 ? homeExpenseCatId || undefined : undefined,
        owner_drawings_amount: ownerDrawings > 0 ? ownerDrawings : undefined,
        destination_type: destinationType,
        // Empty string (never picked, e.g. netRemaining is 0 so nothing
        // was required) must be sent as undefined — an empty string fails
        // backend UUID validation instead of resolving to "no destination".
        target_plant_id: destinationType === "plant" && targetPlantId ? targetPlantId : undefined,
        account_id: destinationType === "account" && finalAccountId ? finalAccountId : undefined,
        reference_no: referenceNo || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      resetForm();
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 overflow-hidden border border-hairline">
        <div className="flex justify-between items-center px-5 py-4 border-b border-hairline bg-paper">
          <div className="flex items-center gap-2">
            <Wallet className="text-teal" size={20} />
            <h3 className="font-display font-semibold text-lg text-ink">Record Payment</h3>
          </div>
          <button onClick={handleClose} className="text-steel hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Payment Method">
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className={inputClass}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="online">Online</option>
              </select>
            </Field>
          </div>

          <Field label="Customer">
            <div className="relative">
              <input
                value={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.display_id}` : customerSearch}
                onChange={(e) => {
                  setCustomerId("");
                  setCustomerSearch(e.target.value);
                }}
                placeholder="Search customer name or ID"
                className={inputClass}
              />
              {!customerId && customerSearch.trim() && (
                <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                  {filteredCustomers.slice(0, 6).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCustomerId(c.id);
                        setCustomerSearch("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-paper font-body text-xs"
                    >
                      <span className="font-semibold text-ink">{c.name}</span> <span className="text-steel">· {c.display_id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="Total Credit / Payment Received (PKR)">
            <AmountInput
              value={totalCreditReceived}
              onChange={setTotalCreditReceived}
              placeholder="0"
              className={`${inputClass} text-base font-mono font-bold text-teal`}
            />
          </Field>

          <SettlementDestinationFields
            grossAmount={grossAmount}
            companies={companies}
            accounts={accounts}
            expenseCategories={expenseCategories}
            homeExpenseAmount={homeExpenseAmount}
            onHomeExpenseAmountChange={setHomeExpenseAmount}
            homeExpenseCatId={homeExpenseCatId}
            onHomeExpenseCatIdChange={setHomeExpenseCatId}
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

          <div className="grid grid-cols-2 gap-2">
            <Field label="Reference / Cheque #">
              <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="Txn #" className={inputClass} />
            </Field>
            <Field label="Notes">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remarks" className={inputClass} />
            </Field>
          </div>

          {error && <div className="text-xs text-brand-red font-medium">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-hairline bg-paper">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Posting Receipt…" : "Post Payment Receipt"}
          </Button>
        </div>
      </div>
    </div>
  );
}
