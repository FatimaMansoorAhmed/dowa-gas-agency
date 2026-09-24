"use client";
import { useEffect, useState } from "react";
import { X, RotateCcw, ArrowRightLeft, Banknote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "@/components/ui";
import AmountInput from "@/components/AmountInput";
import SettlementDestinationFields, { SpecialAccount } from "@/components/SettlementDestinationFields";
import { HomeExpenseLine, homeExpenseLinesTotal, homeExpenseLinesValid, toHomeExpenseLinesPayload } from "@/components/HomeExpenseLinesEditor";
import { api } from "@/lib/api";
import { todayLocalInput, pkr } from "@/lib/format";
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
  // "sell" (Empty Cylinders page's "Sell Cylinder" button) reuses this
  // exact component/endpoint instead of duplicating the cash-mode +
  // settlement-fields wiring: mode is locked to "cash" (no transfer
  // toggle), and origin="sell_cylinder" tags the row so the Daily Report
  // keeps reporting sells as their own section (§ models.CylinderReturn.origin).
  variant?: "return" | "sell";
}

export default function ReturnCylinderModal({ isOpen, onClose, onSuccess, customer, variant = "return" }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isSell = variant === "sell";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);

  const [cylSize, setCylSize] = useState<"118" | "454">("118");
  const [sellType, setSellType] = useState<SellType>("cross");
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState<"transfer" | "cash">(isSell ? "cash" : "transfer");

  const [toCustomerId, setToCustomerId] = useState("");
  const [toCustomerSearch, setToCustomerSearch] = useState("");

  const [amount, setAmount] = useState("");
  // Sell only: a real sale — price × quantity is the receivable, and
  // paymentReceived (default 0) is what's collected now.
  const [price, setPrice] = useState("");
  const [paymentReceived, setPaymentReceived] = useState("");
  const [homeExpenseLines, setHomeExpenseLines] = useState<HomeExpenseLine[]>([]);
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
        // § Employee Salary Tracking — excluded, same reasoning as
        // PaymentReceiptModal (no Employee picker on this flow).
        setExpenseCategories(catList.filter((c) => !(c.is_system && c.name === "Salary")));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("modals.failedLoadFormData"));
      }
    })();
    const size = parseFloat(customer.empty_cylinders_118 || "0") > 0 ? "118" : "454";
    setCylSize(size);
    setSellType(defaultTypeFor(customer, size));
    setQuantity("");
    setMode(isSell ? "cash" : "transfer");
    setToCustomerId("");
    setToCustomerSearch("");
    setAmount("");
    setPrice("");
    setPaymentReceived("");
    setHomeExpenseLines([]);
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

  // Sell: a real sale. Deductions come out of the payment received, never
  // the sale amount (same as a normal Sale's settlement).
  const priceNum = parseFloat(price) || 0;
  const saleTotal = qtyNum * priceNum;
  const paymentNum = parseFloat(paymentReceived) || 0;
  const sellExpenses = homeExpenseLinesTotal(homeExpenseLines);
  const sellNetRemaining = Math.max(0, paymentNum - sellExpenses - cashOwnerDrawings);
  const sellOutstanding = Math.max(0, saleTotal - paymentNum);
  const sellPaymentTooHigh = paymentNum > saleTotal + 0.01;
  const sellCanSubmit =
    priceNum > 0 &&
    !sellPaymentTooHigh &&
    (paymentNum <= 0 ||
      (sellExpenses + cashOwnerDrawings <= paymentNum + 0.01 &&
        homeExpenseLinesValid(homeExpenseLines, expenseCategories) &&
        (sellNetRemaining <= 0 || (destinationType === "plant" ? !!targetPlantId : specialAccount === "bank" ? !!accountId : true))));

  const canSubmit =
    qtyNum > 0 &&
    qtyNum <= availableBalance &&
    (isSell
      ? sellCanSubmit
      : mode === "transfer"
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
    if ((mode === "cash" || isSell) && destinationType === "account" && specialAccount !== "bank" && specialAccount !== "shop_cash") {
      const bucketAccount = findBucketAccount(accounts, specialAccount);
      finalAccountId = bucketAccount ? bucketAccount.id : specialAccount;
    }

    try {
      if (isSell) {
        // Routing is only meaningful (and only sent) when money was actually received.
        const routed = paymentNum > 0;
        await api.cylinderReturns.create({
          customer_id: customer.id,
          cylinder_size: cylSize,
          cylinder_type: sellType === "legacy" ? undefined : sellType,
          quantity: qtyNum,
          mode: "cash",
          origin: "sell_cylinder",
          price_per_cylinder: priceNum,
          payment_received: paymentNum,
          home_expense_lines: routed ? toHomeExpenseLinesPayload(homeExpenseLines) : undefined,
          owner_drawings_amount: routed && cashOwnerDrawings > 0 ? cashOwnerDrawings : undefined,
          destination_type: routed ? destinationType : undefined,
          target_plant_id: routed && destinationType === "plant" && targetPlantId ? targetPlantId : undefined,
          account_id: routed && destinationType === "account" && finalAccountId ? finalAccountId : undefined,
          notes: notes || undefined,
          entered_by: user.name,
        });
        onSuccess();
        onClose();
        return;
      }
      await api.cylinderReturns.create({
        customer_id: customer.id,
        cylinder_size: cylSize,
        cylinder_type: sellType === "legacy" ? undefined : sellType,
        quantity: qtyNum,
        mode,
        origin: isSell ? "sell_cylinder" : "return_cylinder",
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
      setError(e instanceof Error ? e.message : t("modals.failedRecordCylinderReturn"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8 overflow-hidden border border-hairline">
        <div className="flex justify-between items-center px-5 py-4 border-b border-hairline bg-paper">
          <div className="flex items-center gap-2">
            {isSell ? <Banknote className="text-teal" size={20} /> : <RotateCcw className="text-teal" size={20} />}
            <h3 className="font-display font-semibold text-lg text-ink">
              {t(isSell ? "modals.sellCylinderTitle" : "modals.returnCylinderTitle", { name: customer.name })}
            </h3>
          </div>
          <button onClick={onClose} className="text-steel hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("modals.cylinderSize")}>
              <select value={cylSize} onChange={(e) => changeSize(e.target.value as "118" | "454")} className={inputClass}>
                <option value="118">{t("unifiedSale.col118")}</option>
                <option value="454">{t("unifiedSale.col454")}</option>
              </select>
            </Field>
            <Field label={t("modals.cylinderType")}>
              <select value={sellType} onChange={(e) => { setSellType(e.target.value as SellType); setQuantity(""); }} className={inputClass}>
                <option value="cross">{t("modals.crossAvailable", { available: balanceFor(customer, cylSize, "cross") })}</option>
                <option value="pso">{t("modals.psoAvailable", { available: balanceFor(customer, cylSize, "pso") })}</option>
                {unclassified(customer, cylSize) > 0 && (
                  <option value="legacy">{t("modals.unclassifiedAvailable", { available: unclassified(customer, cylSize) })}</option>
                )}
              </select>
            </Field>
          </div>

          <div className="font-mono text-xs text-steel">
            {t("modals.availableCylindersLine", { size: cylSize === "454" ? t("unifiedSale.col454") : t("unifiedSale.col118"), type: sellType === "legacy" ? t("modals.unclassifiedLower") : sellType.toUpperCase() })}{" "}
            <b className="text-ink">{availableBalance}</b>
          </div>

          <Field label={t("modals.quantityLabel")}>
            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
            />
          </Field>

          {!isSell && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("transfer")}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                  mode === "transfer" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
                }`}
              >
                <ArrowRightLeft size={13} /> {t("modals.transferToCustomer")}
              </button>
              <button
                type="button"
                onClick={() => setMode("cash")}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                  mode === "cash" ? "bg-teal/10 border-teal text-teal shadow-xs" : "border-hairline bg-white text-steel hover:bg-paper"
                }`}
              >
                <Banknote size={13} /> {t("modals.convertToCash")}
              </button>
            </div>
          )}

          {isSell ? (
            <>
              <div className="p-3.5 bg-paper rounded-lg border border-hairline space-y-3">
                <div className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">{t("modals.sellSaleDetails")}</div>
                <div className="font-body text-xs text-steel">
                  {t("modals.sellCustomerLabel")}: <b className="text-ink">{customer.name}</b> · {customer.display_id}
                </div>
                <Field label={t("modals.sellPricePerCylinder")}>
                  <AmountInput value={price} onChange={setPrice} placeholder="0" className={inputClass} />
                </Field>
                <div className="flex justify-between items-center">
                  <span className="font-body text-xs text-steel">{t("modals.sellTotalSale")}</span>
                  <b className="font-mono text-base text-teal">{pkr(saleTotal)}</b>
                </div>
              </div>

              <div className="p-3.5 bg-paper rounded-lg border border-hairline space-y-3">
                <div className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">{t("modals.sellPaymentSection")}</div>
                <Field label={t("modals.sellAmountReceived")}>
                  <AmountInput
                    value={paymentReceived}
                    onChange={setPaymentReceived}
                    placeholder="0"
                    className={`${inputClass} text-base font-mono font-bold text-teal`}
                  />
                </Field>
                {sellPaymentTooHigh && (
                  <div className="text-xs text-brand-red font-medium">{t("modals.sellPaymentExceedsTotal")}</div>
                )}
                {paymentNum > 0 ? (
                  <div className="font-body text-xs text-steel">{t("modals.sellOutstandingAfter", { amount: pkr(sellOutstanding) })}</div>
                ) : (
                  saleTotal > 0 && (
                    <div className="font-body text-xs text-steel">{t("modals.sellFullAmountToLedger", { amount: pkr(saleTotal) })}</div>
                  )
                )}
              </div>

              {paymentNum > 0 && (
                <SettlementDestinationFields
                  grossAmount={paymentNum}
                  companies={companies}
                  accounts={accounts}
                  expenseCategories={expenseCategories}
                  homeExpenseAmount={homeExpenseAmount}
                  onHomeExpenseAmountChange={setHomeExpenseAmount}
                  homeExpenseCatId={homeExpenseCatId}
                  onHomeExpenseCatIdChange={setHomeExpenseCatId}
                  homeExpenseLines={homeExpenseLines}
                  onHomeExpenseLinesChange={setHomeExpenseLines}
                  onExpenseCategoriesChange={setExpenseCategories}
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
              )}
            </>
          ) : mode === "transfer" ? (
            <Field label={t("modals.transferToCustomerB")}>
              <div className="relative">
                <input
                  value={toCustomer ? `${toCustomer.name} · ${toCustomer.display_id}` : toCustomerSearch}
                  onChange={(e) => {
                    setToCustomerId("");
                    setToCustomerSearch(e.target.value);
                  }}
                  placeholder={t("modals.searchCustomerByNameOrId2")}
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
              <Field label={t("modals.cashValuePkr")}>
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

          <Field label={t("modals.notesOptional")}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>

          {error && <div className="text-xs text-brand-red font-medium">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-hairline bg-paper">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("unifiedSale.cancel")}
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? t("unifiedSale.saving") : t(isSell ? "modals.confirmSale" : "modals.confirmReturn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
