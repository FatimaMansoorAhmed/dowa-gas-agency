"use client";
import { useEffect, useState } from "react";
import { Download, Eye, RefreshCw, Send, FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtTime, todayLocalInput } from "@/lib/format";
import type { GeneratedReport, WhatsAppStatus } from "@/lib/types";

/** Reports page (§6) — every generated Daily Report PDF, viewable /
 * downloadable / re-generatable / sendable over WhatsApp, plus manual
 * generation for any selected date. */
function ReportsBody() {
  const { t } = useTranslation();
  const STATUS_LABEL: Record<WhatsAppStatus, { label: string; color: string }> = {
    not_sent: { label: t("reports.statusNotSent"), color: "#8A98A3" },
    sent: { label: t("reports.statusSent"), color: "#1E8A5F" },
    failed: { label: t("reports.statusFailed"), color: "#B03A3A" },
    unavailable: { label: t("reports.statusUnavailable"), color: "#B7791F" },
  };
  const { user } = useAuth();
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [genDate, setGenDate] = useState(todayLocalInput());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    api.reports.list().then(setReports).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleGenerate = async () => {
    if (!user) return;
    setBusyId("__generate__");
    try {
      await api.reports.generateDaily(genDate, user.name);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleRegenerate = async (r: GeneratedReport) => {
    if (!user) return;
    setBusyId(r.id);
    try {
      await api.reports.generateDaily(r.business_date, user.name);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleSendWhatsApp = async (r: GeneratedReport) => {
    setBusyId(r.id);
    try {
      const result = await api.reports.sendWhatsApp(r.id);
      setRowMessage((m) => ({ ...m, [r.id]: result.message }));
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.reports")}
        title={t("reports.title")}
        caption={t("reports.caption")}
      />

      <Panel className="mb-4">
        <Eyebrow>{t("reports.generateAReport")}</Eyebrow>
        <SectionCaption>{t("reports.generateCaption")}</SectionCaption>
        <div className="flex items-center flex-wrap gap-2">
          <input type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} className={`${inputClass} w-full sm:w-[160px]`} />
          <Button variant="teal" onClick={handleGenerate} disabled={busyId === "__generate__"}>
            <FileDown size={14} /> {busyId === "__generate__" ? t("reports.generating") : t("reports.generate")}
          </Button>
        </div>
      </Panel>

      <Panel>
        <Eyebrow>{t("reports.reportHistory")}</Eyebrow>
        {loading ? (
          <div className="font-body text-steel py-6">{t("common.loading")}</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>{t("customerLedger.colDate")}</Th>
                <Th>{t("reports.colReportType")}</Th>
                <Th>{t("reports.colLanguage")}</Th>
                <Th>{t("reports.colGeneratedAt")}</Th>
                <Th>{t("reports.colGeneratedBy")}</Th>
                <Th>{t("reports.colWhatsappStatus")}</Th>
                <Th center>{t("unifiedSale.colActions")}</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const status = STATUS_LABEL[r.whatsapp_status] || STATUS_LABEL.not_sent;
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <Td mono>{r.business_date}</Td>
                    <Td mono>{r.report_type}</Td>
                    <Td>
                      <span
                        className="font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
                        style={
                          r.language === "ur"
                            ? { color: "#1E8A5F", background: "#E6F4EE" }
                            : { color: "#3B5166", background: "#EEF2F5" }
                        }
                      >
                        {r.language === "ur" ? t("reports.languageUr") : t("reports.languageEn")}
                      </span>
                    </Td>
                    <Td mono>{fmtTime(r.generated_at)}</Td>
                    <Td mono>{r.generated_by}</Td>
                    <Td>
                      <span className="font-mono text-[11px] font-semibold" style={{ color: status.color }}>
                        {status.label}
                      </span>
                      {rowMessage[r.id] && (
                        <div className="font-body text-[10.5px] text-steel mt-0.5">{rowMessage[r.id]}</div>
                      )}
                      {r.whatsapp_error && !rowMessage[r.id] && (
                        <div className="font-body text-[10.5px] text-brand-red mt-0.5">{r.whatsapp_error}</div>
                      )}
                    </Td>
                    <Td center>
                      <div className="flex items-center justify-center gap-2">
                        <a href={api.reports.viewUrl(r.id)} target="_blank" rel="noreferrer" title={t("reports.viewTitle")}>
                          <Eye size={14} className="text-steel hover:text-teal" />
                        </a>
                        <a href={api.reports.downloadUrl(r.id)} download title={t("reports.downloadTitle")}>
                          <Download size={14} className="text-steel hover:text-teal" />
                        </a>
                        <button
                          onClick={() => handleRegenerate(r)}
                          disabled={busy}
                          title={t("reports.regenerateTitle")}
                          className="bg-transparent border-none cursor-pointer disabled:opacity-40"
                        >
                          <RefreshCw size={14} className="text-steel hover:text-teal" />
                        </button>
                        <button
                          onClick={() => handleSendWhatsApp(r)}
                          disabled={busy || r.language !== "ur"}
                          title={r.language === "ur" ? t("reports.sendWhatsappTitle") : t("reports.sendWhatsappUrduOnlyTitle")}
                          className="bg-transparent border-none cursor-pointer disabled:opacity-40"
                        >
                          <Send size={14} className="text-steel hover:text-teal" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {!reports.length && (
                <tr>
                  <td colSpan={7} className="text-steel font-body text-[13px] py-4 text-center">
                    {t("reports.noReportsYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AuthGate>
      <ReportsBody />
    </AuthGate>
  );
}
