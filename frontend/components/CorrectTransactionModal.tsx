"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toKarachiDateString } from "@/lib/format";
import type { PaymentAccount, Sale, Payment, Purchase, CompanyPayment, ShopSale, ShopSupplyCustomer, ShopListRow } from "@/lib/types";

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

  useEffect(() => {
    if (kind === "payment" || kind === "companyPayment" || kind === "shopSale") {
      api.paymentAccounts.list().then(setAccounts);
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
  const [gstEnabled, setGstEnabled] = useState(kind === "sale" ? !!sale.gst_enabled : false);
  const [gstRate, setGstRate] = useState(kind === "sale" ? String(sale.gst_rate || "") : "");

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

  const kindLabel = {
    sale: t("unifiedSale.colSale"),
    payment: t("customerLedger.colPayment"),
    purchase: t("purchases.colPurchase"),
    companyPayment: t("modals.plantPaymentSingular"),
    shopSale: t("shopDetail.shopSale"),
  }[kind];

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
      ? parseFloat(quantity) > 0 && (paymentType === "cash" || !!supplyCustomerId)
        && (paymentType === "cash" || (parseFloat(amountReceived) || 0) >= 0)
      : parseFloat(amount) > 0) &&
    ((kind !== "payment" && kind !== "companyPayment") || accountId || kind === "companyPayment");

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
      setError(t("modals.couldNotSaveCorrection"));
    } finally {
      setSaving(false);
    }
  };

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

          {(kind === "payment" || kind === "companyPayment") && (
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

          <Field label={t("modals.notesOptional")}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>

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
        </div>
      </div>
    </div>
  );
}
