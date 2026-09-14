  "use client";

  import { useEffect, useRef, useState } from "react";
  import { createPortal } from "react-dom";
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
    AlertCircle,
    Zap,
    Printer,
    PackagePlus,
    Share2,
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
  import ShopCashTransferModal from "@/components/ShopCashTransferModal";
  import AddSupplyCustomerModal from "@/components/AddSupplyCustomerModal";
  import RecordSupplyCustomerPaymentModal from "@/components/RecordSupplyCustomerPaymentModal";
  import SupplyCustomerLedgerModal from "@/components/SupplyCustomerLedgerModal";
  import RecordShopExpenseModal from "@/components/RecordShopExpenseModal";
  import EmergencyTransferModal from "@/components/EmergencyTransferModal";
  import AddFilledCylinderStockModal from "@/components/AddFilledCylinderStockModal";
  import EditOpeningBalanceModal from "@/components/EditOpeningBalanceModal";
  import CorrectTransactionModal, {
    CorrectableKind,
  } from "@/components/CorrectTransactionModal";
  import ShopStockBatchesPanel from "@/components/ShopStockBatchesPanel";

  import { api } from "@/lib/api";
  import { useAuth } from "@/lib/auth";
  import { pkr, fmtTime, todayLocalInput, toKarachiDateString, fmtNumber, resolveAccountLabel, ACCOUNT_TYPE_LABELS } from "@/lib/format";

import type {
  ShopDetailOut,
  ShopTransactionRow,
  Sale,
  Payment,
  ShopSale,
  ShopSupplyCustomer,
  ShopBusinessLedgerOut,
  ShopBusinessLedgerRow,
  ShopStockBatch,
  Company,
  PaymentAccount,
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
      customer_payment: t("shopDetail.customerPayment"),
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
      shop_cash_transfer: t("shopDetail.cashTransferOut"),
    };

    return labels[kind] ?? kind;
  }

  // Where a Shop Sale's collected amount was routed (§ Settlement Routing) —
  // mirrors unified-sale/page.tsx's getDestinationLabel/resolvePaymentAccountLabel
  // rather than re-implementing it: a "plant" destination resolves the plant's
  // name from target_plant_id, an "account" destination resolves the label
  // from the PaymentAccount row (or its bucket key), and a null destination
  // means nothing was collected (all-credit) or the row predates routing.
function resolveShopSaleRoutedLabel(
  row: ShopTransactionRow | ShopBusinessLedgerRow,
  companies: Company[],
  accounts: PaymentAccount[],
  t: (key: string, options?: Record<string, any>) => string
): string {
    if (!row.settlement_destination_type) return "—";
    if (row.settlement_destination_type === "plant") {
      const plant = companies.find((c) => c.id === row.settlement_target_plant_id);
      return plant ? t("payments.plantLabel", { name: plant.name }) : t("payments.plantSettlementBadge");
    }
    // Account routing: the stored id is a real PaymentAccount UUID (the
    // shop's own Shop Cash account, or a bank account picked on the form)
    // or one of the 4 fixed bucket keys — resolveAccountLabel handles both,
    // exactly like the Unified Sale page.
    if (row.settlement_account_id) {
      return resolveAccountLabel(row.settlement_account_id, accounts);
    }
    return t("payments.accountSettlementBadge");
  }

function renderShopSaleSettlementBreakdown(
  row: ShopTransactionRow | ShopBusinessLedgerRow,
  companies: Company[],
  accounts: PaymentAccount[],
  t: (key: string, options?: Record<string, any>) => string
) {
  const homeExpenseAmount = Number(row.settlement_home_expense_amount || "0");
  const ownerDrawingsAmount = Number(row.settlement_owner_drawings_amount || "0");
  // Math.abs on the cash_impact branch: existing callers (cash_sale/
  // credit_sale) always have a non-negative cash_impact (money INTO Shop
  // Cash), so this is a no-op for them — but shop_cash_transfer's
  // cash_impact is deliberately negative (§ Shop Cash Transfer — an
  // outflow, honestly signed for the ledger's own total), and the
  // Home-Expense/Owner-Drawings/Routed-To breakdown below is always a
  // fraction of the GROSS amount moved, regardless of direction.
  // A "customer_payment" ShopTransactionRow has neither amount_received
  // (shop_sale-only, partial-payment concept) nor cash_impact
  // (ShopBusinessLedgerRow-only) — its `amount` IS the full amount
  // received, by definition (a Payment Only collection has no partial/
  // outstanding concept of its own), so that's the last fallback.
  const amountReceived = "amount_received" in row && row.amount_received != null
    ? Number(row.amount_received)
    : "cash_impact" in row
      ? Math.abs(Number(row.cash_impact))
      : "amount" in row && row.amount != null
        ? Number(row.amount)
        : 0;
  const netSettlementAmount = amountReceived - homeExpenseAmount - ownerDrawingsAmount;
  const parts: Array<{ label: string; value: string }> = [];

  if (homeExpenseAmount > 0) {
    parts.push({
      label: row.settlement_home_expense_description || t("shopDetail.homeExpense"),
      value: pkr(homeExpenseAmount),
    });
  }
  if (ownerDrawingsAmount > 0) {
    parts.push({
      label: t("shopDetail.ownerDrawings"),
      value: pkr(ownerDrawingsAmount),
    });
  }
  if (netSettlementAmount > 0 && row.settlement_destination_type) {
    parts.push({
      label: t("shopDetail.routedTo"),
      value: resolveShopSaleRoutedLabel(row, companies, accounts, t),
    });
  }

  if (!parts.length) return <span className="text-slate-400">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] leading-tight">
      {parts.map((part, index) => (
        <span
          key={`${part.label}-${index}`}
          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md bg-slate-100 px-1.5 py-1"
        >
          <span className="min-w-0 truncate text-slate-500">{part.label}</span>
          <span className="shrink-0 font-mono font-semibold text-slate-800">{part.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Business Ledger's Settlement Breakdown column (§ Shop Detail visual
 * redesign) — a compact one-line summary ("Rs 2,000 deducted → Plant: X",
 * "→ Office Cash") with the full itemized breakdown (same shape
 * renderShopSaleSettlementBreakdown above already computes, just as a
 * click-to-open popover instead of 3 always-rendered chips). Click, not
 * hover, per design decision — financial data worth reading carefully,
 * and a native title= tooltip doesn't work on touch and can clip.
 * Rendered via a portal to document.body so it's never clipped by the
 * table's own overflow-x-auto ancestor. */
function SettlementBreakdownCell({
  row, companies, accounts, t,
}: {
  row: ShopBusinessLedgerRow;
  companies: Company[];
  accounts: PaymentAccount[];
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const homeExpenseAmount = Number(row.settlement_home_expense_amount || "0");
  const ownerDrawingsAmount = Number(row.settlement_owner_drawings_amount || "0");
  const amountReceived = Math.abs(Number(row.cash_impact));
  const netSettlementAmount = amountReceived - homeExpenseAmount - ownerDrawingsAmount;

  const parts: Array<{ label: string; value: string }> = [];
  if (homeExpenseAmount > 0) {
    parts.push({ label: row.settlement_home_expense_description || t("shopDetail.homeExpense"), value: pkr(homeExpenseAmount) });
  }
  if (ownerDrawingsAmount > 0) {
    parts.push({ label: t("shopDetail.ownerDrawings"), value: pkr(ownerDrawingsAmount) });
  }
  const routedToLabel = netSettlementAmount > 0 && row.settlement_destination_type
    ? resolveShopSaleRoutedLabel(row, companies, accounts, t)
    : null;
  if (routedToLabel) {
    parts.push({ label: t("shopDetail.routedTo"), value: routedToLabel });
  }

  if (!parts.length) return <span className="text-slate-400">—</span>;

  const deductionsTotal = homeExpenseAmount + ownerDrawingsAmount;
  const summary =
    deductionsTotal > 0 && routedToLabel
      ? `${pkr(deductionsTotal)} ${t("shopDetail.deducted")} → ${routedToLabel}`
      : deductionsTotal > 0
      ? `${pkr(deductionsTotal)} ${t("shopDetail.deducted")}`
      : routedToLabel
      ? `→ ${routedToLabel}`
      : "—";

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 272) });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="max-w-[220px] truncate text-left text-xs font-medium text-slate-600 underline decoration-dotted decoration-slate-300 underline-offset-2 hover:text-teal cursor-pointer"
      >
        {summary}
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {t("shopDetail.colSettlementBreakdown")}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label={t("unifiedSale.close")}
              >
                <X size={13} />
              </button>
            </div>
            <div className="space-y-1.5">
              {parts.map((part, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-slate-500">{part.label}</span>
                  <span className="shrink-0 font-mono font-semibold text-slate-800">{part.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

  /* -------------------------------------------------------------------------- */

function TransactionHistoryModal({
  shopId,
  shopName,
  transactions,
  month,
  setMonth,
  onClose,
  onCorrect,
  correctLoading,
  companies,
  accounts,
}: {
  shopId: string;
  shopName: string;
  transactions: ShopTransactionRow[];
  month: string;
  setMonth: (value: string) => void;
  onClose: () => void;
  onCorrect: (row: ShopTransactionRow) => void;
  correctLoading: string | null;
  companies: Company[];
  accounts: PaymentAccount[];
}) {
    const { t } = useTranslation();
    const [year, mo] = month.split("-");
    const [sharing, setSharing] = useState(false);
    const [shareStatus, setShareStatus] = useState<{ type: "info" | "error"; msg: string } | null>(null);

    // Send via WhatsApp (client-side only) — same mechanism Customer Ledger/
    // Plant Ledger's own statement already uses (frontend/app/customer-
    // ledger/page.tsx's shareStatement): fetch the same backend-rendered
    // PDF the "Download Statement" link opens, then hand it to the
    // device's native share sheet (navigator.share, mobile — the user
    // picks WhatsApp themselves and the real PDF gets attached) or, where
    // that can't carry a file (desktop), download the PDF and open a
    // wa.me chat draft in parallel for the file to be attached by hand.
    const shareStatement = async () => {
      setShareStatus(null);
      setSharing(true);
      try {
        const res = await fetch(api.shops.statementUrl(shopId, month), { credentials: "include" });
        if (!res.ok) throw new Error(t("customerLedger.shareWhatsappError"));
        const blob = await res.blob();
        const filename = `Statement-${shopName}-${month}.pdf`;
        const file = new File([blob], filename, { type: "application/pdf" });
        const shareText = t("shopDetail.shareWhatsappShopText", { name: shopName, mo, year });

        let canShareFile = false;
        try {
          canShareFile =
            typeof navigator.canShare === "function" &&
            typeof navigator.share === "function" &&
            navigator.canShare({ files: [file] });
        } catch {
          canShareFile = false;
        }

        if (canShareFile) {
          try {
            await navigator.share({ files: [file], title: filename, text: shareText });
          } catch (err) {
            if (err instanceof Error && err.name !== "AbortError") throw err;
          }
          return;
        }

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);

        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
        setShareStatus({ type: "info", msg: t("customerLedger.shareWhatsappFallbackInstruction") });
      } catch (err) {
        setShareStatus({ type: "error", msg: err instanceof Error ? err.message : t("customerLedger.shareWhatsappError") });
      } finally {
        setSharing(false);
      }
    };

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

              <a
                href={api.shops.statementUrl(shopId, month)}
                target="_blank"
                rel="noreferrer"
                title={t("shopDetail.downloadStatementTitle")}
                className="inline-flex items-center gap-2 font-body text-[13px] font-medium px-4 py-2.5 rounded-md bg-transparent text-ink border border-hairline cursor-pointer"
              >
                <Printer size={14} /> {t("shopDetail.downloadStatement")}
              </a>
              <Button variant="outline" onClick={shareStatement} disabled={sharing}>
                <Share2 size={14} /> {sharing ? t("customerLedger.sharingWhatsapp") : t("customerLedger.shareWhatsapp")}
              </Button>

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

          {shareStatus && (
            <div
              className={`shrink-0 mx-6 mt-3 font-body text-[12.5px] px-3 py-2 rounded-md border ${
                shareStatus.type === "info"
                  ? "bg-[#EAF6F6] text-tealdeep border-[#BFE3E3]"
                  : "bg-red-50 text-red-600 border-red-200"
              }`}
            >
              {shareStatus.msg}
            </div>
          )}

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
                     {t("shopDetail.colSettlementBreakdown")}
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
                              row.kind === "payment" || row.kind === "customer_payment"
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

                       <td className="border-r border-slate-100 px-4 py-3">
                         {row.kind === "shop_sale" || row.kind === "customer_payment"
                           ? renderShopSaleSettlementBreakdown(row, companies, accounts, t)
                           : <span className="text-slate-400">—</span>}
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

    const [sharingStatement, setSharingStatement] = useState(false);
    const [shareStatementStatus, setShareStatementStatus] = useState<{ type: "info" | "error"; msg: string } | null>(null);

    const [showPay, setShowPay] = useState(false);
    const [showSale, setShowSale] = useState(false);
    const [showCashTransfer, setShowCashTransfer] = useState(false);
    const [showAddStock, setShowAddStock] = useState(false);
    const [showCorrections, setShowCorrections] = useState(false);
    const [showStockPricing, setShowStockPricing] = useState(false);
    const [showBusinessLedger, setShowBusinessLedger] = useState(false);
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

    const [showEditOpening, setShowEditOpening] = useState(false);

    // Stock Batches (FIFO Breakdown) — `batches` is always the LIVE/
    // unfiltered queue (the Inventory Flow Summary Bar's "carrying
    // balances" must never shift from the historic "Inspect month" filter
    // below it — see ShopStockBatchesPanel's docstring). `filteredBatches`
    // is only populated when a specific month is selected there; null means
    // "use `batches` as-is" for the table too.
    const [batches, setBatches] = useState<ShopStockBatch[]>([]);
    const [batchesMonthFilter, setBatchesMonthFilter] = useState("");
    const [filteredBatches, setFilteredBatches] = useState<ShopStockBatch[] | null>(null);

    // Where a Shop Sale's collected amount was routed (§ Settlement Routing)
    // — resolved on the frontend (see resolveShopSaleRoutedLabel, mirroring
    // unified-sale/page.tsx's getDestinationLabel) so the shop side shows the
    // same "Routed To" info the plant side already gets.
    const [companies, setCompanies] = useState<Company[]>([]);
    const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

    const load = () => {
      setLoading(true);

      Promise.all([
        api.shops.detail(shopId, { date, month }),
        api.companies.list(),
        api.paymentAccounts.list(),
      ])
        .then(([d, c, a]) => { setDetail(d); setCompanies(c); setAccounts(a); })
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

    // Send via WhatsApp (client-side only) — same mechanism every other
    // statement in the app already uses (frontend/app/customer-ledger/
    // page.tsx's shareStatement). Top-level entry point replacing the old
    // generic browser-print button — TransactionHistoryModal keeps its own
    // separate instance of this for when browsing a different month there.
    const shareStatement = async () => {
      setShareStatementStatus(null);
      setSharingStatement(true);
      try {
        const res = await fetch(api.shops.statementUrl(shopId, month), { credentials: "include" });
        if (!res.ok) throw new Error(t("customerLedger.shareWhatsappError"));
        const blob = await res.blob();
        const filename = `Statement-${detail.customer.name}-${month}.pdf`;
        const file = new File([blob], filename, { type: "application/pdf" });
        const [year, mo] = month.split("-");
        const shareText = t("shopDetail.shareWhatsappShopText", { name: detail.customer.name, mo, year });

        let canShareFile = false;
        try {
          canShareFile =
            typeof navigator.canShare === "function" &&
            typeof navigator.share === "function" &&
            navigator.canShare({ files: [file] });
        } catch {
          canShareFile = false;
        }

        if (canShareFile) {
          try {
            await navigator.share({ files: [file], title: filename, text: shareText });
          } catch (err) {
            if (err instanceof Error && err.name !== "AbortError") throw err;
          }
          return;
        }

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);

        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
        setShareStatementStatus({ type: "info", msg: t("customerLedger.shareWhatsappFallbackInstruction") });
      } catch (err) {
        setShareStatementStatus({ type: "error", msg: err instanceof Error ? err.message : t("customerLedger.shareWhatsappError") });
      } finally {
        setSharingStatement(false);
      }
    };

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

                <div
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2"
                  title={t("shopDetail.selectBusinessDayHint")}
                >
                  <CalendarDays size={14} className="text-slate-400" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-[130px] border-0 bg-transparent font-body text-[13px] text-ink outline-none"
                    aria-label={t("shopDetail.businessDate")}
                  />
                </div>

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
                  onClick={() => setShowAddStock(true)}
                >
                  <PackagePlus size={14} />
                  {t("shopDetail.addFilledStock")}
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

                <a
                  href={api.shops.statementUrl(shopId, month)}
                  target="_blank"
                  rel="noreferrer"
                  title={t("shopDetail.downloadStatementTitle")}
                  className="inline-flex items-center gap-2 font-body text-[13px] font-medium px-4 py-2.5 rounded-md bg-transparent text-ink border border-hairline cursor-pointer"
                >
                  <Printer size={14} /> {t("shopDetail.downloadStatement")}
                </a>
                <Button variant="outline" onClick={shareStatement} disabled={sharingStatement}>
                  <Share2 size={14} /> {sharingStatement ? t("customerLedger.sharingWhatsapp") : t("customerLedger.shareWhatsapp")}
                </Button>

              </div>
            }
          />

          {shareStatementStatus && (
            <div
              className={`mb-5 font-body text-[12.5px] px-3 py-2 rounded-md border ${
                shareStatementStatus.type === "info"
                  ? "bg-[#EAF6F6] text-tealdeep border-[#BFE3E3]"
                  : "bg-red-50 text-red-600 border-red-200"
              }`}
            >
              {shareStatementStatus.msg}
            </div>
          )}

          <div className="print-area space-y-8">

            {/* ---------------------------------------------------------------- */}
            {/* HERO METRICS — Shop Cash Balance lives only in the Shop Cash     */}
            {/* Flow section below (with the Transfer Out button); showing it   */}
            {/* here too was pure duplication of the same number.               */}
            {/* ---------------------------------------------------------------- */}

            <section>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

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

                <div className="flex items-center gap-3">

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

                  <Button
                    variant="outline"
                    onClick={() => setShowCashTransfer(true)}
                  >
                    <ArrowUpRight size={14} />
                    {t("shopDetail.transferOut")}
                  </Button>

                </div>

              </div>


              {/* Flat, evenly-sized tiles — same visual weight as Purchases'
                  5-stat row (Opening/Total Purchases/Total Payments/Total
                  Ton/Current Payable), just one uniform style throughout
                  instead of per-metric background colors. Owner Withdrawals
                  kept as its own tile rather than folded into Expenses —
                  the expense-vs-owner-drawdown distinction stays visible at
                  a glance, not just in the ledger detail below. */}
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-medium text-slate-500">
                      {t("shopDetail.openingCash")}
                    </span>
                    <button
                      onClick={() => setShowEditOpening(true)}
                      className="print:hidden bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-700"
                      aria-label={t("modals.editOpeningBalanceTitle", { id: detail.customer.display_id })}
                    >
                      <Pencil size={12} />
                    </button>
                  </div>

                  <span className="mt-1 block font-mono text-lg font-bold text-slate-900">
                    {pkr(detail.cash.opening_cash)}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="block text-xs font-medium text-slate-500">
                    {t("shopDetail.cashSalesPlus")}
                  </span>

                  <span className="mt-1 block font-mono text-lg font-bold text-brand-green">
                    +{pkr(detail.cash.cash_retail_sales)}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="block text-xs font-medium text-slate-500">
                    {t("shopDetail.collectionsPlus")}
                  </span>

                  <span className="mt-1 block font-mono text-lg font-bold text-brand-green">
                    +{pkr(detail.cash.supply_customer_collections)}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="block text-xs font-medium text-slate-500">
                    {t("shopDetail.expensesMinus")}
                  </span>

                  <span className="mt-1 block font-mono text-lg font-bold text-brand-red">
                    -{pkr(detail.cash.expenses)}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="block text-xs font-medium text-slate-500">
                    {t("shopDetail.withdrawalsMinus")}
                  </span>

                  <span className="mt-1 block font-mono text-lg font-bold text-brand-red">
                    -{pkr(detail.cash.owner_withdrawals)}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="block text-xs font-medium text-slate-500">
                    {t("shopDetail.closingCash")}
                  </span>

                  <span className="mt-1 block font-mono text-lg font-bold text-slate-900">
                    {pkr(detail.cash.closing_cash)}
                  </span>
                </div>

              </div>


              {(detail.cash.dowa_payments !== "0" ||
                detail.cash.transfers_in !== "0" ||
                detail.cash.transfers_out !== "0" ||
                detail.cash.cash_transfers_out !== "0" ||
                detail.cash.settlement_home_expense_total !== "0" ||
                detail.cash.settlement_owner_drawings_total !== "0") && (
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

                  {detail.cash.cash_transfers_out !== "0" && (
                    <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-800">
                      {t("shopDetail.cashTransfersOutLine", { amount: pkr(detail.cash.cash_transfers_out) })}
                    </span>
                  )}

                  {/* Sale/Transfer Deductions — purely informational (never
                      part of closing_cash above): Home Expense/Owner
                      Drawings bypassed via a Shop Sale's or Shop Cash
                      Transfer's settlement routing this period. Neutral
                      gray, deliberately distinct from the colored pills
                      above, which are all real Shop Cash flows. */}
                  {(detail.cash.settlement_home_expense_total !== "0" ||
                    detail.cash.settlement_owner_drawings_total !== "0") && (
                    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                      {t("shopDetail.saleTransferDeductions")}:{" "}
                      {[
                        detail.cash.settlement_home_expense_total !== "0"
                          ? `${pkr(detail.cash.settlement_home_expense_total)} (${t("shopDetail.homeExpense")})`
                          : null,
                        detail.cash.settlement_owner_drawings_total !== "0"
                          ? `${pkr(detail.cash.settlement_owner_drawings_total)} (${t("shopDetail.ownerDrawings")})`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
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

                <button
                  onClick={() => setShowStockPricing((v) => !v)}
                  className="flex w-full items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/60 px-6 py-5 text-left transition hover:bg-slate-100/60 cursor-pointer no-print"
                >
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">
                      {t("shopDetail.stockSalePricing")}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {t("shopDetail.stockPricingCaption")}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs font-semibold text-teal">
                    {showStockPricing ? t("shopDetail.hideDetails") : t("shopDetail.showDetails")}
                  </span>
                </button>

                <div className={showStockPricing ? "overflow-x-auto" : "hidden print:block print:overflow-x-auto"}>

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

                <button
                  onClick={() => setShowBusinessLedger((v) => !v)}
                  className="flex w-full flex-col gap-4 border-b border-slate-200 bg-white px-6 py-5 text-left transition hover:bg-slate-50/60 cursor-pointer no-print lg:flex-row lg:items-center lg:justify-between"
                >

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

                  <div className="flex flex-wrap items-center gap-2">

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

                    <span className="shrink-0 text-xs font-semibold text-teal">
                      {showBusinessLedger ? t("shopDetail.hideDetails") : t("shopDetail.showDetails")}
                    </span>

                  </div>

                </button>


                {/* Excel-style table */}
                <div className={showBusinessLedger ? "overflow-x-auto" : "hidden print:block print:overflow-x-auto"}>

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
                           {t("shopDetail.colSettlementBreakdown")}
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

                            <td className="px-4 py-3">
                              <SettlementBreakdownCell row={r} companies={companies} accounts={accounts} t={t} />
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

                <div className={`flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-6 py-3 sm:flex-row sm:items-center sm:justify-between ${showBusinessLedger ? "" : "hidden print:flex"}`}>

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


                  {/* § Activity Records — fully visible, not a 3-item
                      compact preview (unlike Supply Customers alongside
                      it, unchanged) — every transaction for the loaded
                      month renders here; scrolls instead of growing the
                      page unbounded on a busy month. */}
                  <div className="mt-5 max-h-[420px] space-y-3 overflow-y-auto border-t border-slate-100 pt-4">

                    {detail.transactions.map((row) => (
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
    shopId={shopId}
    shopName={detail.customer.name}
    transactions={detail.transactions}
    month={month}
    setMonth={setMonth}
    onClose={() => setShowTransactions(false)}
    onCorrect={openCorrect}
    correctLoading={correctLoading}
    companies={companies}
    accounts={accounts}
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
            shopName={detail.customer.name}
            stockProducts={detail.stock.products}
            onClose={() => setShowSale(false)}
            onSaved={() => {
              setShowSale(false);
              load();
            }}
            onPartialSave={load}
          />
        )}

        {showCashTransfer && (
          <ShopCashTransferModal
            shopId={shopId}
            availableBalance={parseFloat(detail.account.current_balance)}
            onClose={() => setShowCashTransfer(false)}
            onSaved={() => {
              setShowCashTransfer(false);
              load();
            }}
          />
        )}


        <AddFilledCylinderStockModal
          isOpen={showAddStock}
          shopId={shopId}
          onClose={() => setShowAddStock(false)}
          onSuccess={load}
        />

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
            shopName={detail.customer.name}
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

        {showEditOpening && detail && (
          <EditOpeningBalanceModal
            title={t("modals.editOpeningBalanceTitle", { id: detail.customer.display_id })}
            currentValue={parseFloat(detail.cash.opening_cash)}
            onClose={() => setShowEditOpening(false)}
            onSave={async (newValue, reason) => {
              await api.shops.correctOpeningCash(shopId, { new_value: newValue, reason });
              setShowEditOpening(false);
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
