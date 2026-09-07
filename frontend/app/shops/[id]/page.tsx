"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";

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
  Zap,
  Printer,
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
import AddSupplyCustomerModal from "@/components/AddSupplyCustomerModal";
import RecordSupplyCustomerPaymentModal from "@/components/RecordSupplyCustomerPaymentModal";
import SupplyCustomerLedgerModal from "@/components/SupplyCustomerLedgerModal";
import RecordShopExpenseModal from "@/components/RecordShopExpenseModal";
import EmergencyTransferModal from "@/components/EmergencyTransferModal";
import CorrectTransactionModal, {
  CorrectableKind,
} from "@/components/CorrectTransactionModal";
import PrintButton from "@/components/PrintButton";
import ShopStockBatchesPanel from "@/components/ShopStockBatchesPanel";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString, fmtNumber } from "@/lib/format";

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

function transactionLabel(kind: string, t: (key: string) => string) {
  const labels: Record<string, string> = {
    load: t("shopDetail.load"),
    shop_sale: t("shopDetail.shopSale"),
    payment: t("customerLedger.colPayment"),
    emergency_transfer_out: t("shopDetail.emergencyTransferOut"),
  };

  return labels[kind] ?? kind;
}

function ledgerLabel(kind: string, t: (key: string) => string) {
  const labels: Record<string, string> = {
    cash_sale: t("shopDetail.cashSale"),
    credit_sale: t("shopDetail.creditSale"),
    customer_payment: t("shopDetail.customerPayment"),
    expense: t("nav.expenses"),
    owner_withdrawal: t("shopDetail.ownerWithdrawal"),
    dowa_payment: t("shopDetail.paymentToDowa"),
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
  const { t } = useTranslation();
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
                {t("shopDetail.transactionHistory")}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {t("shopDetail.transactionHistoryCaption")}
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
              title={t("unifiedSale.close")}
            >
              <X size={18} />
            </button>

          </div>
        </div>

        {/* Transaction Count */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/60 px-6 py-3">
          <span className="text-xs font-medium text-slate-500">
            {t("shopDetail.countFound", { count: transactions.length })}
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
                  {t("customerLedger.colDate")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colType")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("customerLedger.colId")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("customerLedger.colDescription")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colQuantity")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colRateKg")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("unifiedSale.colAmount")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colPaid")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colBalanceDue")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("customerLedger.colEnteredBy")}
                </th>

                <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colStatus")}
                </th>

                <th className="px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("shopDetail.colAction")}
                </th>

              </tr>
            </thead>

            <tbody>

              {transactions.map((row, index) => {

                const outstanding =
                  row.kind === "shop_sale" &&
                  row.amount_outstanding != null &&
                  parseFloat(row.amount_outstanding) > 0;

                return (
                  <tr
                    key={row.ref_id}
                    className={`
                      border-b border-slate-100
                      transition-colors
                      hover:bg-teal/[0.025]
                      ${index % 2 === 0 ? "bg-white" : "bg-slate-50/30"}
                    `}
                  >

                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                      {fmtTime(row.date)}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3">
                      <span
                        className={`
                          inline-flex rounded-md px-2 py-1
                          text-[10px] font-semibold uppercase tracking-wide
                          ${
                            row.kind === "payment"
                              ? "bg-emerald-50 text-emerald-700"
                              : row.kind === "shop_sale"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                          }
                        `}
                      >
                        {transactionLabel(row.kind, t)}
                      </span>
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                      {row.display_id}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-sm text-slate-700">
                      {row.description || "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {row.quantity ?? "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {row.board_rate_per_kg ?? row.load_rate_per_kg ?? "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs font-semibold text-slate-700">
                      {row.amount ? pkr(row.amount) : "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {row.kind === "shop_sale" &&
                      row.amount_received != null
                        ? pkr(row.amount_received)
                        : "—"}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 text-right font-mono text-xs">
                      {row.kind === "shop_sale" &&
                      row.amount_outstanding != null ? (
                        <span
                          className={
                            outstanding
                              ? "font-bold text-brand-red"
                              : "font-medium text-slate-600"
                          }
                        >
                          {pkr(row.amount_outstanding)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3 font-mono text-xs text-slate-500">
                      {row.entered_by}
                    </td>

                    <td className="border-r border-slate-100 px-4 py-3">
                      <span className="font-mono text-[10px] uppercase text-slate-500">
                        {row.status}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {row.correctable && (
                          <button
                            onClick={() => onCorrect(row)}
                            disabled={correctLoading === row.ref_id}
                            title={t("customerLedger.correctThisTransaction")}
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
                        {row.kind === "shop_sale" && (
                          <a
                            href={api.shops.saleInvoiceUrl(row.ref_id)}
                            target="_blank"
                            rel="noreferrer"
                            title={t("unifiedSale.viewPrintInvoice")}
                            className="
                              inline-flex h-8 w-8
                              items-center justify-center
                              rounded-lg
                              text-slate-400
                              transition
                              hover:bg-teal/10
                              hover:text-teal
                              cursor-pointer
                            "
                          >
                            <Printer size={14} />
                          </a>
                        )}
                      </div>
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
                        {t("customerLedger.noTransactionsThisMonth")}
                      </p>

                      <p className="mt-1 text-xs text-slate-400">
                        {t("shopDetail.transactionsWillAppear")}
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
            {t("shopDetail.showingHistoryFor", { month })}
          </span>

          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            {t("unifiedSale.close")}
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
  const { t } = useTranslation();
  const params = useParams();
  const shopId = params.id as string;
  const { user } = useAuth();

  const [date, setDate] = useState(todayLocalInput());
  const [month, setMonth] = useState(currentMonth());

  const [detail, setDetail] = useState<ShopDetailOut | null>(null);
  const [loading, setLoading] = useState(true);

  const [showPay, setShowPay] = useState(false);
  const [showSale, setShowSale] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showEmergencyTransfer, setShowEmergencyTransfer] = useState(false);
  const [showExpense, setShowExpense] = useState(false);

  const [showTransactions, setShowTransactions] = useState(false);

  const [payCustomerTarget, setPayCustomerTarget] =
    useState<ShopSupplyCustomer | null>(null);

  // Supply Customer Ledger (§ Shop Customer Ledger) — showCustomerLedger
  // gates the modal; ledgerInitialCustomerId optionally preselects one
  // customer (e.g. clicked directly from the card) rather than defaulting
  // to the first in the list.
  const [showCustomerLedger, setShowCustomerLedger] = useState(false);
  const [ledgerInitialCustomerId, setLedgerInitialCustomerId] = useState<string | undefined>(undefined);

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
              {t("shopDetail.loadingShop")}
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
          eyebrow={t("shopDetail.eyebrow")}
          title={detail.customer.name}
          caption={`${detail.customer.display_id} · ${detail.customer.mobile}`}
          action={
            <div className="flex flex-wrap items-center gap-2 no-print">

              <Button
                variant="teal"
                onClick={() => setShowPay(true)}
              >
                <PlusCircle size={14} />
                {t("customerLedger.receivePayment")}
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowSale(true)}
              >
                <ShoppingCart size={14} />
                {t("shopDetail.recordShopSale")}
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowExpense(true)}
              >
                <Wallet size={14} />
                {t("expenses.recordExpense")}
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowAddCustomer(true)}
              >
                <Users size={14} />
                {t("shopDetail.addSupplyCustomer")}
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowEmergencyTransfer(true)}
              >
                <Zap size={14} />
                {t("shopDetail.emergencyTransfer")}
              </Button>

              <PrintButton label={t("shopDetail.print")} />

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
                  {t("shopDetail.businessDate")}
                </div>

                <div className="mt-0.5 text-xs text-slate-500">
                  {t("shopDetail.selectBusinessDayHint")}
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
                {t("shopDetail.businessOverview")}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {t("shopDetail.businessOverviewCaption")}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

              {/* CASH */}
              <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-6 shadow-sm">

                <div className="flex items-start justify-between">

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/80">
                      {t("shopDetail.shopCashBalance")}
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
                    {t("shopDetail.openingCash")}
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
                      {t("shopDetail.dowaOutstanding")}
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
                    {t("shopDetail.accountHolder")}
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
                      {t("shopDetail.closingStockInventory")}
                    </div>

                    <div className="mt-2 font-display text-3xl font-bold text-slate-900">
                      {s.total_closing_stock}
                      <span className="ml-2 text-sm font-normal text-slate-400">
                        {t("shopDetail.units")}
                      </span>
                    </div>
                  </div>

                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Package size={19} />
                  </div>

                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">

                  <span className="text-slate-500">
                    {t("shopDetail.opening")}{" "}
                    <strong className="text-slate-700">
                      {s.total_opening_stock}
                    </strong>
                  </span>

                  <span className="text-emerald-600">
                    {t("shopDetail.loaded")}{" "}
                    <strong>
                      +{s.total_new_load}
                    </strong>
                  </span>

                  <span className="text-slate-600">
                    {t("shopDetail.sold")}{" "}
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
          {/* CASH FLOW                                                        */}
          {/* ---------------------------------------------------------------- */}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  {t("shopDetail.shopCashFlow")}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {t("shopDetail.businessDateLabel", { date: detail.cash.business_date })}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">

                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {t("shopDetail.liveAccountBalance")}
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
                  {t("shopDetail.openingCash")}
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-slate-800">
                  {pkr(detail.cash.opening_cash)}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <span className="block text-xs font-medium text-emerald-700">
                  {t("shopDetail.cashSalesPlus")}
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-green">
                  +{pkr(detail.cash.cash_retail_sales)}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <span className="block text-xs font-medium text-emerald-700">
                  {t("shopDetail.collectionsPlus")}
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-green">
                  +{pkr(detail.cash.supply_customer_collections)}
                </span>
              </div>

              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
                <span className="block text-xs font-medium text-rose-700">
                  {t("shopDetail.expensesMinus")}
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-red">
                  -{pkr(detail.cash.expenses)}
                </span>
              </div>

              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
                <span className="block text-xs font-medium text-rose-700">
                  {t("shopDetail.withdrawalsMinus")}
                </span>

                <span className="mt-1 block font-mono text-sm font-semibold text-brand-red">
                  -{pkr(detail.cash.owner_withdrawals)}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
                <span className="block text-xs font-medium text-slate-600">
                  {t("shopDetail.closingCash")}
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
                    {t("shopDetail.paymentsToDowaLine", { amount: pkr(detail.cash.dowa_payments) })}
                  </span>
                )}

                {detail.cash.transfers_in !== "0" && (
                  <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">
                    {t("shopDetail.transfersInLine", { amount: pkr(detail.cash.transfers_in) })}
                  </span>
                )}

                {detail.cash.transfers_out !== "0" && (
                  <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-800">
                    {t("shopDetail.transfersOutLine", { amount: pkr(detail.cash.transfers_out) })}
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
                  {t("shopDetail.stockSalePricing")}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {t("shopDetail.stockPricingCaption")}
                </p>

              </div>

              <div className="overflow-x-auto">

                <table className="w-full min-w-[950px] border-collapse text-sm">

                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">

                      <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("unifiedSale.colProduct")}
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colBoardRateKg")}
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colPhysical")}
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colWastage")}
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colNetSaleable")}
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colSaleRate")}
                      </th>

                      <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colTodaysSales")}
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
                            : t("shopDetail.notSet")}
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                          {fmtNumber(p.cylinder_weight, 2)} kg
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs text-slate-600">
                          -{fmtNumber(p.wastage_kg, 2)} kg
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-xs font-semibold text-slate-700">
                          {fmtNumber(p.saleable_kg, 2)} kg
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
                      {t("shopDetail.shopBusinessLedger")}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {t("shopDetail.businessLedgerCaption")}
                    </p>
                  </div>

                </div>

                <div className="flex flex-wrap gap-2">

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      {t("shopDetail.businessDate")}
                    </div>

                    <div className="mt-0.5 font-mono text-xs font-semibold text-slate-700">
                      {ledger.business_date}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      {t("shopDetail.entries")}
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
                        {t("purchases.colTime")}
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colType")}
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("customerLedger.colId")}
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("customerLedger.colDescription")}
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("unifiedSale.colAmount")}
                      </th>

                      <th className="border-r border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("shopDetail.colCashImpact")}
                      </th>

                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t("customerLedger.colEnteredBy")}
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
                              {ledgerLabel(r.kind, t)}
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
                  {t("shopDetail.showingAllEntries")}
                </span>

                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  {t("shopDetail.liveBusinessLedger")}
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
                {t("shopDetail.activityRecords")}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {t("shopDetail.activityRecordsCaption")}
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
                      {t("shopDetail.recentTransactions")}
                    </h3>

                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-500">
                      {detail.transactions.length}
                    </span>

                  </div>

                  <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">
                    {t("shopDetail.recentTransactionsCaption")}
                  </p>

                </div>


                <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">

                  {detail.transactions.slice(0, 3).map((row) => (
                    <div
                      key={row.ref_id}
                      className="flex items-center justify-between gap-4"
                    >

                      <div className="min-w-0">

                        <div className="truncate text-xs font-semibold text-slate-700">
                          {row.description ||
                            transactionLabel(row.kind, t)}
                        </div>

                        <div className="mt-1 font-mono text-[10px] text-slate-400">
                          {fmtTime(row.date)} · {row.display_id}
                        </div>

                      </div>

                      <div className="shrink-0 font-mono text-xs font-semibold text-slate-700">
                        {row.amount ? pkr(row.amount) : "—"}
                      </div>

                    </div>
                  ))}

                  {!detail.transactions.length && (
                    <div className="py-3 text-xs text-slate-400">
                      {t("customerLedger.noTransactionsThisMonth")}
                    </div>
                  )}

                </div>


                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">

                  <span className="text-xs font-medium text-slate-500">
                    {t("shopDetail.totalRecords", { count: detail.transactions.length })}
                  </span>

                  <span className="text-xs font-semibold text-teal">
                    {t("shopDetail.viewFullHistory")}
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
                    {t("shopDetail.supplyCustomers")}
                  </h3>

                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {t("shopDetail.supplyCustomersCaption")}
                  </p>

                </div>


                {supplyCustomers.length > 0 && (
                  <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">

{supplyCustomers.slice(0, 3).map((customer) => (
  <button
    key={customer.id}
    onClick={() => { setLedgerInitialCustomerId(customer.id); setShowCustomerLedger(true); }}
    className="flex w-full items-center justify-between gap-3 rounded-lg text-left transition hover:bg-slate-50 cursor-pointer"
  >
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs font-semibold text-slate-700">
        {customer.name}
      </div>

      <div className="mt-1 font-mono text-[10px] text-slate-400">
        {customer.mobile ?? t("shopDetail.noMobile")}
      </div>
    </div>

    <div className="shrink-0 text-right">
      <div className="font-mono text-xs font-semibold text-slate-800">
        {pkr(customer.current_balance)}
      </div>

      {parseFloat(customer.current_balance) > 0 && (
        <span
          onClick={(e) => { e.stopPropagation(); setPayCustomerTarget(customer); }}
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
          {t("customerLedger.receivePayment")}
        </span>
      )}
    </div>
  </button>
))}

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[11px] font-medium text-slate-500">
                    {t("shopDetail.customersTotal", { count: supplyCustomers.length })}
                  </span>
                  <button
                    onClick={() => { setLedgerInitialCustomerId(undefined); setShowCustomerLedger(true); }}
                    className="text-[11px] font-semibold text-teal hover:underline cursor-pointer"
                  >
                    {t("shopDetail.viewLedger")}
                  </button>
                </div>

                <button
                  onClick={() => setShowAddCustomer(true)}
                  className="
                    mt-3
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
                  {t("shopDetail.addSupplyCustomer")}
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
                      {t("shopDetail.correctionHistory")}
                    </h2>

                    <p className="mt-0.5 text-xs text-slate-500">
                      {t("shopDetail.correctedTransactionCount", { count: allCorrections.length })}
                    </p>

                  </div>

                </div>

                <span className="text-xs font-semibold text-teal">
                  {showCorrections
                    ? t("shopDetail.hideDetails")
                    : t("shopDetail.showDetails")}
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

                      <Th>{t("customerLedger.colDate")}</Th>
                      <Th>{t("shopDetail.colType")}</Th>
                      <Th>{t("customerLedger.colOriginalId")}</Th>
                      <Th>{t("customerLedger.colDescription")}</Th>
                      <Th right>{t("customerLedger.colOriginalAmount")}</Th>
                      <Th>{t("customerLedger.colReason")}</Th>
                      <Th>{t("customerLedger.colCorrectedBy")}</Th>
                      <Th>{t("customerLedger.colCorrectedAt")}</Th>
                      <Th>{t("customerLedger.colReplacedBy")}</Th>

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
          onPartialSave={load}
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

      {showEmergencyTransfer && (
        <EmergencyTransferModal
          shopId={shopId}
          shopName={detail.customer.name}
          stockProducts={detail.stock.products}
          onClose={() => setShowEmergencyTransfer(false)}
          onSaved={() => {
            setShowEmergencyTransfer(false);
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

      {showCustomerLedger && (
        <SupplyCustomerLedgerModal
          customers={supplyCustomers}
          initialCustomerId={ledgerInitialCustomerId}
          onClose={() => setShowCustomerLedger(false)}
          onReceivePayment={(customer) => {
            setShowCustomerLedger(false);
            setPayCustomerTarget(customer);
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
