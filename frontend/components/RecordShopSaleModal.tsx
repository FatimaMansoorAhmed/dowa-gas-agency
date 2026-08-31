"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput } from "@/lib/format";
import type { Product, ShopSupplyCustomer } from "@/lib/types";

/** Record Shop Sale — a shop's retail sale to its own end customers,
 * priced from the Board Rate in effect on the date entered below (never
 * the load rate). The exact amount is computed server-side; this form
 * never sends a price. Supports full-cylinder or KG quantities (§15), and
 * an optional named Supply Customer paying cash or on credit (§25) — a
 * credit sale requires a customer, since a credit sale to nobody makes no
 * sense; a cash sale may optionally still name one. */
export default function RecordShopSaleModal({
  shopId, onClose, onSaved,
}: { shopId: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<ShopSupplyCustomer[]>([]);
  const [productId, setProductId] = useState("");
  const [date, setDate] = useState(todayLocalInput());
  const [unit, setUnit] = useState<"cylinder" | "kg">("cylinder");
  const [quantity, setQuantity] = useState("");
  const [paymentType, setPaymentType] = useState<"cash" | "credit">("cash");
  const [supplyCustomerId, setSupplyCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only legitimate active products belong in this selector — an
  // accidental duplicate DB row (e.g. a stray "11.8 KG Cylinder2") must
  // never be offered here even though it still exists for history's sake.
  useEffect(() => { api.products.list().then((p) => setProducts(p.filter((x) => x.active === "active"))); }, []);
  useEffect(() => { api.shops.customers.list(shopId).then(setCustomers); }, [shopId]);

  const canSubmit =
    productId && date && parseFloat(quantity) > 0 &&
    (paymentType === "cash" || !!supplyCustomerId);

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

      await api.shops.createSale(shopId, {
        date: isoDate,
        product_id: productId,
        quantity: parseFloat(quantity),
        unit,
        payment_type: paymentType,
        supply_customer_id: supplyCustomerId || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message?.includes("Insufficient") ? "Not enough stock for this quantity." : "Could not save the sale — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
      <div className="bg-white rounded-xl px-6 py-6 w-[400px]">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Record Shop Sale</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Product">
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit">
              <select value={unit} onChange={(e) => setUnit(e.target.value as "cylinder" | "kg")} className={inputClass}>
                <option value="cylinder">Full Cylinder(s)</option>
                <option value="kg">KG</option>
              </select>
            </Field>
            <Field label={unit === "kg" ? "Quantity (KG)" : "Quantity (cylinders)"}>
              <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
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
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>
          <div className="font-body text-[11px] text-steel">
            Priced automatically from today's Board Rate × the product's saleable weight.
            {paymentType === "credit" ? " A credit sale adds to the customer's outstanding balance with the shop, not to Dowa." : ""}
          </div>
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Sale"}
          </Button>
        </div>
      </div>
    </div>
  );
}
