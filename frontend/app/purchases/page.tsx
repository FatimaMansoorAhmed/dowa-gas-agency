"use client";
import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Search, Truck, Wallet, Pencil } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, BalanceTag, Button } from "@/components/ui";
import NewPlantModal from "@/components/NewPlantModal";
import AddPurchaseModal from "@/components/AddPurchaseModal";
import RecordPlantPaymentModal from "@/components/RecordPlantPaymentModal";
import CorrectTransactionModal, { CorrectableKind } from "@/components/CorrectTransactionModal";
import PrintButton from "@/components/PrintButton";
import { api } from "@/lib/api";
import { pkr, fmtTime, fmtClock, todayLocalInput } from "@/lib/format";
import type { PlantLedgerSummaryRow, CompanyLedgerSummary, CompanyLedgerRow, Purchase, CompanyPayment } from "@/lib/types";

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" reflects the Karachi calendar even off-Karachi machines.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function PurchasesBody() {
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
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const yearOptions = [2025, 2026, 2027];

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
        eyebrow="Purchases"
        title="Plants, purchases & payables"
        caption="Every purchase and plant payment posts here automatically — this is the same data the drill-down below reads from, always in sync."
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setShowNewPlant(true)}><PlusCircle size={14} /> Add Plant</Button>
            <Button variant="outline" onClick={() => setShowNewPurchase(true)}><Truck size={14} /> New Purchase</Button>
            <Button variant="outline" onClick={() => setShowPlantPayment(true)}><Wallet size={14} /> Plant Payment</Button>
          </div>
        }
      />

      <div className="grid grid-cols-5 gap-3.5 mb-4">
        <Panel><Eyebrow>Opening Payable</Eyebrow><div className="font-display font-bold text-2xl text-ink">{pkr(totals.opening)}</div></Panel>
        <Panel><Eyebrow>Total Purchases</Eyebrow><div className="font-display font-bold text-2xl text-ink">{pkr(totals.purchases)}</div></Panel>
        <Panel><Eyebrow>Total Payments</Eyebrow><div className="font-display font-bold text-2xl text-brand-green">{pkr(totals.payments)}</div></Panel>
        <Panel><Eyebrow>Total Ton</Eyebrow><div className="font-display font-bold text-2xl text-ink">{totals.ton.toFixed(2)}</div></Panel>
        <Panel><Eyebrow>Current Payable</Eyebrow><div className="font-display font-bold text-2xl text-ink">{pkr(totals.closing)}</div></Panel>
      </div>

      <Panel className="mb-4">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2.5">
          <Eyebrow>Plant Summary</Eyebrow>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
              <Search size={13} className="text-steel" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plant" className="border-none outline-none font-body text-xs py-1.5 w-[160px]" />
            </div>
            <select value={mo} onChange={(e) => setMonth(`${year}-${e.target.value}`)} className={`${inputClass} w-[130px]`}>
              {monthNames.map((name, i) => <option key={name} value={String(i + 1).padStart(2, "0")}>{name}</option>)}
            </select>
            <select value={year} onChange={(e) => setMonth(`${e.target.value}-${mo}`)} className={`${inputClass} w-[90px]`}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <SectionCaption>Click a row to see its full transaction-level ledger below.</SectionCaption>

        {loadingSummary ? (
          <div className="font-body text-steel py-6">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Plant / Company</Th>
                  <Th>Mobile</Th>
                  <Th right>Opening</Th>
                  <Th right>11.8 KG</Th>
                  <Th right>45.4 KG</Th>
                  <Th right>Total KG</Th>
                  <Th right>Total Ton</Th>
                  <Th right>Purchases</Th>
                  <Th right>Payments</Th>
                  <Th right>Closing</Th>
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
                      <Td right mono>{r.total_118 || 0}</Td>
                      <Td right mono>{r.total_454 || 0}</Td>
                      <Td right mono>{rowKg.toLocaleString()}</Td>
                      <Td right mono>{rowTon}</Td>
                      <Td right mono>{pkr(r.total_purchases)}</Td>
                      <Td right mono>{pkr(r.total_payments)}</Td>
                      <Td right mono bold><BalanceTag amount={r.closing_balance} /></Td>
                    </tr>
                  );
                })}
                {!filteredRows.length && (
                  <tr><td colSpan={11} className="text-steel font-body text-[13px] py-4 text-center">No plants match.</td></tr>
                )}
                <tr className="bg-ink">
                  <Td bold color="#fff">—</Td>
                  <Td bold color="#fff">Totals</Td>
                  <Td color="#fff">—</Td>
                  <Td right mono bold color="#fff">{pkr(totals.opening)}</Td>
                  <Td right mono bold color="#fff">{totals.t118}</Td>
                  <Td right mono bold color="#fff">{totals.t454}</Td>
                  <Td right mono bold color="#fff">{totals.kg.toLocaleString()}</Td>
                  <Td right mono bold color="#fff">{totals.ton.toFixed(2)}</Td>
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
          {loadingDetail && <div className="font-body text-steel py-6">Loading…</div>}
          {!loadingDetail && detail && (
            <>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <Eyebrow>{detail.company.name} — Detail</Eyebrow>
                  <div className="font-mono text-xs text-steel">{detail.company.mobile || "No mobile on file"}</div>
                  <div className="hidden print:block font-mono text-xs text-steel mt-1">Period: {mo}/{year}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="print:hidden"><PrintButton label="Print Plant Ledger" /></span>
                  <BalanceTag amount={detail.closing_balance} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-4">
                <Panel><Eyebrow>Opening</Eyebrow><div className="font-display font-bold text-base text-ink">{pkr(detail.opening_balance)}</div></Panel>
                <Panel><Eyebrow>Purchases</Eyebrow><div className="font-display font-bold text-base text-ink">{pkr(detail.total_purchases)}</div></Panel>
                <Panel><Eyebrow>Paid</Eyebrow><div className="font-display font-bold text-base text-brand-green">{pkr(detail.total_payments)}</div></Panel>
                <Panel><Eyebrow>Closing</Eyebrow><div className="font-display font-bold text-base text-ink">{pkr(detail.closing_balance)}</div></Panel>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Time</Th>
                      <Th>ID</Th>
                      <Th>Description</Th>
                      <Th>Vehicle</Th>
                      <Th right>11.8 KG</Th>
                      <Th right>45.4 KG</Th>
                      <Th right>Purchase</Th>
                      <Th right>Payment</Th>
                      <Th right>Balance</Th>
                      <Th>Entered By</Th>
                      <Th center><span className="print:hidden">Actions</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <Td colSpan={9}>Opening balance</Td>
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
                            {r.correctable && (
                              <button
                                onClick={() => openCorrect(r)}
                                disabled={correctLoading === r.ref_id}
                                title="Correct this transaction"
                                className="print:hidden inline-flex items-center gap-1 bg-[#EAF6F6] border border-teal/40 rounded-md px-2 py-1 cursor-pointer text-teal hover:bg-teal hover:text-white disabled:opacity-40"
                              >
                                <Pencil size={11} />
                                <span className="font-mono text-[10.5px] font-semibold">
                                  {correctLoading === r.ref_id ? "Loading…" : "Correct"}
                                </span>
                              </button>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                    {!displayRows.length && (
                      <tr><td colSpan={12} className="text-steel font-body text-[13px] py-4 text-center">No transactions this month.</td></tr>
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
                    <Eyebrow>Correction History ({detail.corrections.length})</Eyebrow>
                  </button>
                  <table className={`w-full border-collapse mt-2 ${showCorrections ? "" : "hidden print:table"}`}>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Original ID</Th>
                        <Th>Description</Th>
                        <Th right>Original Amount</Th>
                        <Th>Reason</Th>
                        <Th>Corrected By</Th>
                        <Th>Corrected At</Th>
                        <Th>Replaced By</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.corrections.map((c) => (
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