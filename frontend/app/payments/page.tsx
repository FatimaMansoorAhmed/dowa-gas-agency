"use client";

import { useEffect, useState, useMemo } from "react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import AmountInput from "@/components/AmountInput";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, resolveAccountLabel } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { findBucketAccount, bucketBalance } from "@/lib/accounts";
import { Building2, Wallet, XCircle, Search, ShieldCheck, Home, DollarSign, Link2, Plus, X } from "lucide-react";
import type { Customer, Company, PaymentAccount, ExpenseCategory, Payment, UnifiedSaleBatch, DestinationType } from "@/lib/types";

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
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [unifiedSales, setUnifiedSales] = useState<UnifiedSaleBatch[]>([]);

  // Modal Visibility State
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRoute, setFilterRoute] = useState<string>("all");

  // Form State
  const [date, setDate] = useState(todayLocalInput());
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [totalCreditReceived, setTotalCreditReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");

  // Deductions
  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseCatId, setHomeExpenseCatId] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");

  // Routing
  const [destinationType, setDestinationType] = useState<DestinationType>("plant");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [specialAccount, setSpecialAccount] = useState<"office_cash" | "owner_home" | "dowa_account" | "bank">("office_cash");
  const [accountId, setAccountId] = useState("");

  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [cList, compList, accList, catList, payList, unifiedList] = await Promise.all([
        api.customers.list(),
        api.companies.list(),
        api.paymentAccounts.list(),
        api.expenseCategories.list(),
        api.paymentReceipts.list(),
        api.unifiedSale.list(),
      ]);
      setCustomers(cList);
      setCompanies(compList);
      setAccounts(accList);
      setExpenseCategories(catList);
      setPayments(payList);
      setUnifiedSales(unifiedList.filter((b) => b.status === "approved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payment register data.");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const filteredCustomers = customers.filter(
    (c) =>
      !customerSearch.trim() ||
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.mobile.includes(customerSearch) ||
      c.display_id.toLowerCase().includes(customerSearch.toLowerCase())
  );

  // Math Calculations
  const grossAmount = parseFloat(totalCreditReceived) || 0;
  const homeExpense = parseFloat(homeExpenseAmount) || 0;
  const ownerDrawings = parseFloat(ownerDrawingsAmount) || 0;
  const netRemaining = Math.max(0, grossAmount - homeExpense - ownerDrawings);

  const canSubmit =
    !!customerId &&
    grossAmount > 0 &&
    !!date &&
    (destinationType === "plant"
      ? !!targetPlantId
      : specialAccount === "bank"
      ? !!accountId
      : true);

  const resetForm = () => {
    setCustomerId("");
    setCustomerSearch("");
    setTotalCreditReceived("");
    setPaymentMethod("cash");
    setHomeExpenseAmount("");
    setHomeExpenseCatId("");
    setOwnerDrawingsAmount("");
    setDestinationType("plant");
    setTargetPlantId("");
    setSpecialAccount("office_cash");
    setAccountId("");
    setReferenceNo("");
    setNotes("");
    setError(null);
    setIsFormOpen(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);

    let finalAccountId = accountId;
    if (destinationType === "account" && specialAccount !== "bank") {
      const bucketAccount = findBucketAccount(accounts, specialAccount);
      finalAccountId = bucketAccount ? bucketAccount.id : specialAccount;
    }

    try {
      await api.paymentReceipts.create({
        date: new Date(date).toISOString(),
        customer_id: customerId,
        amount: grossAmount,
        method: paymentMethod,
        home_expense_amount: homeExpense > 0 ? homeExpense : undefined,
        home_expense_category_id: homeExpense > 0 ? homeExpenseCatId || undefined : undefined,
        owner_drawings_amount: ownerDrawings > 0 ? ownerDrawings : undefined,
        destination_type: destinationType,
        target_plant_id: destinationType === "plant" ? targetPlantId : undefined,
        account_id: destinationType === "account" ? finalAccountId : undefined,
        reference_no: referenceNo || undefined,
        notes: notes || undefined,
        entered_by: user.name,
      });
      resetForm();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  };

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

  const kpis = useMemo(() => {
    let totalCollections = 0;
    let plantSettlements = 0;

    registerRows.forEach((row) => {
      const amt = parseFloat(row.amount) || 0;
      totalCollections += amt;
      if (row.destination_type === "plant" || row.target_plant_id) {
        plantSettlements += amt;
      }
    });

    return { totalCollections, plantSettlements };
  }, [registerRows]);

  const filteredRegister = useMemo(() => {
    return registerRows.filter((row) => {
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

      return matchesSearch && matchesRoute;
    });
  }, [registerRows, customers, searchQuery, filterRoute]);

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

      {/* RECEIVE PAYMENT FORM MODAL OVERLAY */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg my-8">
            <Panel>
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <Eyebrow>Receive Payment</Eyebrow>
                  <button
                    onClick={() => setIsFormOpen(false)}
                    className="p-1 rounded-md text-steel hover:bg-paper transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date">
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Payment Method">
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className={inputClass}>
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="online">Online</option>
                    </select>
                  </Field>
                </div>

                <Field label="Customer">
                  <div className="relative">
                    <input
                      value={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.display_id}` : customerSearch}
                      onChange={(e) => {
                        setCustomerId("");
                        setCustomerSearch(e.target.value);
                      }}
                      placeholder="Search customer name or ID"
                      className={inputClass}
                    />
                    {!customerId && customerSearch.trim() && (
                      <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                        {filteredCustomers.slice(0, 6).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setCustomerId(c.id);
                              setCustomerSearch("");
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-paper font-body text-xs"
                          >
                            <span className="font-semibold text-ink">{c.name}</span> <span className="text-steel">· {c.display_id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>

                <Field label="Total Credit / Payment Received (PKR)">
                  <AmountInput
                    value={totalCreditReceived}
                    onChange={setTotalCreditReceived}
                    placeholder="0"
                    className={`${inputClass} text-base font-mono font-bold text-teal`}
                  />
                </Field>

                {/* DEDUCTIONS SECTION */}
                <div className="p-3.5 bg-paper rounded-lg border border-hairline space-y-3">
                  <div className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">
                    Deductions (Optional)
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Home Expense (PKR)">
                      <AmountInput
                        value={homeExpenseAmount}
                        onChange={setHomeExpenseAmount}
                        placeholder="0"
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Category">
                      <select
                        value={homeExpenseCatId}
                        onChange={(e) => setHomeExpenseCatId(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Select Category</option>
                        {expenseCategories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <Field label="Owner Drawings Amount (PKR)">
                    <AmountInput
                      value={ownerDrawingsAmount}
                      onChange={setOwnerDrawingsAmount}
                      placeholder="0"
                      className={inputClass}
                    />
                  </Field>
                </div>

                {/* FLEXIBLE SETTLEMENT SECTION */}
                <div className="p-3.5 bg-slate-50 rounded-lg border border-hairline space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-[10px] text-steel uppercase font-bold tracking-wider">
                      Route Remaining Balance ({pkr(netRemaining)}) To
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDestinationType("plant")}
                      className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                        destinationType === "plant"
                          ? "bg-teal/10 border-teal text-teal shadow-xs"
                          : "border-hairline bg-white text-steel hover:bg-paper"
                      }`}
                    >
                      <Building2 size={13} /> Plant Settlement
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestinationType("account")}
                      className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                        destinationType === "account"
                          ? "bg-teal/10 border-teal text-teal shadow-xs"
                          : "border-hairline bg-white text-steel hover:bg-paper"
                      }`}
                    >
                      <Wallet size={13} /> Account Deposit
                    </button>
                  </div>

                  {destinationType === "plant" ? (
                    <Field label="Select Plant Ledger">
                      <select value={targetPlantId} onChange={(e) => setTargetPlantId(e.target.value)} className={inputClass}>
                        <option value="">Select Target Plant</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <div className="space-y-2">
                      <Field label="Select Destination Account">
                        <select
                          value={specialAccount}
                          onChange={(e) => setSpecialAccount(e.target.value as typeof specialAccount)}
                          className={inputClass}
                        >
                          <option value="office_cash">Office Cash</option>
                          <option value="owner_home">Owner Home Account</option>
                          <option value="dowa_account">Dowa Account</option>
                          <option value="bank">Specific Bank Account</option>
                        </select>
                      </Field>

                      {specialAccount === "bank" && (
                        <Field label="Target Bank Account">
                          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                            <option value="">Select Bank Account</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({a.kind})
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Reference / Cheque #">
                    <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="Txn #" className={inputClass} />
                  </Field>
                  <Field label="Notes">
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remarks" className={inputClass} />
                  </Field>
                </div>

                {error && <div className="text-xs text-brand-red font-medium">{error}</div>}

                <div className="flex gap-2 justify-end mt-2">
<Button variant="outline" onClick={() => setIsFormOpen(false)}>
  Cancel
</Button>
                  <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
                    {saving ? "Posting Receipt…" : "Post Payment Receipt"}
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
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