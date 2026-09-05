"use client";
import { useEffect, useState } from "react";
import { X, RotateCcw, ArrowRightLeft, Banknote } from "lucide-react";
import { Field, inputClass, Button } from "@/components/ui";
import AmountInput from "@/components/AmountInput";
import SettlementDestinationFields, { SpecialAccount } from "@/components/SettlementDestinationFields";
import { api } from "@/lib/api";
import { todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { findBucketAccount } from "@/lib/accounts";
import type { Customer, Company, PaymentAccount, ExpenseCategory, DestinationType } from "@/lib/types";

/** Return Cylinder (§ Part B, Customer Ledger) — a customer hands back
 * cylinders of one category (size + Cross/PSO type — the only 2 types this
 * app tracks, see Customer.empty_cylinders_{size}_{type}). Two mutually
 * exclusive paths:
 *   - "transfer": pure cylinder-count move to another customer, zero money.
 *   - "cash": converts the quantity to a cash value routed through the
 *     EXACT SAME destination fields as PaymentReceiptModal (Part A) — see
 *     SettlementDestinationFields, shared rather than re-implemented. */

type SellType = "cross" | "pso" | "legacy";

function unclassified(c: Customer, size: "118" | "454"): number {
  const total = parseFloat((size === "454" ? c.empty_cylinders_454 : c.empty_cylinders_118) || "0");
  const cross = parseFloat((size === "454" ? c.empty_cylinders_454_cross : c.empty_cylinders_118_cross) || "0");
  const pso = parseFloat((size === "454" ? c.empty_cylinders_454_pso : c.empty_cylinders_118_pso) || "0");
  return Math.max(total - cross - pso, 0);
}

function balanceFor(c: Customer, size: "118" | "454", type: SellType): number {
  if (type === "legacy") return unclassified(c, size);
  const key = `empty_cylinders_${size}_${type}` as keyof Customer;
  return parseFloat((c[key] as string) || "0");
}

function defaultTypeFor(c: Customer, size: "118" | "454"): SellType {
  if (balanceFor(c, size, "cross") > 0) return "cross";
  if (balanceFor(c, size, "pso") > 0) return "pso";
  return "legacy";
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customer: Customer | null;
}

export default function ReturnCylinderModal({ isOpen, onClose, onSuccess, customer }: Props) {
  const { user } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);

  const [cylSize, setCylSize] = useState<"118" | "454">("118");
  const [sellType, setSellType] = useState<SellType>("cross");
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState<"transfer" | "cash">("transfer");

  const [toCustomerId, setToCustomerId] = useState("");
  const [toCustomerSearch, setToCustomerSearch] = useState("");

  const [amount, setAmount] = useState("");
  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseCatId, setHomeExpenseCatId] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType>("plant");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [specialAccount, setSpecialAccount] = useState<SpecialAccount>("office_cash");
  const [accountId, setAccountId] = useState("");

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !customer) return;
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
    const size = parseFloat(customer.empty_cylinders_118 || "0") > 0 ? "118" : "454";
    setCylSize(size);
    setSellType(defaultTypeFor(customer, size));
    setQuantity("");
    setMode("transfer");
    setToCustomerId("");
    setToCustomerSearch("");
    setAmount("");
    setHomeExpenseAmount("");
    setHomeExpenseCatId("");
    setOwnerDrawingsAmount("");
    setDestinationType("plant");
    setTargetPlantId("");
    setSpecialAccount("office_cash");
    setAccountId("");
    setNotes("");
    setError(null);
  }, [isOpen, customer?.id]);

  if (!isOpen || !customer) return null;

  const availableBalance = balanceFor(customer, cylSize, sellType);
  const qtyNum = parseFloat(quantity) || 0;
  const amountNum = parseFloat(amount) || 0;

  const changeSize = (size: "118" | "454") => {
    setCylSize(size);
    setSellType(defaultTypeFor(customer, size));
    setQuantity("");
  };

  const otherCustomers = customers.filter((c) => c.id !== customer.id);
  const filteredToCustomers = otherCustomers.filter(
    (c) =>
      !toCustomerSearch.trim() ||
      c.name.toLowerCase().includes(toCustomerSearch.toLowerCase()) ||
      c.mobile.includes(toCustomerSearch) ||
      c.display_id.toLowerCase().includes(toCustomerSearch.toLowerCase())
  );
  const toCustomer = customers.find((c) => c.id === toCustomerId);

  const cashHomeExpense = parseFloat(homeExpenseAmount) || 0;
  const cashOwnerDrawings = parseFloat(ownerDrawingsAmount) || 0;
  const cashNetRemaining = Math.max(0, amountNum - cashHomeExpense - cashOwnerDrawings);

  const canSubmit =
    qtyNum > 0 &&
    qtyNum <= availableBalance &&
    (mode === "transfer"
      ? !!toCustomerId
      : amountNum > 0 &&
        // Nothing left to route (Home Expense/Owner Drawings consumed the
        // whole cash value) — a Plant/Account pick would be decorative.
        (cashNetRemaining <= 0 || (destinationType === "plant" ? !!targetPlantId : specialAccount === "bank" ? !!accountId : true)));

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);

    let finalAccountId = accountId;
    if (mode === "cash" && destinationType === "account" && specialAccount !== "bank") {
      const bucketAccount = findBucketAccount(accounts, specialAccount);
      finalAccountId = bucketAccount ? bucketAccount.id : specialAccount;
    }

    try {
      await api.cylinderReturns.create({
        customer_id: customer.id,
        cylinder_size: cylSize,
        cylinder_type: sellType === "legacy" ? undefined : sellType,
        quantity: qtyNum,
        mode,
        to_customer_id: mode === "transfer" ? toCustomerId : undefined,
        amount: mode === "cash" ? amountNum : undefined,
        home_expense_amount: mode === "cash" && (parseFloat(homeExpenseAmount) || 0) > 0 ? parseFloat(homeExpenseAmount) : undefined,
        home_expense_category_id: mode === "cash" && (parseFloat(homeExpenseAmount) || 0) > 0 ? homeExpenseCatId || undefined : undefined,
        owner_drawings_amount: mode === "cash" && (parseFloat(ownerDrawingsAmount) || 0) > 0 ? parseFloat(ownerDrawingsAmount) : undefined,
        destination_type: mode === "cash" ? destinationType : undefined,
        target_plant_id: mode === "cash" && destinationType === "plant" && targetPlantId ? targetPlantId : undefined,
        account_id: mode === "cash" && destinationType === "account" && finalAccountId ? finalAccountId : undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record the cylinder return.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 overflow-hidden border border-hairline">
        <div className="flex justify-between items-center px-5 py-4 border-b border-hairline bg-paper">
          <div className="flex items-center gap-2">
            <RotateCcw className="text-teal" size={20} />
            <h3 className="font-display font-semibold text-lg text-ink">Return Cylinder — {customer.name}</h3>
          </div>
          <button onClick={onClose} className="text-steel hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cylinder Size">
              <select value={cylSize} onChange={(e) => changeSize(e.target.value as "118" | "454")} className={inputClass}>
                <option value="118">11.8 KG</option>
                <option value="454">45.4 KG</option>
              </select>
            </Field>
            <Field label="Cylinder Type">
              <select value={sellType} onChange={(e) => { setSellType(e.target.value as SellType); setQuantity(""); }} className={inputClass}>
                <option value="cross">Cross ({balanceFor(customer, cylSize, "cross")} available)</option>
                <option value="pso">PSO ({balanceFor(customer, cylSize, "pso")} available)</option>
                {unclassified(customer, cylSize) > 0 && (
                  <option value="legacy">Unclassified ({unclassified(customer, cylSize)} available)</option>
                )}
              </select>
            </Field>
          </div>

          <div className="font-mono text-xs text-steel">
            Available {cylSize === "454" ? "45.4 KG" : "11.8 KG"} {sellType === "legacy" ? "unclassified" : sellType.toUpperCase()} empty cylinders:{" "}
            <b className="text-ink">{availableBalance}</b>
          </div>

          <Field label="Quantity">
            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("transfer")}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                mode === "transfer" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
              }`}
            >
              <ArrowRightLeft size={13} /> Transfer to Customer
            </button>
            <button
              type="button"
              onClick={() => setMode("cash")}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                mode === "cash" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
              }`}
            >
              <Banknote size={13} /> Convert to Cash
            </button>
          </div>

          {mode === "transfer" ? (
            <Field label="Transfer To (Customer B)">
              <div className="relative">
                <input
                  value={toCustomer ? `${toCustomer.name} · ${toCustomer.display_id}` : toCustomerSearch}
                  onChange={(e) => {
                    setToCustomerId("");
                    setToCustomerSearch(e.target.value);
                  }}
                  placeholder="Search customer by name or ID"
                  className={inputClass}
                />
                {!toCustomerId && toCustomerSearch.trim() && (
                  <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                    {filteredToCustomers.slice(0, 6).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setToCustomerId(c.id);
                          setToCustomerSearch("");
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
          ) : (
            <>
              <Field label="Cash Value (PKR)">
                <AmountInput
                  value={amount}
                  onChange={setAmount}
                  placeholder="0"
                  className={`${inputClass} text-base font-mono font-bold text-teal`}
                />
              </Field>

              <SettlementDestinationFields
                grossAmount={amountNum}
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
            </>
          )}

          <Field label="Notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>

          {error && <div className="text-xs text-brand-red font-medium">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-hairline bg-paper">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : "Confirm Return"}
          </Button>
        </div>
      </div>
    </div>
  );
}
