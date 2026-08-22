"use client";
import { useEffect, useState } from "react";
import { Search, ChevronRight, X, AlertTriangle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Field, inputClass, Button, Th, Td, BalanceTag } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Customer, PaymentAccount } from "@/lib/types";

function CustomerBody() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", mobile: "", shopName: "", address: "", openingBalance: "" });

  const [payModal, setPayModal] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");
  const [payAccountId, setPayAccountId] = useState("");

  const [chargeModal, setChargeModal] = useState<Customer | null>(null);
  const [chargeAmount, setChargeAmount] = useState("");

  const load = async (q?: string) => setCustomers(await api.customers.list(q));
  useEffect(() => { load(); api.paymentAccounts.list().then(setAccounts); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 250);
    return () => clearTimeout(t);
  }, [search]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.mobile.trim()) return;
    await api.customers.create({
      name: form.name.trim(), mobile: form.mobile.trim(), shop_name: form.shopName.trim() || undefined,
      address: form.address.trim() || undefined, opening_balance: parseFloat(form.openingBalance) || 0,
    });
    setForm({ name: "", mobile: "", shopName: "", address: "", openingBalance: "" });
    load(search || undefined);
  };

  // Same endpoint the New Sale page's inline payment uses (§19) -- record it
  // once, here or there, and every screen that reads customer/payment data
  // reflects it. No page-specific balance math to keep in sync by hand.
  const submitPayment = async () => {
    if (!payModal || !payAmount || !payAccountId || !user) return;
    await api.payments.create({
      date: new Date().toISOString(), customer_id: payModal.id, amount: parseFloat(payAmount),
      method: payMethod, account_id: payAccountId, entered_by: user.name,
    });
    setPayModal(null); setPayAmount(""); setPayAccountId("");
    load(search || undefined);
  };

  const submitCharge = async () => {
    if (!chargeModal || !chargeAmount) return;
    await api.customers.adjust(chargeModal.id, "charge", parseFloat(chargeAmount));
    setChargeModal(null); setChargeAmount("");
    load(search || undefined);
  };

  const excess = payModal && payAmount ? parseFloat(payAmount) - parseFloat(payModal.current_balance) : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Customers"
        title="Add and manage customer accounts"
        caption="Balances follow the advance convention -- negative means the customer paid ahead, shown as Advance, not Balance Due. Payments recorded here use the same ledger as New Sale."
      />

      <div className="grid grid-cols-[0.85fr_1.4fr] gap-4">
        <Panel>
          <Eyebrow>Add New Customer</Eyebrow>
          <div className="flex flex-col gap-3 mt-2">
            <Field label="Customer Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
            <Field label="Mobile Number"><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="03XX-XXXXXXX" className={inputClass} /></Field>
            <Field label="Shop / Business Name (optional)"><input value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} className={inputClass} /></Field>
            <Field label="Address (optional)"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} /></Field>
            <Field label="Opening Balance"><input type="number" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} placeholder="0" className={inputClass} /></Field>
            <Button variant="primary" onClick={handleAdd} disabled={!form.name.trim() || !form.mobile.trim()}>Add Customer</Button>
          </div>
        </Panel>

        <Panel>
          <div className="flex justify-between items-center mb-1">
            <Eyebrow>Existing Customers ({customers.length})</Eyebrow>
            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search size={13} className="text-steel" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile, shop, or ID" className="border-none outline-none font-body text-xs py-1.5 w-[190px]" />
            </div>
          </div>
          <table className="w-full border-collapse mt-2">
            <thead>
              <tr><Th>ID</Th><Th>Name</Th><Th>Mobile</Th><Th right>Balance</Th><Th>Status</Th><Th right>Action</Th></tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <Td mono>{c.display_id}</Td>
                  <Td bold>{c.name}{c.shop_name ? <span className="text-steel font-normal"> · {c.shop_name}</span> : ""}</Td>
                  <Td mono>{c.mobile}</Td>
                  <Td right><BalanceTag amount={c.current_balance} /></Td>
                  <Td>
                    <span className={`font-mono text-[10.5px] px-2 py-0.5 rounded-full ${c.status === "active" ? "bg-[#EAF5EF] text-brand-green" : "bg-[#F2F1EC] text-steel"}`}>
                      {c.status}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex gap-2.5 justify-end">
                      <button onClick={() => setChargeModal(c)} className="bg-transparent border-none cursor-pointer text-steel font-body text-xs">
                        Add charge
                      </button>
                      <button
                        onClick={() => { setPayModal(c); setPayAccountId(""); setPayAmount(""); }}
                        className="bg-transparent border-none cursor-pointer text-teal font-body text-xs inline-flex items-center gap-1"
                      >
                        Record payment <ChevronRight size={12} />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
              {!customers.length && <tr><td className="text-steel font-body text-[13px] py-3">No customers match.</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>

      {payModal && (
        <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-6 py-6 w-[380px]">
            <div className="flex justify-between items-center mb-1">
              <div className="font-display font-bold text-[17px] text-ink">{payModal.name}</div>
              <button onClick={() => setPayModal(null)} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
            </div>
            <div className="font-mono text-xs text-steel mb-4">
              Current: <BalanceTag amount={payModal.current_balance} />
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Amount">
                <input type="number" autoFocus value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Method">
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} className={inputClass}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online Payment</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Pay To (Account)">
                <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} className={inputClass}>
                  <option value="">Select account</option>
                  {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
            {payAmount && excess > 0 && (
              <div className="mt-2.5 px-2.5 py-2 bg-[#FBEAEA] rounded-md font-body text-xs text-brand-red flex gap-1.5 items-start">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>Excess of {pkr(excess)} will be recorded as account credit (advance).</span>
              </div>
            )}
            <div className="mt-4">
              <Button variant="primary" onClick={submitPayment} disabled={!payAmount || !payAccountId}>Save Payment</Button>
            </div>
          </div>
        </div>
      )}

      {chargeModal && (
        <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-6 py-6 w-[360px]">
            <div className="flex justify-between items-center mb-1">
              <div className="font-display font-bold text-[17px] text-ink">{chargeModal.name}</div>
              <button onClick={() => setChargeModal(null)} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
            </div>
            <div className="font-mono text-xs text-steel mb-4">
              Current: <BalanceTag amount={chargeModal.current_balance} />
            </div>
            <div className="font-body text-[11.5px] text-steel mb-3">
              For manual balance corrections only -- a real sale should go through New Sale so it's tied to a product and rate.
            </div>
            <Field label="Amount">
              <input type="number" autoFocus value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className={inputClass} />
            </Field>
            <div className="mt-4">
              <Button variant="primary" onClick={submitCharge} disabled={!chargeAmount}>Save Charge</Button>
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
