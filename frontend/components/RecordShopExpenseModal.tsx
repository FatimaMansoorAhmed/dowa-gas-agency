"use client";
import { useEffect, useState } from "react";
import { X, Check, Plus, Trash2 } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import AmountInput from "./AmountInput";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput } from "@/lib/format";
import type { ExpenseCategory, PaymentAccount } from "@/lib/types";

type Line = { category_id: string; line_type: "expense" | "owner_withdrawal"; amount: string; description: string };

const emptyLine = (): Line => ({ category_id: "", line_type: "expense", amount: "", description: "" });

export default function RecordShopExpenseModal({
  shopId, onClose, onSaved,
}: { shopId: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [date, setDate] = useState(todayLocalInput());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [accountId, setAccountId] = useState("");
  const [paymentSource, setPaymentSource] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.expenseCategories.list().then(setCategories); }, []);
  useEffect(() => { api.paymentAccounts.list().then((a) => setAccounts(a.filter((x) => x.active === "active"))); }, []);

  const total = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  const canSubmit = date && lines.length > 0 && lines.every(
    (l) => (l.line_type === "owner_withdrawal" || l.category_id) && parseFloat(l.amount) > 0
  );

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

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

      await api.shops.expenses.create(shopId, {
        date: isoDate,
        lines: lines.map((l) => ({
          category_id: l.line_type === "expense" ? l.category_id : undefined,
          line_type: l.line_type,
          amount: parseFloat(l.amount),
          description: l.description || undefined,
        })),
        account_id: accountId || undefined,
        payment_source: paymentSource || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      onSaved();
    } catch (e) {
      setError("Could not save — check every line has a category and a positive amount.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50">
      <div className="bg-white rounded-xl px-6 py-6 w-[620px] max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Record Expenses</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Debit From Account">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                <option value="">Shop Cash (default)</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Payment Source Note (optional)">
            <input value={paymentSource} onChange={(e) => setPaymentSource(e.target.value)} placeholder="e.g. cash drawer" className={inputClass} />
          </Field>

          <div className="font-mono text-[10px] uppercase text-steel mt-1">Lines</div>
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1.3fr_1.3fr_0.9fr_1.3fr_auto] gap-2 items-center">
              {/* 1. TYPE FIRST: Expense vs Owner Withdrawal */}
              <select
                value={line.line_type}
                onChange={(e) => {
                  const type = e.target.value as Line["line_type"];
                  updateLine(i, {
                    line_type: type,
                    category_id: type === "owner_withdrawal" ? "" : line.category_id,
                  });
                }}
                className={inputClass}
              >
                <option value="expense">Expense</option>
                <option value="owner_withdrawal">Owner Withdrawal</option>
              </select>

              {/* 2. CATEGORY SECOND: Clean disabled input box for Owner Withdrawal */}
              {line.line_type === "expense" ? (
                <select
                  value={line.category_id}
                  onChange={(e) => updateLine(i, { category_id: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  disabled
                  value="—"
                  className={`${inputClass} bg-slate-100/70 text-slate-400 cursor-not-allowed text-center font-mono`}
                />
              )}

              {/* 3. AMOUNT */}
              <AmountInput
                value={line.amount}
                onChange={(v) => updateLine(i, { amount: v })}
                placeholder="Amount"
                className={inputClass}
              />

              {/* 4. DESCRIPTION */}
              <input
                value={line.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
                placeholder="Description (optional)"
                className={inputClass}
              />

              {/* DELETE BUTTON */}
              <button
                onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1}
                className="bg-transparent border-none cursor-pointer text-steel hover:text-brand-red disabled:opacity-30"
                title="Remove line"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="flex items-center gap-1 text-[12px] font-body text-teal bg-transparent border-none cursor-pointer w-fit"
          >
            <Plus size={13} /> Add line
          </button>

          <Field label="Notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>

          <div className="flex justify-between items-center border-t border-hairline pt-2 mt-1">
            <span className="font-mono text-[11px] uppercase text-steel">Total</span>
            <span className="font-mono font-bold text-[16px] text-ink">{total.toFixed(2)}</span>
          </div>
        </div>
        {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
        <div className="mt-4">
          <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Expense Transaction"}
          </Button>
        </div>
      </div>
    </div>
  );
}