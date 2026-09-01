"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toKarachiDateString } from "@/lib/format";
import type { PaymentAccount, Sale, Payment, Purchase, CompanyPayment, ShopSale, ShopSupplyCustomer } from "@/lib/types";

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
  }, [kind]);
  const [supplyCustomers, setSupplyCustomers] = useState<ShopSupplyCustomer[]>([]);

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

  const kindLabel = { sale: "Sale", payment: "Payment", purchase: "Purchase", companyPayment: "Plant Payment", shopSale: "Shop Sale" }[kind];

  const canSubmit =
    reason.trim().length > 0 &&
    date &&
    (kind === "sale" || kind === "purchase"
      ? parseFloat(quantity) > 0 && parseFloat(ratePerCylinder) > 0
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
      setError("Could not save the correction — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-xl px-6 py-6 w-[440px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">
            Correct {kindLabel} · {transaction.display_id}
          </div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer">
            <X size={16} className="text-steel" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>

          {(kind === "sale" || kind === "purchase") && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity">
                  <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Rate / Cylinder">
                  <input
                    type="number"
                    value={ratePerCylinder}
                    onChange={(e) => setRatePerCylinder(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              {kind === "sale" && (
                <Field label="Cylinders Returned">
                  <input
                    type="number"
                    value={cylindersReturned}
                    onChange={(e) => setCylindersReturned(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              )}
              {kind === "purchase" && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Additional">
                    <input type="number" value={additionalCharges} onChange={(e) => setAdditionalCharges(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Transport">
                    <input type="number" value={transportCharges} onChange={(e) => setTransportCharges(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Other">
                    <input type="number" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} className={inputClass} />
                  </Field>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gate Pass No.">
                  <input value={gatePassNo} onChange={(e) => setGatePassNo(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Vehicle No.">
                  <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className={inputClass} />
                </Field>
              </div>
              {kind === "purchase" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Driver Name">
                    <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Driver Contact">
                    <input value={driverContact} onChange={(e) => setDriverContact(e.target.value)} className={inputClass} />
                  </Field>
                </div>
              )}
            </>
          )}

          {kind === "shopSale" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit">
                  <select value={unit} onChange={(e) => setUnit(e.target.value as "cylinder" | "kg")} className={inputClass}>
                    <option value="cylinder">Full Cylinder(s)</option>
                    <option value="kg">KG</option>
                  </select>
                </Field>
                <Field label={unit === "kg" ? "Quantity (KG)" : "Quantity (cylinders)"}>
                  <input type="number" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Payment Type">
                  <select value={paymentType} onChange={(e) => setPaymentType(e.target.value as "cash" | "credit")} className={inputClass}>
                    <option value="cash">Cash</option>
                    <option value="credit">Credit</option>
                  </select>
                </Field>
                <Field label={paymentType === "credit" ? "Supply Customer" : "Supply Customer (optional)"}>
                  <select value={supplyCustomerId} onChange={(e) => setSupplyCustomerId(e.target.value)} className={inputClass}>
                    <option value="">{paymentType === "credit" ? "Select customer" : "Walk-in / public"}</option>
                    {supplyCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              </div>
              {paymentType === "credit" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount Received">
                    <input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Destination Account">
                    <select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} className={inputClass}>
                      <option value="">Shop Cash (default)</option>
                      {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                </div>
              )}
              <div className="font-body text-[11px] text-steel">
                The sale amount will be recomputed from the Board Rate in effect on the date above ×
                the product's saleable weight — never from the original amount.
              </div>
            </>
          )}

          {(kind === "payment" || kind === "companyPayment") && (
            <>
              <Field label="Amount">
                <input type="number" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Method">
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="online">Online Payment</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label={kind === "payment" ? "Into Account" : "From Account"}>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                    <option value="">{kind === "companyPayment" ? "Direct settlement (none)" : "Select account"}</option>
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
              <Field label="Reference Number (optional)">
                <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
              </Field>
              {kind === "payment" && (
                <Field label="Source Account (optional — only if funded from a tracked account, e.g. a shop's own Shop Cash)">
                  <select value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)} className={inputClass}>
                    <option value="">None (untracked source)</option>
                    {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}

          <Field label="Notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>

          <Field label="Reason for Correction (required)">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="e.g. Amount was entered wrong, quantity miscounted…"
            />
          </Field>

          <div className="font-body text-[11px] text-steel">
            {transaction.display_id} stays in history, clearly marked as corrected — a new
            transaction is posted with the values above.
          </div>

          {error && <div className="font-body text-xs text-brand-red">{error}</div>}

          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Correction"}
          </Button>
        </div>
      </div>
    </div>
  );
}
