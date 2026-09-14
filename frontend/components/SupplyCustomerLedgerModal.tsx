"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Search, Banknote, Printer, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Th, Td, Eyebrow, BalanceTag, Button } from "./ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, resolveAccountLabel } from "@/lib/format";
import type { Company, PaymentAccount, ShopSupplyCustomer, ShopSupplyCustomerLedgerOut, ShopSupplyCustomerLedgerRow } from "@/lib/types";

// Settlement Routing breakdown for a Payment Only collection (§ Payment
// Only mode) — mirrors app/shops/[id]/page.tsx's renderShopSaleSettlement
// Breakdown/resolveShopSaleRoutedLabel, kept as its own small local copy
// since this modal has no shared import path to that file's component-local
// helpers and its own row shape (ShopSupplyCustomerLedgerRow) is simpler
// (no cash_impact/amount_received — payment_amount IS the full amount).
function resolveRoutedLabel(
  row: ShopSupplyCustomerLedgerRow,
  companies: Company[],
  accounts: PaymentAccount[],
  t: (key: string, options?: Record<string, any>) => string
): string {
  if (!row.settlement_destination_type) return "—";
  if (row.settlement_destination_type === "plant") {
    const plant = companies.find((c) => c.id === row.settlement_target_plant_id);
    return plant ? t("payments.plantLabel", { name: plant.name }) : t("payments.plantSettlementBadge");
  }
  if (row.settlement_account_id) return resolveAccountLabel(row.settlement_account_id, accounts);
  return t("payments.accountSettlementBadge");
}

function SettlementBreakdown({
  row, companies, accounts, t,
}: {
  row: ShopSupplyCustomerLedgerRow;
  companies: Company[];
  accounts: PaymentAccount[];
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const homeExpenseAmount = Number(row.settlement_home_expense_amount || "0");
  const ownerDrawingsAmount = Number(row.settlement_owner_drawings_amount || "0");
  const netSettlementAmount = parseFloat(row.payment_amount) - homeExpenseAmount - ownerDrawingsAmount;
  const parts: Array<{ label: string; value: string }> = [];
  if (homeExpenseAmount > 0) {
    parts.push({ label: row.settlement_home_expense_description || t("shopDetail.homeExpense"), value: pkr(homeExpenseAmount) });
  }
  if (ownerDrawingsAmount > 0) {
    parts.push({ label: t("shopDetail.ownerDrawings"), value: pkr(ownerDrawingsAmount) });
  }
  if (netSettlementAmount > 0 && row.settlement_destination_type) {
    parts.push({ label: t("shopDetail.routedTo"), value: resolveRoutedLabel(row, companies, accounts, t) });
  }
  if (!parts.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] leading-tight">
      {parts.map((part, index) => (
        <span key={`${part.label}-${index}`} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md bg-slate-100 px-1.5 py-1">
          <span className="min-w-0 truncate text-slate-500">{part.label}</span>
          <span className="shrink-0 font-mono font-semibold text-slate-800">{part.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Supply Customer Ledger (§ Shop Customer Ledger) — the shop-scoped mirror
 * of the main Customer Ledger page, scaled down to a modal since a shop's
 * own customer book is a small, secondary concern off the Shop Detail page
 * rather than a top-level nav item. All-time, not month-scoped — see
 * GET /shops/customers/{id}/ledger's docstring for why. Read-only: to
 * receive a payment, this closes and hands off to the existing
 * RecordSupplyCustomerPaymentModal via onReceivePayment, rather than
 * stacking two modals. */
export default function SupplyCustomerLedgerModal({
  customers,
  initialCustomerId,
  onClose,
  onReceivePayment,
}: {
  customers: ShopSupplyCustomer[];
  initialCustomerId?: string;
  onClose: () => void;
  onReceivePayment: (customer: ShopSupplyCustomer) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialCustomerId || customers[0]?.id || "");
  const [ledger, setLedger] = useState<ShopSupplyCustomerLedgerOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<{ type: "info" | "error"; msg: string } | null>(null);
  // Settlement Routing breakdown (§ Payment Only mode) — needed to resolve
  // a "routed to" plant/account label, same as the Shop Detail page.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

  useEffect(() => {
    api.companies.list().then(setCompanies).catch(() => {});
    api.paymentAccounts.list().then(setAccounts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) { setLedger(null); return; }
    setLoading(true);
    setShareStatus(null);
    api.shops.customers.ledger(selectedId)
      .then(setLedger)
      .finally(() => setLoading(false));
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (c.mobile || "").includes(q));
  }, [customers, search]);

  const selected = customers.find((c) => c.id === selectedId) || null;

  // Send via WhatsApp (client-side only) — same mechanism every other
  // statement in the app already uses (frontend/app/customer-ledger/
  // page.tsx's shareStatement): fetch the same backend-rendered PDF the
  // "Download Statement" link opens, then hand it to the device's native
  // share sheet (mobile) or download+wa.me draft (desktop).
  const shareStatement = async () => {
    if (!selected) return;
    setShareStatus(null);
    setSharing(true);
    try {
      const res = await fetch(api.shops.customers.statementUrl(selected.id), { credentials: "include" });
      if (!res.ok) throw new Error(t("customerLedger.shareWhatsappError"));
      const blob = await res.blob();
      const filename = `Statement-${selected.name}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareText = t("modals.shareWhatsappSupplyCustomerText", { name: selected.name });

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
    <div
      className="fixed inset-0 z-50 bg-[rgba(11,33,56,0.5)] p-3 sm:p-5 flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* § Supply Customer Ledger modal size — was max-w-5xl (1024px), too
          compact once the statement buttons + full 7-column table (Date/
          ID/Description/Rate/Amount/Payment/Balance) both live in the
          header/body; matches TransactionHistoryModal's own size exactly
          (frontend/app/shops/[id]/page.tsx) for consistency between the
          two "browse a ledger" modals. w-full + the overlay's own p-3
          sm:p-5 gutter (unchanged) still keep this fully responsive down
          to small screens — only the upper bound grew. */}
      <div className="w-full max-w-[1500px] max-h-[92vh] overflow-hidden bg-white rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <div>
            <Eyebrow>{t("modals.supplyCustomerLedger")}</Eyebrow>
            <div className="font-body text-xs text-steel mt-1">
              {t("modals.supplyCustomerLedgerCaption")}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink" title={t("unifiedSale.close")}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          {/* Customer list */}
          <div className="w-full sm:w-[260px] shrink-0 border-b sm:border-b-0 sm:border-r border-hairline flex flex-col overflow-hidden max-h-[220px] sm:max-h-none">
            <div className="p-3 border-b border-hairline">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("modals.searchCustomersPlaceholder")}
                  className="w-full pl-7 pr-2.5 py-1.5 bg-paper border border-hairline rounded-md text-xs font-body text-ink focus:outline-none focus:border-teal"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-hairline/60 transition-colors ${c.id === selectedId ? "bg-teal/10" : "hover:bg-paper"}`}
                >
                  <div className="font-body text-[12.5px] font-semibold text-ink truncate">{c.name}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-steel">{c.mobile || t("shopDetail.noMobile")}</span>
                    <span className="font-mono text-[11px] font-semibold text-ink">{pkr(c.current_balance)}</span>
                  </div>
                </button>
              ))}
              {!filtered.length && (
                <div className="p-4 text-center text-steel font-body text-[12px]">{t("modals.noCustomersFound")}</div>
              )}
            </div>
          </div>

          {/* Ledger detail */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-5">
            {!selected && (
              <div className="text-center text-steel font-body text-sm py-12">{t("modals.selectCustomerToViewLedger")}</div>
            )}
            {selected && (
              <>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-display text-lg font-bold text-ink">{selected.name}</div>
                    <div className="mt-1 font-body text-xs text-steel">
                      {[selected.mobile, selected.address].filter(Boolean).join(" · ") || t("modals.noContactDetails")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={api.shops.customers.statementUrl(selected.id)}
                      target="_blank"
                      rel="noreferrer"
                      title={t("shopDetail.downloadStatementTitle")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
                    >
                      <Printer size={13} /> {t("shopDetail.downloadStatement")}
                    </a>
                    <Button variant="outline" onClick={shareStatement} disabled={sharing}>
                      <Share2 size={13} /> {sharing ? t("customerLedger.sharingWhatsapp") : t("customerLedger.shareWhatsapp")}
                    </Button>
                    {parseFloat(selected.current_balance) > 0 && (
                      <button
                        type="button"
                        onClick={() => onReceivePayment(selected)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-700"
                      >
                        <Banknote size={13} /> {t("customerLedger.receivePayment")}
                      </button>
                    )}
                  </div>
                </div>

                {shareStatus && (
                  <div
                    className={`mt-3 font-body text-[12.5px] px-3 py-2 rounded-md border ${
                      shareStatus.type === "info"
                        ? "bg-[#EAF6F6] text-tealdeep border-[#BFE3E3]"
                        : "bg-red-50 text-red-600 border-red-200"
                    }`}
                  >
                    {shareStatus.msg}
                  </div>
                )}

                {loading && <div className="mt-6 text-center text-steel font-body text-sm">{t("modals.loadingLedger")}</div>}

                {!loading && ledger && (
                  <>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">{t("customerLedger.openingBalance")}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-ink">{pkr(ledger.opening_balance)}</div>
                      </div>
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">{t("modals.totalSalesCredit")}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-ink">{pkr(ledger.total_sales)}</div>
                      </div>
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">{t("modals.collectedAtSale")}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-slate-600">{pkr(ledger.total_collected_at_sale)}</div>
                      </div>
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">{t("customerLedger.totalPayments")}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-[#1E8A5F]">{pkr(ledger.total_payments)}</div>
                      </div>
                      <div className="rounded-lg border border-teal/30 bg-teal/5 p-3">
                        <div className="font-mono text-[9.5px] uppercase text-teal">{t("modals.closingBalance")}</div>
                        <div className="mt-1"><BalanceTag amount={ledger.closing_balance} /></div>
                      </div>
                    </div>

                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[900px] border-collapse">
                        <thead>
                          <tr className="border-b border-hairline text-left">
                            <Th>{t("customerLedger.colDate")}</Th>
                            <Th>{t("customerLedger.colId")}</Th>
                            <Th>{t("customerLedger.colDescription")}</Th>
                            <Th right>{t("customerLedger.colRate")}</Th>
                            <Th right>{t("modals.colRemainingAmount")}</Th>
                            <Th right>{t("customerLedger.colPayment")}</Th>
                            <Th>{t("shopDetail.colSettlementBreakdown")}</Th>
                            <Th right>{t("customerLedger.colBalance")}</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {ledger.rows.map((r) => (
                            <tr key={r.ref_id} className="hover:bg-paper/60 transition-colors">
                              <Td mono>{fmtTime(r.date)}</Td>
                              <Td mono>{r.display_id}</Td>
                              <Td>{r.description}</Td>
                              <Td right mono color="#8E8E93">{r.rate ? pkr(r.rate) : "—"}</Td>
                              <Td right mono>{parseFloat(r.sale_amount) ? pkr(r.sale_amount) : "—"}</Td>
                              <Td right mono color="#1E8A5F">{parseFloat(r.payment_amount) ? pkr(r.payment_amount) : "—"}</Td>
                              <Td>
                                {r.kind === "payment"
                                  ? <SettlementBreakdown row={r} companies={companies} accounts={accounts} t={t} />
                                  : <span className="text-slate-400">—</span>}
                              </Td>
                              <Td right mono bold>{pkr(r.running_balance)}</Td>
                            </tr>
                          ))}
                          {!ledger.rows.length && (
                            <tr><td colSpan={8} className="text-steel font-body text-[13px] py-6 text-center">{t("modals.noTransactionsYetForCustomer")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
