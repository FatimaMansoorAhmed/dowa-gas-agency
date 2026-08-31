"use client";
import { useEffect, useState } from "react";
import { X, Check, Plus, Trash2 } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput } from "@/lib/format";
import type { ExpenseCategory } from "@/lib/types";

type Line = { category_id: string; line_type: "expense" | "owner_withdrawal"; amount: string; description: string };

const emptyLine = (): Line => ({ category_id: "", line_type: "expense", amount: "", description: "" });

/** Record Expenses — ONE atomic cash-out transaction with 1+ categorized
 * lines (§20-21): a single owner withdrawal split into Fuel/Salary/Home is
 * entered here as one submission, never as N separate expense entries.
 * Each line is independently tagged expense vs owner_withdrawal (§22-23)
 * so Home/personal withdrawals never get silently counted as a business
 * expense, even when entered alongside genuine ones. */
export default function RecordShopExpenseModal({
  shopId, onClose, onSaved,
}: { shopId: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [date, setDate] = useState(todayLocalInput());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [paymentSource, setPaymentSource] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.expenseCategories.list().then(setCategories); }, []);

  const total = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const canSubmit = date && lines.length > 0 && lines.every((l) => l.category_id && parseFloat(l.amount) > 0);

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
          category_id: l.category_id,
          line_type: l.line_type,
          amount: parseFloat(l.amount),
          description: l.description || undefined,
        })),
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
      <div className="bg-white rounded-xl px-6 py-6 w-[560px] max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Record Expenses</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Payment Source (optional)">
              <input value={paymentSource} onChange={(e) => setPaymentSource(e.target.value)} placeholder="e.g. cash drawer" className={inputClass} />
            </Field>
          </div>

          <div className="font-mono text-[10px] uppercase text-steel mt-1">Lines</div>
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1.3fr_1fr_0.9fr_1.3fr_auto] gap-2 items-center">
              <select value={line.category_id} onChange={(e) => updateLine(i, { category_id: e.target.value })} className={inputClass}>
                <option value="">Category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={line.line_type} onChange={(e) => updateLine(i, { line_type: e.target.value as Line["line_type"] })} className={inputClass}>
                <option value="expense">Expense</option>
                <option value="owner_withdrawal">Owner Withdrawal</option>
              </select>
              <input
                type="number" value={line.amount} onChange={(e) => updateLine(i, { amount: e.target.value })}
                placeholder="Amount" className={inputClass}
              />
              <input
                value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })}
                placeholder="Description (optional)" className={inputClass}
              />
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
