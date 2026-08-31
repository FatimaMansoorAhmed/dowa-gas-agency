
"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, Check, AlertCircle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, Field, inputClass, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Customer, Product, CylinderTransaction, CylinderBalance } from "@/lib/types";

function todayLocalInput() {
  return new Date().toISOString().slice(0, 10);
}

function CylinderLedgerBody() {
  const { user } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [allBalances, setAllBalances] = useState<CylinderBalance[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [transactions, setTransactions] = useState<CylinderTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const [date, setDate] = useState(todayLocalInput());
  const [productId, setProductId] = useState("");
  const [qtyOut, setQtyOut] = useState("");
  const [qtyIn, setQtyIn] = useState("");
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadStatic = async () => {
    const [c, pRaw, b] = await Promise.all([
      api.customers.list(),
      api.products.list(),
      api.cylinderTransactions.balances(),
    ]);
    // Active-only — a deactivated duplicate product must never be a
    // selectable option, here or anywhere else.
    const p = pRaw.filter((x) => x.active === "active");
    setCustomers(c);
    setProducts(p);
    setAllBalances(b);
    if (p.length && !productId) setProductId(p[0].id);
  };

  useEffect(() => { loadStatic(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCustomer = async (id: string) => {
    setLoading(true);
    try {
      const txns = await api.cylinderTransactions.list({ customer_id: id });
      setTransactions(txns);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!customerId) { setTransactions([]); return; }
    loadCustomer(customerId);
  }, [customerId]);

  const owedByCustomer = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of allBalances) {
      map[b.customer_id] = (map[b.customer_id] || 0) + parseFloat(b.balance);
    }
    return map;
  }, [allBalances]);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerBalances = allBalances.filter((b) => b.customer_id === customerId);

  const filtered = customers.filter((c) =>
    !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.mobile.includes(search) || (c.display_id ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const refreshBalances = async () => {
    const b = await api.cylinderTransactions.balances();
    setAllBalances(b);
  };

  const handleSubmit = async () => {
    setToast(null);
    if (!customerId || !productId) {
      setToast({ type: "error", msg: "Select a customer and a cylinder type first." });
      return;
    }
    const out = parseFloat(qtyOut) || 0;
    const inn = parseFloat(qtyIn) || 0;
    if (out <= 0 && inn <= 0) {
      setToast({ type: "error", msg: "Enter a quantity out or in." });
      return;
    }
    setSaving(true);
    try {
      await api.cylinderTransactions.create({
        date: new Date(`${date}T${new Date().toTimeString().split(" ")[0]}`).toISOString(),
        customer_id: customerId,
        product_id: productId,
        qty_out: out,
        qty_in: inn,
        notes: notes || undefined,
        entered_by: user?.name || "fatima",
      });
      setToast({ type: "success", msg: "Cylinder movement recorded." });
      setQtyOut("");
      setQtyIn("");
      setNotes("");
      await Promise.all([loadCustomer(customerId), refreshBalances()]);
    } catch (err: any) {
      setToast({ type: "error", msg: err?.message || "Failed to record movement." });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this cylinder entry? This reverses the balance.")) return;
    await api.cylinderTransactions.cancel(id, user?.name || "fatima");
    await Promise.all([loadCustomer(customerId), refreshBalances()]);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Cylinder Ledger"
        title="Empty cylinder returns & deposit balance"
        caption="Every sale dispatches filled cylinders and, if any come back the same day, records the exchange automatically. Use this page for standalone drop-offs and to see what each customer still owes back."
      />

      <div className="grid grid-cols-[0.65fr_1.5fr] gap-4">
        <Panel>
          <Eyebrow>Customers</Eyebrow>
          <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5 mb-3">
            <Search size={13} className="text-steel" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="border-none outline-none font-body text-xs py-1.5 w-full" />
          </div>
          <div className="flex flex-col gap-1.5 max-h-[520px] overflow-y-auto">
            {filtered.map((c) => {
              const owed = owedByCustomer[c.id] || 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setCustomerId(c.id)}
                  className={`text-left px-3 py-2.5 rounded-lg border ${customerId === c.id ? "border-teal bg-[#EAF6F6]" : "border-hairline bg-paper"}`}
                >
                  <div className="font-body text-[13px] font-semibold text-ink">{c.name}</div>
                  <div className="font-mono text-[10.5px] text-steel">{c.display_id ?? ""} · {c.mobile}</div>
                  <div className="mt-1 font-mono text-[12.5px] font-semibold">
                    {owed > 0 ? (
                      <span className="text-brand-amber">{owed} cylinder{owed === 1 ? "" : "s"} due</span>
                    ) : (
                      <span className="text-steel">Settled</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <div>
          {!customerId && (
            <Panel><div className="font-body text-[13px] text-steel py-10 text-center">Select a customer to see their cylinder balance.</div></Panel>
          )}

          {customerId && (
            <>
              <Panel className="mb-4">
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div>
                    <div className="font-display font-bold text-xl text-ink">{selectedCustomer?.name}</div>
                    <div className="font-mono text-xs text-steel mt-1">
                      {selectedCustomer?.display_id} · {selectedCustomer?.mobile}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: `repeat(${Math.max(products.length, 1)}, 1fr)` }}>
                  {products.map((p) => {
                    const bal = parseFloat(customerBalances.find((b) => b.product_id === p.id)?.balance || "0");
                    return (
                      <div key={p.id} className="px-3 py-2.5 bg-paper rounded-lg border border-hairline">
                        <Eyebrow>{p.name}</Eyebrow>
                        <div className={`font-display font-bold text-lg ${bal > 0 ? "text-brand-amber" : "text-ink"}`}>
                          {bal} {bal === 1 ? "cylinder" : "cylinders"}
                        </div>
                        <div className="font-mono text-[10.5px] text-steel">owed back to Dowa</div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel className="mb-4">
                <Eyebrow>Record a cylinder movement</Eyebrow>
                <SectionCaption>Use this for standalone drop-offs or collections — not tied to a sale.</SectionCaption>
                <div className="grid grid-cols-5 gap-3 items-end">
                  <Field label="Date">
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Cylinder Type">
                    <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Filled Out">
                    <input type="number" min="0" value={qtyOut} onChange={(e) => setQtyOut(e.target.value)} className={inputClass} placeholder="0" />
                  </Field>
                  <Field label="Empty In">
                    <input type="number" min="0" value={qtyIn} onChange={(e) => setQtyIn(e.target.value)} className={inputClass} placeholder="0" />
                  </Field>
                  <Button variant="primary" onClick={handleSubmit} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
                <div className="mt-3">
                  <Field label="Notes (optional)">
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
                  </Field>
                </div>
                {toast && (
                  <div className={`font-body text-[13px] p-2.5 rounded border flex items-center gap-2 mt-3 ${
                    toast.type === "success" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"
                  }`}>
                    {toast.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                    <span>{toast.msg}</span>
                  </div>
                )}
              </Panel>

              <Panel>
                <Eyebrow>Cylinder Movement History</Eyebrow>
                {loading && <div className="font-body text-steel p-4">Loading…</div>}
                {!loading && (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <Th>Date</Th><Th>ID</Th><Th>Type</Th><Th right>Out</Th><Th right>In</Th><Th>Notes</Th><Th>Source</Th><Th>{""}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t) => {
                        const p = products.find((x) => x.id === t.product_id);
                        return (
                          <tr key={t.id}>
                            <Td mono>{fmtTime(t.date)}</Td>
                            <Td mono>{t.display_id}</Td>
                            <Td>{p?.name || "—"}</Td>
                            <Td right mono>{parseFloat(t.qty_out) || "—"}</Td>
                            <Td right mono color="#1E8A5F">{parseFloat(t.qty_in) || "—"}</Td>
                            <Td>{t.notes || "—"}</Td>
                            <Td>{t.sale_id ? "Sale" : "Manual"}</Td>
                            <Td right>
                              {!t.sale_id && (
                                <button onClick={() => handleCancel(t.id)} className="font-body text-[12px] text-brand-red bg-transparent border-none cursor-pointer">
                                  Cancel
                                </button>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                      {!transactions.length && (
                        <tr><td colSpan={8} className="text-steel font-body text-[13px] py-4 text-center">No cylinder movements yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CylinderLedgerPage() {
  return (
   null
  );
}