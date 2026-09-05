"use client";
import { useState } from "react";
import { X, Check } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ShopSupplyCustomer } from "@/lib/types";

/** Add Supply Customer (§25) — a shop's OWN retail/wholesale customer,
 * entirely distinct from a Dowa Customer: no Dowa receivable, never shows
 * in the Customer Ledger. Mirrors AddShopModal's shape. */
export default function AddSupplyCustomerModal({
  shopId, onClose, onCreated,
}: { shopId: string; onClose: () => void; onCreated: (c: ShopSupplyCustomer) => void }) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !user) return;
    setSaving(true);
    setError(null);
    try {
      const customer = await api.shops.customers.create(shopId, {
        name: name.trim(),
        mobile: mobile.trim() || undefined,
        address: address.trim() || undefined,
        opening_balance: parseFloat(openingBalance) || 0,
        entered_by: user.name,
      });
      onCreated(customer);
    } catch (e) {
      setError("Could not create customer — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-[360px]">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Add Supply Customer</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Customer Name">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Ali Traders" />
          </Field>
          <Field label="Mobile (optional)">
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="03XX-XXXXXXX" className={inputClass} />
          </Field>
          <Field label="Address (optional)">
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Opening Balance">
            <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0" className={inputClass} />
          </Field>
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!name.trim() || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Customer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
