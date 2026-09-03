"use client";
import { useEffect, useState } from "react";
import { Search, X, AlertTriangle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import AmountInput from "@/components/AmountInput";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Customer } from "@/lib/types";

// "legacy" = the untyped, unclassified remainder of a size's balance for
// customers that predate typed Cross/PSO tracking (or predate any typed
// sale) — total_for_size − cross − pso. Selling it uses the old
// size-only endpoint call (no cylinder_type), exactly as before this
// feature existed; it is never guessed into Cross or PSO.
type SellType = "cross" | "pso" | "legacy";

function unclassified(c: Customer, size: "118" | "454"): number {
  const total = parseFloat((size === "454" ? c.empty_cylinders_454 : c.empty_cylinders_118) || "0");
  const cross = parseFloat((size === "454" ? c.empty_cylinders_454_cross : c.empty_cylinders_118_cross) || "0");
  const pso = parseFloat((size === "454" ? c.empty_cylinders_454_pso : c.empty_cylinders_118_pso) || "0");
  return Math.max(total - cross - pso, 0);
}

function EmptyCylindersBody() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  const [sellModal, setSellModal] = useState<Customer | null>(null);
  const [cylSize, setCylSize] = useState<"118" | "454">("118");
  const [sellType, setSellType] = useState<SellType>("cross");
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

  const balanceFor = (c: Customer, size: "118" | "454", type: SellType): number => {
    if (type === "legacy") return unclassified(c, size);
    const key = `empty_cylinders_${size}_${type}` as keyof Customer;
    return parseFloat((c[key] as string) || "0");
  };

  const defaultTypeFor = (c: Customer, size: "118" | "454"): SellType => {
    if (balanceFor(c, size, "cross") > 0) return "cross";
    if (balanceFor(c, size, "pso") > 0) return "pso";
    return "legacy";
  };

  const openSellModal = (c: Customer) => {
    setSellModal(c);
    // Default to whichever size actually has stock to sell.
    const size = parseFloat(c.empty_cylinders_118 || "0") > 0 ? "118" : "454";
    setCylSize(size);
    setSellType(defaultTypeFor(c, size));
    setQuantity("");
    setAmount("");
    setNotes("");
    setError(null);
  };

  const closeSellModal = () => {
    setSellModal(null);
    setError(null);
  };

  const changeSize = (size: "118" | "454") => {
    setCylSize(size);
    if (sellModal) setSellType(defaultTypeFor(sellModal, size));
    setQuantity("");
  };

  const availableBalance = sellModal ? balanceFor(sellModal, cylSize, sellType) : 0;
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
        cylinder_type: sellType === "legacy" ? undefined : sellType,
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

  // Fleet-wide totals for the summary cards — sums the per-customer
  // Cross/PSO breakdown; "Unclassified" captures customers/stock recorded
  // before typed tracking existed, so nothing is hidden or double-counted.
  const totals = customers.reduce(
    (acc, c) => ({
      cross118: acc.cross118 + balanceFor(c, "118", "cross"),
      pso118: acc.pso118 + balanceFor(c, "118", "pso"),
      cross454: acc.cross454 + balanceFor(c, "454", "cross"),
      pso454: acc.pso454 + balanceFor(c, "454", "pso"),
      unclassified118: acc.unclassified118 + unclassified(c, "118"),
      unclassified454: acc.unclassified454 + unclassified(c, "454"),
    }),
    { cross118: 0, pso118: 0, cross454: 0, pso454: 0, unclassified118: 0, unclassified454: 0 }
  );
  const totalCross = totals.cross118 + totals.cross454;
  const totalPso = totals.pso118 + totals.pso454;
  const totalUnclassified = totals.unclassified118 + totals.unclassified454;

  return (
    <div>
      <PageHeader
        eyebrow="Empty Cylinders"
        title="Customer empty cylinder stock"
        caption="Every customer's available empty cylinder balance — sell it back to record the transaction and post it to their ledger."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-4">
        <Panel className="min-h-[96px]">
          <Eyebrow>Total Cross</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{totalCross}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            11.8 KG: {totals.cross118} · 45.4 KG: {totals.cross454}
          </div>
        </Panel>
        <Panel className="min-h-[96px]">
          <Eyebrow>Total PSO</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{totalPso}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            11.8 KG: {totals.pso118} · 45.4 KG: {totals.pso454}
          </div>
        </Panel>
      </div>

      <Panel className="mb-4">
        <Eyebrow>Size Breakdown</Eyebrow>
        <SectionCaption>11.8 KG and 45.4 KG quantities are never mixed — Cross/PSO is a type within each size.</SectionCaption>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 bg-paper rounded-lg border border-hairline">
            <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel mb-2">Cross</div>
            <div className="flex justify-between font-body text-[13px] text-ink"><span>11.8 KG</span><b className="font-mono">{totals.cross118}</b></div>
            <div className="flex justify-between font-body text-[13px] text-ink mt-1"><span>45.4 KG</span><b className="font-mono">{totals.cross454}</b></div>
            <div className="flex justify-between font-body text-[13px] text-teal mt-1.5 pt-1.5 border-t border-hairline"><span>Total</span><b className="font-mono">{totalCross}</b></div>
          </div>
          <div className="p-3 bg-paper rounded-lg border border-hairline">
            <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel mb-2">PSO</div>
            <div className="flex justify-between font-body text-[13px] text-ink"><span>11.8 KG</span><b className="font-mono">{totals.pso118}</b></div>
            <div className="flex justify-between font-body text-[13px] text-ink mt-1"><span>45.4 KG</span><b className="font-mono">{totals.pso454}</b></div>
            <div className="flex justify-between font-body text-[13px] text-teal mt-1.5 pt-1.5 border-t border-hairline"><span>Total</span><b className="font-mono">{totalPso}</b></div>
          </div>
        </div>
        {totalUnclassified > 0 && (
          <div className="mt-3 font-body text-[11.5px] text-steel">
            + {totalUnclassified} unclassified (11.8: {totals.unclassified118} · 45.4: {totals.unclassified454}) — recorded before Cross/PSO tracking, still fully sellable via the legacy option below.
          </div>
        )}
      </Panel>

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
              <Field label="Cylinder Size">
                <select
                  value={cylSize}
                  onChange={(e) => changeSize(e.target.value as "118" | "454")}
                  className={inputClass}
                >
                  <option value="118">11.8 KG</option>
                  <option value="454">45.4 KG</option>
                </select>
              </Field>
              <Field label="Cylinder Type">
                <select
                  value={sellType}
                  onChange={(e) => { setSellType(e.target.value as SellType); setQuantity(""); }}
                  className={inputClass}
                >
                  <option value="cross">Cross ({balanceFor(sellModal, cylSize, "cross")} available)</option>
                  <option value="pso">PSO ({balanceFor(sellModal, cylSize, "pso")} available)</option>
                  {unclassified(sellModal, cylSize) > 0 && (
                    <option value="legacy">Unclassified ({unclassified(sellModal, cylSize)} available)</option>
                  )}
                </select>
              </Field>
              <div className="font-mono text-xs text-steel">
                Available {cylSize === "454" ? "45.4 KG" : "11.8 KG"} {sellType === "legacy" ? "unclassified" : sellType.toUpperCase()} empty cylinders: <b className="text-ink">{availableBalance}</b>
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
                <AmountInput
                  value={amount}
                  onChange={setAmount}
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
