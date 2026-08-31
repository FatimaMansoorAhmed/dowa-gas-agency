"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, Button } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pkr, fmtClock, todayLocalInput } from "@/lib/format";
import type { DailyReportData } from "@/lib/types";

/** Daily Activity (§3C, §5) — the on-screen/printable view of every
 * business/financial/operational transaction for one selected business
 * date. Reads from the same aggregator (/reports/daily/{date}/data) the
 * PDF is rendered from, so this screen, the print output, and the PDF
 * can never disagree with each other. */
function DailyActivityBody() {
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
      setToast("PDF generated and saved — view it on the Reports page.");
    } catch {
      setToast("Could not generate the PDF — try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Daily Activity"
        title="One business date, every transaction"
        caption="Sales, purchases, payments, investments, expenses, and cylinder activity for the selected business date, drawn from the same ledger data used everywhere else."
        action={
          <div className="flex items-center gap-2 no-print">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-[160px]`} />
            <PrintButton label="Print" />
            <Button variant="teal" onClick={handleGenerate} disabled={generating}>
              <FileDown size={14} /> {generating ? "Generating…" : "Generate PDF"}
            </Button>
            <Button variant="outline" onClick={() => router.push("/reports")}>
              View Reports
            </Button>
          </div>
        }
      />

      {toast && <div className="font-body text-[13px] text-brand-green mb-3 no-print">{toast}</div>}

      {loading && (
        <Panel>
          <div className="font-body text-steel p-6">Loading…</div>
        </Panel>
      )}

      {!loading && data && (
        <div className="print-area">
          <div className="hidden print:block mb-4">
            <div className="font-display font-bold text-xl">DOWA Gas Agency — Daily Activity</div>
            <div className="font-mono text-xs text-steel">Business Date: {data.business_date}</div>
          </div>

          {/* Daily Summary */}
          <Panel className="mb-4">
            <Eyebrow>Daily Summary</Eyebrow>
            <div className="grid grid-cols-5 gap-3 mt-2">
              <SummaryTile label="Sales" value={data.summary.total_sales} />
              <SummaryTile label="Purchases" value={data.summary.total_purchases} />
              <SummaryTile label="Customer Payments" value={data.summary.total_customer_payments} />
              <SummaryTile label="Plant Payments" value={data.summary.total_plant_payments} />
              <SummaryTile label="Investments" value={data.summary.total_investments} />
              <SummaryTile label="Expenses" value={data.summary.total_expenses} />
              <SummaryTile label="Owner Drawings" value={data.summary.total_owner_drawings} />
              <SummaryTile label="Net Cash Movement" value={data.summary.net_cash_movement} />
              <SummaryTile label="Cylinders Out" value={data.summary.total_cylinders_out} plain />
              <SummaryTile label="Cylinders In" value={data.summary.total_cylinders_in} plain />
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
                    Total: {pkr(section.financial_total)}
                  </div>
                )}
              </div>
              {section.rows.length === 0 ? (
                <div className="font-body text-[13px] text-steel py-3">No activity for this date.</div>
              ) : (
                <table className="w-full border-collapse mt-2">
                  <thead>
                    <tr>
                      <Th>Time</Th>
                      <Th>ID</Th>
                      <Th>Description</Th>
                      <Th>Customer/Plant</Th>
                      <Th>Reference</Th>
                      <Th>Entered By</Th>
                      <Th>Status</Th>
                      <Th right>Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r) => (
                      <tr key={r.id}>
                        <Td mono>{fmtClock(r.date)}</Td>
                        <Td mono>{r.display_id}</Td>
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
