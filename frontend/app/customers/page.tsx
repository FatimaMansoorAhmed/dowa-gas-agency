"use client";
import { useEffect, useState } from "react";
import { Search, ChevronRight, X, AlertTriangle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Field, inputClass, Button, Th, Td, BalanceTag } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr } from "@/lib/format";
import type { Customer } from "@/lib/types";

function CustomerBody() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", mobile: "", address: "", openingBalance: "" });
  const [adjustModal, setAdjustModal] = useState<Customer | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<"payment" | "charge">("payment");

  const load = async (q?: string) => setCustomers(await api.customers.list(q));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 250);
    return () => clearTimeout(t);
  }, [search]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.mobile.trim()) return;
    await api.customers.create({
      name: form.name.trim(), mobile: form.mobile.trim(), address: form.address.trim(),
      opening_balance: parseFloat(form.openingBalance) || 0,
    });
    setForm({ name: "", mobile: "", address: "", openingBalance: "" });
    load(search || undefined);
  };

  const submitAdjust = async () => {
    if (!adjustModal || !adjustAmount) return;
    await api.customers.adjust(adjustModal.id, adjustType, parseFloat(adjustAmount));
    setAdjustModal(null);
    setAdjustAmount("");
    load(search || undefined);
  };

  const excess = adjustModal && adjustAmount
    ? parseFloat(adjustAmount) - parseFloat(adjustModal.current_balance)
    : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Customers"
        title="Add and manage customer accounts"
        caption="Balances follow the advance convention — negative means the customer paid ahead, shown as Advance, not Balance Due."
      />

      <div className="grid grid-cols-[0.85fr_1.4fr] gap-4">
        <Panel>
          <Eyebrow>Add New Customer</Eyebrow>
          <div className="flex flex-col gap-3 mt-2">
            <Field label="Customer Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
            <Field label="Mobile Number"><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="03XX-XXXXXXX" className={inputClass} /></Field>
            <Field label="Address"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} /></Field>
            <Field label="Opening Balance"><input type="number" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} placeholder="0" className={inputClass} /></Field>
            <Button variant="primary" onClick={handleAdd} disabled={!form.name.trim() || !form.mobile.trim()}>Add Customer</Button>
          </div>
        </Panel>

        <Panel>
          <div className="flex justify-between items-center mb-1">
            <Eyebrow>Existing Customers ({customers.length})</Eyebrow>
            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search size={13} className="text-steel" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile" className="border-none outline-none font-body text-xs py-1.5 w-[190px]" />
            </div>
          </div>
          <table className="w-full border-collapse mt-2">
            <thead>
              <tr><Th>Name</Th><Th>Mobile</Th><Th right>Balance</Th><Th>Status</Th><Th right>Action</Th></tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <Td bold>{c.name}</Td>
                  <Td mono>{c.mobile}</Td>
                  <Td right><BalanceTag amount={c.current_balance} /></Td>
                  <Td>
                    <span className={`font-mono text-[10.5px] px-2 py-0.5 rounded-full ${c.status === "active" ? "bg-[#EAF5EF] text-brand-green" : "bg-[#F2F1EC] text-steel"}`}>
                      {c.status}
                    </span>
                  </Td>
                  <Td right>
                    <button
                      onClick={() => { setAdjustModal(c); setAdjustType("payment"); }}
                      className="bg-transparent border-none cursor-pointer text-teal font-body text-xs inline-flex items-center gap-1"
                    >
                      Record payment <ChevronRight size={12} />
                    </button>
                  </Td>
                </tr>
              ))}
              {!customers.length && <tr><td className="text-steel font-body text-[13px] py-3">No customers match.</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>

      {adjustModal && (
        <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-6 py-6 w-[360px]">
            <div className="flex justify-between items-center mb-1">
              <div className="font-display font-bold text-[17px] text-ink">{adjustModal.name}</div>
              <button onClick={() => setAdjustModal(null)} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
            </div>
            <div className="font-mono text-xs text-steel mb-4">
              Current: <BalanceTag amount={adjustModal.current_balance} />
            </div>
            <div className="flex gap-2 mb-3">
              {(["payment", "charge"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setAdjustType(t)}
                  className={`flex-1 py-2 rounded-md font-body text-xs font-semibold text-ink ${adjustType === t ? "border-2 border-teal bg-[#EAF6F6]" : "border border-hairline bg-white"}`}
                >
                  {t === "payment" ? "Record Payment" : "Add Charge"}
                </button>
              ))}
            </div>
            <Field label="Amount">
              <input type="number" autoFocus value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className={inputClass} />
            </Field>
            {adjustType === "payment" && adjustAmount && excess > 0 && (
              <div className="mt-2.5 px-2.5 py-2 bg-[#FBEAEA] rounded-md font-body text-xs text-brand-red flex gap-1.5 items-start">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>Excess of {pkr(excess)} will be recorded as credit-in-hand (advance).</span>
              </div>
            )}
            <div className="mt-4">
              <Button variant="primary" onClick={submitAdjust} disabled={!adjustAmount}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomerPage() {
  return (
    <AuthGate>
      <CustomerBody />
    </AuthGate>
  );
}
