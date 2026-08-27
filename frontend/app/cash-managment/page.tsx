"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Home, Landmark, ArrowRightLeft, Building2, Send, Users, X, Calendar, Banknote } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Field, inputClass, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { BUCKET_ACCOUNTS, findBucketAccount, type BucketType } from "@/lib/accounts";
import type { PaymentAccount, Company, OwnerDrawing, OwnerCapital, UnifiedSaleBatch, Customer } from "@/lib/types";

type DateFilter = "all" | "today" | "monthly" | "yearly" | "custom";

const BUCKET_ICONS: Record<BucketType, typeof Wallet> = {
  office_cash: Wallet,
  owner_home: Home,
  dowa_account: Landmark,
};

function CashManagementBody() {
  const { user } = useAuth();
  const enteredBy = user?.name || "System";

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ownerDrawings, setOwnerDrawings] = useState<OwnerDrawing[]>([]);
  const [ownerCapital, setOwnerCapital] = useState<OwnerCapital[]>([]);
  const [unifiedSales, setUnifiedSales] = useState<UnifiedSaleBatch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Time filter state for Owner Drawings
  const [drawingFilter, setDrawingFilter] = useState<DateFilter>("all");
  const [customDate, setCustomDate] = useState<string>("");

  // Modal visibility states
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isPlantPaymentOpen, setIsPlantPaymentOpen] = useState(false);

  // Transfer Money form state
  const [transferFrom, setTransferFrom] = useState<BucketType>("office_cash");
  const [transferTo, setTransferTo] = useState<BucketType>("dowa_account");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Pay Plant form state
  const [plantSource, setPlantSource] = useState<Extract<BucketType, "office_cash" | "dowa_account">>("office_cash");
  const [plantId, setPlantId] = useState("");
  const [plantAmount, setPlantAmount] = useState("");
  const [plantSaving, setPlantSaving] = useState(false);
  const [plantError, setPlantError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      let [accList, compList, drawList, capList, usList, custList] = await Promise.all([
        api.paymentAccounts.list(),
        api.companies.list(),
        api.ownerDrawings.list(),
        api.ownerCapital.list({ destination_type: "account" }),
        api.unifiedSale.list(),
        api.customers.list(),
      ]);

      const missing = BUCKET_ACCOUNTS.filter((b) => !findBucketAccount(accList, b.type));
      if (missing.length > 0) {
        for (const b of missing) {
          try {
            await api.paymentAccounts.create(b.label, "cash", 0, b.type);
          } catch {
            // Ignore race conditions
          }
        }
        accList = await api.paymentAccounts.list();
      }

      // Sort Owner Drawings: Latest First (Newest at top)
      drawList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setAccounts(accList);
      setCompanies(compList);
      setOwnerDrawings(drawList);
      setOwnerCapital(capList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setUnifiedSales(usList);
      setCustomers(custList);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load cash management data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const balanceOf = (type: BucketType) => {
    const acc = findBucketAccount(accounts, type);
    return acc ? parseFloat(acc.current_balance) : 0;
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);

    if (transferFrom === transferTo) {
      setTransferError("Source and destination accounts must be different.");
      return;
    }
    const amt = Number(transferAmount);
    if (!transferAmount || !(amt > 0)) {
      setTransferError("Enter a positive amount.");
      return;
    }
    const fromAccount = findBucketAccount(accounts, transferFrom);
    const toAccount = findBucketAccount(accounts, transferTo);
    if (!fromAccount || !toAccount) {
      setTransferError("Accounts are still being set up — please retry in a moment.");
      return;
    }
    if (amt > parseFloat(fromAccount.current_balance)) {
      setTransferError("Amount exceeds the available balance in the source account.");
      return;
    }

    setTransferSaving(true);
    try {
      await api.paymentAccounts.transfer({
        from_account_id: fromAccount.id,
        to_account_id: toAccount.id,
        amount: amt,
        notes: "Cash Management — internal transfer",
        entered_by: enteredBy,
      });
      setTransferAmount("");
      setIsTransferOpen(false);
      await loadData();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setTransferSaving(false);
    }
  };

  const handlePlantPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlantError(null);

    if (!plantId) {
      setPlantError("Select a plant.");
      return;
    }
    const amt = Number(plantAmount);
    if (!plantAmount || !(amt > 0)) {
      setPlantError("Enter a positive amount.");
      return;
    }
    const sourceAccount = findBucketAccount(accounts, plantSource);
    if (!sourceAccount) {
      setPlantError("Source account is still being set up — please retry in a moment.");
      return;
    }
    if (amt > parseFloat(sourceAccount.current_balance)) {
      setPlantError("Amount exceeds the available balance in the source account.");
      return;
    }

    setPlantSaving(true);
    try {
      await api.companyPayments.create({
        date: new Date().toISOString(),
        company_id: plantId,
        amount: amt,
        method: "cash",
        account_id: sourceAccount.id,
        notes: "Cash Management — plant payment",
        entered_by: enteredBy,
      });
      setPlantAmount("");
      setIsPlantPaymentOpen(false);
      await loadData();
    } catch (err) {
      setPlantError(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setPlantSaving(false);
    }
  };

  // Filtered Owner Drawings based on selected timeframe or custom date.
  // Compares Asia/Karachi calendar dates, not the viewer's own local date —
  // `new Date(d.date)` misparses a marker-less backend timestamp as local
  // time instead of UTC (§ Day-wise Date Filtering Mismatch).
  const filteredOwnerDrawings = useMemo(() => {
    const today = todayLocalInput();
    return ownerDrawings
      .filter((d) => {
        const day = toKarachiDateString(d.date);
        if (!day) return false;

        if (drawingFilter === "today") {
          return day === today;
        }
        if (drawingFilter === "monthly") {
          return day.slice(0, 7) === today.slice(0, 7);
        }
        if (drawingFilter === "yearly") {
          return day.slice(0, 4) === today.slice(0, 4);
        }
        if (drawingFilter === "custom" && customDate) {
          return day === customDate;
        }
        return true; // "all"
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Latest First
  }, [ownerDrawings, drawingFilter, customDate]);

  const totalOwnerDrawings = useMemo(
    () => filteredOwnerDrawings.reduce((sum, d) => sum + parseFloat(d.amount || "0"), 0),
    [filteredOwnerDrawings]
  );

  const drawingRows = useMemo(() => {
    return filteredOwnerDrawings
      .filter((d) => d.unified_sale_id)
      .map((d) => {
        const batch = unifiedSales.find((b) => b.id === d.unified_sale_id);
        const customer = batch ? customers.find((c) => c.id === batch.customer_id) : undefined;
        return {
          id: d.id,
          customerName: customer?.name || "—",
          saleId: batch?.display_id || d.display_id,
          date: d.date,
          sourceAccount: d.account_id
            ? accounts.find((a) => a.id === d.account_id)?.name || "—"
            : "Customer Payment (Direct)",
          amount: parseFloat(d.amount || "0"),
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Ensures Latest First
  }, [filteredOwnerDrawings, unifiedSales, customers, accounts]);

  return (
    <div className="max-w-[1400px] mx-auto w-full space-y-6 px-4 sm:px-6 py-4">
      <PageHeader
        eyebrow="LIQUIDITY & TREASURY"
        title="Cash Management"
        caption="Live balances across Office Cash, Home Cash, and the Dowa Account — move money between them, pay plants, and audit owner drawings."
      />

      {loadError && (
        <div className="px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-xs font-medium">
          {loadError}
        </div>
      )}

      {/* TOP SECTION: OWNER DRAWINGS KPI & FILTER CONTROLS */}
      <div className="p-5 bg-white border border-slate-200/80 rounded-xl shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[#A8D0CD]/30 text-[#2B5854]">
              <Users size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Owner Drawings</h2>
              <p className="text-xs text-slate-400">Filter and track drawing amounts by timeframe</p>
            </div>
          </div>

          {/* Timeframe & Calendar Picker Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
              {(["today", "monthly", "yearly", "all"] as DateFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setDrawingFilter(f);
                    setCustomDate("");
                  }}
                  className={`px-3 py-1.5 rounded-md capitalize transition-all cursor-pointer ${
                    drawingFilter === f
                      ? "bg-[#A8D0CD] text-[#1E403C] shadow-xs font-bold"
                      : "hover:text-slate-900"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Custom Date Input */}
            <div className="relative flex items-center">
              <Calendar size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setDrawingFilter(e.target.value ? "custom" : "all");
                }}
                className={`pl-8 pr-2 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 border transition-all cursor-pointer focus:outline-none focus:bg-white focus:border-[#A8D0CD] ${
                  drawingFilter === "custom"
                    ? "border-[#A8D0CD] bg-[#A8D0CD] text-[#1E403C] font-bold shadow-xs"
                    : "border-transparent"
                }`}
              />
            </div>
          </div>
        </div>

        <div>
          <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-slate-400">
            Total Drawn ({drawingFilter === "custom" && customDate ? customDate : drawingFilter})
          </span>
          <div className="font-mono text-3xl font-bold text-slate-900">
            {loading ? "—" : pkr(totalOwnerDrawings)}
          </div>
        </div>
      </div>

      {/* LIQUIDITY KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {BUCKET_ACCOUNTS.map(({ type, label }) => {
          const Icon = BUCKET_ICONS[type];
          return (
            <div
              key={type}
              className="p-4 bg-white border border-slate-200/80 rounded-xl shadow-xs transition-all hover:border-[#A8D0CD]"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-slate-500">
                  {label}
                </span>
                <div className="p-1.5 rounded-md bg-[#A8D0CD]/30 text-[#2B5854]">
                  <Icon size={16} />
                </div>
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900">
                {loading ? "—" : pkr(balanceOf(type))}
              </div>
            </div>
          );
        })}
      </div>

      {/* CLICKABLE ACTION BOXES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* TRANSFER MONEY CARD */}
        <button
          type="button"
          onClick={() => setIsTransferOpen(true)}
          className="group text-left p-5 bg-white border border-slate-200 rounded-xl shadow-xs transition-all hover:border-[#A8D0CD] hover:shadow-md cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-[#A8D0CD]/30 text-[#2B5854] group-hover:bg-[#A8D0CD] group-hover:text-[#1E403C] transition-colors">
              <ArrowRightLeft size={22} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 group-hover:text-[#2B5854] transition-colors">
                Transfer Money
              </h3>
              <p className="text-xs text-slate-500">Click to transfer cash between accounts</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-100 text-slate-700 group-hover:bg-[#A8D0CD] group-hover:text-[#1E403C] transition-colors">
            Open
          </span>
        </button>

        {/* PAY PLANT CARD */}
        <button
          type="button"
          onClick={() => setIsPlantPaymentOpen(true)}
          className="group text-left p-5 bg-white border border-slate-200 rounded-xl shadow-xs transition-all hover:border-[#A8D0CD] hover:shadow-md cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-[#A8D0CD]/30 text-[#2B5854] group-hover:bg-[#A8D0CD] group-hover:text-[#1E403C] transition-colors">
              <Building2 size={22} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 group-hover:text-[#2B5854] transition-colors">
                Pay Plant
              </h3>
              <p className="text-xs text-slate-500">Click to record a payment to a plant supplier</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-100 text-slate-700 group-hover:bg-[#A8D0CD] group-hover:text-[#1E403C] transition-colors">
            Open
          </span>
        </button>
      </div>

      {/* OWNER DRAWINGS AUDIT TABLE */}
      <Panel>
        <Eyebrow>
          Owner Drawings Audit Ledger (
          {drawingFilter === "custom" && customDate ? customDate : drawingFilter})
        </Eyebrow>

        <div className="overflow-x-auto mt-3">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <Th>Customer Name</Th>
                <Th>Sale ID</Th>
                <Th>Date</Th>
                <Th>Source Account</Th>
                <Th right>Amount Drawn</Th>
              </tr>
            </thead>
            <tbody>
              {drawingRows.length === 0 ? (
                <tr>
                  <Td colSpan={5} center color="#8E8E93">
                    {loading ? "Loading…" : "No owner drawings recorded for the selected filter."}
                  </Td>
                </tr>
              ) : (
                drawingRows.map((row) => (
                  <tr key={row.id}>
                    <Td bold>
                      <span className="text-slate-900">{row.customerName}</span>
                    </Td>
                    <Td mono color="#2B5854" bold>
                      {row.saleId}
                    </Td>
                    <Td color="#64748B" mono>
                      {fmtTime(row.date)}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {row.sourceAccount}
                      </span>
                    </Td>
                    <Td right mono bold color="#2B5854">
                      {pkr(row.amount)}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* OWNER CAPITAL INFLOW AUDIT TABLE */}
      <Panel>
        <Eyebrow>Owner Capital Inflow (Re-Investment — Deposit to Account)</Eyebrow>
        <div className="overflow-x-auto mt-3">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <Th>ID</Th>
                <Th>Date</Th>
                <Th>Account</Th>
                <Th>Source</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {ownerCapital.length === 0 ? (
                <tr>
                  <Td colSpan={5} center color="#8E8E93">
                    {loading ? "Loading…" : "No Owner Capital deposits recorded yet."}
                  </Td>
                </tr>
              ) : (
                ownerCapital.map((c) => (
                  <tr key={c.id}>
                    <Td mono color="#2B5854" bold>
                      {c.display_id}
                    </Td>
                    <Td color="#64748B" mono>
                      {fmtTime(c.date)}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {accounts.find((a) => a.id === c.account_id)?.name || "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#E4F3F3] text-tealdeep border border-[#A8D0CD]">
                        <Banknote size={11} /> Owner Capital Inflow
                      </span>
                    </Td>
                    <Td right mono bold color="#2B5854">
                      {pkr(c.amount)}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* MODAL 1: TRANSFER MONEY */}
      {isTransferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#2B5854]">
                <ArrowRightLeft size={16} /> Internal Money Transfer
              </span>
              <button
                type="button"
                onClick={() => setIsTransferOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleTransfer} className="space-y-3.5">
              <Field label="From Account">
                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value as BucketType)}
                  className={inputClass}
                >
                  {BUCKET_ACCOUNTS.map((b) => (
                    <option key={b.type} value={b.type}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="To Account">
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value as BucketType)}
                  className={inputClass}
                >
                  {BUCKET_ACCOUNTS.map((b) => (
                    <option key={b.type} value={b.type}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Amount (PKR)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="e.g. 50000"
                  className={inputClass}
                />
              </Field>

              {transferError && (
                <div className="text-xs font-medium text-red-500 bg-red-50 p-2 rounded-md border border-red-100">
                  {transferError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTransferOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferSaving || loading}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#1E403C] bg-[#A8D0CD] hover:bg-[#92C2BE] rounded-lg shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send size={14} />
                  {transferSaving ? "Transferring…" : "Execute Transfer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: PAY PLANT */}
      {isPlantPaymentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#2B5854]">
                <Building2 size={16} /> Plant Supplier Payment
              </span>
              <button
                type="button"
                onClick={() => setIsPlantPaymentOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePlantPayment} className="space-y-3.5">
              <Field label="Source Account">
                <select
                  value={plantSource}
                  onChange={(e) =>
                    setPlantSource(e.target.value as Extract<BucketType, "office_cash" | "dowa_account">)
                  }
                  className={inputClass}
                >
                  <option value="office_cash">Office Cash</option>
                  <option value="dowa_account">Dowa Account</option>
                </select>
              </Field>

              <Field label="Plant">
                <select value={plantId} onChange={(e) => setPlantId(e.target.value)} className={inputClass}>
                  <option value="">Select plant</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Amount (PKR)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={plantAmount}
                  onChange={(e) => setPlantAmount(e.target.value)}
                  placeholder="e.g. 100000"
                  className={inputClass}
                />
              </Field>

              {plantError && (
                <div className="text-xs font-medium text-red-500 bg-red-50 p-2 rounded-md border border-red-100">
                  {plantError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPlantPaymentOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={plantSaving || loading}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#1E403C] bg-[#A8D0CD] hover:bg-[#92C2BE] rounded-lg shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send size={14} />
                  {plantSaving ? "Paying…" : "Pay Plant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CashManagementPage() {
  return (
    <AuthGate>
      <CashManagementBody />
    </AuthGate>
  );
}