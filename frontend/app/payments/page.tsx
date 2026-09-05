"use client";

import { useEffect, useState, useMemo } from "react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, inputClass, Button, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString, resolveAccountLabel } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { bucketBalance } from "@/lib/accounts";
import { Building2, Wallet, XCircle, Search, ShieldCheck, Home, DollarSign, Link2, Plus, CalendarDays } from "lucide-react";
import PaymentReceiptModal from "@/components/PaymentReceiptModal";
import type { Customer, Company, PaymentAccount, Payment, UnifiedSaleBatch, DestinationType } from "@/lib/types";

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month"/"this year" defaults match the Karachi calendar — same
// helper every other filtered page (Dashboard, Expenses) defines locally.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}
function currentYear() {
  return todayLocalInput().slice(0, 4);
}

// Same day/month/year/all filter convention as app/expenses/page.tsx —
// reused rather than inventing a new filter UI for this page.
type DateFilterType = "all" | "day" | "month" | "year";

type RegisterRow = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  amount: string;
  destination_type: DestinationType | null;
  target_plant_id: string | null;
  account_id: string | null;
  reference_no: string | null;
  notes: string | null;
  source: "receipt" | "unified_sale";
};

function PaymentsBody() {
  const { user } = useAuth();

  // Data Sources
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [unifiedSales, setUnifiedSales] = useState<UnifiedSaleBatch[]>([]);

  // Modal Visibility State
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRoute, setFilterRoute] = useState<string>("all");
  // Defaults to "month" (current month) — the register previously showed
  // every payment ever recorded mixed together with no date scoping at all.
  const [dateFilterType, setDateFilterType] = useState<DateFilterType>("month");
  const [dateFilterDay, setDateFilterDay] = useState(todayLocalInput());
  const [dateFilterMonth, setDateFilterMonth] = useState(currentMonth());
  const [dateFilterYear, setDateFilterYear] = useState(currentYear());

  const [error, setError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [cList, compList, accList, payList, unifiedList] = await Promise.all([
        api.customers.list(),
        api.companies.list(),
        api.paymentAccounts.list(),
        api.paymentReceipts.list(),
        api.unifiedSale.list(),
      ]);
      setCustomers(cList);
      setCompanies(compList);
      setAccounts(accList);
      setPayments(payList);
      setUnifiedSales(unifiedList.filter((b) => b.status === "approved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payment register data.");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCancelPayment = async (id: string) => {
    if (!user || actionBusyId) return;
    if (!window.confirm("Are you sure you want to cancel this payment?")) return;
    setActionBusyId(id);
    try {
      await api.paymentReceipts.cancel(id, user.name);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to cancel payment.");
    } finally {
      setActionBusyId(null);
    }
  };

  const registerRows = useMemo<RegisterRow[]>(() => {
    const receiptRows: RegisterRow[] = payments
      .filter((p) => p.status !== "cancelled")
      .map((p) => {
        const gross = parseFloat(p.amount) || 0;
        const net = p.net_settlement_amount != null ? parseFloat(p.net_settlement_amount) : gross;
        const hasDeduction = Math.abs(net - gross) > 0.01;
        return {
          id: p.id,
          display_id: p.display_id,
          date: p.date,
          customer_id: p.customer_id,
          amount: p.net_settlement_amount ?? p.amount,
          destination_type: p.destination_type ?? null,
          target_plant_id: p.target_plant_id ?? null,
          account_id: p.account_category ?? p.account_id ?? null,
          reference_no: p.reference_no,
          notes: hasDeduction
            ? `${p.notes ? p.notes + " · " : ""}gross ${pkr(gross)}`
            : p.notes,
          source: "receipt" as const,
        };
      });

    const unifiedRows: RegisterRow[] = unifiedSales.map((b) => {
      const gross = parseFloat(b.total_credit_received) || 0;
      const net = parseFloat(b.net_plant_payment) || 0;
      const hasDeduction = Math.abs(net - gross) > 0.01;
      return {
        id: b.id,
        display_id: b.display_id,
        date: b.approved_at || b.date,
        customer_id: b.customer_id,
        amount: b.net_plant_payment,
        destination_type: b.destination_type ?? null,
        target_plant_id: b.target_plant_id ?? null,
        account_id: b.account_id ?? null,
        reference_no: null,
        notes: `Unified Sale settlement · ${b.display_id}${hasDeduction ? ` · gross ${pkr(gross)}` : ""}`,
        source: "unified_sale" as const,
      };
    });

    return [...receiptRows, ...unifiedRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [payments, unifiedSales]);

  const filteredRegister = useMemo(() => {
    return registerRows.filter((row) => {
      // Asia/Karachi calendar date, not the viewer's own local date — see
      // toKarachiDateString (§ Day-wise Date Filtering Mismatch). Same
      // day/month/year scoping as app/expenses/page.tsx.
      let matchesDate = true;
      if (dateFilterType !== "all") {
        const rowDay = toKarachiDateString(row.date);
        if (!rowDay) {
          matchesDate = false;
        } else if (dateFilterType === "day") {
          matchesDate = rowDay === dateFilterDay;
        } else if (dateFilterType === "month") {
          matchesDate = rowDay.slice(0, 7) === dateFilterMonth;
        } else if (dateFilterType === "year") {
          matchesDate = rowDay.slice(0, 4) === dateFilterYear;
        }
      }

      const cust = customers.find((c) => c.id === row.customer_id);
      const matchesSearch =
        !searchQuery.trim() ||
        cust?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cust?.display_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.display_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.reference_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.notes?.toLowerCase().includes(searchQuery.toLowerCase());

      const isPlant = row.destination_type === "plant" || !!row.target_plant_id;

      let matchesRoute = true;
      if (filterRoute === "plant") {
        matchesRoute = isPlant;
      } else if (filterRoute === "dowa") {
        matchesRoute = !isPlant && row.account_id === "dowa_account";
      } else if (filterRoute === "owner_home") {
        matchesRoute = !isPlant && (row.account_id === "owner_home" || row.account_id === "cash");
      } else if (filterRoute === "office_cash") {
        matchesRoute = !isPlant && row.account_id === "office_cash";
      }

      return matchesDate && matchesSearch && matchesRoute;
    });
  }, [registerRows, customers, searchQuery, filterRoute, dateFilterType, dateFilterDay, dateFilterMonth, dateFilterYear]);

  // KPI cards reflect the active date scope (matches expenses.tsx's
  // filteredTotal convention) — otherwise a scoped table next to unscoped
  // headline totals would be its own "mixed together" confusion.
  const kpis = useMemo(() => {
    let totalCollections = 0;
    let plantSettlements = 0;

    filteredRegister.forEach((row) => {
      const amt = parseFloat(row.amount) || 0;
      totalCollections += amt;
      if (row.destination_type === "plant" || row.target_plant_id) {
        plantSettlements += amt;
      }
    });

    return { totalCollections, plantSettlements };
  }, [filteredRegister]);

  const resolveRouteBadge = (row: RegisterRow) => {
    if (row.destination_type === "plant" || row.target_plant_id) {
      const plant = companies.find((c) => c.id === row.target_plant_id);
      return { label: plant ? `Plant: ${plant.name}` : "Plant Settlement", color: "bg-teal/10 text-teal border-teal/30" };
    }
    if (row.account_id === "dowa_account") return { label: "Dowa Account", color: "bg-blue-50 text-blue-700 border-blue-200" };
    if (row.account_id === "owner_home" || row.account_id === "cash") {
      return { label: "Owner Home", color: "bg-purple-50 text-purple-700 border-purple-200" };
    }
    if (row.account_id === "office_cash") return { label: "Office Cash", color: "bg-amber-50 text-amber-700 border-amber-200" };

    return { label: resolveAccountLabel(row.account_id, accounts), color: "bg-slate-50 text-slate-700 border-slate-200" };
  };

  return (
    <div className="max-w-[1700px] mx-auto w-full space-y-6 px-4 sm:px-6">
      <PageHeader
        eyebrow="Financial Audit"
        title="Payment Register & Audit Log"
        caption="Track customer collections, deduct home expenses or owner drawings, and route remaining balances to Plants, Dowa Account, Owner Home, or Office Cash."
      />

      {/* TOP KPI SUMMARY CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
        <div className="p-4 bg-panel border border-hairline rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-steel mb-1">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider">Total Collections</span>
            <DollarSign size={14} />
          </div>
          <div className="font-mono text-xl font-bold text-ink">{pkr(kpis.totalCollections)}</div>
        </div>

        <div className="p-4 bg-panel border border-hairline rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-teal mb-1">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider">Plant Settlements</span>
            <Building2 size={14} />
          </div>
          <div className="font-mono text-xl font-bold text-teal">{pkr(kpis.plantSettlements)}</div>
        </div>

        <div className="p-4 bg-panel border border-hairline rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-blue-600 mb-1">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider">Dowa Account</span>
            <ShieldCheck size={14} />
          </div>
          <div className="font-mono text-xl font-bold text-blue-600">{pkr(bucketBalance(accounts, "dowa_account"))}</div>
        </div>

        <div className="p-4 bg-panel border border-hairline rounded-xl shadow-xs">
          <div className="flex justify-between items-center text-amber-600 mb-1">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider">Office Cash</span>
            <Wallet size={14} />
          </div>
          <div className="font-mono text-xl font-bold text-amber-600">{pkr(bucketBalance(accounts, "office_cash"))}</div>
        </div>

        <div className="p-4 bg-panel border border-hairline rounded-xl shadow-xs col-span-2 md:col-span-1">
          <div className="flex justify-between items-center text-purple-600 mb-1">
            <span className="font-mono text-[10px] uppercase font-bold tracking-wider">Owner Home</span>
            <Home size={14} />
          </div>
          <div className="font-mono text-xl font-bold text-purple-600">{pkr(bucketBalance(accounts, "owner_home"))}</div>
        </div>
      </div>

      {/* REGISTER LOG HEADER & ACTION BUTTON */}
      <div className="w-full space-y-4">
        <Panel>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <div>
              <Eyebrow>Payment Register Log</Eyebrow>
              <SectionCaption>Audited records of customer collections & deductions.</SectionCaption>
            </div>

            {/* FILTERING BAR & OPEN FORM BUTTON */}
            <div className="flex flex-wrap gap-2 w-full sm:w-auto items-center">
<Button variant="primary" onClick={() => setIsFormOpen(true)}>
  <Plus size={14} /> Receive Payment
</Button>
              <div className="relative flex-1 sm:w-64">
                <Search size={13} className="absolute left-2.5 top-2.5 text-steel" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search payments..."
                  className={`${inputClass} pl-8 py-1.5 text-xs`}
                />
              </div>
              <select
                value={filterRoute}
                onChange={(e) => setFilterRoute(e.target.value)}
                className={`${inputClass} py-1.5 text-xs sm:w-40`}
              >
                <option value="all">All Routes</option>
                <option value="plant">Plant Settlements</option>
                <option value="dowa">Dowa Account</option>
                <option value="office_cash">Office Cash</option>
                <option value="owner_home">Owner Home</option>
              </select>
            </div>
          </div>

          {/* DATE SCOPE FILTER — same day/month/year/all convention as
              app/expenses/page.tsx, reused rather than a page-specific UI. */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-4 gap-1.5 sm:w-auto sm:flex">
              {(["all", "day", "month", "year"] as DateFilterType[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setDateFilterType(opt)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    dateFilterType === opt
                      ? "border-ink bg-ink text-white"
                      : "border-hairline bg-paper text-ink hover:bg-paper/70"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>

            {dateFilterType !== "all" && (
              <div className="flex items-center gap-2 rounded-lg border border-hairline bg-paper/60 px-2.5 py-1.5">
                <CalendarDays size={13} className="text-steel shrink-0" />
                {dateFilterType === "day" && (
                  <input
                    type="date"
                    value={dateFilterDay}
                    onChange={(e) => setDateFilterDay(e.target.value)}
                    className={`${inputClass} py-1 text-xs`}
                  />
                )}
                {dateFilterType === "month" && (
                  <input
                    type="month"
                    value={dateFilterMonth}
                    onChange={(e) => setDateFilterMonth(e.target.value)}
                    className={`${inputClass} py-1 text-xs`}
                  />
                )}
                {dateFilterType === "year" && (
                  <select
                    value={dateFilterYear}
                    onChange={(e) => setDateFilterYear(e.target.value)}
                    className={`${inputClass} py-1 text-xs`}
                  >
                    {Array.from({ length: new Date().getFullYear() - 2020 + 1 }, (_, i) => String(new Date().getFullYear() - i)).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <Th>DATE</Th>
                  <Th>CUSTOMER</Th>
                  <Th right>RECEIVED</Th>
                  <Th>SETTLEMENT ROUTE</Th>
                  <Th>REMARKS / REF</Th>
                  <Th right>ACTION</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredRegister.map((row) => {
                  const cust = customers.find((c) => c.id === row.customer_id);
                  const routeBadge = resolveRouteBadge(row);
                  const isBusy = actionBusyId === row.id;

                  return (
                    <tr key={row.id} className="hover:bg-paper/60 transition-colors">
                      <Td color="#8E8E93" mono>{fmtTime(row.date)}</Td>
                      <Td bold>
                        <div>{cust?.name || "—"}</div>
                        <div className="text-[10px] text-steel font-mono">{cust?.display_id}</div>
                      </Td>
                      <Td right mono bold color="#0F8B8D">
                        {pkr(row.amount)}
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${routeBadge.color}`}
                        >
                          {routeBadge.label}
                        </span>
                      </Td>
                      <Td color="#8E8E93">
                        <div className="text-[10px] font-mono text-steel/70">{row.display_id}</div>
                        <div className="text-xs">{row.reference_no || row.notes || "—"}</div>
                      </Td>
                      <Td right>
                        {row.source === "receipt" ? (
                          <button
                            title="Cancel Receipt"
                            disabled={isBusy}
                            onClick={() => handleCancelPayment(row.id)}
                            className="p-1 text-steel hover:text-brand-red transition-colors"
                          >
                            <XCircle size={15} />
                          </button>
                        ) : (
                          <span title="Approved via Unified Sale — manage it from that page" className="inline-flex items-center gap-1 text-[10px] font-mono text-steel/60">
                            <Link2 size={12} /> Unified Sale
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
                {!filteredRegister.length && (
                  <tr>
                    <td colSpan={6} className="text-steel font-body text-[13px] py-8 text-center">
                      No payments found for the selected criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <PaymentReceiptModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={loadData}
      />
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <AuthGate>
      <PaymentsBody />
    </AuthGate>
  );
}