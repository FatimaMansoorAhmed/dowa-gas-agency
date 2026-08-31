"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput } from "@/lib/format";
import type { Product } from "@/lib/types";

/** Record Return / Adjustment — a standalone stock movement, kept
 * deliberately simple: it never touches a stock batch/FIFO, it only ever
 * contributes its own signed quantity to the Closing Stock formula. */
export default function RecordShopAdjustmentModal({
  shopId, onClose, onSaved,
}: { shopId: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [date, setDate] = useState(todayLocalInput());
  const [adjustmentType, setAdjustmentType] = useState<"return" | "adjustment">("return");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same active-only filtering as RecordShopSaleModal — a deactivated
  // duplicate product must never appear as a selectable choice.
  useEffect(() => { api.products.list().then((p) => setProducts(p.filter((x) => x.active === "active"))); }, []);

  const canSubmit = productId && date && parseFloat(quantity) > 0;

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
      const signedQty = direction === "in" ? parseFloat(quantity) : -parseFloat(quantity);

      await api.shops.createAdjustment(shopId, {
        date: isoDate,
        product_id: productId,
        adjustment_type: adjustmentType,
        quantity_delta: signedQty,
        reason: reason || undefined,
        entered_by: user.name,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message?.includes("negative") ? "This would make stock negative." : "Could not save — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
      <div className="bg-white rounded-xl px-6 py-6 w-[380px]">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Record Return / Adjustment</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Type">
            <select value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value as "return" | "adjustment")} className={inputClass}>
              <option value="return">Return</option>
              <option value="adjustment">Adjustment</option>
            </select>
          </Field>
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
            <Field label="Direction">
              <select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")} className={inputClass}>
                <option value="in">Stock In (+)</option>
                <option value="out">Stock Out (−)</option>
              </select>
            </Field>
            <Field label="Quantity">
              <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label="Reason (optional)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </Field>
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
