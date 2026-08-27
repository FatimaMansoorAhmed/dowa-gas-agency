"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Wallet, Home, Landmark, Building2, Check, X } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { BUCKET_ACCOUNTS, findBucketAccount, type BucketType } from "@/lib/accounts";
import type { Company, OwnerCapital, OwnerCapitalDestination, PaymentAccount } from "@/lib/types";

const BUCKET_ICONS: Record<BucketType, typeof Wallet> = {
  office_cash: Wallet,
  owner_home: Home,
  dowa_account: Landmark,
};

function OwnerCapitalBody() {
  const { user } = useAuth();
  const enteredBy = user?.name || "System";

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [entries, setEntries] = useState<OwnerCapital[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [destinationType, setDestinationType] = useState<OwnerCapitalDestination>("account");
  const [bucketType, setBucketType] = useState<BucketType>("office_cash");
  const [plantId, setPlantId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocalInput());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      let [accList, compList, capList] = await Promise.all([
        api.paymentAccounts.list(),
        api.companies.list(),
        api.ownerCapital.list(),
      ]);

      const missing = BUCKET_ACCOUNTS.filter((b) => !findBucketAccount(accList, b.type));
      if (missing.length > 0) {
        for (const b of missing) {
          try {
            await api.paymentAccounts.create(b.label, "cash", 0, b.type);
          } catch {
            // Ignore race conditions — another request may have created it first.
          }
        }
        accList = await api.paymentAccounts.list();
      }

      setAccounts(accList);
      setCompanies(compList);
      setEntries(capList);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load Owner Capital data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalInjected = useMemo(
    () => entries.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [entries]
  );
  const totalToAccounts = useMemo(
    () =>
      entries
        .filter((e) => e.destination_type === "account")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [entries]
  );
  const totalToPlants = useMemo(
    () =>
      entries
        .filter((e) => e.destination_type === "plant")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [entries]
  );

  const targetLabel = (e: OwnerCapital) => {
    if (e.destination_type === "account") {
      const account = accounts.find((a) => a.id === e.account_id);
      return account?.name || "Account";
    }
    const company = companies.find((c) => c.id === e.target_plant_id);
    return company ? `${company.name} (Plant)` : "Plant";
  };

  const canSubmit =
    date &&
    Number(amount) > 0 &&
    (destinationType === "account" ? !!bucketType : !!plantId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const amt = Number(amount);
    if (!amount || !(amt > 0)) {
      setFormError("Enter an amount greater than 0.");
      return;
    }
    if (destinationType === "plant" && !plantId) {
      setFormError("Select a plant to pay.");
      return;
    }

    setSaving(true);
    try {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const localISO = new Date(`${date}T${hh}:${mm}:${ss}`).toISOString();

      await api.ownerCapital.create({
        date: localISO,
        amount: amt,
        destination_type: destinationType,
        account_id: destinationType === "account" ? bucketType : undefined,
        target_plant_id: destinationType === "plant" ? plantId : undefined,
        notes: notes || undefined,
        entered_by: enteredBy,
      });

      setAmount("");
      setNotes("");
      setToast("Owner Capital recorded.");
      await load();
      setTimeout(() => setToast(null), 2200);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this Owner Capital entry? This reverses its effect on the account or plant payable.")) return;
    try {
      await api.ownerCapital.cancel(id, enteredBy);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not cancel this entry.");
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto w-full space-y-6">
      <PageHeader
        eyebrow="OWNER CAPITAL"
        title="Re-Investment / Owner Capital"
        caption="Record fresh capital the owner injects into the business — deposit it into an account, or apply it directly to settle a plant supplier's payable."
      />

      {loadError && (
        <div className="px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-xs font-medium">
          {loadError}
        </div>
      )}

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-ink rounded-xl shadow-xs">
          <div className="flex justify-between items-center mb-2">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-[#9FD8D8]">
              Total Owner Capital
            </span>
            <Banknote size={16} className="text-[#9FD8D8]" />
          </div>
          <div className="font-mono text-2xl font-bold text-white">{loading ? "—" : pkr(totalInjected)}</div>
        </div>
        <div className="p-4 bg-white border border-slate-200/80 rounded-xl shadow-xs">
          <div className="flex justify-between items-center mb-2">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Deposited to Accounts
            </span>
            <Wallet size={16} className="text-[#2B5854]" />
          </div>
          <div className="font-mono text-2xl font-bold text-slate-900">{loading ? "—" : pkr(totalToAccounts)}</div>
        </div>
        <div className="p-4 bg-white border border-slate-200/80 rounded-xl shadow-xs">
          <div className="flex justify-between items-center mb-2">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Direct Plant Payments
            </span>
            <Building2 size={16} className="text-[#2B5854]" />
          </div>
          <div className="font-mono text-2xl font-bold text-slate-900">{loading ? "—" : pkr(totalToPlants)}</div>
        </div>
      </div>

      {/* FORM */}
      <Panel>
        <Eyebrow>New Re-Investment</Eyebrow>
        <h2 className="font-display text-[18px] font-semibold text-ink mt-1">Inject Owner Capital</h2>
        <SectionCaption>
          Choose one allocation target. A deposit only increases the selected account; a direct plant payment only
          settles that plant's payable — the two never mix.
        </SectionCaption>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Destination toggle */}
          <Field label="Allocation Target">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600 w-fit">
              <button
                type="button"
                onClick={() => setDestinationType("account")}
                className={`px-4 py-2 rounded-md transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                  destinationType === "account" ? "bg-[#A8D0CD] text-[#1E403C] shadow-xs font-bold" : "hover:text-slate-900"
                }`}
              >
                <Wallet size={13} /> Deposit to Account
              </button>
              <button
                type="button"
                onClick={() => setDestinationType("plant")}
                className={`px-4 py-2 rounded-md transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                  destinationType === "plant" ? "bg-[#A8D0CD] text-[#1E403C] shadow-xs font-bold" : "hover:text-slate-900"
                }`}
              >
                <Building2 size={13} /> Direct Plant Payment
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Dynamic target dropdown */}
            {destinationType === "account" ? (
              <Field label="Deposit To">
                <select value={bucketType} onChange={(e) => setBucketType(e.target.value as BucketType)} className={inputClass}>
                  {BUCKET_ACCOUNTS.map((b) => (
                    <option key={b.type} value={b.type}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Plant Supplier">
                <select value={plantId} onChange={(e) => setPlantId(e.target.value)} className={inputClass}>
                  <option value="">Select plant</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Amount (PKR)">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 10000000"
                className={inputClass}
              />
            </Field>

            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>

            <Field label="Notes (optional)">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="e.g. Owner personal funds" />
            </Field>
          </div>

          {destinationType === "plant" && plantId && (
            <div className="px-3 py-2 rounded-md bg-[#FBF3E4] text-[11px] text-[#8A5A00] border border-[#F0DFB8]">
              This amount will settle {companies.find((c) => c.id === plantId)?.name}'s payable directly. No cash
              account (Office Cash / Home Cash / Dowa Account) will be increased.
            </div>
          )}

          {formError && (
            <div className="text-xs font-medium text-red-500 bg-red-50 p-2 rounded-md border border-red-100">{formError}</div>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" variant="teal" disabled={!canSubmit || saving}>
              <Check size={14} /> {saving ? "Saving…" : "Record Owner Capital"}
            </Button>
            {toast && <span className="font-body text-[12.5px] text-brand-green">{toast}</span>}
          </div>
        </form>
      </Panel>

      {/* AUDIT TABLE */}
      <Panel>
        <Eyebrow>Owner Capital / Re-Investment Ledger</Eyebrow>
        <h2 className="font-display text-[18px] font-semibold text-ink mt-1">Audit trail</h2>
        <SectionCaption>
          Every re-investment, its allocation target, and where it posted — deposits show up on the target account's
          Cash Book column as "Owner Capital Inflow"; direct plant payments show on that plant's Settlement Ledger as
          "Owner Capital (Direct)".
        </SectionCaption>

        <div className="overflow-x-auto mt-3">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <Th>ID</Th>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Target</Th>
                <Th right>Amount</Th>
                <Th>Entered By</Th>
                <Th center>Status</Th>
                <Th center>Action</Th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <Td colSpan={8} center color="#8E8E93">
                    {loading ? "Loading…" : "No Owner Capital entries recorded yet."}
                  </Td>
                </tr>
              ) : (
                entries.map((e) => {
                  const linkedAccount = e.account_id ? accounts.find((a) => a.id === e.account_id) : undefined;
                  const bucket = linkedAccount?.account_type as BucketType | undefined;
                  const Icon = e.destination_type === "account" ? BUCKET_ICONS[bucket || "office_cash"] : Building2;
                  return (
                    <tr key={e.id}>
                      <Td mono color="#2B5854" bold>
                        {e.display_id}
                      </Td>
                      <Td color="#64748B" mono>
                        {fmtTime(e.date)}
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                            e.destination_type === "account"
                              ? "bg-[#E4F3F3] text-tealdeep border-[#A8D0CD]"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          <Icon size={11} />
                          {e.destination_type === "account" ? "Deposit to Account" : "Direct Plant Payment"}
                        </span>
                      </Td>
                      <Td>{targetLabel(e)}</Td>
                      <Td right mono bold color="#2B5854">
                        {pkr(e.amount)}
                      </Td>
                      <Td>{e.entered_by}</Td>
                      <Td center>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-medium ${
                            e.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {e.status}
                        </span>
                      </Td>
                      <Td center>
                        {e.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => handleCancel(e.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-600 cursor-pointer"
                          >
                            <X size={12} /> Cancel
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function OwnerCapitalPage() {
  return (
    <AuthGate>
      <OwnerCapitalBody />
    </AuthGate>
  );
}
