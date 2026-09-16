"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, Button } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pkr, fmtClock, todayLocalInput } from "@/lib/format";
import type { DailyReportData, ReportableTransaction } from "@/lib/types";

/** § Daily Report clean columns — same Cylinder Type/Quantity cell
 * conventions as the PDF (reporting/pdf.py's _shop_statement_cylinder_
 * type_cell/_daily_quantity_cell, itself mirroring the Shop Statement's
 * own columns) — "—" for a row with no real product/quantity concept. */
function cylinderTypeCell(r: ReportableTransaction): string {
  const w = parseFloat(r.cylinder_weight || "0");
  if (!r.cylinder_weight || w === 0) return "—";
  return `${parseFloat(r.cylinder_weight)} KG`;
}

function quantityCell(r: ReportableTransaction): string {
  if (r.quantity == null) return "—";
  const q = parseFloat(r.quantity);
  if (!q) return "—";
  // Trim trailing zeros (e.g. "2.0000" -> "2") but keep real decimals
  // (e.g. a KG-based Shop Sale's fractional cylinder-equivalent).
  const text = q.toFixed(4).replace(/\.?0+$/, "");
  return r.unit === "kg" ? `${text} kg` : text;
}

/** Daily Activity (§3C, §5) — the on-screen/printable view of every
 * business/financial/operational transaction for one selected business
 * date. Reads from the same aggregator (/reports/daily/{date}/data) the
 * PDF is rendered from, so this screen, the print output, and the PDF
 * can never disagree with each other. */
function DailyActivityBody() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(todayLocalInput());
  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.reports
      .dailyData(date)
      .then(setData)
      .finally(() => setLoading(false));
  }, [date]);

  const handleGenerate = async () => {
    if (!user) return;
    setGenerating(true);
    setToast(null);
    try {
      await api.reports.generateDaily(date, user.name);
      setToast(t("dailyActivity.pdfGeneratedToast"));
    } catch {
      setToast(t("dailyActivity.pdfFailedToast"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.dailyActivity")}
        title={t("dailyActivity.title")}
        caption={t("dailyActivity.caption")}
        action={
          <div className="flex items-center flex-wrap gap-2 no-print">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-full sm:w-[160px]`} />
            <PrintButton label={t("dailyActivity.print")} />
            <Button variant="teal" onClick={handleGenerate} disabled={generating}>
              <FileDown size={14} /> {generating ? t("dailyActivity.generating") : t("dailyActivity.generatePdf")}
            </Button>
            <Button variant="outline" onClick={() => router.push("/reports")}>
              {t("dailyActivity.viewReports")}
            </Button>
          </div>
        }
      />

      {toast && <div className="font-body text-[13px] text-brand-green mb-3 no-print">{toast}</div>}

      {loading && (
        <Panel>
          <div className="font-body text-steel p-6">{t("common.loading")}</div>
        </Panel>
      )}

      {!loading && data && (
        <div className="print-area">
          <div className="hidden print:block mb-4">
            <div className="font-display font-bold text-xl">DOWA Gas Agency — {t("nav.dailyActivity")}</div>
            <div className="font-mono text-xs text-steel">{t("dailyActivity.printHeaderBusinessDate", { date: data.business_date })}</div>
          </div>

          {/* Daily Summary */}
          <Panel className="mb-4">
            <Eyebrow>{t("dailyActivity.dailySummary")}</Eyebrow>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-2">
              <SummaryTile label={t("dailyActivity.sales")} value={data.summary.total_sales} />
              <SummaryTile label={t("dailyActivity.deliveryCharges")} value={data.summary.total_delivery_charges} />
              <SummaryTile label={t("dailyActivity.purchases")} value={data.summary.total_purchases} />
              <SummaryTile label={t("dailyActivity.customerPayments")} value={data.summary.total_customer_payments} />
              <SummaryTile label={t("dailyActivity.plantPayments")} value={data.summary.total_plant_payments} />
              <SummaryTile label={t("dailyActivity.investments")} value={data.summary.total_investments} />
              <SummaryTile label={t("nav.expenses")} value={data.summary.total_expenses} />
              <SummaryTile label={t("unifiedSale.ownerDrawings")} value={data.summary.total_owner_drawings} />
              <SummaryTile label={t("pnlChart.legendNetCashMovement")} value={data.summary.net_cash_movement} />
              <SummaryTile label={t("dailyActivity.cylindersOut")} value={data.summary.total_cylinders_out} plain />
              <SummaryTile label={t("dailyActivity.cylindersIn")} value={data.summary.total_cylinders_in} plain />
            </div>
          </Panel>

          {data.sections.map((section) => (
            <Panel key={section.key} className="mb-4">
              <div className="flex items-center justify-between">
                <Eyebrow>
                  {section.label} ({section.rows.length})
                </Eyebrow>
                {section.financial_total !== null && (
                  <div className="font-mono text-[13px] font-semibold text-ink">
                    {t("dailyActivity.sectionTotal", { amount: pkr(section.financial_total) })}
                  </div>
                )}
              </div>
              {section.rows.length === 0 ? (
                <div className="font-body text-[13px] text-steel py-3">{t("dailyActivity.noActivityForDate")}</div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full border-collapse mt-2">
                  <thead>
                    <tr>
                      <Th>{t("purchases.colTime")}</Th>
                      <Th>{t("customerLedger.colId")}</Th>
                      <Th>{t("modals.cylinderType")}</Th>
                      <Th>{t("shopDetail.colQuantity")}</Th>
                      <Th>{t("customerLedger.colDescription")}</Th>
                      <Th>{t("dailyActivity.colCustomerPlant")}</Th>
                      <Th>{t("dailyActivity.colReference")}</Th>
                      <Th>{t("customerLedger.colEnteredBy")}</Th>
                      <Th>{t("shopDetail.colStatus")}</Th>
                      <Th right>{t("unifiedSale.colAmount")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r) => (
                      <tr key={r.id}>
                        <Td mono>{fmtClock(r.date)}</Td>
                        <Td mono>{r.display_id}</Td>
                        <Td mono>{cylinderTypeCell(r)}</Td>
                        <Td mono>{quantityCell(r)}</Td>
                        <Td>{r.description}</Td>
                        <Td>{r.customer || r.plant || "—"}</Td>
                        <Td mono>{r.reference || "—"}</Td>
                        <Td mono>{r.entered_by}</Td>
                        <Td mono>{r.approval_info || r.status}</Td>
                        <Td right mono>{r.amount ? pkr(r.amount) : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DailyActivityPage() {
  return (
    <AuthGate>
      <DailyActivityBody />
    </AuthGate>
  );
}

function SummaryTile({ label, value, plain = false }: { label: string; value: string; plain?: boolean }) {
  const n = parseFloat(value || "0");
  return (
    <div>
      <div className="font-mono text-[10px] tracking-wide uppercase text-steel">{label}</div>
      <div className={`font-mono font-semibold text-[14px] ${n < 0 ? "text-brand-red" : "text-ink"}`}>
        {plain ? value : pkr(value)}
      </div>
    </div>
  );
}
