"use client";

import { useEffect, useState } from "react";
import {
  X,
  Check,
  ShoppingCart,
  CreditCard,
  Banknote,
  UserRound,
  FileText,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Field, inputClass, Button } from "./ui";
  import AmountInput from "./AmountInput";
  import SettlementDestinationFields, { SpecialAccount } from "./SettlementDestinationFields";
  import { HomeExpenseLine, homeExpenseLinesValid, toHomeExpenseLinesPayload } from "./HomeExpenseLinesEditor";
  import { api, apiErrorMessage } from "@/lib/api";
  import { useAuth } from "@/lib/auth";
  import { todayLocalInput, pkr } from "@/lib/format";

import type {
  Product,
  ShopSupplyCustomer,
  PaymentAccount,
  ShopProductStockSummary,
  Company,
  DestinationType,
  ExpenseCategory,
  Employee,
} from "@/lib/types";
import { isSalaryCategorySelected } from "./SettlementDestinationFields";

/**
 * Record Shop Sale
 *
 * Large, spacious form for recording a shop's retail sale with 3-way
 * settlement routing on collected funds.
 */
export default function RecordShopSaleModal({
  shopId,
  shopName,
  stockProducts,
  onClose,
  onSaved,
  onPartialSave,
}: {
  shopId: string;
  shopName: string;
  stockProducts: ShopProductStockSummary[];
  onClose: () => void;
  onSaved: () => void;
  onPartialSave?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Passed to every SettlementDestinationFields below (§ Shop Cash
  // destination) so its Account picker offers this shop's own Shop Cash
  // account as a 4th choice alongside Office Cash/Home Cash/Dowa Account.
  const shopContext = { id: shopId, name: shopName };

  // Payment Only mode (§ Payment Only, mirrors unified-sale/page.tsx's
  // formMode toggle exactly) — a supply customer paying the shop with
  // nothing collected in-person: no product/quantity, posts through
  // api.shops.customerPayments.create's settlement-routing path instead of
  // api.shops.createSale. The legacy plain-account customer-payment flow
  // (RecordSupplyCustomerPaymentModal) is a separate, untouched modal.
  const [formMode, setFormMode] = useState<"record_sale" | "payment_only">("record_sale");

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<ShopSupplyCustomer[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [liveStockProducts, setLiveStockProducts] = useState(stockProducts);
  useEffect(() => {
    api.shops.stock(shopId).then((s) => setLiveStockProducts(s.products));
  }, [shopId]);

  const [productId, setProductId] = useState("");
  const [date, setDate] = useState(todayLocalInput());

  const [unit, setUnit] = useState<"cylinder" | "kg">("cylinder");
  const [quantity, setQuantity] = useState("");

  // § Board Rate manual entry — required, never pre-filled/defaulted from
  // any resolved system-wide rate (see routers/shops.py::_apply_shop_sale,
  // which no longer calls resolve_board_rate at all). The user types this
  // fresh every time a sale is recorded.
  const [boardRatePerKg, setBoardRatePerKg] = useState("");

  // § Selling Price override — optional; when filled, replaces the FINAL
  // TOTAL AMOUNT outright (post board-rate calculation) — never a
  // per-cylinder rate the user has to reverse-engineer. Never pre-filled;
  // the live board-rate-computed total is shown as the field's placeholder
  // (see the "leave blank to use..." hint) so the user always sees what
  // they're overriding without the field itself holding that value.
  const [manualTotalAmount, setManualTotalAmount] = useState("");

  // § GST on Shop Sale — optional, default off, same convention as Unified
  // Sale's own gstEnabled/gstRate.
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstRate, setGstRate] = useState("");
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountRate, setDiscountRate] = useState("");

  const [paymentType, setPaymentType] = useState<"cash" | "credit">("cash");
  const [supplyCustomerId, setSupplyCustomerId] = useState("");

  // Also doubles as the Payment Only amount field (§5 — removing the old
  // "Received payment now" checkbox: it was functionally redundant, since
  // an omitted/blank amount and an explicit 0 are backend-identical either
  // way — a credit sale's settlement section is now always visible,
  // defaulting to 0/fully-credit when left untouched).
  const [amountReceived, setAmountReceived] = useState("");

  // Settlement routing state — Home Expense is category-based (§ Home
  // Expense category reversion), same ExpenseCategory list the main
  // Expenses page uses, including the system "Salary" category (which
  // requires picking an Employee — § Employee Salary Tracking).
  // § Payment Only mode — still the legacy single-amount shape: that path
  // posts through api.shops.customerPayments.create (a ShopCustomerPayment,
  // not a ShopSale), which was never extended to support multi-line Home
  // Expense (§ Multi-line Categorized Home Expense is Shop-Sale-scoped only).
  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseCategoryId, setHomeExpenseCategoryId] = useState("");
  const [homeExpenseEmployeeId, setHomeExpenseEmployeeId] = useState("");
  // § Multi-line Categorized Home Expense — Record Sale mode only (both
  // the Walk-in and Named-Customer settlement sections below share this
  // one array, exactly like they already shared homeExpenseAmount above).
  const [homeExpenseLines, setHomeExpenseLines] = useState<HomeExpenseLine[]>([]);
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");
  const [destinationType, setDestinationType] = useState<DestinationType>("account");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [specialAccount, setSpecialAccount] = useState<SpecialAccount>("office_cash");
  const [accountId, setAccountId] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* -------------------------------------------------------------
     LOAD DATA
  ------------------------------------------------------------- */

  useEffect(() => {
    api.products.list().then((p) => {
      setProducts(p.filter((x) => x.active === "active"));
    });
  }, []);

  useEffect(() => {
    api.shops.customers.list(shopId).then(setCustomers);
  }, [shopId]);

  useEffect(() => {
    api.paymentAccounts.list().then((a) => {
      setAccounts(a.filter((x) => x.active === "active"));
    });
  }, []);

  useEffect(() => {
    api.companies.list().then((c) => {
      // Filter by status if present, otherwise set list directly
      setCompanies(c.filter((x: any) => x.status ? x.status === "active" : true));
    });
  }, []);

  useEffect(() => {
    api.expenseCategories.list().then((c) => setExpenseCategories(c.filter((x) => x.active === "active" || x.is_system)));
  }, []);

  useEffect(() => {
    api.employees.list().then(setEmployees);
  }, []);

  /* -------------------------------------------------------------
     SELECTED PRODUCT & PRICE CALCULATION
  ------------------------------------------------------------- */

  const selectedProduct = products.find((p) => p.id === productId);
  const priceRow = liveStockProducts.find((p) => p.product_id === productId);

  const qty = parseFloat(quantity);
  const typedBoardRate = parseFloat(boardRatePerKg);
  const typedManualTotal = parseFloat(manualTotalAmount);
  const hasManualOverride = !isNaN(typedManualTotal) && typedManualTotal > 0;

  // § Board Rate manual entry — priceRow is read here ONLY for saleable_kg
  // (a product-weight fact, unaffected by this change — still comes from
  // _compute_stock_summary's own untouched resolve_board_rate call);
  // priceRow.sale_rate_per_cylinder/board_rate_per_kg (the auto-resolved
  // reference rate) are deliberately never used to price this sale.
  const saleableKg = priceRow ? parseFloat(priceRow.saleable_kg) : null;
  const cylindersEquivalent = unit === "kg" && saleableKg ? qty / saleableKg : qty;

  // perUnitRate/saleRatePerCylinder are ALWAYS board-rate-derived — the
  // audit trail of what the board-rate math would have produced. Mirrors
  // routers/shops.py::_apply_shop_sale exactly: the § Selling Price
  // override below replaces the final TOTAL AMOUNT outright, never this
  // per-cylinder figure.
  const perUnitRate =
    saleableKg != null && !isNaN(typedBoardRate) && typedBoardRate > 0
      ? unit === "kg"
        ? typedBoardRate // Rs/kg, shown directly
        : typedBoardRate * saleableKg // Rs/cylinder
      : null;

  const saleRatePerCylinder =
    saleableKg != null && !isNaN(typedBoardRate) && typedBoardRate > 0
      ? typedBoardRate * saleableKg
      : null;

  const boardRateComputedAmount =
    saleRatePerCylinder != null && qty > 0 ? cylindersEquivalent * saleRatePerCylinder : null;

  // § Selling Price override — replaces the final total outright when
  // present (never the per-cylinder rate above), same as
  // routers/shops.py::_apply_shop_sale's manual_total_amount handling.
  const saleAmount = hasManualOverride ? typedManualTotal : boardRateComputedAmount;

  // § GST on Shop Sale — saleAmount stays GST-exclusive (matches
  // total_amount server-side); grandTotal is what's actually owed/
  // collected from here on, mirroring unified-sale/page.tsx exactly.
  // Discount (optional) applies FIRST — GST then runs on the discounted
  // base. saleAmount (raw) stays what the backend keeps as total_amount.
  const effectiveDiscountRate = discountEnabled ? parseFloat(discountRate) || 0 : 0;
  const discountAmount = saleAmount != null && effectiveDiscountRate > 0 ? (saleAmount * effectiveDiscountRate) / 100 : 0;
  const discountedBase = saleAmount != null ? saleAmount - discountAmount : null;
  const effectiveGstRate = gstEnabled ? parseFloat(gstRate) || 0 : 0;
  const gstAmount = discountedBase != null && effectiveGstRate > 0 ? (discountedBase * effectiveGstRate) / 100 : 0;
  const grandTotal = discountedBase != null ? discountedBase + gstAmount : null;

  // Amount Received is only ever editable once a real Supply Customer is
  // named — Walk-in (no customer) always collects the full amount, on
  // either payment type, since there's no one to owe the rest to. Once a
  // customer is named, partial payment is allowed under EITHER "cash" or
  // "credit" (§ Amount Received visible for any named customer) — the
  // effect below prefills/resets amountReceived on mode changes so an
  // untouched field still defaults to the pre-existing behavior (full for
  // cash, blank/fully-credit for credit).
  useEffect(() => {
    if (formMode !== "record_sale") return;
    if (!supplyCustomerId) {
      setAmountReceived("");
      return;
    }
    setAmountReceived(paymentType === "cash" && grandTotal != null ? String(grandTotal) : "");
    // Only reset on an actual mode switch (customer or payment type
    // changing) — never on saleAmount/grandTotal changing, which would
    // otherwise wipe out a manually-typed partial amount every time
    // quantity is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyCustomerId, paymentType, formMode]);

  // Effective amount collected now (for Walk-in, it equals the GST-
  // inclusive grandTotal — there's no one to owe the rest to, on either
  // payment type; for Payment Only, amountReceived IS the whole
  // transaction, not a partial-payment-against-a-sale amount). A blank/0
  // amountReceived when a customer IS named simply means "fully unpaid" —
  // no separate checkbox needed to distinguish that from "not collecting
  // anything" (§5).
  const effectiveCollectedAmount =
    formMode === "payment_only"
      ? parseFloat(amountReceived) || 0
      : !supplyCustomerId
      ? grandTotal || 0
      : parseFloat(amountReceived) || 0;

  const balanceDue =
    formMode === "record_sale" && grandTotal != null && !!supplyCustomerId
      ? grandTotal - effectiveCollectedAmount
      : null;

  /* -------------------------------------------------------------
     HELPER: RESOLVE ACCOUNT ID/LABEL
  ------------------------------------------------------------- */

  const resolveAccountId = (): string | undefined => {
    if (destinationType !== "account") return undefined;
    if (specialAccount === "bank") return accountId || undefined;
    return specialAccount; // "office_cash", "owner_home", "dowa_account"
  };

  /* -------------------------------------------------------------
     VALIDATION
  ------------------------------------------------------------- */

  const homeExpenseNeedsEmployee =
    parseFloat(homeExpenseAmount) > 0 &&
    isSalaryCategorySelected(expenseCategories, homeExpenseCategoryId) &&
    !homeExpenseEmployeeId;

  // § Multi-line Categorized Home Expense — Record Sale mode's own
  // validation (an unfilled/blank line never blocks submission, same
  // convention homeExpenseNeedsEmployee above already follows for the
  // Payment Only path).
  const homeExpenseLinesInvalid = !homeExpenseLinesValid(homeExpenseLines, expenseCategories);

  const canSubmit =
    (formMode === "payment_only" ? !homeExpenseNeedsEmployee : !homeExpenseLinesInvalid) &&
    (formMode === "payment_only"
      ? !!supplyCustomerId && !!date && parseFloat(amountReceived) > 0
      : !!productId &&
        !!date &&
        parseFloat(quantity) > 0 &&
        // § Board Rate manual entry — required for a Record Sale (never
        // for Payment Only, which has no product/pricing at all).
        typedBoardRate > 0 &&
        // § GST on Shop Sale — a checked box needs an actual rate.
        (!gstEnabled || parseFloat(gstRate) > 0) &&
        (!discountEnabled || (parseFloat(discountRate) > 0 && parseFloat(discountRate) <= 100)) &&
        (paymentType === "cash" || !!supplyCustomerId));

  /* -------------------------------------------------------------
     SUBMIT
  ------------------------------------------------------------- */

  const submit = async () => {
    if (!canSubmit || !user) return;

    setSaving(true);
    setError(null);
    let saleSaved = false;

    try {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");

      const isoDate = new Date(`${date}T${hh}:${mm}:${ss}`).toISOString();

      if (formMode === "payment_only") {
        const payload: any = {
          date: isoDate,
          supply_customer_id: supplyCustomerId,
          amount: parseFloat(amountReceived),
          method: "cash",
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
        await api.shops.customerPayments.create(shopId, supplyCustomerId, payload);
        onSaved();
        return;
      }

      const payload: any = {
        date: isoDate,
        product_id: productId,
        quantity: parseFloat(quantity),
        unit,
        board_rate_per_kg: typedBoardRate,
        manual_total_amount: hasManualOverride ? typedManualTotal : undefined,
        discount_enabled: discountEnabled,
        discount_rate: discountEnabled ? effectiveDiscountRate : undefined,
        gst_enabled: gstEnabled,
        gst_rate: gstEnabled ? effectiveGstRate : undefined,
        payment_type: paymentType,
        supply_customer_id: supplyCustomerId || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      };

      // Sent whenever a real customer is named, on EITHER payment type —
      // the backend now honors a partial amount under "cash" too (§ Amount
      // Received visible for any named customer), not just "credit". Omitted
      // for Walk-in: the backend force-sets amount_received to the full
      // total server-side regardless, since there's no one to owe the rest.
      if (supplyCustomerId) {
        payload.amount_received = parseFloat(amountReceived) || 0;
      }

      // Include settlement fields if funds are collected
      if (effectiveCollectedAmount > 0) {
        payload.destination_type = destinationType;
        // § Multi-line Categorized Home Expense — replaces the legacy
        // single-amount fields entirely for Shop Sale (never sent
        // alongside home_expense_lines; the backend ignores those scalars
        // whenever this list is non-empty anyway — see _apply_shop_sale).
        payload.home_expense_lines = toHomeExpenseLinesPayload(homeExpenseLines);
        payload.owner_drawings_amount = parseFloat(ownerDrawingsAmount) || 0;

        if (destinationType === "plant") {
          payload.target_plant_id = targetPlantId || undefined;
        } else {
          payload.account_id = resolveAccountId();
        }
      }

      const createdSale = await api.shops.createSale(shopId, payload);
      saleSaved = true;

      onSaved();
    } catch (e: any) {
      if (saleSaved) {
        setError(
          t("modals.saleSavedExpenseFailed", {
            error: apiErrorMessage(e, "unknown error"),
          })
        );
        onPartialSave?.();
      } else {
        // Check the REAL backend rejection reason first (Insufficient
        // stock, amount_received exceeds total) — apiErrorMessage extracts
        // FastAPI's `detail` out of the fetch error — and only fall back to
        // that same helper's output for anything else, so the user never
        // sees a generic "check the fields" string when the server told us
        // exactly what went wrong.
        const msg = apiErrorMessage(e, "");
        setError(
          msg.includes("Insufficient")
            ? t("modals.notEnoughStock")
            : msg.includes("amount_received") || msg.includes("exceeds")
            ? t("modals.amountReceivedExceedsSaleTotal")
            : apiErrorMessage(e, t("modals.couldNotSaveSaleGeneric"))
        );
      }
    } finally {
      setSaving(false);
    }
  };

  /* -------------------------------------------------------------
     UI
  ------------------------------------------------------------- */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,33,56,0.58)] p-4 sm:p-6">
      <div className="flex w-full max-w-4xl max-h-[94vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5 sm:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
              <ShoppingCart size={20} />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-ink">
                {formMode === "payment_only" ? t("unifiedSale.modePaymentOnly") : t("modals.recordShopSaleTitle")}
              </h2>
              <p className="mt-1 font-body text-xs text-slate-500">
                {formMode === "payment_only" ? t("unifiedSale.paymentOnlyCaption") : t("modals.recordShopSaleCaption")}
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
          <div className="space-y-8">
            {/* MODE SWITCH — same pattern as unified-sale/page.tsx's Full
                Sale / Payment Only toggle. */}
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setFormMode("record_sale")}
                className={`rounded-md py-2 font-body text-[13px] font-semibold transition-colors ${
                  formMode === "record_sale" ? "bg-teal text-white" : "text-slate-500 hover:bg-white"
                }`}
              >
                {t("modals.recordShopSaleTitle")}
              </button>
              <button
                type="button"
                onClick={() => setFormMode("payment_only")}
                className={`rounded-md py-2 font-body text-[13px] font-semibold transition-colors ${
                  formMode === "payment_only" ? "bg-teal text-white" : "text-slate-500 hover:bg-white"
                }`}
              >
                {t("unifiedSale.modePaymentOnly")}
              </button>
            </div>

            {/* PAYMENT ONLY — a supply customer paying with nothing
                collected in-person: no product/quantity, Supply Customer is
                required (not optional, unlike the credit-sale field below). */}
            {formMode === "payment_only" && (
              <section>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <Field label={t("modals.selectCustomerGeneric")}>
                    <select
                      value={supplyCustomerId}
                      onChange={(e) => setSupplyCustomerId(e.target.value)}
                      className={`${inputClass} h-12`}
                    >
                      <option value="">{t("modals.selectCustomerGeneric")}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t("modals.saleDateLabel")}>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={`${inputClass} h-12`}
                    />
                  </Field>
                </div>

                <div className="mt-5">
                  <Field label={t("modals.amountReceivedLabel")}>
                    <AmountInput
                      value={amountReceived}
                      onChange={setAmountReceived}
                      placeholder={t("modals.amountReceivedPlaceholder")}
                      className={`${inputClass} h-12`}
                    />
                  </Field>
                </div>

                {effectiveCollectedAmount > 0 && (
                  <div className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
                    <SettlementDestinationFields
                      grossAmount={effectiveCollectedAmount}
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
              </section>
            )}

            {/* SALE DETAILS */}
            {formMode === "record_sale" && (
            <>
            <section>
              <div className="mb-5">
                <h3 className="font-display text-base font-bold text-slate-800">
                  {t("modals.saleDetails")}
                </h3>
                <p className="mt-1 font-body text-xs text-slate-500">
                  {t("modals.saleDetailsCaption")}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label={t("unifiedSale.colProduct")}>
                  <select
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className={`${inputClass} h-12`}
                  >
                    <option value="">{t("modals.selectProduct")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("modals.saleDateLabel")}>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${inputClass} h-12`}
                  />
                </Field>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label={t("modals.unitLabel")}>
                  <select
                    value={unit}
                    onChange={(e) =>
                      setUnit(e.target.value as "cylinder" | "kg")
                    }
                    className={`${inputClass} h-12`}
                  >
                    <option value="cylinder">
                      {t("modals.fullCylinders")}
                    </option>
                    <option value="kg">{t("modals.kgUnit")}</option>
                  </select>
                </Field>

                <Field
                  label={
                    unit === "kg"
                      ? t("modals.quantityKg")
                      : t("modals.quantityCylindersLabelCap")
                  }
                >
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder={
                      unit === "kg"
                        ? t("modals.enterKilograms")
                        : t("modals.enterNumberOfCylinders")
                    }
                    className={`${inputClass} h-12`}
                  />
                </Field>
              </div>

              {/* § Board Rate manual entry — required, no pre-fill/default
                  (never resolved from any system-wide rate — see
                  routers/shops.py::_apply_shop_sale). The user types this
                  fresh on every sale. */}
              <div className="mt-5">
                <Field label={t("modals.boardRatePerKgLabel")}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={boardRatePerKg}
                    onChange={(e) => setBoardRatePerKg(e.target.value)}
                    placeholder={t("modals.boardRatePerKgPlaceholder")}
                    className={`${inputClass} h-12`}
                  />
                </Field>
                <p className="mt-1.5 font-body text-[11px] text-slate-500">
                  {t("modals.boardRatePerKgRequiredHint")}
                </p>
              </div>

              {/* Discount — optional, applied to this sale's total_amount
                  BEFORE GST (GST is then computed on the discounted base);
                  frozen server-side at creation. */}
              <div className="mt-5 border-t border-slate-200 pt-5">
                <Field label={t("unifiedSale.discountSectionTitle")}>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 font-body text-[13px] text-ink cursor-pointer">
                      <input type="checkbox" checked={discountEnabled} onChange={(e) => setDiscountEnabled(e.target.checked)} />
                      {t("unifiedSale.applyDiscount")}
                    </label>
                    {discountEnabled && (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={discountRate}
                        onChange={(e) => setDiscountRate(e.target.value)}
                        placeholder="Rate %"
                        className={`${inputClass} w-24`}
                      />
                    )}
                  </div>
                </Field>
              </div>

              {/* § GST on Shop Sale — optional, applies to this sale's
                  discounted base (or total_amount when no discount); frozen
                  server-side at creation, same convention as Unified
                  Sale's own GST section. */}
              <div className="mt-5 border-t border-slate-200 pt-5">
                <Field label={t("unifiedSale.gstSectionTitle")}>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 font-body text-[13px] text-ink cursor-pointer">
                      <input type="checkbox" checked={gstEnabled} onChange={(e) => setGstEnabled(e.target.checked)} />
                      {t("unifiedSale.applyGst")}
                    </label>
                    {gstEnabled && (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={gstRate}
                        onChange={(e) => setGstRate(e.target.value)}
                        placeholder="Rate %"
                        className={`${inputClass} w-24`}
                      />
                    )}
                  </div>
                </Field>
              </div>
            </section>

            {/* SALE AMOUNT PROMINENT DISPLAY */}
            {productId && (
              <section className="overflow-hidden rounded-2xl border border-teal/20 bg-teal/5">
                <div className="flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-teal">
                      {t("modals.saleAmountLabel")}
                    </p>
                    <p className="mt-1.5 font-display text-lg font-bold text-slate-800">
                      {selectedProduct?.name ||
                        t("modals.selectedProductFallback")}
                    </p>
                    {qty > 0 && (
                      <p className="mt-1.5 font-body text-sm text-slate-500">
                        {qty}{" "}
                        {unit === "kg"
                          ? t("modals.kgUnit")
                          : t("modals.cylinderOrMore")}
                        {perUnitRate != null && <> × {pkr(perUnitRate)}</>}
                        {boardRateComputedAmount != null && <> = {pkr(boardRateComputedAmount)}</>}
                      </p>
                    )}
                  </div>

                  <div className="sm:text-right">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      {(gstEnabled && effectiveGstRate > 0) || (discountEnabled && effectiveDiscountRate > 0) ? t("unifiedSale.grandTotal") : t("modals.totalLabel")}
                    </p>
                    <p className="mt-1 font-display text-3xl font-bold text-brand-green sm:text-4xl">
                      {grandTotal != null ? pkr(grandTotal) : "—"}
                    </p>
                    {((gstEnabled && effectiveGstRate > 0) || (discountEnabled && effectiveDiscountRate > 0)) && saleAmount != null && (
                      <div className="mt-1 flex flex-col items-end gap-0.5 font-mono text-[11px] text-slate-500">
                        <span>{t("unifiedSale.subtotal")} {pkr(saleAmount)}</span>
                        {discountEnabled && effectiveDiscountRate > 0 && (
                          <span>{t("unifiedSale.discount")} @ {discountRate}% (−) −{pkr(discountAmount)}</span>
                        )}
                        {discountEnabled && effectiveDiscountRate > 0 && gstEnabled && effectiveGstRate > 0 && discountedBase != null && (
                          <span>{t("unifiedSale.discountedSubtotal")} {pkr(discountedBase)}</span>
                        )}
                        {gstEnabled && effectiveGstRate > 0 && (
                          <span>GST @ {gstRate}% (+) {pkr(gstAmount)}</span>
                        )}
                      </div>
                    )}
                    {hasManualOverride && (
                      <p className="mt-1 font-mono text-[11px] text-amber-600">
                        {t("modals.manualRateOverrideBadge")}
                      </p>
                    )}
                  </div>
                </div>

                {/* § Selling Price override — optional, replaces the final
                    total amount outright (never the per-cylinder rate
                    above). Never pre-filled; the board-rate-computed
                    amount is shown as the placeholder so the user always
                    sees what they're overriding without it being typed in
                    for them. */}
                <div className="border-t border-teal/20 px-6 py-5">
                  <Field label={t("modals.manualTotalAmountLabel")}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={manualTotalAmount}
                      onChange={(e) => setManualTotalAmount(e.target.value)}
                      placeholder={
                        boardRateComputedAmount != null
                          ? t("modals.manualTotalAmountPlaceholderWithDefault", { amount: pkr(boardRateComputedAmount) })
                          : t("modals.manualTotalAmountPlaceholder")
                      }
                      className={`${inputClass} h-12`}
                    />
                  </Field>
                  <p className="mt-1.5 font-body text-[11px] text-slate-500">
                    {t("modals.manualTotalAmountHint")}
                  </p>
                </div>
              </section>
            )}

            {/* PAYMENT METHOD */}
            <section>
              <div className="mb-5">
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-800">
                  <CreditCard size={17} className="text-teal" />
                  {t("modals.paymentWord")}
                </h3>
                <p className="mt-1 font-body text-xs text-slate-500">
                  {t("modals.paymentSectionCaption")}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label={t("modals.paymentTypeLabel")}>
                  <select
                    value={paymentType}
                    onChange={(e) =>
                      setPaymentType(e.target.value as "cash" | "credit")
                    }
                    className={`${inputClass} h-12`}
                  >
                    <option value="cash">{t("unifiedSale.methodCash")}</option>
                    <option value="credit">{t("modals.creditOption")}</option>
                  </select>
                </Field>

                <Field
                  label={
                    paymentType === "credit"
                      ? t("modals.supplyCustomer")
                      : t("modals.supplyCustomerOptional")
                  }
                >
                  <select
                    value={supplyCustomerId}
                    onChange={(e) => setSupplyCustomerId(e.target.value)}
                    className={`${inputClass} h-12`}
                  >
                    <option value="">
                      {paymentType === "credit"
                        ? t("modals.selectCustomerGeneric")
                        : t("modals.walkInPublic")}
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            {/* WALK-IN SETTLEMENT ROUTING — no customer named, so the full
                amount is always collected on either payment type (a "credit"
                walk-in is blocked by canSubmit/backend validation anyway). */}
            {!supplyCustomerId && effectiveCollectedAmount > 0 && (
              <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
                <SettlementDestinationFields
                  grossAmount={effectiveCollectedAmount}
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
              </section>
            )}

            {/* NAMED-CUSTOMER SETTLEMENT — Amount Received is editable for
                any real Supply Customer, on either payment type (§ Amount
                Received visible for any named customer), so partial payment
                is allowed under "cash" exactly like it already is under
                "credit". */}
            {!!supplyCustomerId && (
              <section className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-100 px-6 py-5">
                  <div className="flex items-center gap-2">
                    <Banknote size={17} className="text-teal" />
                    <h3 className="font-display text-base font-bold text-slate-800">
                      {t("modals.paymentReceivedNow")}
                    </h3>
                  </div>
                  <p className="mt-1 font-body text-xs text-slate-500">
                    {t("modals.paymentReceivedNowCaption")}
                  </p>
                </div>

                <div className="space-y-5 p-6">
                  {/* Amount + settlement always visible now (§5) — a blank/0
                      amount here simply means "fully credit," same
                      information "amount > 0" already carried on its own;
                      the old checkbox only gated whether this field showed
                      at all, which added a state (checked-but-blank) that
                      behaved identically to unchecked on the backend. */}
                  <Field label={t("modals.amountReceivedLabel")}>
                    <AmountInput
                      value={amountReceived}
                      onChange={setAmountReceived}
                      placeholder={t("modals.amountReceivedPlaceholder")}
                      className={`${inputClass} h-12`}
                    />
                  </Field>

                  {effectiveCollectedAmount > 0 && (
                    <SettlementDestinationFields
                      grossAmount={effectiveCollectedAmount}
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

                  {balanceDue != null && (
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                      <div>
                        <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                          {t("modals.remainingBalance")}
                        </p>
                        <p className="mt-1 font-body text-sm font-medium text-slate-600">
                          {balanceDue < 0 ? t("modals.advanceCreditNote") : t("modals.outstandingAfterPayment")}
                        </p>
                      </div>
                      <span
                        className={`font-mono text-lg font-bold ${
                          balanceDue > 0 ? "text-brand-red" : "text-brand-green"
                        }`}
                      >
                        {pkr(balanceDue)}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}
            </>
            )}

            {/* NOTES */}
            <section>
              <div className="mb-5">
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-800">
                  <FileText size={17} className="text-teal" />
                  {t("modals.additionalInformation")}
                </h3>
              </div>
              <Field label={t("modals.notesOptional")}>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("modals.notesPlaceholderSale")}
                  rows={4}
                  className={`${inputClass} min-h-[110px] resize-y py-3`}
                />
              </Field>
            </section>

            {/* OUTSTANDING BALANCE INFO BANNER — keyed off an actual
                remaining balance, not paymentType, so a partially-paid
                "cash" sale gets the same explanation a "credit" sale does
                (matches the backend's outstanding > 0 convention above). */}
            {formMode === "record_sale" && balanceDue != null && balanceDue > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-5 py-4">
                <UserRound size={17} className="mt-0.5 shrink-0 text-blue-600" />
                <p className="font-body text-xs leading-relaxed text-blue-800">
                  {t("modals.creditSaleInfo")}
                </p>
              </div>
            )}

            {/* ERROR DISPLAY */}
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
            {formMode === "payment_only" ? (
              parseFloat(amountReceived) > 0 ? (
                <>
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                    {t("modals.amountReceivedLabel")}
                  </p>
                  <p className="mt-0.5 font-display text-lg font-bold text-slate-800">
                    {pkr(parseFloat(amountReceived))}
                  </p>
                </>
              ) : (
                <p className="font-body text-xs text-slate-500">
                  {t("modals.completeSaleDetailsToContinue")}
                </p>
              )
            ) : grandTotal != null ? (
              <>
                <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  {t("modals.saleTotal")}
                </p>
                <p className="mt-0.5 font-display text-lg font-bold text-slate-800">
                  {pkr(grandTotal)}
                </p>
              </>
            ) : (
              <p className="font-body text-xs text-slate-500">
                {t("modals.completeSaleDetailsToContinue")}
              </p>
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

            <Button
              variant="primary"
              onClick={submit}
              disabled={!canSubmit || saving}
            >
              <Check size={15} />
              {saving
                ? t("unifiedSale.saving")
                : formMode === "payment_only" ? t("modals.savePayment") : t("modals.saveSale")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}