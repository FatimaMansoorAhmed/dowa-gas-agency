"use client";
import { useEffect, useState } from "react";
import { Search, PlusCircle, Pencil, Check, X, CheckCircle2, AlertTriangle, XCircle, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Th, Td, inputClass, BalanceTag, Button, Field } from "@/components/ui";
import { api, apiErrorMessage } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { employeeDeleteMessage } from "@/lib/deleteConfirm";
import type { Employee, EmployeeLedgerSummary } from "@/lib/types";

function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

// § Employee Salary Tracking — "at a glance" payment status badge. Purely
// a display-side classification of numbers the backend already computes
// (EmployeeLedgerSummary.total_accrued/total_paid for a given month) — no
// new calculation, just paid-vs-due comparison. Automatically flips back
// to "due" the moment a new month's accrual posts (same lazy-accrual
// mechanism every other Employee view already relies on), so this never
// needs its own "reset next month" logic.
type PaymentStatus = "paid" | "partial" | "due" | "none";

function computePaymentStatus(accruedStr: string, paidStr: string): PaymentStatus {
  const accrued = parseFloat(accruedStr) || 0;
  const paid = parseFloat(paidStr) || 0;
  if (accrued <= 0) return "none";
  if (paid >= accrued) return "paid";
  if (paid > 0) return "partial";
  return "due";
}

function PaymentStatusBadge({
  accrued, paid, t,
}: {
  accrued: string;
  paid: string;
  t: (key: string, options?: Record<string, any>) => string;
}) {
  const status = computePaymentStatus(accrued, paid);
  if (status === "none") return null;

  const cfg: Record<Exclude<PaymentStatus, "none">, { icon: typeof CheckCircle2; cls: string; label: string }> = {
    paid: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: t("employees.statusPaidBadge") },
    partial: { icon: AlertTriangle, cls: "bg-amber-50 text-amber-700 border-amber-200", label: t("employees.statusPartialBadge") },
    due: { icon: XCircle, cls: "bg-red-50 text-brand-red border-red-200", label: t("employees.statusDueBadge") },
  };
  const { icon: Icon, cls, label } = cfg[status];
  const title =
    status === "paid"
      ? t("employees.statusPaidTooltip", { paid: pkr(paid), accrued: pkr(accrued) })
      : t("employees.statusUnpaidTooltip", { paid: pkr(paid), accrued: pkr(accrued) });

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}
    >
      <Icon size={11} /> {label}
    </span>
  );
}

function EmployeesBody() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<EmployeeLedgerSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSalary, setNewSalary] = useState("");
  const [saving, setSaving] = useState(false);

  const [showEditSalary, setShowEditSalary] = useState(false);
  const [editSalaryValue, setEditSalaryValue] = useState("");
  const [editStatusValue, setEditStatusValue] = useState<"active" | "inactive">("active");
  const [editSalaryError, setEditSalaryError] = useState<string | null>(null);

  // § Employee Salary Tracking — "at a glance" this-month status for every
  // employee in the sidebar, independent of whichever month the detail
  // panel happens to be showing. Reuses the same ledger endpoint (and its
  // already-verified accrual logic) already called for the selected
  // employee — just fetched for all of them, for the real current month.
  const [thisMonthStatus, setThisMonthStatus] = useState<Record<string, { accrued: string; paid: string }>>({});

  const loadEmployees = () => {
    api.employees.list().then((list) => {
      setEmployees(list);
      const thisMonth = currentMonth();
      Promise.all(
        list.map((e) =>
          api.employees.ledger(e.id, thisMonth).then(
            (s) => [e.id, { accrued: s.total_accrued, paid: s.total_paid }] as const
          )
        )
      ).then((entries) => setThisMonthStatus(Object.fromEntries(entries)));
    });
  };

  const loadLedger = () => {
    if (!employeeId) {
      setSummary(null);
      return;
    }
    setLoading(true);
    api.employees.ledger(employeeId, month).then(setSummary).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, month]);

  const filtered = employees.filter(
    (e) => !search.trim() || e.name.toLowerCase().includes(search.toLowerCase())
  );

  const [year, mo] = month.split("-");
  const monthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const yearOptions = [2025, 2026, 2027];

  const canAddEmployee = newName.trim() && parseFloat(newSalary) > 0;

  const addEmployee = async () => {
    if (!canAddEmployee || !user) return;
    setSaving(true);
    try {
      const emp = await api.employees.create({
        name: newName.trim(),
        monthly_salary: parseFloat(newSalary),
        entered_by: user.name,
      });
      setNewName("");
      setNewSalary("");
      setShowAddForm(false);
      loadEmployees();
      setEmployeeId(emp.id);
    } finally {
      setSaving(false);
    }
  };

  const openEditSalary = () => {
    if (!summary) return;
    setEditSalaryValue(summary.employee.monthly_salary);
    setEditStatusValue(summary.employee.status);
    setEditSalaryError(null);
    setShowEditSalary(true);
  };

  const saveEditSalary = async () => {
    if (!employeeId || parseFloat(editSalaryValue) <= 0) return;
    setSaving(true);
    setEditSalaryError(null);
    try {
      await api.employees.update(employeeId, {
        monthly_salary: parseFloat(editSalaryValue),
        status: editStatusValue,
      });
      setShowEditSalary(false);
      loadEmployees();
      loadLedger();
    } catch (e) {
      // § Edit Salary bug fix — this used to fail silently (no catch at
      // all): the modal would just sit there with nothing visibly wrong,
      // which is exactly what made a real failure indistinguishable from
      // "the edit doesn't do anything."
      setEditSalaryError(apiErrorMessage(e, t("modals.couldNotSaveSaleGeneric")));
    } finally {
      setSaving(false);
    }
  };

  // Delete Employee — owner-only on the server; the confirm text states
  // the exact salary standing being written off.
  const handleDeleteEmployee = async () => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    if (!window.confirm(employeeDeleteMessage(t, emp))) return;
    try {
      await api.employees.remove(emp.id);
      setEmployeeId("");
      loadEmployees();
    } catch (e) {
      alert(apiErrorMessage(e, t("deleteEntity.failed")));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.employees")}
        title={t("employees.title")}
        caption={t("employees.caption")}
        action={
          !showAddForm ? (
            <Button variant="teal" onClick={() => setShowAddForm(true)}>
              <PlusCircle size={15} /> {t("employees.addEmployee")}
            </Button>
          ) : undefined
        }
      />

      {showAddForm && (
        <Panel className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <Eyebrow>{t("employees.addEmployee")}</Eyebrow>
            <button onClick={() => setShowAddForm(false)} className="bg-transparent border-none cursor-pointer">
              <X size={16} className="text-steel" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <Field label={t("employees.nameLabel")}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("employees.namePlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field label={t("employees.monthlySalaryLabel")}>
              <input
                type="number"
                min="0"
                value={newSalary}
                onChange={(e) => setNewSalary(e.target.value)}
                placeholder="0"
                className={inputClass}
              />
            </Field>
            <Button variant="primary" onClick={addEmployee} disabled={!canAddEmployee || saving}>
              <Check size={15} /> {saving ? t("unifiedSale.saving") : t("employees.saveEmployee")}
            </Button>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[0.65fr_1.5fr] gap-4">
        {/* Employee Sidebar */}
        <Panel>
          <Eyebrow>{t("nav.employees")}</Eyebrow>
          <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5 mb-3">
            <Search size={13} className="text-steel" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("employees.searchPlaceholder")}
              className="border-none outline-none font-body text-xs py-1.5 w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5 max-h-[520px] overflow-y-auto">
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => setEmployeeId(e.id)}
                className={`text-left px-3 py-2.5 rounded-lg border ${
                  employeeId === e.id ? "border-teal bg-[#EAF6F6]" : "border-hairline bg-paper"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-body text-[13px] font-semibold text-ink flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{e.name}</span>
                    {e.status === "inactive" && (
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 tracking-wide">
                        {t("employees.statusInactive")}
                      </span>
                    )}
                  </div>
                  {thisMonthStatus[e.id] && (
                    <PaymentStatusBadge
                      accrued={thisMonthStatus[e.id].accrued}
                      paid={thisMonthStatus[e.id].paid}
                      t={t}
                    />
                  )}
                </div>
                <div className="font-mono text-[10.5px] text-steel">
                  {t("employees.monthlySalaryLabel")}: {pkr(e.monthly_salary)}
                </div>
                <div
                  className="mt-1"
                  title={
                    parseFloat(employeeId === e.id && summary ? summary.closing_balance : e.current_balance) < 0
                      ? t("employees.closingBalanceAdvanceNote", {
                          amount: pkr(Math.abs(parseFloat(employeeId === e.id && summary ? summary.closing_balance : e.current_balance))),
                        })
                      : undefined
                  }
                >
                  <BalanceTag amount={employeeId === e.id && summary ? summary.closing_balance : e.current_balance} />
                </div>
              </button>
            ))}
            {!filtered.length && (
              <div className="font-body text-[12.5px] text-steel py-6 text-center">
                {t("employees.noEmployeesYet")}
              </div>
            )}
          </div>
        </Panel>

        {/* Ledger Details */}
        <div>
          {!employeeId && (
            <Panel>
              <div className="font-body text-[13px] text-steel py-10 text-center">
                {t("employees.selectEmployeePrompt")}
              </div>
            </Panel>
          )}

          {employeeId && (
            <div>
              <Panel className="mb-4">
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div>
                    <div className="font-display font-bold text-xl text-ink flex items-center gap-2">
                      {summary?.employee.name}
                      {summary && (
                        <PaymentStatusBadge accrued={summary.total_accrued} paid={summary.total_paid} t={t} />
                      )}
                    </div>
                    <div className="font-mono text-xs text-steel mt-1">
                      {t("employees.monthlySalaryLabel")}: {summary ? pkr(summary.employee.monthly_salary) : "—"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" onClick={openEditSalary}>
                      <Pencil size={14} /> {t("employees.editSalary")}
                    </Button>
                    <Button variant="outline" onClick={handleDeleteEmployee}>
                      <Trash2 size={14} /> {t("deleteEntity.delete")}
                    </Button>
                    <div className="flex gap-1.5 ml-1">
                      <select
                        value={mo}
                        onChange={(e) => setMonth(`${year}-${e.target.value}`)}
                        className={`${inputClass} w-[75px]`}
                      >
                        {monthOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        value={year}
                        onChange={(e) => setMonth(`${e.target.value}-${mo}`)}
                        className={`${inputClass} w-[85px]`}
                      >
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </Panel>

              {loading && (
                <Panel>
                  <div className="font-body text-steel p-6">{t("common.loading")}</div>
                </Panel>
              )}

              {!loading && summary && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    <Panel>
                      <Eyebrow>{t("employees.openingBalance")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.opening_balance)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("employees.totalAccrued")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.total_accrued)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("employees.totalPaid")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-brand-green">{pkr(summary.total_paid)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>{t("employees.closingBalance")}</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink"><BalanceTag amount={summary.closing_balance} /></div>
                      {parseFloat(summary.closing_balance) < 0 && (
                        <div className="mt-1.5 font-body text-[11px] leading-snug text-tealdeep">
                          {t("employees.closingBalanceAdvanceNote", { amount: pkr(Math.abs(parseFloat(summary.closing_balance))) })}
                        </div>
                      )}
                    </Panel>
                  </div>

                  <Panel>
                    <Eyebrow>{t("employees.salaryLedger")}</Eyebrow>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <Th>{t("employees.colDate")}</Th>
                            <Th>{t("employees.colId")}</Th>
                            <Th>{t("employees.colDescription")}</Th>
                            <Th right>{t("employees.colAccrued")}</Th>
                            <Th right>{t("employees.colPaid")}</Th>
                            <Th right>{t("employees.colBalance")}</Th>
                            <Th>{t("employees.colEnteredBy")}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <Td colSpan={5}>{t("employees.openingBalanceRow")}</Td>
                            <Td right mono bold>{pkr(summary.opening_balance)}</Td>
                            <Td>{null}</Td>
                          </tr>
                          {summary.rows.map((r) => (
                            <tr key={r.ref_id}>
                              <Td mono>{fmtTime(r.date)}</Td>
                              <Td mono>{r.display_id}</Td>
                              <Td>{r.description}</Td>
                              <Td right mono>{parseFloat(r.accrued_amount) ? pkr(r.accrued_amount) : "—"}</Td>
                              <Td right mono color="#1E8A5F">{parseFloat(r.paid_amount) ? pkr(r.paid_amount) : "—"}</Td>
                              <Td right mono bold>
                                <BalanceTag amount={r.running_balance} />
                              </Td>
                              <Td mono>{r.entered_by || "—"}</Td>
                            </tr>
                          ))}
                          {!summary.rows.length && (
                            <tr>
                              <td colSpan={7} className="text-steel font-body text-[13px] py-4 text-center">
                                {t("employees.noTransactionsThisMonth")}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showEditSalary && summary && (
        <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl px-6 py-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <div className="font-display font-bold text-[16px] text-ink">{t("employees.editSalary")}</div>
              <button onClick={() => setShowEditSalary(false)} className="bg-transparent border-none cursor-pointer">
                <X size={16} className="text-steel" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <Field label={t("employees.monthlySalaryLabel")}>
                <input
                  type="number"
                  min="0"
                  value={editSalaryValue}
                  onChange={(e) => setEditSalaryValue(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label={t("employees.statusLabel")}>
                <select
                  value={editStatusValue}
                  onChange={(e) => setEditStatusValue(e.target.value as "active" | "inactive")}
                  className={inputClass}
                >
                  <option value="active">{t("employees.statusActive")}</option>
                  <option value="inactive">{t("employees.statusInactive")}</option>
                </select>
              </Field>
            </div>
            {editSalaryError && (
              <div className="mt-3 font-body text-xs text-brand-red">{editSalaryError}</div>
            )}
            <div className="mt-4">
              <Button variant="primary" onClick={saveEditSalary} disabled={saving || parseFloat(editSalaryValue) <= 0}>
                <Check size={14} /> {saving ? t("unifiedSale.saving") : t("employees.saveEmployee")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <AuthGate>
      <EmployeesBody />
    </AuthGate>
  );
}
