"use client";
import { Plus, Trash2 } from "lucide-react";
import { inputClass } from "./ui";
import AmountInput from "./AmountInput";
import type { ExpenseCategory } from "@/lib/types";

/** Shared "Expense / Withdrawal" line-editor — the exact same shape
 * RecordShopExpenseModal.tsx already submits to POST /shops/{shop_id}/
 * expenses (line_type "expense"|"owner_withdrawal", category_id required
 * only for "expense", amount, description). Reused here (rather than
 * duplicated) so Record Customer Payment / Record Sale can optionally
 * attach the same kind of line, submitted as a SEPARATE second call to
 * that same existing endpoint after the sale/payment itself succeeds —
 * two independent real-world events, not a new combined backend
 * transaction (§6). Starts collapsed (zero lines) since it's optional;
 * expands into the full per-line editor once the first line is added. */
export type ExpenseLine = { category_id: string; line_type: "expense" | "owner_withdrawal"; amount: string; description: string };

export const emptyExpenseLine = (): ExpenseLine => ({ category_id: "", line_type: "expense", amount: "", description: "" });

// Only lines with a filled amount count — an untouched blank line never
// blocks submission of the sale/payment itself.
export function expenseLinesValid(lines: ExpenseLine[]): boolean {
  return lines
    .filter((l) => parseFloat(l.amount) > 0)
    .every((l) => l.line_type === "owner_withdrawal" || !!l.category_id);
}

export function hasFilledExpenseLines(lines: ExpenseLine[]): boolean {
  return lines.some((l) => parseFloat(l.amount) > 0);
}

export function toExpenseLinesPayload(lines: ExpenseLine[]) {
  return lines
    .filter((l) => parseFloat(l.amount) > 0)
    .map((l) => ({
      category_id: l.line_type === "expense" ? l.category_id : undefined,
      line_type: l.line_type,
      amount: parseFloat(l.amount),
      description: l.description || undefined,
    }));
}

export default function ExpenseWithdrawLines({
  lines, onChange, categories,
}: {
  lines: ExpenseLine[];
  onChange: (lines: ExpenseLine[]) => void;
  categories: ExpenseCategory[];
}) {
  const updateLine = (i: number, patch: Partial<ExpenseLine>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  if (lines.length === 0) {
    // A bare link here read as decoration, not a form section — easy to
    // scroll past on a long form (§ Expense/Withdraw discoverability) —
    // so the collapsed state keeps the same bordered-box + label frame as
    // the expanded one below, just without any lines in it yet.
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
        <div className="font-mono text-[10px] uppercase text-steel">Expense / Withdrawal (optional)</div>
        <button
          type="button"
          onClick={() => onChange([emptyExpenseLine()])}
          className="flex items-center gap-1 text-[12px] font-body text-teal bg-transparent border-none cursor-pointer w-fit"
        >
          <Plus size={13} /> Add a line
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
      <div className="font-mono text-[10px] uppercase text-steel">Expense / Withdrawal (optional)</div>

      {lines.map((line, i) => (
        <div key={i} className="overflow-x-auto">
        <div className="grid grid-cols-[1.1fr_1.1fr_0.8fr_1.1fr_auto] gap-2 items-center min-w-[520px]">
          <select
            value={line.line_type}
            onChange={(e) => {
              const type = e.target.value as ExpenseLine["line_type"];
              updateLine(i, { line_type: type, category_id: type === "owner_withdrawal" ? "" : line.category_id });
            }}
            className={inputClass}
          >
            <option value="expense">Expense</option>
            <option value="owner_withdrawal">Owner Withdrawal</option>
          </select>

          {line.line_type === "expense" ? (
            <select value={line.category_id} onChange={(e) => updateLine(i, { category_id: e.target.value })} className={inputClass}>
              <option value="">Category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <input type="text" disabled value="—" className={`${inputClass} bg-slate-100/70 text-slate-400 cursor-not-allowed text-center font-mono`} />
          )}

          <AmountInput value={line.amount} onChange={(v) => updateLine(i, { amount: v })} placeholder="Amount" className={inputClass} />

          <input
            value={line.description}
            onChange={(e) => updateLine(i, { description: e.target.value })}
            placeholder="Description (optional)"
            className={inputClass}
          />

          <button
            type="button"
            onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
            className="bg-transparent border-none cursor-pointer text-steel hover:text-brand-red"
            title="Remove line"
          >
            <Trash2 size={14} />
          </button>
        </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...lines, emptyExpenseLine()])}
        className="flex items-center gap-1 text-[12px] font-body text-teal bg-transparent border-none cursor-pointer w-fit"
      >
        <Plus size={13} /> Add line
      </button>
    </div>
  );
}
