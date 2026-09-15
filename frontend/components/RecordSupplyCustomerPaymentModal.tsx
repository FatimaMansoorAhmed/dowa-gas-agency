"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "./ui";
import AmountInput from "./AmountInput";
import SettlementDestinationFields, { SpecialAccount } from "./SettlementDestinationFields";
import { api, apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput, pkr } from "@/lib/format";
import { isSalaryCategorySelected } from "./SettlementDestinationFields";
import type { ShopSupplyCustomer, PaymentAccount, Company, DestinationType, ExpenseCategory, Employee } from "@/lib/types";

/** Record a Supply Customer's payment to the shop (§25) — collects against
 * a credit ShopSale's receivable, increases Shop Cash (§ Shop Cash Money
 * Routing — posts to a real, shop-scoped PaymentAccount). Never touches the
 * Dowa Customer Ledger/Payment model — this is Engine 3, not Engine 1.
 *
 * Two ways to record the exact same event (§ Payment Only / Receive
 * Payment unification) — this modal (opened from the Supply Customer
 * Ledger's "Receive Payment" button) and RecordShopSaleModal's "Payment
 * Only" tab both post through api.shops.customerPayments.create with the
 * identical settlement-routing payload shape, so they behave identically
 * and both feed the same Settlement Breakdown chips already shown in the
 * Shop Business Ledger / Transaction History / this customer's own ledger.
 * `method` (Cash/Bank Transfer/Other) is kept as its own simple field —
 * purely a record-keeping label, same as everywhere else in the app (see
 * PaymentCreate.method) — it never affects where the money routes. */
export default function RecordSupplyCustomerPaymentModal({
  shopId, shopName, customer, onClose, onSaved,
}: { shopId: string; shopName: string; customer: ShopSupplyCustomer; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const shopContext = { id: shopId, name: shopName };

  const [date, setDate] = useState(todayLocalInput());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Settlement Routing (§ Payment Only mode) — identical field set/defaults
  // to RecordShopSaleModal's payment_only tab.
  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseCategoryId, setHomeExpenseCategoryId] = useState("");
  const [homeExpenseEmployeeId, setHomeExpenseEmployeeId] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType>("account");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [specialAccount, setSpecialAccount] = useState<SpecialAccount>("office_cash");
  const [accountId, setAccountId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.paymentAccounts.list().then((a) => setAccounts(a.filter((x) => x.active === "active"))); }, []);
  useEffect(() => { api.companies.list().then(setCompanies); }, []);
  useEffect(() => { api.expenseCategories.list().then((c) => setExpenseCategories(c.filter((x) => x.active === "active" || x.is_system))); }, []);
  useEffect(() => { api.employees.list().then(setEmployees); }, []);

  const effectiveAmount = parseFloat(amount) || 0;
  const homeExpenseNeedsEmployee =
    parseFloat(homeExpenseAmount) > 0 &&
    isSalaryCategorySelected(expenseCategories, homeExpenseCategoryId) &&
    !homeExpenseEmployeeId;
  const canSubmit = effectiveAmount > 0 && !!date && !homeExpenseNeedsEmployee;

  const resolveAccountId = (): string | undefined => {
    if (destinationType !== "account") return undefined;
    if (specialAccount === "bank") return accountId || undefined;
    return specialAccount; // "office_cash", "owner_home", "dowa_account", "shop_cash"
  };

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
        supply_customer_id: customer.id,
        amount: effectiveAmount,
        method,
        notes: notes || undefined,
        entered_by: user.name,
        destination_type: destinationType,
        home_expense_amount: parseFloat(homeExpenseAmount) || 0,
        home_expense_category_id: homeExpenseCategoryId || undefined,
        home_expense_employee_id: homeExpenseEmployeeId || undefined,
        owner_drawings_amount: parseFloat(ownerDrawingsAmount) || 0,
      };
      if (destinationType === "plant") {
        payload.target_plant_id = targetPlantId || undefined;
      } else {
        payload.settlement_account_id = resolveAccountId();
      }

      await api.shops.customerPayments.create(shopId, customer.id, payload);
      onSaved();
    } catch (e) {
      setError(apiErrorMessage(e, t("modals.couldNotSavePayment")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">{t("modals.receivePaymentTitle", { name: customer.name })}</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="font-body text-[12px] text-steel mb-3">
          {t("modals.outstandingLabel", { amount: pkr(customer.current_balance) })}
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("unifiedSale.date")}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("modals.amountField")}>
              <AmountInput value={amount} onChange={setAmount} className={inputClass} />
            </Field>
          </div>
          <Field label={t("expenses.paymentMethod")}>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
              <option value="cash">{t("unifiedSale.methodCash")}</option>
              <option value="bank_transfer">{t("expenses.methodBankTransfer")}</option>
              <option value="other">{t("expenses.methodOther")}</option>
            </select>
          </Field>
          <Field label={t("modals.notesOptional")}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>

          {effectiveAmount > 0 && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <SettlementDestinationFields
                grossAmount={effectiveAmount}
                companies={companies}
                accounts={accounts}
                shopContext={shopContext}
                homeExpenseAmount={homeExpenseAmount}
                onHomeExpenseAmountChange={setHomeExpenseAmount}
                expenseCategories={expenseCategories}
                homeExpenseCatId={homeExpenseCategoryId}
                onHomeExpenseCatIdChange={setHomeExpenseCategoryId}
                employees={employees}
                homeExpenseEmployeeId={homeExpenseEmployeeId}
                onHomeExpenseEmployeeIdChange={setHomeExpenseEmployeeId}
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
            </div>
          )}
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.savePayment")}
          </Button>
        </div>
      </div>
    </div>
  );
}
