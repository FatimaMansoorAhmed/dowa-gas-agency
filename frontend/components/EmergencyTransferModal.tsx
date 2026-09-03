"use client";

import { useEffect, useState } from "react";
import { X, Check, Zap, Banknote } from "lucide-react";

import { Field, inputClass, Button } from "./ui";
import AmountInput from "./AmountInput";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput, pkr } from "@/lib/format";

import type { Customer, PaymentAccount, ShopProductStockSummary } from "@/lib/types";

/**
 * Emergency Transfer — a real (non-shop) customer needs cylinders
 * urgently and is directed to THIS shop instead of a plant. Posts a real
 * Sale (charge to the customer's actual ledger, visible in Customer
 * Ledger — same table Unified Sale posts to) while drawing physical
 * stock from this shop's own FIFO stock. Customer selection reuses the
 * exact same live-search-against-api.customers.list() pattern Unified
 * Sale already uses — not a new component.
 */
export default function EmergencyTransferModal({
  shopId, shopName, stockProducts, onClose, onSaved,
}: {
  shopId: string; shopName: string; stockProducts: ShopProductStockSummary[];
  onClose: () => void; onSaved: () => void;
}) {
  const { user } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const [productId, setProductId] = useState("");
  const [date, setDate] = useState(todayLocalInput());
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  const [collectNow, setCollectNow] = useState(false);
  const [amountCollected, setAmountCollected] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.customers.list().then(setCustomers); }, []);
  useEffect(() => { api.paymentAccounts.list().then((a) => setAccounts(a.filter((x) => x.active === "active"))); }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  // Emergency Transfer is for a REAL customer, not another shop — the
  // backend enforces this too; filtering here just keeps the picker clean.
  const filteredCustomers = customers.filter((c) => {
    if (c.customer_type === "shop") return false;
    const q = customerSearch.trim().toLowerCase();
    if (!q) return false;
    return c.name.toLowerCase().includes(q) || c.display_id.toLowerCase().includes(q) || (c.mobile || "").includes(q);
  });

  const selectedProduct = stockProducts.find((p) => p.product_id === productId);
  const available = selectedProduct ? parseFloat(selectedProduct.closing_stock) : null;
  const qty = parseFloat(quantity);
  const rateNum = parseFloat(rate);
  const totalAmount = qty > 0 && rateNum > 0 ? qty * rateNum : null;

  const canSubmit =
    !!customerId && !!productId && !!date &&
    qty > 0 && rateNum > 0 &&
    (available == null || qty <= available) &&
    (!collectNow || (parseFloat(amountCollected) > 0 && parseFloat(amountCollected) <= (totalAmount || 0)));

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

      await api.emergencyTransfer.create({
        date: isoDate,
        customer_id: customerId,
        shop_id: shopId,
        product_id: productId,
        quantity: qty,
        rate_per_cylinder: rateNum,
        notes: notes || undefined,
        amount_collected_now: collectNow ? parseFloat(amountCollected) : undefined,
        destination_account_id: collectNow ? (destinationAccountId || undefined) : undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^API .*?\):\s*/, "") : "Could not save — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
      <div className="bg-white rounded-xl px-6 py-6 w-[460px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2 font-display font-bold text-[17px] text-ink">
            <Zap size={16} className="text-brand-amber" /> Emergency Transfer
          </div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="font-body text-[12px] text-steel mb-4">
          Charges a real customer's own ledger, drawing cylinders from {shopName}'s stock.
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Customer">
            <div className="relative">
              <input
                value={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.display_id}` : customerSearch}
                onChange={(e) => { setCustomerId(""); setCustomerSearch(e.target.value); }}
                placeholder="Search by name, mobile, or customer ID"
                className={inputClass}
              />
              {!customerId && customerSearch.trim() && (
                <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-52 overflow-y-auto shadow-lg">
                  {filteredCustomers.slice(0, 8).map((c) => (
                    <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(""); }} className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px]">
                      <span className="font-semibold text-ink">{c.name}</span> <span className="text-steel">· {c.display_id} · {c.mobile}</span>
                    </button>
                  ))}
                  {!filteredCustomers.length && <div className="px-3 py-2 font-body text-[13px] text-steel">No match.</div>}
                </div>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Product">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
                <option value="">Select product</option>
                {stockProducts.map((p) => (
                  <option key={p.product_id} value={p.product_id}>{p.product_name} ({p.closing_stock} available)</option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Rate / Cylinder">
              <AmountInput value={rate} onChange={setRate} className={inputClass} />
            </Field>
          </div>
          {available != null && qty > available && (
            <div className="font-body text-xs text-brand-red -mt-1.5">
              Only {available} available at this shop.
            </div>
          )}

          {totalAmount != null && (
            <div className="flex justify-between items-center rounded-md bg-paper px-3 py-2">
              <span className="font-mono text-[10px] uppercase text-steel">Total</span>
              <span className="font-mono font-bold text-[15px] text-ink">{pkr(totalAmount)}</span>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} className="cursor-pointer" />
            <span className="font-body text-[13px] text-ink flex items-center gap-1"><Banknote size={13} /> Collect payment now</span>
          </label>

          {collectNow && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount Collected">
                <AmountInput value={amountCollected} onChange={setAmountCollected} className={inputClass} />
              </Field>
              <Field label="Destination Account">
                <select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} className={inputClass}>
                  <option value="">{shopName} Shop Cash (default)</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          <Field label="Notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>
        </div>

        {error && <div className="font-body text-xs text-brand-red mt-3">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Emergency Transfer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
