
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PlusCircle,
  Check,
  X,
  CalendarDays,
  Receipt,
  Wallet,
  TrendingDown,
  ListChecks,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { api } from "@/lib/api";
import {
  pkr,
  fmtTime,
  todayLocalInput,
  toKarachiDateString,
} from "@/lib/format";
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

// ============================================================
// LOCAL PRESENTATIONAL PRIMITIVES
// Deep Navy / Slate redesign.
// Primary color: #0b2138
// ============================================================

const NAVY = "#0b2138";
const NAVY_DARK = "#071a2d";
const NAVY_LIGHT = "#e8eef4";
const NAVY_SOFT = "#eef3f7";
const NAVY_BORDER = "#c9d5df";

const fieldInputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[13px] text-slate-950 placeholder:text-slate-400 outline-none transition-colors focus:border-[#0b2138] focus:ring-2 focus:ring-[#0b2138]/15";

const compactInputCls =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] text-slate-950 outline-none transition-colors focus:border-[#0b2138] focus:ring-2 focus:ring-[#0b2138]/15";

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wide text-slate-600">
      {children}
    </label>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const variants: Record<string, string> = {
    primary:
      "bg-[#0b2138] hover:bg-[#071a2d] text-white shadow-sm shadow-[#0b2138]/25",
    outline:
      "bg-white hover:bg-slate-100 text-slate-800 border border-slate-300",
    ghost:
      "bg-slate-200 hover:bg-slate-300 text-slate-700",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors ${
        variants[variant]
      } ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer"
      }`}
    >
      {children}
    </button>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone:
    | "indigo"
    | "rose"
    | "slate"
    | "emerald";
}) {
  const toneCls: Record<string, string> = {
    indigo: "bg-[#e8eef4] text-[#0b2138]",
    rose: "bg-rose-100 text-rose-700",
    slate: "bg-slate-200 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm shadow-slate-300/50">
      <div
        className={`mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneCls[tone]}`}
      >
        <Icon size={15} />
      </div>

      <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-1 truncate text-[19px] font-extrabold text-slate-950 sm:text-[21px]">
        {value}
      </div>

      <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
        {hint}
      </div>
    </div>
  );
}

function SectionTag({
  n,
  label,
  optional,
}: {
  n: string;
  label: string;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex items-center gap-2">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] font-bold"
        style={{
          backgroundColor: NAVY_LIGHT,
          color: NAVY,
        }}
      >
        {n}
      </span>

      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
        {label}
      </span>

      {optional && (
        <span className="text-[10px] font-medium text-slate-500">
          {t("expenses.optional")}
        </span>
      )}
    </div>
  );
}

function ExpensesBody() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [categories, setCategories] = useState<
    ExpenseCategory[]
  >([]);

  const [accounts, setAccounts] = useState<
    PaymentAccount[]
  >([]);

  const [allExpenses, setAllExpenses] = useState<
    Expense[]
  >([]);

  // Form visibility
  const [showExpenseForm, setShowExpenseForm] =
    useState(false);

  // Expense form
  const [date, setDate] = useState(
    todayLocalInput()
  );

  const [categoryId, setCategoryId] =
    useState("");

  const [addingCategory, setAddingCategory] =
    useState(false);

  const [newCategoryName, setNewCategoryName] =
    useState("");

  const [amount, setAmount] = useState("");

  const [accountId, setAccountId] =
    useState("");

  const [method, setMethod] = useState<
    | "cash"
    | "bank_transfer"
    | "cheque"
    | "online"
    | "other"
  >("cash");

  const [description, setDescription] =
    useState("");

  const [vendor, setVendor] =
    useState("");

  const [referenceNo, setReferenceNo] =
    useState("");

  // UI state
  const [toast, setToast] =
    useState<string | null>(null);

  const [saving, setSaving] =
    useState(false);

  // Filters
  const [filterType, setFilterType] =
    useState<FilterType>("month");

  const [filterDay, setFilterDay] =
    useState(todayLocalInput());

  const [filterMonth, setFilterMonth] =
    useState(currentMonth());

  const [filterYear, setFilterYear] =
    useState(currentYear());

  const month = currentMonth();

  const load = async () => {
    const [cats, accs, expenses] =
      await Promise.all([
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

    const c =
      await api.expenseCategories.create(
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
          `${date}T${new Date()
            .toTimeString()
            .slice(0, 8)}`
        ).toISOString(),

        category_id: categoryId,
        amount: parseFloat(amount),
        account_id: accountId,
        method,
        description:
          description || undefined,
        vendor: vendor || undefined,
        reference_no:
          referenceNo || undefined,
        entered_by: user.name,
      });

      setToast(t("expenses.expenseSavedToast"));

      setAmount("");
      setDescription("");
      setVendor("");
      setReferenceNo("");

      await load();

      setTimeout(
        () => setToast(null),
        2200
      );
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
      const expenseDay =
        toKarachiDateString(
          expense.date
        );

      if (!expenseDay) return false;

      if (filterType === "day") {
        return expenseDay === filterDay;
      }

      if (filterType === "month") {
        return (
          expenseDay.slice(0, 7) ===
          filterMonth
        );
      }

      if (filterType === "year") {
        return (
          expenseDay.slice(0, 4) ===
          filterYear
        );
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
   */
  const monthExpenses = useMemo(() => {
    return allExpenses.filter((expense) => {
      const expenseDay =
        toKarachiDateString(
          expense.date
        );

      return (
        !!expenseDay &&
        expenseDay.slice(0, 7) ===
          month
      );
    });
  }, [allExpenses, month]);

  const totalMTD =
    monthExpenses.reduce(
      (sum, expense) =>
        sum + parseFloat(expense.amount),
      0
    );

  /*
   * FILTERED TOTAL
   */
  const filteredTotal =
    filteredExpenses.reduce(
      (sum, expense) =>
        sum + parseFloat(expense.amount),
      0
    );

  /*
   * FILTERED CATEGORY BREAKDOWN
   */
  const filteredByCategory = useMemo(() => {
    const map = new Map<
      string,
      number
    >();

    filteredExpenses.forEach(
      (expense) => {
        const categoryId =
          expense.category_id ?? "uncategorized";
        map.set(
          categoryId,
          (map.get(
            categoryId
          ) || 0) +
            parseFloat(
              expense.amount
            )
        );
      }
    );

    return Array.from(map.entries())
      .map(
        ([
          categoryId,
          amount,
        ]) => ({
          category:
            categories.find(
              (category) =>
                category.id ===
                categoryId
            ),
          amount,
        })
      )
      .sort(
        (a, b) =>
          b.amount - a.amount
      );
  }, [
    filteredExpenses,
    categories,
  ]);

  /*
   * Show latest 10 from current filter.
   */
  const recentExpenses =
    filteredExpenses.slice(0, 10);

  const filterLabel =
    filterType === "all"
      ? t("expenses.allExpenses")
      : filterType === "day"
      ? t("expenses.dayFilterLabel", { day: filterDay })
      : filterType === "month"
      ? t("expenses.monthFilterLabel", { month: filterMonth })
      : t("expenses.yearFilterLabel", { year: filterYear });

  return (
    <div className="min-h-screen">

      {/* ============================================================
          HEADER
      ============================================================ */}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#e8eef4] px-2.5 py-1">
            <span
              className="h-1.5 w-1.5 rounded-full bg-[#0b2138]"
            />

            <span className="font-mono text-[10.5px] font-bold uppercase tracking-widest text-[#0b2138]">
              {t("nav.expenses")}
            </span>
          </div>

          <h1 className="text-[26px] font-extrabold tracking-tight text-slate-950 sm:text-[28px]">
            {t("expenses.heading")}
          </h1>

          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-slate-600">
            {t("expenses.caption")}
          </p>
        </div>

        {!showExpenseForm && (
          <Btn
            onClick={() =>
              setShowExpenseForm(true)
            }
          >
            <PlusCircle size={15} />
            {t("expenses.recordExpense")}
          </Btn>
        )}
      </div>

      {/* ============================================================
          STAT ROW
      ============================================================ */}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Wallet}
          label={t("expenses.filteredTotal")}
          value={pkr(filteredTotal)}
          hint={filterLabel}
          tone="indigo"
        />

        <StatTile
          icon={TrendingDown}
          label={t("expenses.thisMonth")}
          value={pkr(totalMTD)}
          hint={month}
          tone="rose"
        />

        <StatTile
          icon={ListChecks}
          label={t("expenses.entries")}
          value={String(
            filteredExpenses.length
          )}
          hint={filterLabel}
          tone="slate"
        />

        <StatTile
          icon={Tag}
          label={t("expenses.categories")}
          value={String(
            filteredByCategory.length
          )}
          hint={t("expenses.inCurrentView")}
          tone="emerald"
        />
      </div>

      {/* ============================================================
          MAIN GRID
      ============================================================ */}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">

        {/* ============================================================
            LEFT — FILTER + CATEGORY
        ============================================================ */}

        <div className="flex flex-col gap-4">

          {/* COMPACT DATE FILTER */}

          <div className="rounded-xl border border-slate-300 bg-white p-3.5 shadow-sm shadow-slate-300/50">
            <div className="mb-3 flex items-center gap-1.5 text-slate-500">
              <CalendarDays size={13} />

              <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
                {t("expenses.period")}
              </span>
            </div>

            <div className="mb-2.5 grid grid-cols-4 gap-1">
              {(
                [
                  "all",
                  "day",
                  "month",
                  "year",
                ] as FilterType[]
              ).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() =>
                    setFilterType(ft)
                  }
                  className={`rounded-md py-1.5 text-[11px] font-bold capitalize transition-colors ${
                    filterType === ft
                      ? "bg-[#0b2138] text-white shadow-sm shadow-[#0b2138]/20"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {t(`payments.date${ft.charAt(0).toUpperCase()}${ft.slice(1)}`)}
                </button>
              ))}
            </div>

            {filterType !== "all" && (
              <div>
                {filterType === "day" && (
                  <input
                    type="date"
                    value={filterDay}
                    onChange={(e) =>
                      setFilterDay(
                        e.target.value
                      )
                    }
                    className={
                      compactInputCls
                    }
                  />
                )}

                {filterType === "month" && (
                  <input
                    type="month"
                    value={filterMonth}
                    onChange={(e) =>
                      setFilterMonth(
                        e.target.value
                      )
                    }
                    className={
                      compactInputCls
                    }
                  />
                )}

                {filterType === "year" && (
                  <select
                    value={filterYear}
                    onChange={(e) =>
                      setFilterYear(
                        e.target.value
                      )
                    }
                    className={
                      compactInputCls
                    }
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
                      <option
                        key={year}
                        value={year}
                      >
                        {year}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
              <span className="text-[11px] font-medium text-slate-600">
                {t("expenses.entryCount", { count: filteredExpenses.length })}
              </span>

              <span className="font-mono text-[13px] font-extrabold text-slate-950">
                {pkr(filteredTotal)}
              </span>
            </div>
          </div>

          {/* CATEGORY BREAKDOWN */}

          <div className="rounded-xl border border-slate-300 bg-white p-3.5 shadow-sm shadow-slate-300/50">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {t("expenses.byCategory")}
              </span>

              <span className="font-mono text-[10px] font-semibold text-slate-500">
                {filteredByCategory.length}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {filteredByCategory.map(
                (row) => {
                  const percentage =
                    filteredTotal > 0
                      ? (row.amount /
                          filteredTotal) *
                        100
                      : 0;

                  return (
                    <div
                      key={
                        row.category?.id ||
                        "uncategorized"
                      }
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] font-semibold text-slate-700">
                          {row.category
                            ?.name ||
                            t("expenses.uncategorized")}
                        </span>

                        <span className="shrink-0 font-mono text-[11px] font-bold text-slate-950">
                          {pkr(
                            row.amount
                          )}
                        </span>
                      </div>

                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-[#0b2138]"
                          style={{
                            width: `${Math.min(
                              percentage,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                }
              )}

              {!filteredByCategory.length && (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center">
                  <p className="text-[12px] font-medium text-slate-500">
                    {t("expenses.noExpensesForPeriod")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ============================================================
            RIGHT — FORM + TRANSACTIONS
        ============================================================ */}

        <div className="flex min-w-0 flex-col gap-5">

          {/* EXPENSE FORM */}

          {showExpenseForm && (
            <div className="rounded-xl border border-slate-300 bg-white shadow-sm shadow-slate-300/50">

              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0b2138]">
                      <PlusCircle
                        size={14}
                        className="text-white"
                      />
                    </div>

                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-widest text-[#0b2138]">
                      {t("expenses.newExpenseBadge")}
                    </span>
                  </div>

                  <h2 className="text-[16px] font-bold text-slate-950">
                    {t("expenses.recordAnExpense")}
                  </h2>

                  <p className="mt-0.5 text-[12px] text-slate-600">
                    {t("expenses.enterPaymentDetails")}
                  </p>
                </div>

                <Btn
                  variant="outline"
                  onClick={() =>
                    setShowExpenseForm(
                      false
                    )
                  }
                >
                  <X size={14} />
                  {t("unifiedSale.close")}
                </Btn>
              </div>

              <div className="flex flex-col gap-5 p-4 sm:p-5">

                {/* 01 — EXPENSE DETAILS */}

                <div>
                  <SectionTag
                    n="01"
                    label={t("expenses.section01Label")}
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t("unifiedSale.date")}>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) =>
                          setDate(
                            e.target.value
                          )
                        }
                        className={
                          fieldInputCls
                        }
                      />
                    </FormField>

                    <FormField label={t("expenses.categoryLabel")}>
                      {!addingCategory ? (
                        <div className="flex gap-2">
                          <select
                            value={
                              categoryId
                            }
                            onChange={(e) =>
                              setCategoryId(
                                e.target.value
                              )
                            }
                            className={`${fieldInputCls} flex-1`}
                          >
                            <option value="">
                              {t("unifiedSale.selectCategory")}
                            </option>

                            {categories
                              .filter(
                                (c) =>
                                  c.active ===
                                  "active"
                              )
                              .map((c) => (
                                <option
                                  key={c.id}
                                  value={
                                    c.id
                                  }
                                >
                                  {c.name}
                                </option>
                              ))}
                          </select>

                          <Btn
                            variant="outline"
                            onClick={() =>
                              setAddingCategory(
                                true
                              )
                            }
                          >
                            <PlusCircle
                              size={14}
                            />
                            {t("expenses.add")}
                          </Btn>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            value={
                              newCategoryName
                            }
                            onChange={(e) =>
                              setNewCategoryName(
                                e.target
                                  .value
                              )
                            }
                            placeholder={t("expenses.newCategoryNamePlaceholder")}
                            className={`${fieldInputCls} flex-1`}
                          />

                          <Btn
                            onClick={
                              handleAddCategory
                            }
                          >
                            <Check
                              size={14}
                            />
                          </Btn>

                          <Btn
                            variant="outline"
                            onClick={() => {
                              setAddingCategory(
                                false
                              );
                              setNewCategoryName(
                                ""
                              );
                            }}
                          >
                            <X size={14} />
                          </Btn>
                        </div>
                      )}
                    </FormField>
                  </div>
                </div>

                {/* AMOUNT */}

                <div
                  className="rounded-xl p-4"
                  style={{
                    border: `1px solid ${NAVY_BORDER}`,
                    backgroundColor:
                      NAVY_SOFT,
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
                      {t("expenses.expenseAmount")}
                    </label>

                    <span className="font-mono text-[10px] font-semibold text-slate-500">
                      PKR
                    </span>
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] font-semibold text-slate-500">
                      Rs
                    </span>

                    <input
                      type="number"
                      value={amount}
                      onChange={(e) =>
                        setAmount(
                          e.target.value
                        )
                      }
                      placeholder="0"
                      className={`${fieldInputCls} !pl-10 h-14 text-[22px] font-mono font-extrabold text-slate-950`}
                    />
                  </div>

                  <p className="mt-2 text-[11px] font-medium text-slate-600">
                    {t("expenses.enterTotalAmountHint")}
                  </p>
                </div>

                {/* 02 — PAYMENT INFORMATION */}

                <div>
                  <SectionTag
                    n="02"
                    label={t("expenses.section02Label")}
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label={t("expenses.paymentMethod")}>
                      <select
                        value={method}
                        onChange={(e) =>
                          setMethod(
                            e.target
                              .value as typeof method
                          )
                        }
                        className={
                          fieldInputCls
                        }
                      >
                        <option value="cash">
                          {t("unifiedSale.methodCash")}
                        </option>

                        <option value="bank_transfer">
                          {t("expenses.methodBankTransfer")}
                        </option>

                        <option value="cheque">
                          {t("unifiedSale.methodCheque")}
                        </option>

                        <option value="online">
                          {t("expenses.methodOnlinePayment")}
                        </option>

                        <option value="other">
                          {t("expenses.methodOther")}
                        </option>
                      </select>
                    </FormField>

                    <FormField label={t("expenses.paidFrom")}>
                      <select
                        value={accountId}
                        onChange={(e) =>
                          setAccountId(
                            e.target
                              .value
                          )
                        }
                        className={
                          fieldInputCls
                        }
                      >
                        <option value="">
                          {t("expenses.selectAccount")}
                        </option>

                        {accounts
                          .filter(
                            (a) =>
                              a.active ===
                              "active"
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
                    </FormField>
                  </div>
                </div>

                {/* 03 — ADDITIONAL INFORMATION */}

                <div>
                  <SectionTag
                    n="03"
                    label={t("expenses.section03Label")}
                    optional
                  />

                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField label={t("expenses.vendorPerson")}>
                        <input
                          value={vendor}
                          onChange={(e) =>
                            setVendor(
                              e.target
                                .value
                            )
                          }
                          placeholder={t("expenses.vendorPlaceholder")}
                          className={
                            fieldInputCls
                          }
                        />
                      </FormField>

                      <FormField label={t("expenses.referenceNumber")}>
                        <input
                          value={
                            referenceNo
                          }
                          onChange={(e) =>
                            setReferenceNo(
                              e.target
                                .value
                            )
                          }
                          placeholder={t("expenses.referenceNoPlaceholder")}
                          className={
                            fieldInputCls
                          }
                        />
                      </FormField>
                    </div>

                    <FormField label={t("expenses.descriptionLabel")}>
                      <input
                        value={description}
                        onChange={(e) =>
                          setDescription(
                            e.target
                              .value
                          )
                        }
                        placeholder={t("expenses.descriptionPlaceholder")}
                        className={
                          fieldInputCls
                        }
                      />
                    </FormField>
                  </div>
                </div>

                {/* ENTERED BY */}

                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">
                      {t("expenses.enteredByLabel")}
                    </p>

                    <p className="mt-0.5 text-[13px] font-semibold text-slate-950">
                      {user?.name ||
                        "—"}
                    </p>
                  </div>

                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b2138]">
                    <span className="text-[11px] font-bold text-white">
                      {(
                        user?.name ||
                        "?"
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* ACTION */}

                <div>
                  <Btn
                    onClick={
                      handleSubmit
                    }
                    disabled={
                      !canSubmit ||
                      saving
                    }
                  >
                    {saving ? (
                      t("unifiedSale.saving")
                    ) : (
                      <>
                        <Check
                          size={15}
                        />
                        {t("expenses.saveExpense")}
                      </>
                    )}
                  </Btn>

                  {toast && (
                    <div className="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-700">
                      <Check
                        size={13}
                      />
                      {toast}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TRANSACTIONS TABLE */}

          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm shadow-slate-300/50">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-[15px] font-bold text-slate-950">
                  {t("expenses.expenseTransactions")}
                </h2>

                <p className="mt-0.5 text-[11.5px] font-medium text-slate-600">
                  {filterLabel}
                </p>
              </div>

              <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1.5 sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />

                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-slate-600">
                  {t("expenses.entryCount", { count: filteredExpenses.length })}
                </span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="whitespace-nowrap px-3 py-2.5 text-left font-mono text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
                      {t("customerLedger.colId")}
                    </th>

                    <th className="whitespace-nowrap px-3 py-2.5 text-left font-mono text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
                      {t("expenses.colCategory")}
                    </th>

                    <th className="whitespace-nowrap px-3 py-2.5 text-left font-mono text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
                      {t("expenses.colSource")}
                    </th>

                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
                      {t("unifiedSale.colAmount")}
                    </th>

                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
                      {t("customerLedger.colDate")}
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {recentExpenses.map(
                    (expense) => {
                      const category =
                        categories.find(
                          (c) =>
                            c.id ===
                            expense.category_id
                        );

                      return (
                        <tr
                          key={
                            expense.id
                          }
                          className="transition-colors hover:bg-slate-50"
                        >
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12.5px] font-medium text-slate-500">
                            {
                              expense.display_id
                            }
                          </td>

                          <td className="whitespace-nowrap px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0b2138]" />

                              <span className="text-[13px] font-semibold text-slate-900">
                                {category
                                  ?.name ||
                                  "—"}
                              </span>
                            </div>
                          </td>

                          <td className="px-3 py-2.5">
                            {expense.shop_name ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-900">
                                  <span className="rounded bg-[#e8eef4] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#0b2138]">
                                    {t("expenses.shopBadge")}
                                  </span>

                                  {expense.shop_name}
                                </span>

                                {expense.source_shop_sale_id && (
                                  <span className="inline-flex w-fit items-center rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-blue-700">
                                    {t("expenses.shopSaleBadge")}
                                  </span>
                                )}

                                {(
                                  expense.customer_name ||
                                  expense.shop_sale_display_id
                                ) && (
                                  <span className="text-[11px] font-medium text-slate-500">
                                    {expense.customer_name ||
                                      t("expenses.unknownCustomer")}

                                    {expense.shop_sale_display_id &&
                                      t("expenses.saleRefSuffix", { id: expense.shop_sale_display_id })}
                                  </span>
                                )}
                              </div>
                            ) : expense.customer_name ? (
                              <span className="text-[12px] font-medium text-slate-800">
                                {expense.customer_name}
                              </span>
                            ) : (
                              <span className="text-[12px] text-slate-500">
                                —
                              </span>
                            )}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[13px] font-extrabold text-rose-700">
                            {pkr(
                              expense.amount
                            )}
                          </td>

                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[12px] font-medium text-slate-500">
                            {fmtTime(
                              expense.date
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}

                  {!recentExpenses.length && (
                    <tr>
                      <td colSpan={5}>
                        <div className="py-10 text-center">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-100">
                            <Receipt
                              size={16}
                              className="text-slate-500"
                            />
                          </div>

                          <p className="mt-3 text-[13px] font-semibold text-slate-800">
                            {t("expenses.noExpensesFound")}
                          </p>

                          <p className="mt-1 text-[11px] font-medium text-slate-500">
                            {t("expenses.tryAnotherDateHint")}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {filteredExpenses.length >
              10 && (
              <div className="border-t border-slate-200 px-4 py-3 text-center">
                <span className="text-[11px] font-medium text-slate-500">
                  {t("expenses.showingLatestOf", { shown: 10, total: filteredExpenses.length })}
                </span>
              </div>
            )}
          </div>
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
