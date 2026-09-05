"use client";
import { useEffect, useState } from "react";
import { X, PackagePlus } from "lucide-react";
import { Field, inputClass, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Customer } from "@/lib/types";

/** Add Empty Cylinder (§ Part C) — manual count correction/addition against
 * the same per-customer, per-category empty-cylinder balance Return
 * Cylinder (Part B) and Sell Empty Cylinders both read/write
 * (Customer.empty_cylinders_{size}_{type}). Pure count increase, no money —
 * posts as a CylinderReturn row with mode="manual_add" so it carries the
 * same entered_by/date/notes audit trail as every other manual entry in
 * this app. Used from both the Empty Cylinders page and Customer Ledger. */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customer: Customer | null;
}

export default function AddEmptyCylinderModal({ isOpen, onClose, onSuccess, customer }: Props) {
  const { user } = useAuth();

  const [cylSize, setCylSize] = useState<"118" | "454">("118");
  const [cylType, setCylType] = useState<"cross" | "pso" | "">("cross");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCylSize("118");
    setCylType("cross");
    setQuantity("");
    setNotes("");
    setError(null);
  }, [isOpen, customer?.id]);

  if (!isOpen || !customer) return null;

  const qtyNum = parseFloat(quantity) || 0;
  const canSubmit = qtyNum > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    try {
      await api.cylinderReturns.create({
        customer_id: customer.id,
        cylinder_size: cylSize,
        cylinder_type: cylType || undefined,
        quantity: qtyNum,
        mode: "manual_add",
        notes: notes || undefined,
        entered_by: user.name,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add the cylinders.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8 overflow-hidden border border-hairline">
        <div className="flex justify-between items-center px-5 py-4 border-b border-hairline bg-paper">
          <div className="flex items-center gap-2">
            <PackagePlus className="text-teal" size={20} />
            <h3 className="font-display font-semibold text-lg text-ink">Add Empty Cylinder — {customer.name}</h3>
          </div>
          <button onClick={onClose} className="text-steel hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cylinder Size">
              <select value={cylSize} onChange={(e) => setCylSize(e.target.value as "118" | "454")} className={inputClass}>
                <option value="118">11.8 KG</option>
                <option value="454">45.4 KG</option>
              </select>
            </Field>
            <Field label="Cylinder Type">
              <select value={cylType} onChange={(e) => setCylType(e.target.value as "cross" | "pso" | "")} className={inputClass}>
                <option value="cross">Cross</option>
                <option value="pso">PSO</option>
                <option value="">Unclassified (legacy)</option>
              </select>
            </Field>
          </div>

          <Field label="Quantity">
            <input
              type="number"
              min="0"
              autoFocus
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Reason / Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. correcting a missed entry"
              className={inputClass}
            />
          </Field>

          {error && <div className="text-xs text-brand-red font-medium">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-hairline bg-paper">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : "Add Cylinders"}
          </Button>
        </div>
      </div>
    </div>
  );
}
