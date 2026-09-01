"use client";
import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput } from "@/lib/format";
import type { ShopSupplyCustomer, PaymentAccount } from "@/lib/types";

/** Record a Supply Customer's payment to the shop (§25) — collects against
 * a credit ShopSale's receivable, increases Shop Cash (§ Shop Cash Money
 * Routing — posts to a real, shop-scoped PaymentAccount). Never touches the
 * Dowa Customer Ledger/Payment model — this is Engine 3, not Engine 1. */
export default function RecordSupplyCustomerPaymentModal({
  shopId, customer, onClose, onSaved,
}: { shopId: string; customer: ShopSupplyCustomer; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [date, setDate] = useState(todayLocalInput());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.paymentAccounts.list().then((a) => setAccounts(a.filter((x) => x.active === "active"))); }, []);

  const canSubmit = parseFloat(amount) > 0 && date;

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

      await api.shops.customerPayments.create(shopId, customer.id, {
        date: isoDate,
        supply_customer_id: customer.id,
        amount: parseFloat(amount),
        method,
        account_id: accountId || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      onSaved();
    } catch (e) {
      setError("Could not save the payment — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
      <div className="bg-white rounded-xl px-6 py-6 w-[380px]">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Receive Payment — {customer.name}</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="font-body text-[12px] text-steel mb-3">
          Outstanding: {customer.current_balance}
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Amount">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Deposit To Account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
              <option value="">Shop Cash (default)</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Payment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
