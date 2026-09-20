"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, PlusCircle, Pencil, Printer, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, BalanceTag, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, fmtNumber } from "@/lib/format";
import ReceivePaymentModal from "@/components/ReceivePaymentModal";
import CorrectTransactionModal, { CorrectableKind } from "@/components/CorrectTransactionModal";
import ReturnCylinderModal from "@/components/ReturnCylinderModal";
import AddEmptyCylinderModal from "@/components/AddEmptyCylinderModal";
import EditOpeningBalanceModal from "@/components/EditOpeningBalanceModal";
import type { Customer, CustomerLedgerSummary, CustomerFlag, LedgerRow, Sale, Payment } from "@/lib/types";

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" reflects the Karachi calendar even off-Karachi machines.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function CustomerLedgerBody() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");

  // Deep-link from elsewhere in the app (e.g. Dashboard's Flagged
  // Accounts) — /customer-ledger?id=<customer-id> opens that exact
  // customer's ledger directly, by ID, never by name.
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) setCustomerId(id);
  }, [searchParams]);
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [showReturnCylinder, setShowReturnCylinder] = useState(false);
  const [showAddCylinder, setShowAddCylinder] = useState(false);
  const [flags, setFlags] = useState<CustomerFlag[]>([]);
  const [correctTarget, setCorrectTarget] = useState<{ kind: CorrectableKind; transaction: Sale | Payment } | null>(null);
  const [correctLoading, setCorrectLoading] = useState<string | null>(null);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showEditOpening, setShowEditOpening] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<{ type: "info" | "error"; msg: string } | null>(null);

  // Ledger Correction (§1) — the ledger row only carries a summary shape;
  // fetch the full Sale/Payment record (scoped to this customer) so the
  // modal can pre-fill every editable field, not just the amount.
  const openCorrect = async (row: LedgerRow) => {
    if (!row.correctable || (row.kind !== "sale" && row.kind !== "payment")) return;
    setCorrectLoading(row.ref_id);
    try {
      if (row.kind === "sale") {
        const list = await api.sales.list({ customer_id: customerId });
        const tx = list.find((s) => s.id === row.ref_id);
        if (tx) setCorrectTarget({ kind: "sale", transaction: tx });
      } else {
        const list = await api.payments.list({ customer_id: customerId });
        const tx = list.find((p) => p.id === row.ref_id);
        if (tx) setCorrectTarget({ kind: "payment", transaction: tx });
      }
    } finally {
      setCorrectLoading(null);
    }
  };

  const loadCustomers = () => {
    api.customers.list().then(setCustomers);
  };

  const loadLedger = () => {
    if (!customerId) {
      setSummary(null);
      return;
    }
    setLoading(true);
    api.ledger.customerMonth(customerId, month).then(setSummary).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    loadLedger();
  }, [customerId, month]);

  // Powers the 🚩 badge in the sidebar for every customer, for the
  // currently-selected month — same Flag Rule as the detail panel above.
  useEffect(() => {
    api.ledger.customerFlags(month).then(setFlags);
  }, [month]);

  const flaggedIds = new Set(flags.filter((f) => f.flagged).map((f) => f.customer.id));

  const filtered = customers.filter(
    (c) =>
      !search.trim() ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.mobile.includes(search) ||
      (c.display_id ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const [year, mo] = month.split("-");
  const monthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const yearOptions = [2025, 2026, 2027];

  // Send via WhatsApp (client-side only — no WhatsApp Business API/backend
  // messaging, see the button's usage below). The statement endpoint is
  // the same backend-rendered PDF the "Download Statement" link opens
  // (app/routers/ledger.py's /customer/{id}/statement); we fetch it here
  // instead of just linking to it because navigator.share needs an actual
  // File/Blob, not a URL. Session auth is cookie-based (lib/api.ts), so
  // credentials: "include" is enough — no bearer token to attach.
  const shareStatement = async () => {
    if (!customerId || !summary) return;
    setShareStatus(null);
    setSharing(true);
    try {
      const res = await fetch(api.ledger.customerStatementUrl(customerId, month), { credentials: "include" });
      if (!res.ok) throw new Error(t("customerLedger.shareWhatsappError"));
      const blob = await res.blob();
      const filename = `Statement-${summary.customer.display_id ?? summary.customer.name}-${month}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareText = t("customerLedger.shareWhatsappText", { name: summary.customer.name, mo, year });

      // navigator.share existing is not enough on its own — many desktop
      // browsers implement share() for text/links but not files, and will
      // throw or silently ignore `files`. canShare({ files }) is the
      // actual capability check (Android/iOS Chrome & Safari support it;
      // desktop Chrome/Edge/Firefox currently do not) — wrapped in
      // try/catch since some older implementations throw on an
      // unrecognized shape rather than just returning false.
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
          // AbortError = user closed the native share sheet without
          // picking anything — not a failure, say nothing.
          if (err instanceof Error && err.name !== "AbortError") throw err;
        }
        return;
      }

      // Desktop fallback: navigator.share with files isn't supported, and
      // WhatsApp's wa.me click-to-chat links have no way to pre-attach a
      // file, so we download the PDF (for staff to attach by hand) and
      // open a WhatsApp chat draft in parallel.
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
    <div>
      <PageHeader
        eyebrow={t("nav.customerLedger")}
        title={t("customerLedger.title")}
        caption={t("customerLedger.caption")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[0.65fr_1.5fr] gap-4">
        {/* Customer Sidebar */}
        <Panel>
          <Eyebrow>{t("nav.customers")}</Eyebrow>
          <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5 mb-3">
            <Search size={13} className="text-steel" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("customerLedger.searchPlaceholder")}
              className="border-none outline-none font-body text-xs py-1.5 w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5 max-h-[520px] overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setCustomerId(c.id)}
                className={`text-left px-3 py-2.5 rounded-lg border ${
                  customerId === c.id ? "border-teal bg-[#EAF6F6]" : "border-hairline bg-paper"
                }`}
              >
                <div className="font-body text-[13px] font-semibold text-ink flex items-center gap-1">
                  {c.name}
                  {flaggedIds.has(c.id) && <span title={t("customerLedger.flaggedThisMonth")}>🚩</span>}
                </div>
                <div className="font-mono text-[10.5px] text-steel">
                  {c.display_id ?? ""} · {c.mobile}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <BalanceTag
                    amount={customerId === c.id && summary ? summary.closing_balance : c.current_balance}
                  />
                  <span className="font-mono text-[10px] text-steel">
                    11.8k: {fmtNumber(c.cylinder_balance_118 || 0)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </Panel>

        {/* Ledger Details */}
        <div>
          {!customerId && (
            <Panel>
              <div className="font-body text-[13px] text-steel py-10 text-center">
                {t("customerLedger.selectCustomerPrompt")}
              </div>
            </Panel>
          )}

          {customerId && (
            <div className="print-area">
              <Panel className="mb-4">
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div>
                    <div className="font-mono text-[10.5px] text-steel tracking-wide uppercase mb-0.5">
                      DOWA Gas Agency
                    </div>
                    <div className="font-display font-bold text-xl text-ink flex items-center gap-2">
                      {summary?.customer.name}
                      {summary?.flagged && (
                        <span
                          title={t("customerLedger.flaggedBadgeTitle")}
                          className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FBEAEA] text-brand-red border border-[#EFC3C3] print:hidden"
                        >
                          🚩 {t("customerLedger.flaggedBadge")}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-steel mt-1">
                      {summary?.customer.display_id ?? ""} · {summary?.customer.mobile}{" "}
                      {summary?.customer.shop_name ? `· ${summary.customer.shop_name}` : ""}
                    </div>
                    <div className="hidden print:block font-mono text-xs text-steel mt-1">
                      {t("customerLedger.periodLabel", { mo, year })}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap print:hidden">
                    <Button variant="teal" onClick={() => setIsPayModalOpen(true)}>
                      <PlusCircle size={15} /> {t("customerLedger.receivePayment")}
                    </Button>
                    <Button variant="outline" onClick={() => setShowReturnCylinder(true)}>
                      {t("customerLedger.returnCylinder")}
                    </Button>
                    <Button variant="outline" onClick={() => setShowAddCylinder(true)}>
                      {t("customerLedger.addEmptyCylinder")}
                    </Button>
                    <a
                      href={api.ledger.customerStatementUrl(customerId, month)}
                      target="_blank"
                      rel="noreferrer"
                      title={t("customerLedger.downloadStatementTitle")}
                      className="inline-flex items-center gap-2 font-body text-[13px] font-medium px-4 py-2.5 rounded-md bg-transparent text-ink border border-hairline cursor-pointer"
                    >
                      <Printer size={14} /> {t("customerLedger.downloadStatement")}
                    </a>
                    <Button variant="outline" onClick={shareStatement} disabled={sharing}>
                      <Share2 size={14} /> {sharing ? t("customerLedger.sharingWhatsapp") : t("customerLedger.shareWhatsapp")}
                    </Button>

                    <div className="flex gap-1.5 ml-1">
                      <select
                        value={mo}
                        onChange={(e) => setMonth(`${year}-${e.target.value}`)}
                        className={`${inputClass} w-[75px]`}
                      >
                        {monthOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <select
                        value={year}
                        onChange={(e) => setMonth(`${e.target.value}-${mo}`)}
                        className={`${inputClass} w-[85px]`}
                      >
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                {shareStatus && (
                  <div
                    className={`print:hidden mt-3 font-body text-[12.5px] px-3 py-2 rounded-md border ${
                      shareStatus.type === "info"
                        ? "bg-[#EAF6F6] text-tealdeep border-[#BFE3E3]"
                        : "bg-red-50 text-red-600 border-red-200"
                    }`}
                  >
                    {shareStatus.msg}
                  </div>
                )}
              </Panel>

              {loading && (
                <Panel>
                  <div className="font-body text-steel p-6">{t("common.loading")}</div>
                </Panel>
              )}

              {!loading && summary && (
                <>
                  {/* Financial Stats */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    <Panel>
                      <div className="flex items-center justify-between">
                        <Eyebrow>{t("customerLedger.openingBalance")}</Eyebrow>
                        <button
                          onClick={() => setShowEditOpening(true)}
                          className="print:hidden bg-transparent border-none cursor-pointer text-steel hover:text-ink"
                          aria-label={t("modals.editOpeningBalanceTitle", { id: summary.customer.display_id })}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.opening_balance)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("customerLedger.totalSales")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.total_sales)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("customerLedger.totalPayments")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-brand-green">
                        {pkr(summary.total_payments)}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("customerLedger.closingCashBalance")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.closing_balance)}</div>
                    </Panel>
                  </div>

                  {/* Cylinder Inventory Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                    <Panel>
                      <Eyebrow>{t("customerLedger.kg118Sold")}</Eyebrow>
                      <div className="font-mono font-semibold text-base text-amber-600">
                        {fmtNumber(summary.total_118 || 0)}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("customerLedger.kg454Sold")}</Eyebrow>
                      <div className="font-mono font-semibold text-base text-purple-600">
                        {fmtNumber(summary.total_454 || 0)}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("customerLedger.totalKgSold")}</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{fmtNumber(summary.total_kg)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("customerLedger.totalTon")}</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">
                        {parseFloat(summary.total_ton || "0").toFixed(2)}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("nav.emptyCylinders")}</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">
                        11.8k: {summary.customer.empty_cylinders_118 || 0} · 45.4k: {summary.customer.empty_cylinders_454 || 0}
                      </div>
                    </Panel>
                  </div>

                  {/* Combined Ledger Table */}
                  <Panel>
                    <Eyebrow>{t("customerLedger.dailyRunningBalance")}</Eyebrow>
                    <SectionCaption>
                      {t("customerLedger.dailyRunningBalanceCaption")}
                    </SectionCaption>
                    <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <Th>{t("customerLedger.colDate")}</Th>
                          <Th>{t("customerLedger.colId")}</Th>
                          <Th>{t("customerLedger.colDescription")}</Th>
                          <Th right>{t("customerLedger.colRate")}</Th>
                          <Th right>{t("customerLedger.kg118Sold")}</Th>
                          <Th right>{t("customerLedger.kg454Sold")}</Th>
                          <Th right>{t("customerLedger.colDiscount")}</Th>
                          <Th right>{t("customerLedger.colGst")}</Th>
                          <Th right>{t("customerLedger.colSale")}</Th>
                          <Th right>{t("customerLedger.colPayment")}</Th>
                          <Th right>{t("customerLedger.colBalance")}</Th>
                          <Th>{t("customerLedger.colEnteredBy")}</Th>
                          <Th center><span className="print:hidden">{t("customerLedger.colActions")}</span></Th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <Td colSpan={10}>{t("customerLedger.openingBalanceRow")}</Td>
                          <Td right mono bold>
                            {pkr(summary.opening_balance)}
                          </Td>
                          <Td colSpan={2}>{null}</Td>
                        </tr>
                        {summary.rows.map((r) => (
                          <tr key={r.ref_id}>
                            <Td mono>{fmtTime(r.date)}</Td>
                            <Td mono>{r.display_id ?? ""}</Td>
                            <Td>{r.description}</Td>
                            <Td right mono>
                              {r.kind === "unified_sale" && r.unified_sale_rates?.length
                                ? r.unified_sale_rates.map((rate) => pkr(rate)).join(", ")
                                : r.rate_per_cylinder
                                ? pkr(r.rate_per_cylinder)
                                : "—"}
                            </Td>
                            <Td right mono>{parseFloat(r.qty_118) ? r.qty_118 : "—"}</Td>
                            <Td right mono>{parseFloat(r.qty_454) ? r.qty_454 : "—"}</Td>
                            <Td right mono>
                              {r.discount_amount && parseFloat(r.discount_amount) > 0 ? pkr(r.discount_amount) : "—"}
                            </Td>
                            <Td right mono>
                              {r.gst_rate && parseFloat(r.gst_rate) > 0 ? (
                                <span title={`${t("customerLedger.colGst")}: ${r.gst_rate}%`}>
                                  {r.gst_rate}% · {pkr(r.gst_amount || "0")}
                                </span>
                              ) : (
                                "—"
                              )}
                            </Td>
                            <Td right mono>
                              {parseFloat(r.sale_amount) ? pkr(r.sale_amount) : "—"}
                            </Td>
                            <Td right mono color="#1E8A5F">
                              {parseFloat(r.payment_amount) ? pkr(r.payment_amount) : "—"}
                            </Td>
                            <Td right mono bold>
                              <BalanceTag amount={r.running_balance} />
                            </Td>
                            <Td mono>{r.entered_by || "—"}</Td>
                            <Td center>
                              {r.correctable && (
                                <button
                                  onClick={() => openCorrect(r)}
                                  disabled={correctLoading === r.ref_id}
                                  title={t("customerLedger.correctThisTransaction")}
                                  className="print:hidden bg-transparent border-none cursor-pointer text-steel hover:text-teal disabled:opacity-40"
                                >
                                  <Pencil size={13} />
                                </button>
                              )}
                            </Td>
                          </tr>
                        ))}
                        {!summary.rows.length && (
                          <tr>
                            <td colSpan={13} className="text-steel font-body text-[13px] py-4 text-center">
                              {t("customerLedger.noTransactionsThisMonth")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    </div>
                  </Panel>

                  {/* Correction History (§1) — superseded transactions, kept for
                      the record and clearly marked, never mixed into the running
                      balance above. */}
                  {summary.corrections.length > 0 && (
                    <Panel className="mt-4">
                      <button
                        onClick={() => setShowCorrections((s) => !s)}
                        className="print:hidden bg-transparent border-none cursor-pointer flex items-center gap-1.5 w-full text-left"
                      >
                        <Eyebrow>{t("customerLedger.correctionHistory", { count: summary.corrections.length })}</Eyebrow>
                      </button>
                      {
                        <div className="overflow-x-auto">
                        <table className={`w-full border-collapse mt-2 ${showCorrections ? "" : "hidden print:table"}`}>
                          <thead>
                            <tr>
                              <Th>{t("customerLedger.colDate")}</Th>
                              <Th>{t("customerLedger.colOriginalId")}</Th>
                              <Th>{t("customerLedger.colDescription")}</Th>
                              <Th right>{t("customerLedger.colOriginalAmount")}</Th>
                              <Th>{t("customerLedger.colReason")}</Th>
                              <Th>{t("customerLedger.colCorrectedBy")}</Th>
                              <Th>{t("customerLedger.colCorrectedAt")}</Th>
                              <Th>{t("customerLedger.colReplacedBy")}</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.corrections.map((c) => (
                              <tr key={c.ref_id}>
                                <Td mono>{fmtTime(c.date)}</Td>
                                <Td mono color="#9B4A4A">{c.display_id}</Td>
                                <Td>{c.description}</Td>
                                <Td right mono>{pkr(c.original_amount)}</Td>
                                <Td>{c.correction_reason}</Td>
                                <Td mono>{c.corrected_by}</Td>
                                <Td mono>{fmtTime(c.corrected_at)}</Td>
                                <Td mono>{c.corrected_display_id ?? "—"}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      }
                    </Panel>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Receive Payment Modal */}
      <ReceivePaymentModal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        defaultCustomerId={customerId}
        onSuccess={() => {
          loadLedger();
          loadCustomers();
        }}
      />

      <ReturnCylinderModal
        isOpen={showReturnCylinder}
        onClose={() => setShowReturnCylinder(false)}
        customer={summary?.customer ?? null}
        onSuccess={() => {
          loadLedger();
          loadCustomers();
        }}
      />

      <AddEmptyCylinderModal
        isOpen={showAddCylinder}
        onClose={() => setShowAddCylinder(false)}
        customer={summary?.customer ?? null}
        onSuccess={() => {
          loadLedger();
          loadCustomers();
        }}
      />

      {correctTarget && (
        <CorrectTransactionModal
          kind={correctTarget.kind}
          transaction={correctTarget.transaction}
          onClose={() => setCorrectTarget(null)}
          onSaved={() => {
            setCorrectTarget(null);
            loadLedger();
          }}
        />
      )}

      {showEditOpening && summary && (
        <EditOpeningBalanceModal
          title={t("modals.editOpeningBalanceTitle", { id: summary.customer.display_id })}
          currentValue={parseFloat(summary.opening_balance)}
          onClose={() => setShowEditOpening(false)}
          onSave={async (newValue, reason) => {
            await api.customers.correctOpeningBalance(customerId, { new_value: newValue, reason });
            setShowEditOpening(false);
            loadLedger();
          }}
        />
      )}
    </div>
  );
}

export default function CustomerLedgerPage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <CustomerLedgerBody />
      </Suspense>
    </AuthGate>
  );
}