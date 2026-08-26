"use client";

import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Check, X, CalendarDays, Filter, Receipt } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import {
  PageHeader,
  Panel,
  Eyebrow,
  SectionCaption,
  Field,
  inputClass,
  Button,
  Th,
  Td,
} from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type {
  ExpenseCategory,
  PaymentAccount,
  Expense,
} from "@/lib/types";

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" / "this year" defaults match the Karachi calendar too.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function currentYear() {
  return todayLocalInput().slice(0, 4);
}

type FilterType = "all" | "day" | "month" | "year";

function ExpensesBody() {
  const { user } = useAuth();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);

  // Form visibility
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  // Expense form
  const [date, setDate] = useState(todayLocalInput());
  const [categoryId, setCategoryId] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<
    "cash" | "bank_transfer" | "cheque" | "online" | "other"
  >("cash");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [referenceNo, setReferenceNo] = useState("");

  // UI state
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState<FilterType>("month");
  const [filterDay, setFilterDay] = useState(todayLocalInput());
  const [filterMonth, setFilterMonth] = useState(currentMonth());
  const [filterYear, setFilterYear] = useState(currentYear());

  const month = currentMonth();

  const load = async () => {
    const [cats, accs, expenses] = await Promise.all([
      api.expenseCategories.list(),
      api.paymentAccounts.list(),
      api.expenses.list(),
    ]);

    setCategories(cats);
    setAccounts(accs);
    setAllExpenses(expenses);
  };

  useEffect(() => {
    load();
  }, []);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;

    const c = await api.expenseCategories.create(
      newCategoryName.trim()
    );

    setCategories((prev) =>
      prev.some((x) => x.id === c.id)
        ? prev
        : [...prev, c]
    );

    setCategoryId(c.id);
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const canSubmit =
    date &&
    categoryId &&
    parseFloat(amount) > 0 &&
    accountId;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;

    setSaving(true);

    try {
      await api.expenses.create({
        date: new Date(
          `${date}T${new Date().toTimeString().slice(0, 8)}`
        ).toISOString(),

        category_id: categoryId,
        amount: parseFloat(amount),
        account_id: accountId,
        method,
        description: description || undefined,
        vendor: vendor || undefined,
        reference_no: referenceNo || undefined,
        entered_by: user.name,
      });

      setToast("Expense saved.");

      setAmount("");
      setDescription("");
      setVendor("");
      setReferenceNo("");

      await load();

      setTimeout(() => setToast(null), 2200);
    } finally {
      setSaving(false);
    }
  };

  /*
   * FILTERED EXPENSES
   *
   * This is UI-side filtering.
   * No API/backend logic is changed.
   */
  const filteredExpenses = useMemo(() => {
    if (filterType === "all") {
      return allExpenses;
    }

    return allExpenses.filter((expense) => {
      // Asia/Karachi calendar date, not the viewer's own local date — see
      // toKarachiDateString (§ Day-wise Date Filtering Mismatch).
      const expenseDay = toKarachiDateString(expense.date);
      if (!expenseDay) return false;

      if (filterType === "day") {
        return expenseDay === filterDay;
      }

      if (filterType === "month") {
        return expenseDay.slice(0, 7) === filterMonth;
      }

      if (filterType === "year") {
        return expenseDay.slice(0, 4) === filterYear;
      }

      return true;
    });
  }, [
    allExpenses,
    filterType,
    filterDay,
    filterMonth,
    filterYear,
  ]);

  /*
   * CURRENT MONTH SUMMARY
   *
   * Keeps the original "This Month" summary.
   */
  const monthExpenses = useMemo(() => {
    return allExpenses.filter((expense) => {
      const expenseDay = toKarachiDateString(expense.date);
      return !!expenseDay && expenseDay.slice(0, 7) === month;
    });
  }, [allExpenses, month]);

  const totalMTD = monthExpenses.reduce(
    (sum, expense) => sum + parseFloat(expense.amount),
    0
  );

  /*
   * FILTERED TOTAL
   */
  const filteredTotal = filteredExpenses.reduce(
    (sum, expense) => sum + parseFloat(expense.amount),
    0
  );

  /*
   * CATEGORY BREAKDOWN
   */
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();

    monthExpenses.forEach((expense) => {
      map.set(
        expense.category_id,
        (map.get(expense.category_id) || 0) +
          parseFloat(expense.amount)
      );
    });

    return Array.from(map.entries())
      .map(([categoryId, amount]) => ({
        category: categories.find(
          (category) => category.id === categoryId
        ),
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthExpenses, categories]);

  /*
   * FILTERED CATEGORY BREAKDOWN
   */
  const filteredByCategory = useMemo(() => {
    const map = new Map<string, number>();

    filteredExpenses.forEach((expense) => {
      map.set(
        expense.category_id,
        (map.get(expense.category_id) || 0) +
          parseFloat(expense.amount)
      );
    });

    return Array.from(map.entries())
      .map(([categoryId, amount]) => ({
        category: categories.find(
          (category) => category.id === categoryId
        ),
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredExpenses, categories]);

  /*
   * Show latest 10 from current filter.
   */
  const recentExpenses = filteredExpenses.slice(0, 10);

  const filterLabel =
    filterType === "all"
      ? "All Expenses"
      : filterType === "day"
      ? `Day — ${filterDay}`
      : filterType === "month"
      ? `Month — ${filterMonth}`
      : `Year — ${filterYear}`;

  return (
    <div className="min-h-screen">

      {/* ============================================================
          HEADER
      ============================================================ */}

      <PageHeader
        eyebrow="Expenses"
        title="Expense Management"
        caption="Record business spending, track where funds were used, and monitor your expenses."
      />

      {/* ============================================================
          RECORD EXPENSE BOX
      ============================================================ */}

      {!showExpenseForm && (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => setShowExpenseForm(true)}
            className="w-full rounded-xl border border-hairline bg-paper px-5 py-5 text-left transition-all hover:border-ink/30 hover:shadow-sm"
          >
            <div className="flex items-center justify-between gap-4">

              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink">
                  <PlusCircle
                    size={19}
                    className="text-[#9FD8D8]"
                  />
                </div>

                <div>
                  <div className="font-display text-[17px] font-semibold text-ink">
                    Record an Expense
                  </div>

                  <div className="mt-1 font-body text-[12px] text-steel">
                    Add a new business expense and select the account it was paid from.
                  </div>
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5">
                <PlusCircle size={14} className="text-white" />

                <span className="font-body text-[12px] font-medium text-white">
                  New Expense
                </span>
              </div>

            </div>
          </button>
        </div>
      )}

      {/* ============================================================
          EXPENSE FORM
      ============================================================ */}

      {showExpenseForm && (
        <div className="mb-5">
          <Panel>

            <div className="flex items-start justify-between gap-4 pb-5 border-b border-hairline">

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
                    <PlusCircle
                      size={16}
                      className="text-[#9FD8D8]"
                    />
                  </div>

                  <Eyebrow>New Expense</Eyebrow>
                </div>

                <h2 className="font-display text-[19px] font-semibold text-ink">
                  Record an expense
                </h2>

                <p className="mt-1 font-body text-[12px] text-steel">
                  Enter the payment details below to create a new expense entry.
                </p>
              </div>

              <Button
                variant="outline"
                onClick={() => setShowExpenseForm(false)}
              >
                <X size={14} />
                Close
              </Button>

            </div>

            <div className="mt-5 flex flex-col gap-5">

              {/* BASIC INFORMATION */}

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-paper font-mono text-[9px] text-steel">
                    01
                  </span>

                  <span className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-steel">
                    Expense details
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                  <Field label="Date">
                    <input
                      type="date"
                      value={date}
                      onChange={(e) =>
                        setDate(e.target.value)
                      }
                      className={`${inputClass} h-11`}
                    />
                  </Field>

                  <Field label="Category">
                    {!addingCategory ? (
                      <div className="flex gap-2">
                        <select
                          value={categoryId}
                          onChange={(e) =>
                            setCategoryId(e.target.value)
                          }
                          className={`${inputClass} h-11 flex-1`}
                        >
                          <option value="">
                            Select category
                          </option>

                          {categories
                            .filter(
                              (c) => c.active === "active"
                            )
                            .map((c) => (
                              <option
                                key={c.id}
                                value={c.id}
                              >
                                {c.name}
                              </option>
                            ))}
                        </select>

                        <Button
                          variant="outline"
                          onClick={() =>
                            setAddingCategory(true)
                          }
                        >
                          <PlusCircle size={14} />
                          Add
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">

                        <input
                          autoFocus
                          value={newCategoryName}
                          onChange={(e) =>
                            setNewCategoryName(
                              e.target.value
                            )
                          }
                          placeholder="New category name"
                          className={`${inputClass} h-11 flex-1`}
                        />

                        <Button
                          variant="teal"
                          onClick={handleAddCategory}
                        >
                          <Check size={14} />
                          Save
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => {
                            setAddingCategory(false);
                            setNewCategoryName("");
                          }}
                        >
                          <X size={14} />
                          Cancel
                        </Button>

                      </div>
                    )}
                  </Field>
                </div>
              </div>

              {/* AMOUNT */}

              <div className="rounded-xl border border-hairline bg-paper/60 p-4">

                <div className="mb-2 flex items-center justify-between">
                  <label className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-steel">
                    Expense Amount
                  </label>

                  <span className="font-mono text-[10px] text-steel">
                    PKR
                  </span>
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-steel">
                    Rs
                  </span>

                  <input
                    type="number"
                    value={amount}
                    onChange={(e) =>
                      setAmount(e.target.value)
                    }
                    placeholder="0"
                    className={`${inputClass} !pl-10 h-14 text-[22px] font-mono font-semibold`}
                  />
                </div>

                <p className="mt-2 font-body text-[11px] text-steel">
                  Enter the total amount paid for this expense.
                </p>
              </div>

              {/* PAYMENT INFORMATION */}

              <div>

                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-paper font-mono text-[9px] text-steel">
                    02
                  </span>

                  <span className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-steel">
                    Payment information
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                  <Field label="Payment Method">
                    <select
                      value={method}
                      onChange={(e) =>
                        setMethod(
                          e.target.value as typeof method
                        )
                      }
                      className={`${inputClass} h-11`}
                    >
                      <option value="cash">
                        Cash
                      </option>

                      <option value="bank_transfer">
                        Bank Transfer
                      </option>

                      <option value="cheque">
                        Cheque
                      </option>

                      <option value="online">
                        Online Payment
                      </option>

                      <option value="other">
                        Other
                      </option>
                    </select>
                  </Field>

                  <Field label="Paid From">
                    <select
                      value={accountId}
                      onChange={(e) =>
                        setAccountId(e.target.value)
                      }
                      className={`${inputClass} h-11`}
                    >
                      <option value="">
                        Select account
                      </option>

                      {accounts
                        .filter(
                          (a) => a.active === "active"
                        )
                        .map((a) => (
                          <option
                            key={a.id}
                            value={a.id}
                          >
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </Field>

                </div>
              </div>

              {/* ADDITIONAL INFORMATION */}

              <div>

                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-paper font-mono text-[9px] text-steel">
                    03
                  </span>

                  <span className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-steel">
                    Additional information
                  </span>

                  <span className="font-body text-[10px] text-steel">
                    Optional
                  </span>
                </div>

                <div className="flex flex-col gap-3">

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                    <Field label="Vendor / Person">
                      <input
                        value={vendor}
                        onChange={(e) =>
                          setVendor(e.target.value)
                        }
                        placeholder="e.g. Supplier, mechanic..."
                        className={`${inputClass} h-11`}
                      />
                    </Field>

                    <Field label="Reference Number">
                      <input
                        value={referenceNo}
                        onChange={(e) =>
                          setReferenceNo(e.target.value)
                        }
                        placeholder="Receipt / invoice no."
                        className={`${inputClass} h-11`}
                      />
                    </Field>

                  </div>

                  <Field label="Description">
                    <input
                      value={description}
                      onChange={(e) =>
                        setDescription(e.target.value)
                      }
                      placeholder="Add a short note about this expense..."
                      className={`${inputClass} h-11`}
                    />
                  </Field>

                </div>
              </div>

              {/* ENTERED BY */}

              <div className="rounded-lg border border-hairline bg-paper px-3.5 py-3">

                <div className="flex items-center justify-between gap-3">

                  <div>
                    <p className="font-body text-[10px] font-semibold uppercase tracking-[0.08em] text-steel">
                      Entered by
                    </p>

                    <p className="mt-0.5 font-body text-[13px] font-medium text-ink">
                      {user?.name || "—"}
                    </p>
                  </div>

                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink">
                    <span className="font-body text-[11px] font-semibold text-white">
                      {(user?.name || "?")
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  </div>

                </div>
              </div>

              {/* ACTION */}

              <div>

                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={!canSubmit || saving}
                >
                  {saving ? (
                    "Saving…"
                  ) : (
                    <>
                      <Check size={15} />
                      Save Expense
                    </>
                  )}
                </Button>

                {toast && (
                  <div className="mt-3 flex items-center gap-1.5 font-body text-[12.5px] text-brand-green">
                    <Check size={13} />
                    {toast}
                  </div>
                )}

              </div>

            </div>
          </Panel>
        </div>
      )}

      {/* ============================================================
          FILTER BAR
      ============================================================ */}

      <Panel>

        <div className="flex flex-col gap-4">

          <div className="flex items-start justify-between gap-4">

            <div>
              <div className="flex items-center gap-2">
                <Filter size={15} className="text-steel" />

                <Eyebrow>Expense History</Eyebrow>
              </div>

              <h2 className="mt-1 font-display text-[18px] font-semibold text-ink">
                View expenses
              </h2>

              <SectionCaption>
                Filter expenses by day, month, year, or view everything.
              </SectionCaption>
            </div>

            <div className="hidden sm:flex items-center gap-2 rounded-lg border border-hairline bg-paper px-3 py-2">
              <Receipt size={14} className="text-steel" />

              <span className="font-mono text-[10px] text-steel">
                {filteredExpenses.length} entries
              </span>
            </div>

          </div>

          {/* FILTER TYPE */}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">

            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                filterType === "all"
                  ? "border-ink bg-ink text-white"
                  : "border-hairline bg-paper text-ink hover:bg-paper/70"
              }`}
            >
              <div className="font-body text-[12px] font-semibold">
                All
              </div>

              <div
                className={`mt-0.5 font-body text-[10px] ${
                  filterType === "all"
                    ? "text-white/60"
                    : "text-steel"
                }`}
              >
                All expenses
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFilterType("day")}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                filterType === "day"
                  ? "border-ink bg-ink text-white"
                  : "border-hairline bg-paper text-ink hover:bg-paper/70"
              }`}
            >
              <div className="font-body text-[12px] font-semibold">
                Day
              </div>

              <div
                className={`mt-0.5 font-body text-[10px] ${
                  filterType === "day"
                    ? "text-white/60"
                    : "text-steel"
                }`}
              >
                Exact date
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFilterType("month")}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                filterType === "month"
                  ? "border-ink bg-ink text-white"
                  : "border-hairline bg-paper text-ink hover:bg-paper/70"
              }`}
            >
              <div className="font-body text-[12px] font-semibold">
                Month
              </div>

              <div
                className={`mt-0.5 font-body text-[10px] ${
                  filterType === "month"
                    ? "text-white/60"
                    : "text-steel"
                }`}
              >
                Monthly view
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFilterType("year")}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                filterType === "year"
                  ? "border-ink bg-ink text-white"
                  : "border-hairline bg-paper text-ink hover:bg-paper/70"
              }`}
            >
              <div className="font-body text-[12px] font-semibold">
                Year
              </div>

              <div
                className={`mt-0.5 font-body text-[10px] ${
                  filterType === "year"
                    ? "text-white/60"
                    : "text-steel"
                }`}
              >
                Yearly view
              </div>
            </button>

          </div>

          {/* FILTER INPUT */}

          {filterType !== "all" && (
            <div className="rounded-lg border border-hairline bg-paper/60 p-3">

              <div className="flex items-center gap-2 mb-2">
                <CalendarDays size={14} className="text-steel" />

                <span className="font-body text-[10px] font-semibold uppercase tracking-[0.08em] text-steel">
                  Select {filterType}
                </span>
              </div>

              {filterType === "day" && (
                <input
                  type="date"
                  value={filterDay}
                  onChange={(e) =>
                    setFilterDay(e.target.value)
                  }
                  className={`${inputClass} h-11`}
                />
              )}

              {filterType === "month" && (
                <input
                  type="month"
                  value={filterMonth}
                  onChange={(e) =>
                    setFilterMonth(e.target.value)
                  }
                  className={`${inputClass} h-11`}
                />
              )}

              {filterType === "year" && (
                <select
                  value={filterYear}
                  onChange={(e) =>
                    setFilterYear(e.target.value)
                  }
                  className={`${inputClass} h-11`}
                >
                  {Array.from(
                    {
                      length:
                        new Date().getFullYear() -
                        2020 +
                        1,
                    },
                    (_, index) =>
                      String(
                        new Date().getFullYear() -
                          index
                      )
                  ).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              )}

            </div>
          )}

          {/* FILTER RESULT SUMMARY */}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-ink px-4 py-4">

            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#9FD8D8]">
                {filterLabel}
              </div>

              <div className="mt-1 font-body text-[11px] text-white/50">
                {filteredExpenses.length} expense
                {filteredExpenses.length === 1
                  ? ""
                  : "s"} found
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
                Total
              </div>

              <div className="mt-0.5 font-display text-[20px] font-bold text-white">
                {pkr(filteredTotal)}
              </div>
            </div>

          </div>

        </div>

      </Panel>

      {/* ============================================================
          SUMMARY + CATEGORY
      ============================================================ */}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">

        {/* SUMMARY */}

        <Panel>

          <Eyebrow>
            {filterType === "all"
              ? "All Expenses"
              : filterLabel}
          </Eyebrow>

          <h2 className="mt-1 font-display text-[18px] font-semibold text-ink">
            Spending overview
          </h2>

          <SectionCaption>
            Total spending for the selected period.
          </SectionCaption>

          <div className="mt-4 rounded-xl bg-ink px-5 py-5">

            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9FD8D8]">
              Total Expenses
            </div>

            <div className="mt-1 font-display text-[27px] font-bold tracking-[-0.03em] text-white">
              {pkr(filteredTotal)}
            </div>

          </div>

          <div className="mt-5">

            <div className="mb-3 flex items-center justify-between">
              <span className="font-body text-[11px] font-semibold uppercase tracking-[0.08em] text-steel">
                By category
              </span>

              <span className="font-mono text-[10px] text-steel">
                {filteredByCategory.length} categories
              </span>
            </div>

            <div className="flex flex-col gap-2">

              {filteredByCategory.map((row) => {

                const percentage =
                  filteredTotal > 0
                    ? (row.amount / filteredTotal) * 100
                    : 0;

                return (
                  <div
                    key={
                      row.category?.id ||
                      "uncategorized"
                    }
                    className="rounded-lg border border-hairline bg-paper px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">

                      <div className="min-w-0">
                        <div className="truncate font-body text-[12px] font-medium text-ink">
                          {row.category?.name ||
                            "Uncategorized"}
                        </div>

                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
                          <div
                            className="h-full rounded-full bg-ink"
                            style={{
                              width: `${Math.min(
                                percentage,
                                100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="font-mono text-[12px] font-semibold text-ink">
                          {pkr(row.amount)}
                        </div>

                        <div className="mt-0.5 font-mono text-[9px] text-steel">
                          {percentage.toFixed(0)}%
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })}

              {!filteredByCategory.length && (
                <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center">
                  <p className="font-body text-[12px] text-steel">
                    No expenses found for this period.
                  </p>
                </div>
              )}

            </div>
          </div>

        </Panel>

        {/* ============================================================
            RECENT / FILTERED EXPENSE TABLE
        ============================================================ */}

        <Panel>

          <div className="mb-4 flex items-start justify-between gap-4">

            <div>
              <Eyebrow>
                {filterLabel}
              </Eyebrow>

              <h2 className="mt-1 font-display text-[18px] font-semibold text-ink">
                Expense transactions
              </h2>

              <SectionCaption>
                Showing the latest entries for the selected filter.
              </SectionCaption>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-hairline bg-paper px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />

              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-steel">
                {filteredExpenses.length} entries
              </span>
            </div>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full border-collapse">

              <thead>
                <tr className="border-b border-hairline">
                  <Th>ID</Th>
                  <Th>Category</Th>
                  <Th>Customer</Th>
                  <Th right>Amount</Th>
                  <Th right>Date</Th>
                </tr>
              </thead>

              <tbody>

                {recentExpenses.map((expense) => {

                  const category =
                    categories.find(
                      (c) =>
                        c.id ===
                        expense.category_id
                    );

                  return (
                    <tr
                      key={expense.id}
                      className="border-b border-hairline/70 last:border-0 hover:bg-paper/60"
                    >

                      <Td mono>
                        <span className="text-steel">
                          {expense.display_id}
                        </span>
                      </Td>

                      <Td bold>
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" />

                          <span>
                            {category?.name || "—"}
                          </span>
                        </div>
                      </Td>

                      <Td>
                        {expense.customer_name ? (
                          <span className="font-body text-[12px] text-ink">
                            {expense.customer_name}
                          </span>
                        ) : (
                          <span className="font-body text-[12px] text-steel">—</span>
                        )}
                      </Td>

                      <Td
                        right
                        mono
                        color="#C8102E"
                      >
                        <span className="font-semibold">
                          {pkr(expense.amount)}
                        </span>
                      </Td>

                      <Td right mono>
                        <span className="text-steel">
                          {fmtTime(expense.date)}
                        </span>
                      </Td>

                    </tr>
                  );
                })}

                {!recentExpenses.length && (
                  <tr>
                    <td colSpan={5}>

                      <div className="py-10 text-center">

                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-hairline bg-paper">
                          <Receipt
                            size={16}
                            className="text-steel"
                          />
                        </div>

                        <p className="mt-3 font-body text-[13px] font-medium text-ink">
                          No expenses found
                        </p>

                        <p className="mt-1 font-body text-[11px] text-steel">
                          Try another date, month, or year.
                        </p>

                      </div>

                    </td>
                  </tr>
                )}

              </tbody>

            </table>

          </div>

          {filteredExpenses.length > 10 && (
            <div className="mt-4 border-t border-hairline pt-3 text-center">
              <span className="font-body text-[11px] text-steel">
                Showing latest 10 of{" "}
                {filteredExpenses.length} expenses
              </span>
            </div>
          )}

        </Panel>

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