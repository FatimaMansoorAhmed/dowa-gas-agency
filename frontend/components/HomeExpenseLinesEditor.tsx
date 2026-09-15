"use client";
import { useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { inputClass } from "./ui";
import AmountInput from "./AmountInput";
import { api } from "@/lib/api";
import { pkr } from "@/lib/format";
import type { ExpenseCategory, Employee } from "@/lib/types";

// § Employee Salary Tracking — same check as SettlementDestinationFields'
// own isSalaryCategorySelected (mirrors backend utils.SALARY_CATEGORY_NAME);
// duplicated here as a tiny local copy rather than imported, since
// SettlementDestinationFields itself imports FROM this file (a shared
// import the other way round would be circular).
function isSalaryCategorySelected(categories: ExpenseCategory[], categoryId: string): boolean {
  const cat = categories.find((c) => c.id === categoryId);
  return !!(cat?.is_system && cat.name === "Salary");
}

/** Multi-line categorized Home Expense editor (§ Multi-line Categorized
 * Home Expense) — used inside a Shop Sale's settlement Deductions section
 * (via SettlementDestinationFields' homeExpenseLines prop). NOT currently
 * wired into CorrectTransactionModal's Shop Sale correction form — that
 * form doesn't send ANY settlement fields on correction yet (a pre-
 * existing gap: correcting a Shop Sale silently drops its whole
 * settlement routing, single-amount Home Expense included, not just the
 * multi-line case), so there's nothing here for this editor to plug into
 * until that's fixed separately. Distinct from the deleted
 * ExpenseWithdrawLines: that component submitted its lines as a SEPARATE
 * second API call after a sale/payment succeeded; these lines are part of
 * the SAME settlement transaction (bypass_sum subtracted from gross
 * before net_settlement_amount is computed) — see
 * routers/shops.py::_apply_shop_sale. */
export type HomeExpenseLine = { category_id: string; employee_id: string; amount: string; description: string };

export const emptyHomeExpenseLine = (): HomeExpenseLine => ({ category_id: "", employee_id: "", amount: "", description: "" });

export function homeExpenseLinesTotal(lines: HomeExpenseLine[]): number {
  return lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
}

export function hasFilledHomeExpenseLines(lines: HomeExpenseLine[]): boolean {
  return lines.some((l) => parseFloat(l.amount) > 0);
}

// Only lines with a filled amount block submission — an untouched blank
// line never blocks the sale itself, same convention as expenseLinesValid
// on the deleted ExpenseWithdrawLines.
export function homeExpenseLinesValid(lines: HomeExpenseLine[], categories: ExpenseCategory[]): boolean {
  return lines
    .filter((l) => parseFloat(l.amount) > 0)
    .every((l) => !!l.category_id && (!isSalaryCategorySelected(categories, l.category_id) || !!l.employee_id));
}

export function toHomeExpenseLinesPayload(lines: HomeExpenseLine[]) {
  return lines
    .filter((l) => parseFloat(l.amount) > 0)
    .map((l) => ({
      category_id: l.category_id,
      amount: parseFloat(l.amount),
      employee_id: l.employee_id || undefined,
      description: l.description || undefined,
    }));
}

export default function HomeExpenseLinesEditor({
  lines, onChange, categories, onCategoriesChange, employees,
}: {
  lines: HomeExpenseLine[];
  onChange: (lines: HomeExpenseLine[]) => void;
  categories: ExpenseCategory[];
  onCategoriesChange: (categories: ExpenseCategory[]) => void;
  employees: Employee[];
}) {
  const { t } = useTranslation();
  const [addingCategoryFor, setAddingCategoryFor] = useState<number | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");

  const updateLine = (i: number, patch: Partial<HomeExpenseLine>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // § Add a new expense category on the spot — exact same api.expenseCategories.create
  // pattern already used on the main Expenses page (app/expenses/page.tsx's
  // handleAddCategory), reused here rather than re-implemented.
  const handleAddCategory = async (i: number) => {
    if (!newCategoryName.trim()) return;
    const c = await api.expenseCategories.create(newCategoryName.trim());
    onCategoriesChange(categories.some((x) => x.id === c.id) ? categories : [...categories, c]);
    updateLine(i, { category_id: c.id, employee_id: "" });
    setNewCategoryName("");
    setAddingCategoryFor(null);
  };

  if (lines.length === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange([emptyHomeExpenseLine()])}
        className="flex items-center gap-1 text-[12px] font-body text-teal bg-transparent border-none cursor-pointer w-fit"
      >
        <Plus size={13} /> {t("modals.addALine")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, i) => {
        const isSalary = isSalaryCategorySelected(categories, line.category_id);
        return (
          <div key={i} className="overflow-x-auto">
            <div className="grid grid-cols-[1.3fr_0.8fr_1.1fr_auto] gap-2 items-start min-w-[460px]">
              <div className="flex flex-col gap-1">
                {addingCategoryFor === i ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder={t("expenses.newCategoryNamePlaceholder")}
                      className={inputClass}
                      onKeyDown={(e) => e.key === "Enter" && handleAddCategory(i)}
                    />
                    <button type="button" onClick={() => handleAddCategory(i)} className="bg-transparent border-none cursor-pointer text-teal">
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddingCategoryFor(null); setNewCategoryName(""); }}
                      className="bg-transparent border-none cursor-pointer text-steel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <select
                    value={line.category_id}
                    onChange={(e) => {
                      if (e.target.value === "__add__") { setAddingCategoryFor(i); return; }
                      updateLine(i, { category_id: e.target.value, employee_id: "" });
                    }}
                    className={inputClass}
                  >
                    <option value="">{t("modals.selectCategory2")}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                    <option value="__add__">+ {t("expenses.add")}</option>
                  </select>
                )}
                {isSalary && (
                  <select value={line.employee_id} onChange={(e) => updateLine(i, { employee_id: e.target.value })} className={inputClass}>
                    <option value="">{t("expenses.selectEmployee")}</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <AmountInput value={line.amount} onChange={(v) => updateLine(i, { amount: v })} placeholder={t("modals.amountPlaceholderShort")} className={inputClass} />

              <input
                value={line.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
                placeholder={t("modals.descriptionOptionalPlaceholder")}
                className={inputClass}
              />

              <button
                type="button"
                onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                className="bg-transparent border-none cursor-pointer text-steel hover:text-brand-red mt-1.5"
                title={t("modals.removeLineTitle")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange([...lines, emptyHomeExpenseLine()])}
          className="flex items-center gap-1 text-[12px] font-body text-teal bg-transparent border-none cursor-pointer w-fit"
        >
          <Plus size={13} /> {t("modals.addLine")}
        </button>
        {hasFilledHomeExpenseLines(lines) && (
          <span className="font-mono text-[11px] text-steel">
            {t("modals.homeExpenseLinesTotal", { amount: pkr(homeExpenseLinesTotal(lines)) })}
          </span>
        )}
      </div>
    </div>
  );
}
