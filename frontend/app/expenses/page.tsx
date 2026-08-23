"use client";
import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Check, X } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { ExpenseCategory, PaymentAccount, Expense } from "@/lib/types";

function todayLocalInput() {
  return new Date().toISOString().slice(0, 10);
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ExpensesBody() {
  const { user } = useAuth();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [monthExpenses, setMonthExpenses] = useState<Expense[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<Expense[]>([]);

  const [date, setDate] = useState(todayLocalInput());
  const [categoryId, setCategoryId] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [referenceNo, setReferenceNo] = useState("");

  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const month = currentMonth();

  const load = async () => {
    const [cats, accs, monthList, allRecent] = await Promise.all([
      api.expenseCategories.list(), api.paymentAccounts.list(),
      api.expenses.list({ month }), api.expenses.list(),
    ]);
    setCategories(cats); setAccounts(accs); setMonthExpenses(monthList);
    setRecentExpenses(allRecent.slice(0, 10));
  };
  useEffect(() => { load(); }, []);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    const c = await api.expenseCategories.create(newCategoryName.trim());
    setCategories((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    setCategoryId(c.id);
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const canSubmit = date && categoryId && parseFloat(amount) > 0 && accountId;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    try {
      await api.expenses.create({
       date: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        category_id: categoryId, amount: parseFloat(amount), account_id: accountId,
        method, description: description || undefined, vendor: vendor || undefined,
        reference_no: referenceNo || undefined, entered_by: user.name,
      });
      setToast("Expense saved.");
      setAmount(""); setDescription(""); setVendor(""); setReferenceNo("");
      await load();
      setTimeout(() => setToast(null), 2200);
    } finally {
      setSaving(false);
    }
  };

  const totalMTD = monthExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    monthExpenses.forEach((e) => {
      map.set(e.category_id, (map.get(e.category_id) || 0) + parseFloat(e.amount));
    });
    return Array.from(map.entries())
      .map(([categoryId, amount]) => ({
        category: categories.find((c) => c.id === categoryId),
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthExpenses, categories]);

  return (
    <div>
      <PageHeader
        eyebrow="Expenses"
        title="Record and track business spending"
        caption="Strictly separate from customer payments — an expense reduces the paying account only, never a customer's balance."
      />

      <div className="grid grid-cols-[1fr_1.3fr] gap-4 mb-4">
        <Panel>
          <div className="flex flex-col gap-3.5">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>

            <Field label="Category">
              {!addingCategory ? (
                <div className="flex gap-1.5">
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputClass} flex-1`}>
                    <option value="">Select category</option>
                    {categories.filter((c) => c.active === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <Button variant="outline" onClick={() => setAddingCategory(true)}><PlusCircle size={14} /> Add</Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input autoFocus value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="New category name" className={`${inputClass} flex-1`} />
                  <Button variant="teal" onClick={handleAddCategory}><Check size={14} /> Save</Button>
                  <Button variant="outline" onClick={() => { setAddingCategory(false); setNewCategoryName(""); }}><X size={14} /> Cancel</Button>
                </div>
              )}
            </Field>

            <Field label="Amount">
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputClass} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputClass}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online Payment</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Paid From (Account)">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                  <option value="">Select account</option>
                  {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Vendor / Person (optional)">
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Reference Number (optional)">
              <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Description (optional)">
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
            </Field>

            <Field label="Entered by"><input value={user?.name || ""} disabled className={`${inputClass} bg-paper text-steel`} /></Field>

            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
              {saving ? "Saving…" : "Save Expense"}
            </Button>
            {toast && <div className="font-body text-[12.5px] text-brand-green flex items-center gap-1.5"><Check size={13} /> {toast}</div>}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel>
            <Eyebrow>This Month — {month}</Eyebrow>
            <SectionCaption>Total spent and where it went, updates as you log entries.</SectionCaption>
            <div className="flex justify-between items-center px-3 py-2.5 bg-ink rounded-lg mb-3">
              <span className="font-mono text-[11px] text-[#9FD8D8] tracking-wide">TOTAL EXPENSES</span>
              <span className="font-display font-bold text-lg text-white">{pkr(totalMTD)}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {byCategory.map((row) => (
                <div key={row.category?.id || "uncategorized"} className="flex justify-between items-center px-3 py-2 bg-paper rounded-md border border-hairline">
                  <span className="font-body text-[13px] text-ink">{row.category?.name || "Uncategorized"}</span>
                  <span className="font-mono text-[13px] font-semibold text-ink">{pkr(row.amount)}</span>
                </div>
              ))}
              {!byCategory.length && <div className="font-body text-[13px] text-steel">No expenses recorded this month yet.</div>}
            </div>
          </Panel>

          <Panel>
            <Eyebrow>Recent Expenses</Eyebrow>
            <SectionCaption>Last 10 entries across all months, most recent first.</SectionCaption>
            <table className="w-full border-collapse">
              <thead><tr><Th>ID</Th><Th>Category</Th><Th right>Amount</Th><Th right>Date</Th></tr></thead>
              <tbody>
                {recentExpenses.map((e) => {
                  const cat = categories.find((c) => c.id === e.category_id);
                  return (
                    <tr key={e.id}>
                      <Td mono>{e.display_id}</Td>
                      <Td bold>{cat?.name || "—"}</Td>
                      <Td right mono color="#C8102E">{pkr(e.amount)}</Td>
                      <Td right mono>{fmtTime(e.date)}</Td>
                    </tr>
                  );
                })}
                {!recentExpenses.length && <tr><td className="text-steel font-body text-[13px] py-3">No expenses recorded yet.</td></tr>}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default function ExpensesPage() {
  return (
    <AuthGate>
      <ExpensesBody />
    </AuthGate>
  );
}