"use client";
import { useEffect, useState } from "react";
import { X, Check, Building2, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "./ui";
import { api, apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toKarachiDateString, pkr } from "@/lib/format";
import type { PaymentAccount, Sale, Payment, Purchase, CompanyPayment, ShopSale, ShopSupplyCustomer, ShopListRow, Company, ExpenseCategory, DestinationType, AccountType } from "@/lib/types";

export type CorrectableKind = "sale" | "payment" | "purchase" | "companyPayment" | "shopSale";

/** Ledger Correction (§1) — one generic modal for the 4 correctable
 * transaction types. Pre-filled with the transaction's own current field
 * values (never blank), requires a reason, then calls the matching
 * api.*.correct(id, {...values, correction_reason, corrected_by: user.name})
 * — the backend reverses the original, marks it "corrected" (kept forever
 * in history), and posts a brand-new replacement row. */
export default function CorrectTransactionModal({
  kind,
  transaction,
  onClose,
  onSaved,
}: {
  kind: CorrectableKind;
  transaction: Sale | Payment | Purchase | CompanyPayment | ShopSale;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [date, setDate] = useState(toKarachiDateString(transaction.date));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // § Bug Fix — Correction Modal Routing. A "payment" transaction is one of
  // three shapes: a plain quick-pay row (destination_type/unified_sale_id
  // both null — the original, unchanged form below), a Payment Receipt-
  // sourced row (destination_type set directly on it — its own amount is
  // still correctable), or a Unified-Sale-originated audit-trail row
  // (unified_sale_id set; its amount is fixed by the sale side — only WHERE
  // the money went is correctable here, via the parent batch's settlement).
  //
  // unified_sale_id, never destination_type, is what tells these apart —
  // routers/payments.py._attach_destination_info deliberately COPIES the
  // parent batch's destination_type onto a Unified-Sale row's `transaction`
  // here (purely so this form can pre-fill routing/account fields below),
  // which means destination_type is NEVER actually null on one of these by
  // the time it reaches this modal. Checking `destination_type == null` for
  // isUnifiedSaleSourced (as this used to) was therefore always false —
  // every such payment fell through to isReceiptSourced instead, submitting
  // through api.paymentReceipts.correct with method pre-filled as the
  // invalid value "unified_sale_credit", which the backend correctly
  // rejected (422) while this form's generic catch (see handleSubmit)
  // silently swallowed the real reason.
  const isUnifiedSaleSourced = kind === "payment" && !!(transaction as Payment).unified_sale_id;
  const isReceiptSourced =
    kind === "payment" && !isUnifiedSaleSourced && (transaction as Payment).destination_type != null;
  const showRouting = isReceiptSourced || isUnifiedSaleSourced;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);

  useEffect(() => {
    if (kind === "payment" || kind === "companyPayment" || kind === "shopSale") {
      api.paymentAccounts.list().then(setAccounts);
    }
    if (showRouting) {
      api.companies.list().then(setCompanies);
      // § Employee Salary Tracking — excluded here for the same reason as
      // PaymentReceiptModal/ReturnCylinderModal: this correction flow's
      // routingFields has no Employee picker, so Salary (which requires
      // one) would be selectable-but-broken if left in.
      api.expenseCategories.list().then((c) => setExpenseCategories(c.filter((x) => !(x.is_system && x.name === "Salary"))));
    }
    if (kind === "shopSale") {
      api.shops.customers.list((transaction as ShopSale).customer_id).then(setSupplyCustomers);
    }
    // Emergency Transfer (§ Shop — Emergency Transfer) — only a Sale that
    // was already an emergency transfer gets the shop selector; a normal
    // Sale's correction form never offers to turn it into one.
    if (kind === "sale" && (transaction as Sale).emergency_transfer_shop_id) {
      api.shops.list().then(setShops);
    }
  }, [kind]);
  const [supplyCustomers, setSupplyCustomers] = useState<ShopSupplyCustomer[]>([]);
  const [shops, setShops] = useState<ShopListRow[]>([]);
  const [emergencyTransferShopId, setEmergencyTransferShopId] = useState(
    kind === "sale" ? (transaction as Sale).emergency_transfer_shop_id || "" : ""
  );

  // Sale fields
  const sale = transaction as Sale;
  const shopSale = transaction as ShopSale;
  const [quantity, setQuantity] = useState(
    kind === "sale" ? sale.quantity
    : kind === "purchase" ? (transaction as Purchase).quantity
    // ShopSale.quantity is always the cylinder-equivalent internally (see
    // models.ShopSale) — for a unit="kg" sale, pre-fill with quantity_kg
    // instead so the form shows what the user actually entered, not the
    // derived fraction.
    : kind === "shopSale" ? (shopSale.unit === "kg" ? shopSale.quantity_kg || shopSale.quantity : shopSale.quantity)
    : ""
  );
  const [ratePerCylinder, setRatePerCylinder] = useState(
    kind === "sale" ? sale.rate_per_cylinder || "" : kind === "purchase" ? (transaction as Purchase).rate_per_cylinder || "" : ""
  );
  // § Board Rate manual entry — pre-filled from the original sale's own
  // frozen rate (never auto-resolved — see routers/shops.py::
  // _apply_shop_sale), same "preserve unless deliberately changed"
  // convention as unit/paymentType/supplyCustomerId below.
  const [boardRatePerKg, setBoardRatePerKg] = useState(
    kind === "shopSale" ? shopSale.board_rate_per_kg_used || "" : ""
  );
  // § Selling Price override — pre-filled ONLY when the original sale
  // actually used one (manual_rate_override), same "preserve unless
  // deliberately changed" convention as boardRatePerKg above; a sale that
  // used plain Board Rate pricing starts blank here too. Pre-fills from
  // total_amount (GST-exclusive, what the override actually replaced) —
  // NOT sale_rate_per_cylinder, which stays board-rate-derived always.
  const [manualTotalAmount, setManualTotalAmount] = useState(
    kind === "shopSale" && shopSale.manual_rate_override ? shopSale.total_amount || "" : ""
  );
  const [cylindersReturned, setCylindersReturned] = useState("0");
  const [gatePassNo, setGatePassNo] = useState(
    kind === "sale" ? sale.gate_pass_no || "" : kind === "purchase" ? (transaction as Purchase).gate_pass_no || "" : ""
  );
  const [vehicleNo, setVehicleNo] = useState(
    kind === "sale" ? sale.vehicle_no || "" : kind === "purchase" ? (transaction as Purchase).vehicle_no || "" : ""
  );
  const [notes, setNotes] = useState((transaction as { notes?: string | null }).notes || "");
  // GST on Sale (optional, locked at entry — § GST on Sale) — pre-filled
  // from the original sale so a correction that doesn't touch GST reposts
  // the exact same gst_enabled/gst_rate, never silently dropping it.
  const [gstEnabled, setGstEnabled] = useState(
    kind === "sale" ? !!sale.gst_enabled : kind === "shopSale" ? !!shopSale.gst_enabled : false
  );
  const [gstRate, setGstRate] = useState(
    kind === "sale" ? String(sale.gst_rate || "") : kind === "shopSale" ? String(shopSale.gst_rate || "") : ""
  );

  // Shop Sale-only fields — a correction must preserve unit/payment_type/
  // supply_customer_id unless the user deliberately changes them; the
  // backend has no way to infer these, and silently defaulting to
  // cylinder/cash would corrupt a KG or credit sale on correction.
  const [unit, setUnit] = useState<"cylinder" | "kg">(kind === "shopSale" ? shopSale.unit : "cylinder");
  const [paymentType, setPaymentType] = useState<"cash" | "credit">(kind === "shopSale" ? shopSale.payment_type : "cash");
  const [supplyCustomerId, setSupplyCustomerId] = useState(kind === "shopSale" ? shopSale.supply_customer_id || "" : "");
  // Inline Settlement (§2) — preserve what was actually collected on the
  // original sale unless the user deliberately changes it; silently
  // defaulting to "fully credit" on every correction would wipe out a
  // partial/full payment that was recorded at creation.
  const [amountReceived, setAmountReceived] = useState(
    kind === "shopSale" && shopSale.payment_type === "credit" ? shopSale.amount_received || "0" : ""
  );
  const [destinationAccountId, setDestinationAccountId] = useState(
    kind === "shopSale" ? shopSale.destination_account_id || "" : ""
  );

  // Purchase-only charges
  const purchase = transaction as Purchase;
  const [additionalCharges, setAdditionalCharges] = useState(kind === "purchase" ? purchase.additional_charges : "0");
  const [transportCharges, setTransportCharges] = useState(kind === "purchase" ? purchase.transport_charges : "0");
  const [otherCharges, setOtherCharges] = useState(kind === "purchase" ? purchase.other_charges : "0");
  const [driverName, setDriverName] = useState(kind === "purchase" ? purchase.driver_name || "" : "");
  const [driverContact, setDriverContact] = useState(kind === "purchase" ? purchase.driver_contact || "" : "");

  // Payment / CompanyPayment fields
  const payment = transaction as Payment;
  const companyPayment = transaction as CompanyPayment;
  const [amount, setAmount] = useState(
    kind === "payment" ? payment.amount : kind === "companyPayment" ? companyPayment.amount : ""
  );
  const [method, setMethod] = useState(
    kind === "payment" ? payment.method : kind === "companyPayment" ? companyPayment.method : "cash"
  );
  const [accountId, setAccountId] = useState(
    kind === "payment" ? payment.account_id || "" : kind === "companyPayment" ? companyPayment.account_id || "" : ""
  );
  const [referenceNo, setReferenceNo] = useState(
    kind === "payment" ? payment.reference_no || "" : kind === "companyPayment" ? companyPayment.reference_no || "" : ""
  );
  // Shop Cash Money Routing (§3) — preserves which account the money came
  // FROM (a shop's own Shop Cash, or another chosen account) when
  // correcting a Payment. Optional/empty for an ordinary customer's payment.
  const [sourceAccountId, setSourceAccountId] = useState(kind === "payment" ? payment.source_account_id || "" : "");

  // Settlement routing (§ Bug Fix — Correction Modal Routing) — pre-filled
  // from the transaction's own (already-resolved, see showRouting above)
  // destination fields for both receipt- and Unified-Sale-sourced rows.
  // home_expense_category_id has no source field to pre-fill from (neither
  // PaymentOut nor PaymentReceiptOut exposes it) — starts blank and, same
  // as a brand-new entry, is required before submitting whenever
  // homeExpenseAmount > 0 (see canSubmit below).
  const [destinationType, setDestinationType] = useState<DestinationType>(
    showRouting ? (payment.destination_type as DestinationType) || "plant" : "plant"
  );
  const [targetPlantId, setTargetPlantId] = useState(showRouting ? payment.target_plant_id || "" : "");
  const [accountCategory, setAccountCategory] = useState<AccountType>(
    showRouting ? ((payment.account_category as AccountType) || "office_cash") : "office_cash"
  );
  const [homeExpenseAmount, setHomeExpenseAmount] = useState(showRouting ? payment.home_expense_amount || "0" : "0");
  const [homeExpenseCategoryId, setHomeExpenseCategoryId] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState(showRouting ? payment.owner_drawings_amount || "0" : "0");

  // § Amount Correction for Unified-Sale-Linked Payments — a separate,
  // independent action from the routing correction below (own reason,
  // own save, own error), not the shared reason/canSubmit/handleSubmit
  // every other kind uses. Two independent actions rather than one
  // combined submit specifically to avoid a partial-failure state where
  // one half saves and the other doesn't.
  const [amountCorrectionReason, setAmountCorrectionReason] = useState("");
  const [amountSaving, setAmountSaving] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [routingReason, setRoutingReason] = useState("");
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);

  const kindLabel = {
    sale: t("unifiedSale.colSale"),
    payment: t("customerLedger.colPayment"),
    purchase: t("purchases.colPurchase"),
    companyPayment: t("modals.plantPaymentSingular"),
    shopSale: t("shopDetail.shopSale"),
  }[kind];

  // § Bug Fix — Correction Modal Routing. Same shape as the Unified Sale
  // page's own settlement validity check (unifiedSale.settlementValid) —
  // the split can't exceed the amount, Home Expense needs a category the
  // moment it's non-zero, and "plant" needs an actual plant picked (no
  // "same as purchase plant" fallback here — a correction has no purchase
  // plant context to default to).
  const bypassSum = (parseFloat(homeExpenseAmount) || 0) + (parseFloat(ownerDrawingsAmount) || 0);
  const routingValid =
    bypassSum <= (parseFloat(amount) || 0) + 0.01 &&
    (parseFloat(homeExpenseAmount) <= 0 || !!homeExpenseCategoryId) &&
    (destinationType !== "plant" || !!targetPlantId);

  const canSubmit =
    reason.trim().length > 0 &&
    date &&
    (kind === "sale" || kind === "purchase"
      ? parseFloat(quantity) > 0 && parseFloat(ratePerCylinder) > 0
        // Once an emergency transfer, always needs a shop to draw from —
        // the correction form never lets this be cleared to empty.
        && (!sale.emergency_transfer_shop_id || !!emergencyTransferShopId)
        && (kind !== "sale" || !gstEnabled || parseFloat(gstRate) > 0)
      : kind === "shopSale"
      ? parseFloat(quantity) > 0 && parseFloat(boardRatePerKg) > 0 && (paymentType === "cash" || !!supplyCustomerId)
        && (paymentType === "cash" || (parseFloat(amountReceived) || 0) >= 0)
        && (!gstEnabled || parseFloat(gstRate) > 0)
      : parseFloat(amount) > 0) &&
    (showRouting
      ? routingValid
      : (kind !== "payment" && kind !== "companyPayment") || accountId || kind === "companyPayment");

  const buildIsoDate = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return new Date(`${date}T${hh}:${mm}:${ss}`).toISOString();
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    try {
      const isoDate = buildIsoDate();
      if (kind === "sale") {
        await api.sales.correct(sale.id, {
          date: isoDate,
          customer_id: sale.customer_id,
          product_id: sale.product_id,
          company_id: sale.company_id || undefined,
          quantity: parseFloat(quantity),
          rate_per_cylinder: parseFloat(ratePerCylinder),
          gate_pass_no: gatePassNo || undefined,
          vehicle_no: vehicleNo || undefined,
          notes: notes || undefined,
          entered_by: user.name,
          cylinders_returned: parseFloat(cylindersReturned) || 0,
          emergency_transfer_shop_id: emergencyTransferShopId || undefined,
          gst_enabled: gstEnabled,
          gst_rate: gstEnabled ? parseFloat(gstRate) : undefined,
          correction_reason: reason,
          corrected_by: user.name,
        });
      } else if (kind === "purchase") {
        await api.purchases.correct(purchase.id, {
          date: isoDate,
          company_id: purchase.company_id,
          product_id: purchase.product_id,
          quantity: parseFloat(quantity),
          rate_per_cylinder: parseFloat(ratePerCylinder),
          additional_charges: parseFloat(additionalCharges) || 0,
          transport_charges: parseFloat(transportCharges) || 0,
          other_charges: parseFloat(otherCharges) || 0,
          gate_pass_no: gatePassNo || undefined,
          vehicle_no: vehicleNo || undefined,
          driver_name: driverName || undefined,
          driver_contact: driverContact || undefined,
          notes: notes || undefined,
          entered_by: user.name,
          correction_reason: reason,
          corrected_by: user.name,
        });
      } else if (kind === "payment" && isReceiptSourced) {
        // § Bug Fix — Correction Modal Routing, Case 1.
        await api.paymentReceipts.correct(payment.id, {
          date: isoDate,
          customer_id: payment.customer_id,
          amount: parseFloat(amount),
          method: method as "cash" | "bank_transfer" | "cheque" | "online" | "other",
          home_expense_amount: parseFloat(homeExpenseAmount) || 0,
          home_expense_category_id: parseFloat(homeExpenseAmount) > 0 ? homeExpenseCategoryId || undefined : undefined,
          owner_drawings_amount: parseFloat(ownerDrawingsAmount) || 0,
          destination_type: destinationType,
          target_plant_id: destinationType === "plant" ? targetPlantId || undefined : undefined,
          account_id: destinationType === "account" ? accountCategory : undefined,
          reference_no: referenceNo || undefined,
          notes: notes || undefined,
          entered_by: user.name,
          correction_reason: reason,
          corrected_by: user.name,
        });
      } else if (kind === "payment") {
        await api.payments.correct(payment.id, {
          date: isoDate,
          customer_id: payment.customer_id,
          sale_id: payment.sale_id || undefined,
          amount: parseFloat(amount),
          method: method as "cash" | "bank_transfer" | "cheque" | "online" | "other",
          account_id: accountId,
          source_account_id: sourceAccountId || undefined,
          reference_no: referenceNo || undefined,
          notes: notes || undefined,
          entered_by: user.name,
          correction_reason: reason,
          corrected_by: user.name,
        });
      } else if (kind === "shopSale") {
        await api.shops.correctSale(shopSale.id, {
          date: isoDate,
          product_id: shopSale.product_id,
          quantity: parseFloat(quantity),
          unit,
          board_rate_per_kg: parseFloat(boardRatePerKg),
          manual_total_amount: parseFloat(manualTotalAmount) > 0 ? parseFloat(manualTotalAmount) : undefined,
          gst_enabled: gstEnabled,
          gst_rate: gstEnabled ? parseFloat(gstRate) : undefined,
          payment_type: paymentType,
          supply_customer_id: supplyCustomerId || undefined,
          amount_received: paymentType === "credit" ? parseFloat(amountReceived) || 0 : undefined,
          destination_account_id: destinationAccountId || undefined,
          notes: notes || undefined,
          entered_by: user.name,
          correction_reason: reason,
          corrected_by: user.name,
        });
      } else {
        await api.companyPayments.correct(companyPayment.id, {
          date: isoDate,
          company_id: companyPayment.company_id,
          purchase_id: companyPayment.purchase_id || undefined,
          amount: parseFloat(amount),
          method: method as "cash" | "bank_transfer" | "cheque" | "online" | "other" | "direct_settlement",
          account_id: accountId || undefined,
          reference_no: referenceNo || undefined,
          notes: notes || undefined,
          entered_by: user.name,
          correction_reason: reason,
          corrected_by: user.name,
        });
      }
      onSaved();
    } catch (e) {
      setError(apiErrorMessage(e, t("modals.couldNotSaveCorrection")));
    } finally {
      setSaving(false);
    }
  };

  // § Amount Correction for Unified-Sale-Linked Payments — independent
  // of handleSubmit above (which still owns the routing-only save for
  // isReceiptSourced/plain payments); see api.unifiedSale.correctAmount.
  const amountCorrectionValid = parseFloat(amount) > 0 && amountCorrectionReason.trim().length > 0;
  const handleSaveAmountCorrection = async () => {
    if (!amountCorrectionValid || !user) return;
    setAmountSaving(true);
    setAmountError(null);
    try {
      await api.unifiedSale.correctAmount(payment.unified_sale_id!, {
        amount: parseFloat(amount),
        correction_reason: amountCorrectionReason,
        corrected_by: user.name,
      });
      onSaved();
    } catch (e) {
      setAmountError(apiErrorMessage(e, t("modals.couldNotSaveCorrection")));
    } finally {
      setAmountSaving(false);
    }
  };

  // Independent routing save for isUnifiedSaleSourced specifically — same
  // api.unifiedSale.correctSettlement call handleSubmit's isUnifiedSaleSourced
  // branch already made, just with its own reason/busy/error instead of the
  // shared ones (which isReceiptSourced/plain payments still use via
  // handleSubmit — this payment type is the only one with two independent
  // actions, so it's the only one that needs its own reason field).
  const handleSaveRoutingCorrection = async () => {
    if (!routingValid || !routingReason.trim() || !user) return;
    setRoutingSaving(true);
    setRoutingError(null);
    try {
      await api.unifiedSale.correctSettlement(payment.unified_sale_id!, {
        home_expense_amount: parseFloat(homeExpenseAmount) || 0,
        home_expense_category_id: parseFloat(homeExpenseAmount) > 0 ? homeExpenseCategoryId || undefined : undefined,
        owner_drawings_amount: parseFloat(ownerDrawingsAmount) || 0,
        destination_type: destinationType,
        target_plant_id: destinationType === "plant" ? targetPlantId || undefined : undefined,
        account_id: destinationType === "account" ? accountCategory : undefined,
        payment_reference: referenceNo || undefined,
        correction_reason: routingReason,
        corrected_by: user.name,
      });
      onSaved();
    } catch (e) {
      setRoutingError(apiErrorMessage(e, t("modals.couldNotSaveCorrection")));
    } finally {
      setRoutingSaving(false);
    }
  };

  // § Bug Fix — Correction Modal Routing. Shared by both showRouting
  // branches below — same fields/behavior as the Unified Sale page's own
  // Settlement Section (see app/unified-sale/page.tsx), in compact form.
  const routingFields = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("unifiedSale.homeExpense")}>
          <input type="number" value={homeExpenseAmount} onChange={(e) => setHomeExpenseAmount(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t("unifiedSale.expenseCategory")}>
          <select value={homeExpenseCategoryId} onChange={(e) => setHomeExpenseCategoryId(e.target.value)} className={inputClass}>
            <option value="">{t("unifiedSale.selectCategory")}</option>
            {expenseCategories.filter((c) => c.active === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("unifiedSale.ownerDrawings")}>
        <input type="number" value={ownerDrawingsAmount} onChange={(e) => setOwnerDrawingsAmount(e.target.value)} className={inputClass} />
      </Field>
      <div className="p-3 bg-paper rounded-lg border border-hairline space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDestinationType("plant")}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
              destinationType === "plant" ? "bg-teal/10 border-teal text-teal" : "border-hairline bg-white text-steel hover:bg-paper"
            }`}
          >
            <Building2 size={14} /> {t("unifiedSale.plantSettlementOption")}
          </button>
          <button
            type="button"
            onClick={() => setDestinationType("account")}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
              destinationType === "account" ? "bg-teal/10 border-teal text-teal" : "border-hairline bg-white text-steel hover:bg-paper"
            }`}
          >
            <Wallet size={14} /> {t("unifiedSale.accountDepositOption")}
          </button>
        </div>
        {destinationType === "plant" ? (
          <Field label={t("unifiedSale.targetPlantRequired")}>
            <select value={targetPlantId} onChange={(e) => setTargetPlantId(e.target.value)} className={inputClass}>
              <option value="">{t("unifiedSale.selectPlant")}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        ) : (
          <Field label={t("unifiedSale.targetAccount")}>
            <select value={accountCategory} onChange={(e) => setAccountCategory(e.target.value as AccountType)} className={inputClass}>
              <option value="office_cash">{t("payments.officeCash")}</option>
              <option value="dowa_account">{t("payments.dowaAccount")}</option>
              <option value="owner_home">{t("payments.ownerHome")}</option>
            </select>
          </Field>
        )}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4 sm:p-6">
      <div className="bg-white rounded-xl px-5 py-6 sm:px-6 w-full max-w-[440px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">
            {t("modals.correctKindTitle", { kind: kindLabel, id: transaction.display_id })}
          </div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer">
            <X size={16} className="text-steel" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label={t("unifiedSale.date")}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>

          {(kind === "sale" || kind === "purchase") && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("modals.quantityLabel")}>
                  <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
                </Field>
                <Field label={t("modals.ratePerCylinder")}>
                  <input
                    type="number"
                    value={ratePerCylinder}
                    onChange={(e) => setRatePerCylinder(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              {kind === "sale" && (
                <Field label={t("modals.cylindersReturned")}>
                  <input
                    type="number"
                    value={cylindersReturned}
                    onChange={(e) => setCylindersReturned(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              )}
              {kind === "sale" && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 font-body text-[13px] text-ink cursor-pointer">
                    <input type="checkbox" checked={gstEnabled} onChange={(e) => setGstEnabled(e.target.checked)} />
                    Apply GST
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
              )}
              {kind === "sale" && sale.emergency_transfer_shop_id && (
                <Field label={t("modals.emergencyTransferShop")}>
                  <select value={emergencyTransferShopId} onChange={(e) => setEmergencyTransferShopId(e.target.value)} className={inputClass}>
                    <option value="">{t("modals.selectShop")}</option>
                    {shops.map((s) => (
                      <option key={s.customer.id} value={s.customer.id}>{s.customer.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              {kind === "purchase" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label={t("modals.additional")}>
                    <input type="number" value={additionalCharges} onChange={(e) => setAdditionalCharges(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label={t("modals.transport")}>
                    <input type="number" value={transportCharges} onChange={(e) => setTransportCharges(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label={t("modals.other")}>
                    <input type="number" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} className={inputClass} />
                  </Field>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("modals.gatePassNoLabel")}>
                  <input value={gatePassNo} onChange={(e) => setGatePassNo(e.target.value)} className={inputClass} />
                </Field>
                <Field label={t("modals.vehicleNoLabel")}>
                  <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className={inputClass} />
                </Field>
              </div>
              {kind === "purchase" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label={t("modals.driverNameLabel")}>
                    <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label={t("modals.driverContactLabel")}>
                    <input value={driverContact} onChange={(e) => setDriverContact(e.target.value)} className={inputClass} />
                  </Field>
                </div>
              )}
            </>
          )}

          {kind === "shopSale" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("modals.unitLabel")}>
                  <select value={unit} onChange={(e) => setUnit(e.target.value as "cylinder" | "kg")} className={inputClass}>
                    <option value="cylinder">{t("modals.fullCylinders")}</option>
                    <option value="kg">{t("modals.kgUnit")}</option>
                  </select>
                </Field>
                <Field label={unit === "kg" ? t("modals.quantityKg") : t("modals.quantityCylinders")}>
                  <input type="number" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
                </Field>
              </div>
              <Field label={t("modals.boardRatePerKgLabel")}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={boardRatePerKg}
                  onChange={(e) => setBoardRatePerKg(e.target.value)}
                  placeholder={t("modals.boardRatePerKgPlaceholder")}
                  className={inputClass}
                />
              </Field>
              <Field label={t("modals.manualTotalAmountLabel")}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={manualTotalAmount}
                  onChange={(e) => setManualTotalAmount(e.target.value)}
                  placeholder={t("modals.manualTotalAmountPlaceholder")}
                  className={inputClass}
                />
              </Field>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("modals.paymentTypeLabel")}>
                  <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as "cash" | "credit")} className={inputClass}>
                    <option value="cash">{t("unifiedSale.methodCash")}</option>
                    <option value="credit">{t("modals.creditOption")}</option>
                  </select>
                </Field>
                <Field label={paymentType === "credit" ? t("modals.supplyCustomer") : t("modals.supplyCustomerOptional")}>
                  <select value={supplyCustomerId} onChange={(e) => setSupplyCustomerId(e.target.value)} className={inputClass}>
                    <option value="">{paymentType === "credit" ? t("modals.selectCustomerGeneric") : t("modals.walkInPublic")}</option>
                    {supplyCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              </div>
              {paymentType === "credit" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label={t("modals.amountReceivedLabel")}>
                    <input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label={t("modals.destinationAccount")}>
                    <select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} className={inputClass}>
                      <option value="">{t("modals.shopCashDefault")}</option>
                      {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                </div>
              )}
              <div className="font-body text-[11px] text-steel">
                {t("modals.boardRateRecomputeNote")}
              </div>
            </>
          )}

          {kind === "payment" && isUnifiedSaleSourced && (
            <>
              {/* Two independent actions — each with its own reason/save/
                  error — rather than one combined submit, so fixing just
                  the amount, just the routing, or both (one after the
                  other) never risks a partial-failure state. */}
              <div className="p-3.5 rounded-lg border border-hairline space-y-3">
                <div>
                  <div className="font-display font-bold text-[13px] text-ink">{t("modals.correctAmountSectionTitle")}</div>
                  <div className="font-body text-[11px] text-steel mt-0.5">{t("modals.correctAmountSectionCaption")}</div>
                </div>
                <Field label={t("modals.amountField")}>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
                </Field>
                <Field label={t("modals.reasonForCorrection")}>
                  <textarea
                    value={amountCorrectionReason}
                    onChange={(e) => setAmountCorrectionReason(e.target.value)}
                    rows={2}
                    className={inputClass}
                    placeholder={t("modals.reasonPlaceholder")}
                  />
                </Field>
                {amountError && <div className="font-body text-xs text-brand-red">{amountError}</div>}
                <Button variant="primary" onClick={handleSaveAmountCorrection} disabled={!amountCorrectionValid || amountSaving}>
                  <Check size={14} /> {amountSaving ? t("unifiedSale.saving") : t("modals.saveAmountCorrection")}
                </Button>
              </div>

              <div className="p-3.5 rounded-lg border border-hairline space-y-3">
                <div>
                  <div className="font-display font-bold text-[13px] text-ink">{t("modals.correctRoutingSectionTitle")}</div>
                  <div className="font-body text-[11px] text-steel mt-0.5">{t("modals.correctRoutingSectionCaption")}</div>
                </div>
                {routingFields}
                <Field label={t("modals.referenceNumberOptional")}>
                  <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
                </Field>
                <Field label={t("modals.reasonForCorrection")}>
                  <textarea
                    value={routingReason}
                    onChange={(e) => setRoutingReason(e.target.value)}
                    rows={2}
                    className={inputClass}
                    placeholder={t("modals.reasonPlaceholder")}
                  />
                </Field>
                {routingError && <div className="font-body text-xs text-brand-red">{routingError}</div>}
                <Button variant="primary" onClick={handleSaveRoutingCorrection} disabled={!routingValid || !routingReason.trim() || routingSaving}>
                  <Check size={14} /> {routingSaving ? t("unifiedSale.saving") : t("modals.saveRoutingCorrection")}
                </Button>
              </div>
            </>
          )}

          {kind === "payment" && isReceiptSourced && (
            <>
              <Field label={t("modals.amountField")}>
                <input type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
              </Field>
              <Field label={t("expenses.paymentMethod")}>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                  <option value="cash">{t("unifiedSale.methodCash")}</option>
                  <option value="bank_transfer">{t("expenses.methodBankTransfer")}</option>
                  <option value="cheque">{t("unifiedSale.methodCheque")}</option>
                  <option value="online">{t("expenses.methodOnlinePayment")}</option>
                  <option value="other">{t("expenses.methodOther")}</option>
                </select>
              </Field>
              {routingFields}
              <Field label={t("modals.referenceNumberOptional")}>
                <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
              </Field>
            </>
          )}

          {(kind === "payment" && !showRouting || kind === "companyPayment") && (
            <>
              <Field label={t("modals.amountField")}>
                <input type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("expenses.paymentMethod")}>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                    <option value="cash">{t("unifiedSale.methodCash")}</option>
                    <option value="bank_transfer">{t("expenses.methodBankTransfer")}</option>
                    <option value="cheque">{t("unifiedSale.methodCheque")}</option>
                    <option value="online">{t("expenses.methodOnlinePayment")}</option>
                    <option value="other">{t("expenses.methodOther")}</option>
                  </select>
                </Field>
                <Field label={kind === "payment" ? t("modals.intoAccount") : t("modals.fromAccount")}>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                    <option value="">{kind === "companyPayment" ? t("modals.directSettlementNone") : t("expenses.selectAccount")}</option>
                    {accounts
                      .filter((a) => a.active === "active")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label={t("modals.referenceNumberOptional")}>
                <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
              </Field>
              {kind === "payment" && (
                <Field label={t("modals.sourceAccountOptionalHint")}>
                  <select value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)} className={inputClass}>
                    <option value="">{t("modals.noneUntrackedSource")}</option>
                    {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}

          {!isUnifiedSaleSourced && (
            <Field label={t("modals.notesOptional")}>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            </Field>
          )}

          {!isUnifiedSaleSourced && (
            <>
              <Field label={t("modals.reasonForCorrection")}>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className={inputClass}
                  placeholder={t("modals.reasonPlaceholder")}
                />
              </Field>

              <div className="font-body text-[11px] text-steel">
                {t("modals.staysInHistoryNote", { id: transaction.display_id })}
              </div>

              {error && <div className="font-body text-xs text-brand-red">{error}</div>}

              <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
                <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.saveCorrection")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
