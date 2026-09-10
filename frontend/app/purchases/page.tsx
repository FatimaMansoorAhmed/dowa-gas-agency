"use client";
import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Search, Truck, Wallet, Pencil, Printer, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, BalanceTag, Button } from "@/components/ui";
import NewPlantModal from "@/components/NewPlantModal";
import AddPurchaseModal from "@/components/AddPurchaseModal";
import RecordPlantPaymentModal from "@/components/RecordPlantPaymentModal";
import CorrectTransactionModal, { CorrectableKind } from "@/components/CorrectTransactionModal";
import EditOpeningBalanceModal from "@/components/EditOpeningBalanceModal";
import { api } from "@/lib/api";
import { pkr, fmtTime, fmtClock, todayLocalInput, fmtNumber } from "@/lib/format";
import type { PlantLedgerSummaryRow, CompanyLedgerSummary, CompanyLedgerRow, Purchase, CompanyPayment } from "@/lib/types";

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" reflects the Karachi calendar even off-Karachi machines.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function PurchasesBody() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");
  const [summaryRows, setSummaryRows] = useState<PlantLedgerSummaryRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyLedgerSummary | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [showNewPlant, setShowNewPlant] = useState(false);
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [showPlantPayment, setShowPlantPayment] = useState(false);
  const [correctTarget, setCorrectTarget] = useState<{ kind: CorrectableKind; transaction: Purchase | CompanyPayment } | null>(null);
  const [correctLoading, setCorrectLoading] = useState<string | null>(null);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showEditOpening, setShowEditOpening] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<{ type: "info" | "error"; msg: string } | null>(null);

  // Ledger Correction — the ledger row only carries a summary shape; fetch
  // the full Purchase/CompanyPayment record (scoped to this plant) so the
  // modal can pre-fill every editable field.
  const openCorrect = async (row: CompanyLedgerRow) => {
    if (!row.correctable || !selectedCompanyId || (row.kind !== "purchase" && row.kind !== "payment")) return;
    setCorrectLoading(row.ref_id);
    try {
      if (row.kind === "purchase") {
        const list = await api.purchases.list({ company_id: selectedCompanyId });
        const tx = list.find((p) => p.id === row.ref_id);
        if (tx) setCorrectTarget({ kind: "purchase", transaction: tx });
      } else {
        const list = await api.companyPayments.list({ company_id: selectedCompanyId });
        const tx = list.find((p) => p.id === row.ref_id);
        if (tx) setCorrectTarget({ kind: "companyPayment", transaction: tx });
      }
    } finally {
      setCorrectLoading(null);
    }
  };

  const loadSummary = async () => {
    setLoadingSummary(true);
    try {
      setSummaryRows(await api.ledger.plantSummary(month));
    } finally {
      setLoadingSummary(false);
    }
  };
  useEffect(() => { loadSummary(); }, [month]);

  useEffect(() => {
    if (!selectedCompanyId) { setDetail(null); return; }
    setLoadingDetail(true);
    api.ledger.companyMonth(selectedCompanyId, month).then(setDetail).finally(() => setLoadingDetail(false));
  }, [selectedCompanyId, month]);

  const filteredRows = useMemo(
    () => summaryRows.filter((r) => !search.trim() || r.company.name.toLowerCase().includes(search.toLowerCase())),
    [summaryRows, search]
  );

  const [year, mo] = month.split("-");
  const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthNames = MONTH_KEYS.map((k) => t(`monthsFull.${k}`));
  const yearOptions = [2025, 2026, 2027];

  // Send via WhatsApp — same client-side-only pattern as Customer Ledger's
  // own shareStatement (app/customer-ledger/page.tsx), just pointed at the
  // Plant Statement PDF instead (app.routers.ledger's
  // /company/{id}/statement, the same backend-rendered PDF the "Download
  // Statement" link opens). navigator.share needs an actual File/Blob, not
  // a URL, hence fetching it here rather than just linking to it.
  const shareStatement = async () => {
    if (!selectedCompanyId || !detail) return;
    setShareStatus(null);
    setSharing(true);
    try {
      const res = await fetch(api.ledger.companyStatementUrl(selectedCompanyId, month), { credentials: "include" });
      if (!res.ok) throw new Error(t("customerLedger.shareWhatsappError"));
      const blob = await res.blob();
      const filename = `Statement-${detail.company.name}-${month}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareText = t("purchases.shareWhatsappPlantText", { name: detail.company.name, mo, year });

      // Same capability check as Customer Ledger — canShare({ files }) is
      // the real signal (Android/iOS Chrome & Safari support it; desktop
      // Chrome/Edge/Firefox currently do not), wrapped in try/catch since
      // some older implementations throw on an unrecognized shape.
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

  const totals = summaryRows.reduce(
    (acc, r) => {
      const kgSum = acc.kg + parseFloat(r.total_kg || "0");
      return {
        opening: acc.opening + parseFloat(r.opening_balance || "0"),
        t118: acc.t118 + Number(r.total_118 || 0),
        t454: acc.t454 + Number(r.total_454 || 0),
        kg: kgSum,
        ton: kgSum / 1000,
        purchases: acc.purchases + parseFloat(r.total_purchases || "0"),
        payments: acc.payments + parseFloat(r.total_payments || "0"),
        closing: acc.closing + parseFloat(r.closing_balance || "0"),
      };
    },
    { opening: 0, t118: 0, t454: 0, kg: 0, ton: 0, purchases: 0, payments: 0, closing: 0 }
  );

  const refreshAfterAction = () => {
    setShowNewPurchase(false);
    setShowPlantPayment(false);
    loadSummary();
    if (selectedCompanyId) api.ledger.companyMonth(selectedCompanyId, month).then(setDetail);
  };

  const displayRows = detail?.rows ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.purchases")}
        title={t("purchases.title")}
        caption={t("purchases.caption")}
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setShowNewPlant(true)}><PlusCircle size={14} /> {t("purchases.addPlant")}</Button>
            <Button variant="outline" onClick={() => setShowNewPurchase(true)}><Truck size={14} /> {t("purchases.newPurchase")}</Button>
            <Button variant="outline" onClick={() => setShowPlantPayment(true)}><Wallet size={14} /> {t("purchases.plantPayment")}</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-4">
        <Panel><Eyebrow>{t("purchases.openingPayable")}</Eyebrow><div className="font-display font-bold text-2xl text-ink">{pkr(totals.opening)}</div></Panel>
        <Panel><Eyebrow>{t("purchases.totalPurchases")}</Eyebrow><div className="font-display font-bold text-2xl text-ink">{pkr(totals.purchases)}</div></Panel>
        <Panel><Eyebrow>{t("customerLedger.totalPayments")}</Eyebrow><div className="font-display font-bold text-2xl text-brand-green">{pkr(totals.payments)}</div></Panel>
        <Panel><Eyebrow>{t("customerLedger.totalTon")}</Eyebrow><div className="font-display font-bold text-2xl text-ink">{totals.ton.toFixed(2)}</div></Panel>
        <Panel><Eyebrow>{t("purchases.currentPayable")}</Eyebrow><div className="font-display font-bold text-2xl text-ink">{pkr(totals.closing)}</div></Panel>
      </div>

      <Panel className="mb-4">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2.5">
          <Eyebrow>{t("purchases.plantSummary")}</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search size={13} className="text-steel" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("purchases.searchPlantPlaceholder")} className="border-none outline-none font-body text-xs py-1.5 w-[160px]" />
            </div>
            <select value={mo} onChange={(e) => setMonth(`${year}-${e.target.value}`)} className={`${inputClass} w-[130px]`}>
              {monthNames.map((name, i) => <option key={name} value={String(i + 1).padStart(2, "0")}>{name}</option>)}
            </select>
            <select value={year} onChange={(e) => setMonth(`${e.target.value}-${mo}`)} className={`${inputClass} w-[90px]`}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <SectionCaption>{t("purchases.clickRowCaption")}</SectionCaption>

        {loadingSummary ? (
          <div className="font-body text-steel py-6">{t("common.loading")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>{t("purchases.colHash")}</Th>
                  <Th>{t("purchases.colPlantCompany")}</Th>
                  <Th>{t("purchases.colMobile")}</Th>
                  <Th right>{t("purchases.colOpening")}</Th>
                  <Th right>{t("unifiedSale.col118")}</Th>
                  <Th right>{t("unifiedSale.col454")}</Th>
                  <Th right>{t("purchases.colTotalKg")}</Th>
                  <Th right>{t("purchases.colTotalTon")}</Th>
                  <Th right>{t("purchases.colPurchases")}</Th>
                  <Th right>{t("purchases.colPayments")}</Th>
                  <Th right>{t("purchases.colClosing")}</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => {
                  const rowKg = parseFloat(r.total_kg || "0");
                  const rowTon = (rowKg / 1000).toFixed(2);
                  return (
                    <tr
                      key={r.company.id}
                      onClick={() => setSelectedCompanyId(r.company.id)}
                      className={`cursor-pointer ${selectedCompanyId === r.company.id ? "bg-[#EAF6F6]" : ""}`}
                    >
                      <Td mono>{i + 1}</Td>
                      <Td bold>{r.company.name}</Td>
                      <Td mono>{r.company.mobile || "—"}</Td>
                      <Td right mono>{pkr(r.opening_balance)}</Td>
                      <Td right mono>{fmtNumber(r.total_118 || 0)}</Td>
                      <Td right mono>{fmtNumber(r.total_454 || 0)}</Td>
                      <Td right mono>{fmtNumber(rowKg)}</Td>
                      <Td right mono>{fmtNumber(rowTon, 2)}</Td>
                      <Td right mono>{pkr(r.total_purchases)}</Td>
                      <Td right mono>{pkr(r.total_payments)}</Td>
                      <Td right mono bold><BalanceTag amount={r.closing_balance} /></Td>
                    </tr>
                  );
                })}
                {!filteredRows.length && (
                  <tr><td colSpan={11} className="text-steel font-body text-[13px] py-4 text-center">{t("purchases.noPlantsMatch")}</td></tr>
                )}
                <tr className="bg-ink">
                  <Td bold color="#fff">—</Td>
                  <Td bold color="#fff">{t("purchases.totalsRow")}</Td>
                  <Td color="#fff">—</Td>
                  <Td right mono bold color="#fff">{pkr(totals.opening)}</Td>
                  <Td right mono bold color="#fff">{fmtNumber(totals.t118)}</Td>
                  <Td right mono bold color="#fff">{fmtNumber(totals.t454)}</Td>
                  <Td right mono bold color="#fff">{fmtNumber(totals.kg)}</Td>
                  <Td right mono bold color="#fff">{fmtNumber(totals.ton, 2)}</Td>
                  <Td right mono bold color="#fff">{pkr(totals.purchases)}</Td>
                  <Td right mono bold color="#fff">{pkr(totals.payments)}</Td>
                  <Td right mono bold color="#fff">{pkr(totals.closing)}</Td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selectedCompanyId && (
        <Panel className="print-area">
          {loadingDetail && <div className="font-body text-steel py-6">{t("common.loading")}</div>}
          {!loadingDetail && detail && (
            <>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <Eyebrow>{t("purchases.detailSuffix", { name: detail.company.name })}</Eyebrow>
                  <div className="font-mono text-xs text-steel">{detail.company.mobile || t("purchases.noMobileOnFile")}</div>
                  <div className="hidden print:block font-mono text-xs text-steel mt-1">{t("customerLedger.periodLabel", { mo, year })}</div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={api.ledger.companyStatementUrl(selectedCompanyId, month)}
                    target="_blank"
                    rel="noreferrer"
                    title={t("purchases.downloadPlantStatementTitle")}
                    className="print:hidden inline-flex items-center gap-2 font-body text-[13px] font-medium px-4 py-2.5 rounded-md bg-transparent text-ink border border-hairline cursor-pointer"
                  >
                    <Printer size={14} /> {t("purchases.downloadPlantStatement")}
                  </a>
                  <Button variant="outline" onClick={shareStatement} disabled={sharing}>
                    <Share2 size={14} /> {sharing ? t("customerLedger.sharingWhatsapp") : t("customerLedger.shareWhatsapp")}
                  </Button>
                  <BalanceTag amount={detail.closing_balance} />
                </div>
              </div>

              {shareStatus && (
                <div
                  className={`print:hidden mt-1 mb-3 font-body text-[12.5px] px-3 py-2 rounded-md border ${
                    shareStatus.type === "info"
                      ? "bg-[#EAF6F6] text-tealdeep border-[#BFE3E3]"
                      : "bg-red-50 text-red-600 border-red-200"
                  }`}
                >
                  {shareStatus.msg}
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Panel>
                  <div className="flex items-center justify-between">
                    <Eyebrow>{t("purchases.panelOpening")}</Eyebrow>
                    <button
                      onClick={() => setShowEditOpening(true)}
                      className="print:hidden bg-transparent border-none cursor-pointer text-steel hover:text-ink"
                      aria-label={t("modals.editOpeningBalanceTitle", { id: detail.company.name })}
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                  <div className="font-display font-bold text-base text-ink">{pkr(detail.opening_balance)}</div>
                </Panel>
                <Panel><Eyebrow>{t("purchases.panelPurchases")}</Eyebrow><div className="font-display font-bold text-base text-ink">{pkr(detail.total_purchases)}</div></Panel>
                <Panel><Eyebrow>{t("purchases.panelPaid")}</Eyebrow><div className="font-display font-bold text-base text-brand-green">{pkr(detail.total_payments)}</div></Panel>
                <Panel><Eyebrow>{t("purchases.panelClosing")}</Eyebrow><div className="font-display font-bold text-base text-ink">{pkr(detail.closing_balance)}</div></Panel>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>{t("customerLedger.colDate")}</Th>
                      <Th>{t("purchases.colTime")}</Th>
                      <Th>{t("customerLedger.colId")}</Th>
                      <Th>{t("customerLedger.colDescription")}</Th>
                      <Th>{t("unifiedSale.colVehicle")}</Th>
                      <Th right>{t("unifiedSale.col118")}</Th>
                      <Th right>{t("unifiedSale.col454")}</Th>
                      <Th right>{t("purchases.colPurchase")}</Th>
                      <Th right>{t("customerLedger.colPayment")}</Th>
                      <Th right>{t("customerLedger.colBalance")}</Th>
                      <Th>{t("customerLedger.colEnteredBy")}</Th>
                      <Th center><span className="print:hidden">{t("customerLedger.colActions")}</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <Td colSpan={9}>{t("customerLedger.openingBalanceRow")}</Td>
                      <Td right mono bold>{pkr(detail.opening_balance)}</Td>
                      <Td colSpan={2}>{null}</Td>
                    </tr>
                    {displayRows.map((r: CompanyLedgerRow) => {
                      const formatted = fmtTime(r.date);
                      const parts = formatted.split(",");
                      const datePart = parts[0] || formatted;
                      const timePart = fmtClock(r.date);
                      const q118 = parseFloat(r.qty_118 || "0");
                      const q454 = parseFloat(r.qty_454 || "0");

                      return (
                        <tr key={r.ref_id}>
                          <Td mono>{datePart}</Td>
                          <Td mono color="#2D3748">{timePart}</Td>
                          <Td mono>{r.display_id}</Td>
                          <Td>{r.description}</Td>
                          <Td mono>{r.vehicle_no || "—"}</Td>
                          <Td right mono>{q118 ? q118 : "—"}</Td>
                          <Td right mono>{q454 ? q454 : "—"}</Td>
                          <Td right mono>{parseFloat(r.purchase_amount) ? pkr(r.purchase_amount) : "—"}</Td>
                          <Td right mono color="#1E8A5F">{parseFloat(r.payment_amount) ? pkr(r.payment_amount) : "—"}</Td>
                          <Td right mono bold><BalanceTag amount={r.running_balance} /></Td>
                          <Td mono>{r.entered_by || "—"}</Td>
                          <Td center>
                            <div className="print:hidden flex items-center justify-center gap-1.5">
                              {r.correctable && (
                                <button
                                  onClick={() => openCorrect(r)}
                                  disabled={correctLoading === r.ref_id}
                                  title={t("customerLedger.correctThisTransaction")}
                                  className="inline-flex items-center gap-1 bg-[#EAF6F6] border border-teal/40 rounded-md px-2 py-1 cursor-pointer text-teal hover:bg-teal hover:text-white disabled:opacity-40"
                                >
                                  <Pencil size={11} />
                                  <span className="font-mono text-[10.5px] font-semibold">
                                    {correctLoading === r.ref_id ? t("common.loading") : t("purchases.correctButtonLabel")}
                                  </span>
                                </button>
                              )}
                              {(r.kind === "purchase" || r.kind === "payment") && (
                                <a
                                  href={r.kind === "purchase" ? api.purchases.invoiceUrl(r.ref_id) : api.companyPayments.invoiceUrl(r.ref_id)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={t("unifiedSale.viewPrintInvoice")}
                                  className="inline-flex items-center justify-center p-1.5 rounded-md text-steel hover:bg-paper hover:text-teal"
                                >
                                  <Printer size={13} />
                                </a>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                    {!displayRows.length && (
                      <tr><td colSpan={12} className="text-steel font-body text-[13px] py-4 text-center">{t("customerLedger.noTransactionsThisMonth")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {detail.corrections.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowCorrections((s) => !s)}
                    className="print:hidden bg-transparent border-none cursor-pointer flex items-center gap-1.5 w-full text-left"
                  >
                    <Eyebrow>{t("customerLedger.correctionHistory", { count: detail.corrections.length })}</Eyebrow>
                  </button>
                  <div className={`overflow-x-auto w-full ${showCorrections ? "" : "hidden print:block"}`}>
                    <table className="w-full min-w-full border-collapse mt-2">
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
                        {detail.corrections.map((c) => (
                          <tr key={c.ref_id}>
                            <Td mono>{fmtTime(c.date)}</Td>
                            <Td mono color="#9B4A4A">{c.display_id}</Td>
                            <Td className="max-w-[200px] truncate" title={c.description}>{c.description}</Td>
                            <Td right mono>{pkr(c.original_amount)}</Td>
                            <Td className="max-w-[200px] truncate" title={c.correction_reason}>{c.correction_reason}</Td>
                            <Td mono>{c.corrected_by}</Td>
                            <Td mono>{fmtTime(c.corrected_at)}</Td>
                            <Td mono>{c.corrected_display_id ?? "—"}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </Panel>
      )}

      {showNewPlant && (
        <NewPlantModal onClose={() => setShowNewPlant(false)} onCreated={() => { setShowNewPlant(false); loadSummary(); }} />
      )}
      {showNewPurchase && (
        <AddPurchaseModal
          onClose={() => setShowNewPurchase(false)}
          onSaved={refreshAfterAction}
          initialCompanyId={selectedCompanyId || undefined}
        />
      )}
      {showPlantPayment && (
        <RecordPlantPaymentModal
          onClose={() => setShowPlantPayment(false)}
          onSaved={refreshAfterAction}
          initialCompanyId={selectedCompanyId || undefined}
        />
      )}
      {correctTarget && (
        <CorrectTransactionModal
          kind={correctTarget.kind}
          transaction={correctTarget.transaction}
          onClose={() => setCorrectTarget(null)}
          onSaved={() => {
            setCorrectTarget(null);
            refreshAfterAction();
          }}
        />
      )}

      {showEditOpening && detail && (
        <EditOpeningBalanceModal
          title={t("modals.editOpeningBalanceTitle", { id: detail.company.name })}
          currentValue={parseFloat(detail.opening_balance)}
          onClose={() => setShowEditOpening(false)}
          onSave={async (newValue, reason) => {
            await api.companies.correctOpeningBalance(detail.company.id, { new_value: newValue, reason });
            setShowEditOpening(false);
            refreshAfterAction();
          }}
        />
      )}
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <AuthGate>
      <PurchasesBody />
    </AuthGate>
  );
}