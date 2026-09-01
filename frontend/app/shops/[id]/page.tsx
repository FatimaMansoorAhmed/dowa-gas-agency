"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  PlusCircle,
  ShoppingCart,
  RefreshCw,
  Pencil,
  Users,
  Wallet,
  Receipt,
  ChevronRight,
  X,
  BookOpen,
  ArrowUpRight,
  ArrowDownRight,
  CalendarDays,
  Package,
  Banknote,
  AlertCircle,
} from "lucide-react";

import AuthGate from "@/components/AuthGate";

import {
  PageHeader,
  Panel,
  Th,
  Td,
  inputClass,
  Button,
} from "@/components/ui";

import ReceivePaymentModal from "@/components/ReceivePaymentModal";
import RecordShopSaleModal from "@/components/RecordShopSaleModal";
import RecordShopAdjustmentModal from "@/components/RecordShopAdjustmentModal";
import AddSupplyCustomerModal from "@/components/AddSupplyCustomerModal";
import RecordSupplyCustomerPaymentModal from "@/components/RecordSupplyCustomerPaymentModal";
import RecordShopExpenseModal from "@/components/RecordShopExpenseModal";
import CorrectTransactionModal, {
  CorrectableKind,
} from "@/components/CorrectTransactionModal";
import PrintButton from "@/components/PrintButton";
import ShopStockBatchesPanel from "@/components/ShopStockBatchesPanel";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString } from "@/lib/format";

import type {
  ShopDetailOut,
  ShopTransactionRow,
  Sale,
  Payment,
  ShopSale,
  ShopSupplyCustomer,
  ShopBusinessLedgerOut,
  ShopStockBatch,
} from "@/lib/types";

function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function transactionLabel(kind: string) {
  const labels: Record<string, string> = {
    load: "Load",
    shop_sale: "Shop Sale",
    payment: "Payment",
    return: "Return",
    adjustment: "Adjustment",
  };

  return labels[kind] ?? kind;
}

function ledgerLabel(kind: string) {
  const labels: Record<string, string> = {
    cash_sale: "Cash Sale",
    credit_sale: "Credit Sale",
    customer_payment: "Customer Payment",
    expense: "Expense",
    owner_withdrawal: "Owner Withdrawal",
    dowa_payment: "Payment to Dowa",
  };

  return labels[kind] ?? kind;
}

/* -------------------------------------------------------------------------- */
/* TRANSACTION HISTORY MODAL                                                  */
/* -------------------------------------------------------------------------- */

function TransactionHistoryModal({
  transactions,
  month,
  setMonth,
  onClose,
  onCorrect,
  correctLoading,
}: {
  transactions: ShopTransactionRow[];
  month: string;
  setMonth: (value: string) => void;
  onClose: () => void;
  onCorrect: (row: ShopTransactionRow) => void;
  correctLoading: string | null;
}) {
  const [year, mo] = month.split("-");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(11,33,56,0.55)] p-4 sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Modal Header */}
        <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-6 py-5 lg:flex-row lg:items-center lg:justify-between">

          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
              <Receipt size={20} />
            </div>

            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                Transaction History
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Complete shop activity for the selected month.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
              <CalendarDays size={14} className="text-slate-400" />

              <select
                value={mo}
                onChange={(e) => setMonth(`${year}-${e.target.value}`)}
                className={`${inputClass} w-[70px] border-0 bg-transparent py-1`}
              >
                {Array.from(
                  { length: 12 },
                  (_, i) => String(i + 1).padStart(2, "0")
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={year}
                onChange={(e) => setMonth(`${e.target.value}-${mo}`)}
                className={`${inputClass} w-[90px] border-0 bg-transparent py-1`}
              >
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
              title="Close"
            >
              <X size={18} />
            </button>

          </div>
        </div>

        {/* Transaction Count */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/60 px-6 py-3">
          <span className="text-xs font-medium text-slate-500">
            {transactions.length} transaction
            {transactions.length === 1 ? "" : "s"} found
          </span>

          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            {month}
          </span>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">

          <table className="w-full min-w-[1250px] border-collapse text-sm">

            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-200 bg-slate-100">

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Date
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Type
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  ID
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Description
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Quantity
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Rate/kg
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Amount
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Paid
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Balance Due
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Entered By
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>

                <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Action
                </th>

              </tr>
            </thead>

            <tbody>

              {transactions.map((t, index) => {

                const outstanding =
                  t.kind === "shop_sale" &&
                  t.amount_outstanding != null &&
                  parseFloat(t.amount_outstanding) > 0;

                return (
                  <tr
                    key={t.ref_id}
                    className={`
                      border-b border-slate-100
                      transition-colors
                      hover:bg-teal/[0.025]
                      ${index % 2 === 0 ? "bg-white" : "bg-slate-50/30"}
                    `}
                  >

                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                      {fmtTime(t.date)}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3">
                      <span
                        className={`
                          inline-flex rounded-md px-2 py-1
                          text-[10px] font-semibold uppercase tracking-wide
                          ${
                            t.kind === "payment"
                              ? "bg-emerald-50 text-emerald-700"
                              : t.kind === "shop_sale"
                              ? "bg-blue-50 text-blue-700"
                              : t.kind === "return" ||
                                t.kind === "adjustment"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                          }
                        `}
                      >
                        {transactionLabel(t.kind)}
                      </span>
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                      {t.display_id}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-sm text-slate-700">
                      {t.description || "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {t.quantity ?? "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {t.board_rate_per_kg ?? t.load_rate_per_kg ?? "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs font-semibold text-slate-700">
                      {t.amount ? pkr(t.amount) : "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {t.kind === "shop_sale" &&
                      t.amount_received != null
                        ? pkr(t.amount_received)
                        : "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs">
                      {t.kind === "shop_sale" &&
                      t.amount_outstanding != null ? (
                        <span
                          className={
                            outstanding
                              ? "font-bold text-brand-red"
                              : "font-medium text-slate-600"
                          }
                        >
                          {pkr(t.amount_outstanding)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                      {t.entered_by}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3">
                      <span className="font-mono text-[10px] uppercase text-slate-500">
                        {t.status}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      {t.correctable && (
                        <button
                          onClick={() => onCorrect(t)}
                          disabled={correctLoading === t.ref_id}
                          title="Correct this transaction"
                          className="
                            inline-flex h-8 w-8
                            items-center justify-center
                            rounded-lg
                            text-slate-400
                            transition
                            hover:bg-teal/10
                            hover:text-teal
                            disabled:opacity-40
                            cursor-pointer
                          "
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>

                  </tr>
                );
              })}

              {!transactions.length && (
                <tr>
                  <td
                    colSpan={13}
                    className="py-16 text-center"
                  >
                    <div className="flex flex-col items-center">
                      <Receipt
                        size={28}
                        className="text-slate-300"
                      />

                      <p className="mt-3 text-sm font-medium text-slate-500">
                        No transactions this month.
                      </p>

                      <p className="mt-1 text-xs text-slate-400">
                        Transactions will appear here once recorded.
                      </p>
                    </div>
                  </td>
                </tr>
              )}

            </tbody>

          </table>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">

          <span className="text-xs text-slate-500">
            Showing transaction history for {month}
          </span>

          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Close
          </button>

        </div>

      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SHOP DETAIL BODY                                                           */
/* -------------------------------------------------------------------------- */

function ShopDetailBody() {
  const params = useParams();
  const shopId = params.id as string;
  const { user } = useAuth();

  const [date, setDate] = useState(todayLocalInput());
  const [month, setMonth] = useState(currentMonth());

  const [detail, setDetail] = useState<ShopDetailOut | null>(null);
  const [loading, setLoading] = useState(true);

  const [showPay, setShowPay] = useState(false);
  const [showSale, setShowSale] = useState(false);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showExpense, setShowExpense] = useState(false);

  const [showTransactions, setShowTransactions] = useState(false);

  const [payCustomerTarget, setPayCustomerTarget] =
    useState<ShopSupplyCustomer | null>(null);

  const [supplyCustomers, setSupplyCustomers] = useState<
    ShopSupplyCustomer[]
  >([]);

  const [ledger, setLedger] =
    useState<ShopBusinessLedgerOut | null>(null);

  const [correctTarget, setCorrectTarget] = useState<{
    kind: CorrectableKind;
    transaction: Sale | Payment | ShopSale;
  } | null>(null);

  const [correctLoading, setCorrectLoading] = useState<string | null>(
    null
  );

  // Stock Batches (FIFO Breakdown) — `batches` is always the LIVE/
  // unfiltered queue (the Inventory Flow Summary Bar's "carrying
  // balances" must never shift from the historic "Inspect month" filter
  // below it — see ShopStockBatchesPanel's docstring). `filteredBatches`
  // is only populated when a specific month is selected there; null means
  // "use `batches` as-is" for the table too.
  const [batches, setBatches] = useState<ShopStockBatch[]>([]);
  const [batchesMonthFilter, setBatchesMonthFilter] = useState("");
  const [filteredBatches, setFilteredBatches] = useState<ShopStockBatch[] | null>(null);

  const load = () => {
    setLoading(true);

    api.shops
      .detail(shopId, { date, month })
      .then(setDetail)
      .finally(() => setLoading(false));

    api.shops.customers.list(shopId).then(setSupplyCustomers);

    api.shops
      .businessLedger(shopId, { date, month })
      .then(setLedger);

    // Refetches on every Load/Shop Sale/Return/Correction, exactly like
    // the calls above — every action's onSaved handler calls this same
    // load() (§4 "automatically refetch whenever...").
    api.shops.batches(shopId).then(setBatches);
  };

  useEffect(() => {
    load();
  }, [shopId, date, month]);

  // The "Inspect month" filter is independent of the page's own date/
  // month selection (it narrows the FIFO table only, never the summary
  // bar) — refetches on its own, separate from the full-page load above.
  useEffect(() => {
    if (!batchesMonthFilter) {
      setFilteredBatches(null);
      return;
    }
    api.shops.batches(shopId, batchesMonthFilter).then(setFilteredBatches);
  }, [shopId, batchesMonthFilter]);

  const openCorrect = async (row: ShopTransactionRow) => {
    if (!row.correctable) return;

    setCorrectLoading(row.ref_id);

    try {
      if (row.kind === "load") {
        const list = await api.sales.list({
          customer_id: shopId,
        });

        const tx = list.find((s) => s.id === row.ref_id);

        if (tx) {
          setCorrectTarget({
            kind: "sale",
            transaction: tx,
          });
        }
      } else if (row.kind === "payment") {
        const list = await api.payments.list({
          customer_id: shopId,
        });

        const tx = list.find((p) => p.id === row.ref_id);

        if (tx) {
          setCorrectTarget({
            kind: "payment",
            transaction: tx,
          });
        }
      } else if (row.kind === "shop_sale") {
        const tx = await api.shops.getSale(row.ref_id);

        setCorrectTarget({
          kind: "shopSale",
          transaction: tx,
        });
      }
    } finally {
      setCorrectLoading(null);
    }
  };

  if (loading && !detail) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <Panel>
          <div className="flex items-center gap-3 p-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-teal" />

            <span className="font-body text-sm text-slate-500">
              Loading shop...
            </span>
          </div>
        </Panel>
      </div>
    );
  }

  if (!detail) return null;

  const s = detail.stock;

  const allCorrections = [
    ...detail.corrections.map((c) => ({
      ...c,
      kind: c.kind as string,
    })),

    ...detail.shop_sale_corrections.map((c) => ({
      ...c,
      kind: "shop_sale",
    })),
  ].sort((a, b) =>
    a.corrected_at < b.corrected_at ? 1 : -1
  );

  return (
    <div className="min-h-screen bg-slate-50/40">

      {/* ------------------------------------------------------------------ */}
      {/* MAIN CONTENT                                                       */}
      {/* ------------------------------------------------------------------ */}

      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 xl:px-10">

        <PageHeader
          eyebrow="Shop Management"
          title={detail.customer.name}
          caption={`${detail.customer.display_id} · ${detail.customer.mobile}`}
          action={
            <div className="flex flex-wrap items-center gap-2 no-print">

              <Button
                variant="teal"
                onClick={() => setShowPay(true)}
              >
                <PlusCircle size={14} />
                Receive Payment
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowSale(true)}
              >
                <ShoppingCart size={14} />
                Record Shop Sale
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowAdjustment(true)}
              >
                <RefreshCw size={14} />
                Return / Adjustment
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowExpense(true)}
              >
                <Wallet size={14} />
                Record Expense
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowAddCustomer(true)}
              >
                <Users size={14} />
                Add Supply Customer
              </Button>

              <PrintButton label="Print" />

            </div>
          }
        />

        <div className="print-area space-y-8">

          {/* ---------------------------------------------------------------- */}
          {/* BUSINESS DATE                                                    */}
          {/* ---------------------------------------------------------------- */}

          <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">

            <div className="flex items-center gap-3">

              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <CalendarDays size={18} />
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-800">
                  Business Date
                </div>

                <div className="mt-0.5 text-xs text-slate-500">
                  Select the business day you want to review.
                </div>
              </div>

            </div>

            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputClass} w-full sm:w-[190px]`}
            />

          </section>


          {/* ---------------------------------------------------------------- */}
          {/* HERO METRICS                                                     */}
          {/* ---------------------------------------------------------------- */}

          <section>

            <div className="mb-4">
              <h2 className="font-display text-xl font-bold text-slate-900">
                Business Overview
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Current financial and inventory position for this shop.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

              {/* CASH */}
              <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-6 shadow-sm">

                <div className="flex items-start justify-between">

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/80">
                      Shop Cash Balance
                    </div>

                    <div className="mt-2 font-display text-3xl font-bold text-brand-green">
                      {pkr(detail.cash.closing_cash)}
                    </div>
                  </div>

                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 text-emerald-600">
                    <Banknote size={19} />
                  </div>

                </div>

                <div className="mt-5 flex items-center justify-between border-t border-emerald-200/60 pt-3 text-xs">

                  <span className="text-slate-500">
                    Opening Cash
                  </span>

                  <span className="font-mono font-semibold text-slate-700">
                    {pkr(detail.cash.opening_cash)}
                  </span>

                </div>

              </div>


              {/* DOWA */}
              <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-6 shadow-sm">

                <div className="flex items-start justify-between">

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-700/80">
                      Dowa Outstanding
                    </div>

                    <div className="mt-2 font-display text-3xl font-bold text-brand-red">
                      {pkr(detail.customer.current_balance)}
                    </div>
                  </div>

                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 text-rose-600">
                    <AlertCircle size={19} />
                  </div>

                </div>

                <div className="mt-5 flex items-center justify-between border-t border-rose-200/60 pt-3 text-xs">

                  <span className="text-slate-500">
                    Account Holder
                  </span>

                  <span className="font-semibold text-slate-700">
                    {detail.customer.name}
                  </span>

                </div>

              </div>


              {/* STOCK */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="flex items-start justify-between">

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Closing Stock Inventory
                    </div>

                    <div className="mt-2 font-display text-3xl font-bold text-slate-900">
                      {s.total_closing_stock}
                      <span className="ml-2 text-sm font-normal text-slate-400">
                        units
                      </span>
                    </div>
                  </div>

                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Package size={19} />
                  </div>

                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">

                  <span className="text-slate-500">
                    Opening{" "}
                    <strong className="text-slate-700">
                      {s.total_opening_stock}
                    </strong>
                  </span>

                  <span className="text-emerald-600">
                    Loaded{" "}
                    <strong>
                      +{s.total_new_load}
                    </strong>
                  </span>

                  <span className="text-slate-600">
                    Sold{" "}
                    <strong>
                      -{s.total_sales}
                    </strong>
                  </span>

                </div>

              </div>

            </div>
          </section>


          {/* ---------------------------------------------------------------- */}
          {/* STOCK BATCHES (FIFO BREAKDOWN & INVENTORY FLOW)                  */}
          {/* ---------------------------------------------------------------- */}

          <ShopStockBatchesPanel
            batches={batches}
            tableBatches={filteredBatches ?? batches}
            totalOpeningStock={s.total_opening_stock}
            totalNewLoad={s.total_new_load}
            totalSoldToday={s.total_sales}
            monthFilter={batchesMonthFilter}
            onMonthFilterChange={setBatchesMonthFilter}
            monthOptions={Array.from(
              new Set(batches.map((b) => toKarachiDateString(b.transaction_date).slice(0, 7)))
            ).sort((a, b) => (a < b ? 1 : -1))}
          />


          {/* ---------------------------------------------------------------- */}
          {/* RETURNS / ADJUSTMENTS                                            */}
          {/* ---------------------------------------------------------------- */}

          {(s.total_returns !== "0" ||
            s.total_adjustments !== "0") && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

                <div className="text-xs font-medium text-slate-500">
                  Today's Returns
                </div>

                <div className="mt-1 font-display text-xl font-bold text-slate-900">
                  {s.total_returns}
                </div>

              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

                <div className="text-xs font-medium text-slate-500">
                  Today's Adjustments
                </div>

                <div className="mt-1 font-display text-xl font-bold text-slate-900">
                  {s.total_adjustments}
                </div>

              </div>

            </div>
          )}


          {/* ---------------------------------------------------------------- */}
          {/* CASH FLOW                                                        */}
          {/* ---------------------------------------------------------------- */}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  Shop Cash Flow
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Business Date: {detail.cash.business_date}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">

                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Live Account Balance
                </div>

                <div className="mt-1 text-sm font-semibold text-slate-800">
                  {detail.account.name}
                  <span className="mx-2 text-slate-300">
                    ·
                  </span>
                  {pkr(detail.account.current_balance)}
                </div>

              </div>

            </div>


            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">

              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <span className="block text-xs font-medium text-slate-500">
                  Opening Cash
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-slate-800">
                  {pkr(detail.cash.opening_cash)}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <span className="block text-xs font-medium text-emerald-700">
                  Cash Sales (+)
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-green">
                  +{pkr(detail.cash.cash_retail_sales)}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <span className="block text-xs font-medium text-emerald-700">
                  Collections (+)
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-green">
                  +{pkr(detail.cash.supply_customer_collections)}
                </span>
              </div>

              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
                <span className="block text-xs font-medium text-rose-700">
                  Expenses (-)
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-red">
                  -{pkr(detail.cash.expenses)}
                </span>
              </div>

              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
                <span className="block text-xs font-medium text-rose-700">
                  Withdrawals (-)
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-red">
                  -{pkr(detail.cash.owner_withdrawals)}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
                <span className="block text-xs font-medium text-slate-600">
                  Closing Cash
                </span>

                <span className="mt-1 block font-mono text-base font-bold text-slate-900">
                  {pkr(detail.cash.closing_cash)}
                </span>
              </div>

            </div>


            {(detail.cash.dowa_payments !== "0" ||
              detail.cash.transfers_in !== "0" ||
              detail.cash.transfers_out !== "0") && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">

                {detail.cash.dowa_payments !== "0" && (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                    Payments to Dowa: -
                    {pkr(detail.cash.dowa_payments)}
                  </span>
                )}

                {detail.cash.transfers_in !== "0" && (
                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">
                    Transfers In: +
                    {pkr(detail.cash.transfers_in)}
                  </span>
                )}

                {detail.cash.transfers_out !== "0" && (
                  <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-800">
                    Transfers Out: -
                    {pkr(detail.cash.transfers_out)}
                  </span>
                )}

              </div>
            )}

          </section>


          {/* ---------------------------------------------------------------- */}
          {/* STOCK / PRODUCT PRICING                                         */}
          {/* ---------------------------------------------------------------- */}

          {s.products.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="border-b border-slate-200 bg-white px-6 py-5">

                <h2 className="font-display text-xl font-bold text-slate-900">
                  Stock & Sale Pricing
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Product-level stock, board rates and today's sales.
                </p>

              </div>

              <div className="overflow-x-auto">

                <table className="w-full min-w-[950px] border-collapse text-sm">

                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">

                      <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Product
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Board Rate/kg
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Physical
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Wastage
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Net Saleable
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Sale Rate
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Today's Sales
                      </th>

                    </tr>
                  </thead>

                  <tbody>

                    {s.products.map((p) => (
                      <tr
                        key={p.product_id}
                        className="border-b border-slate-100 transition hover:bg-slate-50/70"
                      >

                        <td className="px-5 py-4 font-semibold text-slate-800">
                          {p.product_name}
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                          {p.board_rate_per_kg
                            ? `${pkr(p.board_rate_per_kg)}/kg`
                            : "Not set"}
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                          {p.cylinder_weight} kg
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                          -{p.wastage_kg} kg
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs font-semibold text-slate-700">
                          {p.saleable_kg} kg
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                          {p.sale_rate_per_cylinder
                            ? pkr(p.sale_rate_per_cylinder)
                            : "—"}
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs font-bold text-brand-green">
                          {pkr(p.todays_sales_amount)}
                        </td>

                      </tr>
                    ))}

                  </tbody>

                </table>

              </div>

            </section>
          )}


          {/* ---------------------------------------------------------------- */}
          {/* BUSINESS LEDGER                                                  */}
          {/* ---------------------------------------------------------------- */}

          {ledger && ledger.rows.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-6 py-5 lg:flex-row lg:items-center lg:justify-between">

                <div className="flex items-start gap-3">

                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <BookOpen size={20} />
                  </div>

                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">
                      Shop Business Ledger
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      Complete business activity — visible at a glance.
                    </p>
                  </div>

                </div>

                <div className="flex flex-wrap gap-2">

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Business Date
                    </div>

                    <div className="mt-0.5 font-mono text-xs font-semibold text-slate-700">
                      {ledger.business_date}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Entries
                    </div>

                    <div className="mt-0.5 font-mono text-xs font-semibold text-slate-700">
                      {ledger.rows.length}
                    </div>
                  </div>

                </div>

              </div>


              {/* Excel-style table */}
              <div className="overflow-x-auto">

                <table className="w-full min-w-[1050px] border-collapse text-sm">

                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100">

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Time
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Type
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        ID
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Description
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Amount
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Cash Impact
                      </th>

                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Entered By
                      </th>

                    </tr>
                  </thead>

                  <tbody>

                    {ledger.rows.map((r, index) => {

                      const positive =
                        parseFloat(r.cash_impact) >= 0;

                      return (
                        <tr
                          key={r.ref_id}
                          className={`
                            border-b border-slate-100
                            transition-colors
                            hover:bg-teal/[0.025]
                            ${
                              index % 2 === 0
                                ? "bg-white"
                                : "bg-slate-50/30"
                            }
                          `}
                        >

                          <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                            {fmtTime(r.date)}
                          </td>

                          <td className="border-r border-slate-100 px-4 py-3">

                            <span
                              className={`
                                inline-flex rounded-md px-2 py-1
                                text-[10px]
                                font-semibold
                                uppercase
                                tracking-wide
                                ${
                                  r.kind === "expense" ||
                                  r.kind === "owner_withdrawal"
                                    ? "bg-rose-50 text-rose-700"
                                    : r.kind === "cash_sale" ||
                                      r.kind === "customer_payment"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                                }
                              `}
                            >
                              {ledgerLabel(r.kind)}
                            </span>

                          </td>

                          <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                            {r.display_id}
                          </td>

                          <td className="border-r border-slate-100 px-4 py-3 text-sm text-slate-700">
                            {r.description || "—"}
                          </td>

                          <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs font-medium text-slate-700">
                            {pkr(r.amount)}
                          </td>

                          <td className="border-r border-slate-100 px-4 py-3 text-right">

                            <span
                              className={`
                                inline-flex items-center gap-1
                                font-mono text-xs font-bold
                                ${
                                  positive
                                    ? "text-brand-green"
                                    : "text-brand-red"
                                }
                              `}
                            >
                              {positive ? (
                                <ArrowUpRight size={12} />
                              ) : (
                                <ArrowDownRight size={12} />
                              )}

                              {positive ? "+" : ""}
                              {pkr(r.cash_impact)}
                            </span>

                          </td>

                          <td className="px-4 py-3 font-mono text-xs text-slate-500">
                            {r.entered_by}
                          </td>

                        </tr>
                      );
                    })}

                  </tbody>

                </table>

              </div>

              <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">

                <span className="text-xs text-slate-500">
                  Showing all business entries for this date.
                </span>

                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  Live business ledger
                </span>

              </div>

            </section>
          )}


          {/* ---------------------------------------------------------------- */}
          {/* ACTIVITY & RECORDS                                               */}
          {/* ---------------------------------------------------------------- */}

          <section>

            <div className="mb-5">
              <h2 className="font-display text-xl font-bold text-slate-900">
                Activity & Records
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Open detailed records when you need them.
              </p>
            </div>


            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">

              {/* RECENT TRANSACTIONS */}
              <button
                onClick={() => setShowTransactions(true)}
                className="
                  group
                  rounded-2xl
                  border border-slate-200
                  bg-white
                  p-6
                  text-left
                  shadow-sm
                  transition-all
                  hover:-translate-y-0.5
                  hover:border-teal/30
                  hover:shadow-md
                  cursor-pointer
                "
              >

                <div className="flex items-start justify-between">

                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal/10 text-teal">
                    <Receipt size={20} />
                  </div>

                  <div className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition group-hover:translate-x-1 group-hover:text-teal">
                    <ChevronRight size={19} />
                  </div>

                </div>

                <div className="mt-5">

                  <div className="flex items-center gap-2">

                    <h3 className="font-display text-lg font-bold text-slate-900">
                      Recent Transactions
                    </h3>

                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-500">
                      {detail.transactions.length}
                    </span>

                  </div>

                  <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">
                    View loads, shop sales, payments, returns and
                    adjustments in the complete transaction register.
                  </p>

                </div>


                <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">

                  {detail.transactions.slice(0, 3).map((t) => (
                    <div
                      key={t.ref_id}
                      className="flex items-center justify-between gap-4"
                    >

                      <div className="min-w-0">

                        <div className="truncate text-xs font-semibold text-slate-700">
                          {t.description ||
                            transactionLabel(t.kind)}
                        </div>

                        <div className="mt-1 font-mono text-[10px] text-slate-400">
                          {fmtTime(t.date)} · {t.display_id}
                        </div>

                      </div>

                      <div className="shrink-0 font-mono text-xs font-semibold text-slate-700">
                        {t.amount ? pkr(t.amount) : "—"}
                      </div>

                    </div>
                  ))}

                  {!detail.transactions.length && (
                    <div className="py-3 text-xs text-slate-400">
                      No transactions this month.
                    </div>
                  )}

                </div>


                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">

                  <span className="text-xs font-medium text-slate-500">
                    {detail.transactions.length} total records
                  </span>

                  <span className="text-xs font-semibold text-teal">
                    View full history →
                  </span>

                </div>

              </button>


              {/* SUPPLY CUSTOMERS */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                <div className="flex items-start justify-between">

                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Users size={20} />
                  </div>

                  <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-[10px] font-semibold text-slate-500">
                    {supplyCustomers.length}
                  </span>

                </div>

                <div className="mt-5">

                  <h3 className="font-display text-lg font-bold text-slate-900">
                    Supply Customers
                  </h3>

                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Customers supplied by this shop and their current
                    outstanding balances.
                  </p>

                </div>


                {supplyCustomers.length > 0 && (
                  <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">

{supplyCustomers.slice(0, 3).map((customer) => (
  <div
    key={customer.id}
    className="flex items-center justify-between gap-3"
  >
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs font-semibold text-slate-700">
        {customer.name}
      </div>

      <div className="mt-1 font-mono text-[10px] text-slate-400">
        {customer.mobile ?? "No mobile"}
      </div>
    </div>

    <div className="shrink-0 text-right">
      <div className="font-mono text-xs font-semibold text-slate-800">
        {pkr(customer.current_balance)}
      </div>

      {parseFloat(customer.current_balance) > 0 && (
        <button
          onClick={() => setPayCustomerTarget(customer)}
          className="
            mt-1
            inline-flex items-center
            rounded-md
            bg-emerald-50
            px-2 py-1
            text-[10px]
            font-semibold
            text-emerald-700
            transition
            hover:bg-emerald-100
            cursor-pointer
          "
        >
          Receive Payment
        </button>
      )}
    </div>
  </div>
))}


                <button
                  onClick={() => setShowAddCustomer(true)}
                  className="
                    mt-5
                    flex w-full
                    items-center justify-center
                    gap-2
                    rounded-lg
                    border border-teal/20
                    bg-teal/5
                    px-3 py-2.5
                    text-xs
                    font-semibold
                    text-teal
                    transition
                    hover:bg-teal/10
                    cursor-pointer
                  "
                >
                  <PlusCircle size={14} />
                  Add Supply Customer
                </button>

                  </div>
                )}

              </div>
            </div>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* CORRECTION HISTORY                                               */}
          {/* ---------------------------------------------------------------- */}

          {allCorrections.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

              <button
                onClick={() =>
                  setShowCorrections((value) => !value)
                }
                className="
                  no-print
                  flex w-full
                  items-center justify-between
                  border-b border-slate-100
                  bg-slate-50/60
                  px-6 py-5
                  text-left
                  transition
                  hover:bg-slate-100/60
                  cursor-pointer
                "
              >

                <div className="flex items-center gap-3">

                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <RefreshCw size={16} />
                  </div>

                  <div>

                    <h2 className="font-display text-base font-bold text-slate-800">
                      Correction History
                    </h2>

                    <p className="mt-0.5 text-xs text-slate-500">
                      {allCorrections.length} corrected transaction
                      {allCorrections.length === 1 ? "" : "s"}
                    </p>

                  </div>

                </div>

                <span className="text-xs font-semibold text-teal">
                  {showCorrections
                    ? "Hide Details"
                    : "Show Details"}
                </span>

              </button>


              <div
                className={`overflow-x-auto ${
                  showCorrections
                    ? ""
                    : "hidden print:block"
                }`}
              >

                <table className="w-full min-w-[1000px] text-left text-sm">

                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">

                      <Th>Date</Th>
                      <Th>Type</Th>
                      <Th>Original ID</Th>
                      <Th>Description</Th>
                      <Th right>Original Amount</Th>
                      <Th>Reason</Th>
                      <Th>Corrected By</Th>
                      <Th>Corrected At</Th>
                      <Th>Replaced By</Th>

                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    {allCorrections.map((c) => (
                      <tr
                        key={c.ref_id}
                        className="transition hover:bg-slate-50/60"
                      >

                        <Td mono>
                          {fmtTime(c.date)}
                        </Td>

                        <Td mono>
                          {c.kind}
                        </Td>

                        <Td mono color="#9B4A4A">
                          <span className="font-semibold text-brand-red">
                            {c.display_id}
                          </span>
                        </Td>

                        <Td>
                          {c.description}
                        </Td>

                        <Td right mono>
                          {pkr(c.original_amount)}
                        </Td>

                        <Td>
                          {c.correction_reason}
                        </Td>

                        <Td mono>
                          {c.corrected_by}
                        </Td>

                        <Td mono>
                          {fmtTime(c.corrected_at)}
                        </Td>

                        <Td mono>
                          {c.corrected_display_id ?? "—"}
                        </Td>

                      </tr>
                    ))}

                  </tbody>

                </table>

              </div>

            </section>
          )}

        </div>
      </div>


      {/* -------------------------------------------------------------------- */}
      {/* MODALS                                                               */}
      {/* -------------------------------------------------------------------- */}

      {showTransactions && (
        <TransactionHistoryModal
          transactions={detail.transactions}
          month={month}
          setMonth={setMonth}
          onClose={() => setShowTransactions(false)}
          onCorrect={openCorrect}
          correctLoading={correctLoading}
        />
      )}


      {showPay && (
        <ReceivePaymentModal
          isOpen={showPay}
          onClose={() => setShowPay(false)}
          defaultCustomerId={shopId}
          onSuccess={() => {
            setShowPay(false);
            load();
          }}
        />
      )}


      {showSale && (
        <RecordShopSaleModal
          shopId={shopId}
          stockProducts={detail.stock.products}
          onClose={() => setShowSale(false)}
          onSaved={() => {
            setShowSale(false);
            load();
          }}
        />
      )}


      {showAdjustment && (
        <RecordShopAdjustmentModal
          shopId={shopId}
          onClose={() => setShowAdjustment(false)}
          onSaved={() => {
            setShowAdjustment(false);
            load();
          }}
        />
      )}


      {showExpense && (
        <RecordShopExpenseModal
          shopId={shopId}
          onClose={() => setShowExpense(false)}
          onSaved={() => {
            setShowExpense(false);
            load();
          }}
        />
      )}


      {showAddCustomer && (
        <AddSupplyCustomerModal
          shopId={shopId}
          onClose={() => setShowAddCustomer(false)}
          onCreated={() => {
            setShowAddCustomer(false);
            load();
          }}
        />
      )}


      {payCustomerTarget && (
        <RecordSupplyCustomerPaymentModal
          shopId={shopId}
          customer={payCustomerTarget}
          onClose={() => setPayCustomerTarget(null)}
          onSaved={() => {
            setPayCustomerTarget(null);
            load();
          }}
        />
      )}


      {correctTarget && (
        <CorrectTransactionModal
          kind={correctTarget.kind}
          transaction={correctTarget.transaction}
          onClose={() => setCorrectTarget(null)}
          onSaved={() => {
            setCorrectTarget(null);
            load();
          }}
        />
      )}

    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* PAGE                                                                       */
/* -------------------------------------------------------------------------- */

export default function ShopDetailPage() {
  return (
    <AuthGate>
      <ShopDetailBody />
    </AuthGate>
  );
}
