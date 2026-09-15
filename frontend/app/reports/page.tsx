"use client";
import { Fragment, useEffect, useState } from "react";
import { Download, Eye, RefreshCw, Send, FileDown, Plus, Trash2, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtTime, todayLocalInput } from "@/lib/format";
import type { GeneratedReport, WhatsAppStatus, WhatsAppRecipient, WhatsAppSendLog } from "@/lib/types";

/** § WhatsApp Recipients & Daily Scheduler — recipient list (add/remove)
 * + the auto-send on/off toggle the 12:00 PM scheduler job reads
 * (app/scheduler.py). "Remove" is a soft deactivate, never a hard delete
 * — a WhatsAppSendLog row's recipient_id would otherwise dangle. */
function WhatsAppSettingsPanel() {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<WhatsAppRecipient[]>([]);
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [label, setLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.reports.whatsappRecipients.list(), api.reports.whatsappAutoSend.get()])
      .then(([r, s]) => {
        setRecipients(r);
        setAutoSendEnabled(s.enabled);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!phoneNumber.trim()) return;
    setBusyId("__add__");
    try {
      await api.reports.whatsappRecipients.create({ phone_number: phoneNumber.trim(), label: label.trim() || undefined });
      setPhoneNumber("");
      setLabel("");
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (r: WhatsAppRecipient) => {
    setBusyId(r.id);
    try {
      if (r.active === "active") await api.reports.whatsappRecipients.deactivate(r.id);
      else await api.reports.whatsappRecipients.activate(r.id);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleAutoSend = async () => {
    const next = !autoSendEnabled;
    setAutoSendEnabled(next); // optimistic
    try {
      await api.reports.whatsappAutoSend.set(next);
    } catch {
      setAutoSendEnabled(!next); // revert on failure
    }
  };

  return (
    <Panel className="mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>{t("reports.whatsappAutoSendTitle")}</Eyebrow>
          <SectionCaption>{t("reports.whatsappAutoSendCaption")}</SectionCaption>
        </div>
        <button
          type="button"
          onClick={handleToggleAutoSend}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer border-none ${
            autoSendEnabled ? "bg-teal" : "bg-slate-300"
          }`}
          aria-label={t("reports.whatsappAutoSendToggleLabel")}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoSendEnabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      {loading ? (
        <div className="font-body text-steel py-4 text-sm">{t("common.loading")}</div>
      ) : (
        <>
          <div className="mt-4 flex items-center flex-wrap gap-2">
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={t("reports.recipientPhonePlaceholder")}
              className={`${inputClass} w-full sm:w-[180px]`}
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("reports.recipientLabelPlaceholder")}
              className={`${inputClass} w-full sm:w-[150px]`}
            />
            <Button variant="outline" onClick={handleAdd} disabled={busyId === "__add__" || !phoneNumber.trim()}>
              <Plus size={14} /> {t("reports.addRecipient")}
            </Button>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            {recipients.map((r) => (
              <div
                key={r.id}
                className={`flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-1.5 ${r.active !== "active" ? "opacity-50" : ""}`}
              >
                <div className="font-body text-[13px] text-ink">
                  <span className="font-mono">{r.phone_number}</span>
                  {r.label && <span className="ml-2 text-steel text-[11.5px]">{r.label}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleActive(r)}
                  disabled={busyId === r.id}
                  title={r.active === "active" ? t("reports.deactivateRecipientTitle") : t("reports.activateRecipientTitle")}
                  className="bg-transparent border-none cursor-pointer disabled:opacity-40"
                >
                  {r.active === "active" ? (
                    <Trash2 size={13} className="text-steel hover:text-brand-red" />
                  ) : (
                    <RotateCcw size={13} className="text-steel hover:text-teal" />
                  )}
                </button>
              </div>
            ))}
            {!recipients.length && (
              <div className="font-body text-[12.5px] text-steel py-2">{t("reports.noRecipientsYet")}</div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

/** Per-report WhatsApp send log (§ WhatsApp Recipients & Daily Scheduler)
 * — expandable inline, one row per recipient attempt. Only ever has rows
 * for a scheduled auto-send (send_report_to_recipient in routers/
 * reports.py); the manual single-recipient "Send via WhatsApp" button
 * above still only updates the report's own whatsapp_status, unchanged. */
function WhatsAppLogRow({ reportId, colSpan }: { reportId: string; colSpan: number }) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<WhatsAppSendLog[] | null>(null);

  useEffect(() => {
    api.reports.whatsappLog(reportId).then(setLogs);
  }, [reportId]);

  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/60 px-4 py-2">
        {logs === null ? (
          <div className="font-body text-[12px] text-steel">{t("common.loading")}</div>
        ) : logs.length === 0 ? (
          <div className="font-body text-[12px] text-steel">{t("reports.noAutoSendLogYet")}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 font-body text-[12px]">
                <span className="font-mono text-ink">{l.recipient_phone_number}</span>
                {l.recipient_label && <span className="text-steel">{l.recipient_label}</span>}
                <span className="font-mono" style={{ color: l.status === "sent" ? "#1E8A5F" : "#B03A3A" }}>
                  {l.status === "sent" ? t("reports.statusSent") : t("reports.statusFailed")}
                </span>
                <span className="text-steel">{fmtTime(l.sent_at)}</span>
                {l.error && <span className="text-brand-red">{l.error}</span>}
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

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
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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

      <WhatsAppSettingsPanel />

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
                  <Fragment key={r.id}>
                  <tr>
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
                        {r.language === "ur" && (
                          <button
                            onClick={() => setExpandedLogId((id) => (id === r.id ? null : r.id))}
                            title={t("reports.viewAutoSendLogTitle")}
                            className="bg-transparent border-none cursor-pointer"
                          >
                            {expandedLogId === r.id ? (
                              <ChevronUp size={14} className="text-steel hover:text-teal" />
                            ) : (
                              <ChevronDown size={14} className="text-steel hover:text-teal" />
                            )}
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                  {expandedLogId === r.id && <WhatsAppLogRow reportId={r.id} colSpan={7} />}
                  </Fragment>
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
