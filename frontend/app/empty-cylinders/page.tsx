"use client";
import { useEffect, useState } from "react";
import { Search, X, AlertTriangle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Field, inputClass, Button, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Customer } from "@/lib/types";

function EmptyCylindersBody() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  const [sellModal, setSellModal] = useState<Customer | null>(null);
  const [cylSize, setCylSize] = useState<"118" | "454">("118");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (q?: string) => setCustomers(await api.customers.list(q));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 250);
    return () => clearTimeout(t);
  }, [search]);

  const openSellModal = (c: Customer) => {
    setSellModal(c);
    // Default to whichever category actually has stock to sell.
    setCylSize(parseFloat(c.empty_cylinders_118 || "0") > 0 ? "118" : "454");
    setQuantity("");
    setAmount("");
    setNotes("");
    setError(null);
  };

  const closeSellModal = () => {
    setSellModal(null);
    setError(null);
  };

  const availableBalance = sellModal
    ? parseFloat((cylSize === "454" ? sellModal.empty_cylinders_454 : sellModal.empty_cylinders_118) || "0")
    : 0;
  const qtyNum = parseFloat(quantity) || 0;
  const amountNum = parseFloat(amount) || 0;

  const submitSell = async () => {
    if (!sellModal || !user) return;
    setError(null);

    if (qtyNum <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }
    if (qtyNum > availableBalance) {
      setError(`Quantity cannot exceed the available balance (${availableBalance}).`);
      return;
    }
    if (amountNum <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }

    setSaving(true);
    try {
      await api.customers.sellEmptyCylinders(sellModal.id, {
        cylinder_size: cylSize,
        quantity: qtyNum,
        amount: amountNum,
        notes: notes.trim() || undefined,
        entered_by: user.name,
      });
      closeSellModal();
      load(search || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the sale.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Empty Cylinders"
        title="Customer empty cylinder stock"
        caption="Every customer's available empty cylinder balance — sell it back to record the transaction and post it to their ledger."
      />

      <Panel>
        <div className="flex justify-between items-center mb-1">
          <Eyebrow>Customers ({customers.length})</Eyebrow>
          <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
            <Search size={13} className="text-steel" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, mobile, shop, or ID"
              className="border-none outline-none font-body text-xs py-1.5 w-[190px]"
            />
          </div>
        </div>
        <table className="w-full border-collapse mt-2">
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Mobile</Th>
              <Th right>11.8 KG Empty</Th>
              <Th right>45.4 KG Empty</Th>
              <Th right>Action</Th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <Td mono>{c.display_id}</Td>
                <Td bold>
                  {c.name}
                  {c.shop_name ? <span className="text-steel font-normal"> · {c.shop_name}</span> : ""}
                </Td>
                <Td mono>{c.mobile}</Td>
                <Td right mono bold>
                  {c.empty_cylinders_118 || 0}
                </Td>
                <Td right mono bold>
                  {c.empty_cylinders_454 || 0}
                </Td>
                <Td right>
                  <Button
                    variant="teal"
                    onClick={() => openSellModal(c)}
                    disabled={parseFloat(c.empty_cylinders_118 || "0") <= 0 && parseFloat(c.empty_cylinders_454 || "0") <= 0}
                  >
                    Sell Empty Cylinders
                  </Button>
                </Td>
              </tr>
            ))}
            {!customers.length && (
              <tr>
                <td colSpan={6} className="text-steel font-body text-[13px] py-3">
                  No customers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      {sellModal && (
        <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-6 py-6 w-[380px]">
            <div className="flex justify-between items-center mb-1">
              <div className="font-display font-bold text-[17px] text-ink">{sellModal.name}</div>
              <button onClick={closeSellModal} className="bg-transparent border-none cursor-pointer">
                <X size={16} className="text-steel" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Cylinder Category">
                <select
                  value={cylSize}
                  onChange={(e) => {
                    setCylSize(e.target.value as "118" | "454");
                    setQuantity("");
                  }}
                  className={inputClass}
                >
                  <option value="118">11.8 KG</option>
                  <option value="454">45.4 KG</option>
                </select>
              </Field>
              <div className="font-mono text-xs text-steel">
                Available {cylSize === "454" ? "45.4 KG" : "11.8 KG"} empty cylinders: <b className="text-ink">{availableBalance}</b>
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
              <Field label="Sale Amount (PKR)">
                <input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Notes (optional)">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </Field>
            </div>

            {error && (
              <div className="mt-2.5 px-2.5 py-2 bg-[#FBEAEA] rounded-md font-body text-xs text-brand-red flex gap-1.5 items-start">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closeSellModal} disabled={saving}>
                Cancel
              </Button>
              <Button variant="teal" onClick={submitSell} disabled={saving || !quantity || !amount}>
                {saving ? "Saving..." : "Confirm Sale"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmptyCylindersPage() {
  return (
    <AuthGate>
      <EmptyCylindersBody />
    </AuthGate>
  );
}
