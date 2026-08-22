"use client";
import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Check, X, AlertTriangle, CheckCircle2, Pencil, Ban, ThumbsUp, Building2, Wallet } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import NewPlantModal from "@/components/NewPlantModal";
import { api } from "@/lib/api";
import { pkr, fmtTime, ACCOUNT_TYPE_LABELS, resolveAccountLabel } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type {
  Company, Customer, Product, ExpenseCategory, RateEntry, PaymentAccount,
  UnifiedSaleBatch, UnifiedSaleResult, DestinationType, AccountType,
} from "@/lib/types";

const EPSILON = 0.01;

function todayLocalInput() {
  return new Date().toISOString().slice(0, 10);
}

type ItemRow = { qty: string; purchaseRate: string; sellingRate: string };

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-[#FFF6E0] text-[#8A6D00] border-[#F0DFA0]",
  approved: "bg-[#EAF5EF] text-[#1E8A5F] border-[#C7E6D3]",
  cancelled: "bg-[#F1F1F1] text-steel border-hairline",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full border font-mono text-[10px] uppercase font-medium ${STATUS_STYLES[status] || ""}`}>
      {status}
    </span>
  );
}

function UnifiedSaleBody() {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [recent, setRecent] = useState<UnifiedSaleBatch[]>([]);

  const [showNewPlant, setShowNewPlant] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDisplayId, setEditingDisplayId] = useState<string | null>(null);

  const [date, setDate] = useState(todayLocalInput());
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [gatePassNo, setGatePassNo] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<Record<string, ItemRow>>({});

  // Payment Format & Settlement Amounts
  const [totalCreditReceived, setTotalCreditReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "online" | "cheque" | "deposit">("cash");
  const [referenceNo, setReferenceNo] = useState("");

  const [homeExpenseAmount, setHomeExpenseAmount] = useState("");
  const [homeExpenseCategoryId, setHomeExpenseCategoryId] = useState("");
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");

  // Routing State
  const [destinationType, setDestinationType] = useState<DestinationType>("plant");
  const [targetPlantId, setTargetPlantId] = useState("");
  // "account" destination is always one of these 4 fixed buckets — never a
  // dynamically-chosen bank/cash PaymentAccount row.
  const [accountCategory, setAccountCategory] = useState<AccountType>("cash");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UnifiedSaleResult | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<UnifiedSaleResult | null>(null);
  const [loadingTransaction, setLoadingTransaction] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  

  const load = async () => {
    const [c, cu, p, cat, acc, r, ru] = await Promise.all([
      api.companies.list(), api.customers.list(), api.products.list(),
      api.expenseCategories.list(), api.paymentAccounts.list(), api.rates.latest(),
      api.unifiedSale.list(),
    ]);
    setCompanies(c); setCustomers(cu); setProducts(p);
    setCategories(cat); setAccounts(acc); setRates(r); setRecent(ru);
  };
  useEffect(() => { load(); }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const selectedCompany = companies.find((c) => c.id === companyId);

  const filteredCustomers = customers.filter((c) =>
    !customerSearch.trim() ||
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.mobile.includes(customerSearch) ||
    c.display_id.toLowerCase().includes(customerSearch.toLowerCase())
  );

  useEffect(() => {
    if (!companyId) return;
    const latest = rates
      .filter((r) => r.company_id === companyId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    if (!latest) return;
    setItems((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        const rate = Math.abs(parseFloat(p.weight_kg) - 11.8) < 0.01 ? latest.rate_118 : latest.rate_454;
        const existing = next[p.id] || { qty: "", purchaseRate: "", sellingRate: "" };
        next[p.id] = {
          qty: existing.qty,
          purchaseRate: existing.purchaseRate || rate,
          sellingRate: existing.sellingRate || "",
        };
      });
      return next;
    });
  }, [companyId, rates, products]);

  const setItemField = (productId: string, field: keyof ItemRow, value: string) => {
    setItems((prev) => ({ ...prev, [productId]: { ...(prev[productId] || { qty: "", purchaseRate: "", sellingRate: "" }), [field]: value } }));
  };

  const activeItems = useMemo(
    () => products
      .map((p) => ({ product: p, row: items[p.id] }))
      .filter((x) => x.row && parseFloat(x.row.qty) > 0),
    [products, items]
  );

  const totalSelling = activeItems.reduce((s, x) => s + (parseFloat(x.row!.qty) || 0) * (parseFloat(x.row!.sellingRate) || 0), 0);
  const totalPurchase = activeItems.reduce((s, x) => s + (parseFloat(x.row!.qty) || 0) * (parseFloat(x.row!.purchaseRate) || 0), 0);
  const margin = totalSelling - totalPurchase;

  const totalCreditNum = parseFloat(totalCreditReceived) || 0;
  const homeExpenseNum = parseFloat(homeExpenseAmount) || 0;
  const ownerDrawingsNum = parseFloat(ownerDrawingsAmount) || 0;
  const bypassSum = homeExpenseNum + ownerDrawingsNum;
  const settlementValid = bypassSum <= totalCreditNum + EPSILON;
  const netPlantPayment = totalCreditNum - homeExpenseNum - ownerDrawingsNum;

  const projectedCustomerBalance = selectedCustomer
    ? parseFloat(selectedCustomer.current_balance) + totalSelling - totalCreditNum
    : null;
  const projectedPlantBalance = selectedCompany
    ? parseFloat(selectedCompany.current_balance) + totalPurchase
    : null;

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    const c = await api.expenseCategories.create(newCategoryName.trim());
    setCategories((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    setHomeExpenseCategoryId(c.id);
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const canSubmit =
    !!customerId && !!companyId && !!date &&
    (activeItems.length > 0 || totalCreditNum > 0) &&
    settlementValid &&
    (homeExpenseNum <= 0 || !!homeExpenseCategoryId);

  const resetForm = () => {
    setItems({});
    setTotalCreditReceived(""); setPaymentMethod("cash"); setReferenceNo("");
    setHomeExpenseAmount(""); setHomeExpenseCategoryId(""); setOwnerDrawingsAmount("");
    setGatePassNo(""); setVehicleNo(""); setNotes("");
    setCustomerId(""); setCustomerSearch(""); setCompanyId("");
    setDestinationType("plant"); setTargetPlantId(""); setAccountCategory("cash");
    setEditingId(null); setEditingDisplayId(null);
  };

  const handleViewTransaction = async (id: string) => {
    setLoadingTransaction(true);
    setTransactionError(null);
    try {
      const result = await api.unifiedSale.get(id);
      setSelectedTransaction(result);
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : "Could not load transaction.");
    } finally {
      setLoadingTransaction(false);
    }
  };

  const handleEditTransaction = async (row: UnifiedSaleBatch) => {
    setError(null);
    try {
      const full = await api.unifiedSale.get(row.id);
      setEditingId(full.id);
      setEditingDisplayId(full.display_id);
      setDate(full.date.slice(0, 10));
      setCustomerId(full.customer_id);
      setCompanyId(full.company_id);
      
      setDestinationType(full.destination_type || "plant");
      setTargetPlantId(full.target_plant_id || "");
      // Older batches may have a real PaymentAccount UUID saved from before
      // routing was locked to the 4 fixed buckets — fall back to "cash" since
      // this dropdown can no longer represent an arbitrary account.
      const savedAccount = full.account_id;
      setAccountCategory(
        savedAccount === "cash" || savedAccount === "office_cash" || savedAccount === "owner_home" || savedAccount === "dowa_account"
          ? savedAccount
          : "cash"
      );

      const nextItems: Record<string, ItemRow> = {};
      full.sales.forEach((sale) => {
        const purchase = full.purchases.find((p) => p.product_id === sale.product_id);
        nextItems[sale.product_id] = {
          qty: String(sale.quantity),
          purchaseRate: String(purchase?.rate_per_cylinder ?? ""),
          sellingRate: String(sale.rate_per_cylinder ?? ""),
        };
      });
      setItems(nextItems);
      setTotalCreditReceived(String(full.total_credit_received));
      setHomeExpenseAmount(String(full.home_expense_amount || ""));
      setHomeExpenseCategoryId(full.expense?.category_id || "");
      setOwnerDrawingsAmount(String(full.owner_drawings_amount || ""));
      setGatePassNo(full.sales[0]?.gate_pass_no || "");
      setVehicleNo(full.sales[0]?.vehicle_no || "");
      setNotes(full.sales[0]?.notes || "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this order for editing.");
    }
  };

  const handleApprove = async (id: string) => {
    if (!user || actionBusyId) return;
    setActionBusyId(id);
    try {
      const result = await api.unifiedSale.approve(id, user.name);
      if (selectedTransaction?.id === id) setSelectedTransaction(result);
      setLastResult((prev) => (prev?.id === id ? result : prev));
      await load();
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : "Approval failed.");
      await load();
    } finally {
      setActionBusyId(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!user || actionBusyId) return;
    if (!window.confirm("Cancel this pending unified sale? This cannot be undone.")) return;
    setActionBusyId(id);
    try {
      const result = await api.unifiedSale.cancel(id, user.name);
      if (selectedTransaction?.id === id) setSelectedTransaction(result);
      setLastResult((prev) => (prev?.id === id ? result : prev));
      await load();
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    try {
      const combinedNotes = [
        `Format: ${paymentMethod.toUpperCase()}`,
        referenceNo ? `Ref: ${referenceNo}` : "",
        destinationType === "account" ? `Category: ${accountCategory}` : "",
        notes,
      ].filter(Boolean).join(" | ");

      const payload = {
        date: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        customer_id: customerId,
        plant_id: companyId,
        items: activeItems.map((x) => ({
          product_id: x.product.id, quantity: parseFloat(x.row!.qty),
          purchase_rate: parseFloat(x.row!.purchaseRate) || 0, selling_rate: parseFloat(x.row!.sellingRate) || 0,
        })),
        settlement: {
          total_credit_received: totalCreditNum,
          cash_received: 0,
          home_expense_amount: homeExpenseNum,
          home_expense_category_id: homeExpenseCategoryId || undefined,
          owner_drawings_amount: ownerDrawingsNum,
          destination_type: destinationType,
          target_plant_id: destinationType === "plant" ? (targetPlantId || companyId) : undefined,
          account_id: destinationType === "account" ? accountCategory : undefined,
        },
        gate_pass_no: gatePassNo || undefined,
        vehicle_no: vehicleNo || undefined,
        notes: combinedNotes || undefined,
        entered_by: user.name,
      };
      const result = editingId
        ? await api.unifiedSale.update(editingId, payload)
        : await api.unifiedSale.create(payload);
      setLastResult(result);
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  const pendingOrders = useMemo(() => recent.filter((r) => r.status === "pending"), [recent]);
  const completedOrders = useMemo(() => recent.filter((r) => r.status !== "pending").slice(0, 10), [recent]);

  const getDestinationLabel = (r: UnifiedSaleBatch) => {
    if (r.destination_type === "account") {
      return resolveAccountLabel(r.account_id, accounts);
    }
    const plant = companies.find((c) => c.id === (r.target_plant_id || r.company_id));
    return plant ? plant.name : "Plant";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Unified Sale"
        title="Sale & settlement, one atomic entry"
        caption="Sells product, posts the plant's cost, and splits the customer's payment across home expense, owner drawings, and your choice of plant or cash account. Nothing posts until the order is approved."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: FORM PANEL */}
        <div className="lg:col-span-8 xl:col-span-5">
          <Panel>
            <div className="flex flex-col gap-4">
              {editingId && (
                <div className="flex items-center justify-between px-3 py-2 bg-[#FFF6E0] border border-[#F0DFA0] rounded-lg">
                  <span className="font-body text-xs text-[#8A6D00]">Editing pending order {editingDisplayId}</span>
                  <button type="button" onClick={resetForm} className="font-body text-xs text-[#8A6D00] underline">
                    Cancel edit
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Purchase Plant">
                  <div className="flex gap-1.5">
                    <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`${inputClass} flex-1`}>
                      <option value="">Select plant</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <Button variant="outline" onClick={() => setShowNewPlant(true)}><PlusCircle size={14} /></Button>
                  </div>
                </Field>
              </div>

              <Field label="Customer">
                <div className="relative">
                  <input
                    value={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.display_id}` : customerSearch}
                    onChange={(e) => { setCustomerId(""); setCustomerSearch(e.target.value); }}
                    placeholder="Search by name, mobile, or customer ID"
                    className={inputClass}
                  />
                  {!customerId && customerSearch.trim() && (
                    <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-52 overflow-y-auto shadow-lg">
                      {filteredCustomers.slice(0, 8).map((c) => (
                        <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(""); }} className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px]">
                          <span className="font-semibold text-ink">{c.name}</span> <span className="text-steel">· {c.display_id} · {c.mobile}</span>
                        </button>
                      ))}
                      {!filteredCustomers.length && <div className="px-3 py-2 font-body text-[13px] text-steel">No match.</div>}
                    </div>
                  )}
                </div>
              </Field>

              {/* Items Section */}
              <div className="border-t border-hairline pt-4">
                <Eyebrow>Items (optional — leave all at 0 for a pure settlement)</Eyebrow>
                <div className="flex flex-col gap-2.5 mt-2.5">
                  {products.map((p) => {
                    const row = items[p.id] || { qty: "", purchaseRate: "", sellingRate: "" };
                    return (
                      <div key={p.id} className="p-3 bg-paper rounded-lg border border-hairline space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-mono text-steel font-medium">{p.name}</span>
                          <span className="font-mono text-teal font-semibold">
                            {parseFloat(row.qty) > 0 ? pkr((parseFloat(row.qty) || 0) * (parseFloat(row.sellingRate) || 0)) : "—"}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input type="number" value={row.qty} onChange={(e) => setItemField(p.id, "qty", e.target.value)} placeholder="Qty" className={inputClass} />
                          <input type="number" value={row.purchaseRate} onChange={(e) => setItemField(p.id, "purchaseRate", e.target.value)} placeholder="Purchase" className={inputClass} />
                          <input type="number" value={row.sellingRate} onChange={(e) => setItemField(p.id, "sellingRate", e.target.value)} placeholder="Selling" className={inputClass} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {activeItems.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="px-3 py-2 bg-ink rounded-md">
                      <div className="font-mono text-[9.5px] text-[#9FD8D8]">SELLING TOTAL</div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white mt-0.5">{pkr(totalSelling)}</div>
                    </div>
                    <div className="px-3 py-2 bg-ink rounded-md">
                      <div className="font-mono text-[9.5px] text-[#9FD8D8]">PURCHASE TOTAL</div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white mt-0.5">{pkr(totalPurchase)}</div>
                    </div>
                    <div className="px-3 py-2 bg-ink rounded-md">
                      <div className="font-mono text-[9.5px] text-[#9FD8D8]">MARGIN</div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white mt-0.5">{pkr(margin)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Settlement Section */}
              <div className="border-t border-hairline pt-4 space-y-3">
                <Eyebrow>Payment & Settlement Routing</Eyebrow>
                <SectionCaption>
                  Select format and amount received, deduct home expenses/drawings, and route the balance.
                </SectionCaption>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Payment Format">
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className={inputClass}>
                      <option value="cash">Cash</option>
                      <option value="online">Online Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="deposit">Check Deposit</option>
                    </select>
                  </Field>

                  <Field label="Total Received (PKR)">
                    <input type="number" value={totalCreditReceived} onChange={(e) => setTotalCreditReceived(e.target.value)} placeholder="0" className={`${inputClass} font-mono font-bold text-teal`} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Home Expense">
                    <input type="number" value={homeExpenseAmount} onChange={(e) => setHomeExpenseAmount(e.target.value)} placeholder="0" className={inputClass} />
                  </Field>
                  <Field label="Expense Category">
                    {!addingCategory ? (
                      <div className="flex gap-1.5">
                        <select value={homeExpenseCategoryId} onChange={(e) => setHomeExpenseCategoryId(e.target.value)} className={`${inputClass} flex-1`}>
                          <option value="">Select category</option>
                          {categories.filter((c) => c.active === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <Button variant="outline" onClick={() => setAddingCategory(true)}><PlusCircle size={14} /></Button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <input autoFocus value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="New category" className={`${inputClass} flex-1`} />
                        <Button variant="teal" onClick={handleAddCategory}><Check size={14} /></Button>
                        <Button variant="outline" onClick={() => { setAddingCategory(false); setNewCategoryName(""); }}><X size={14} /></Button>
                      </div>
                    )}
                  </Field>
                </div>

                <Field label="Owner Drawings">
                  <input type="number" value={ownerDrawingsAmount} onChange={(e) => setOwnerDrawingsAmount(e.target.value)} placeholder="0" className={inputClass} />
                </Field>

                {/* Destination Routing Selector */}
                <div className="p-3 bg-paper rounded-lg border border-hairline space-y-3">
                  <div className="font-mono text-[10px] text-steel uppercase font-semibold">Route Remaining Balance ({pkr(Math.max(netPlantPayment, 0))}) To</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDestinationType("plant")}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                        destinationType === "plant"
                          ? "bg-teal/10 border-teal text-teal"
                          : "border-hairline bg-white text-steel hover:bg-paper"
                      }`}
                    >
                      <Building2 size={14} /> Plant Settlement
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestinationType("account")}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-xs font-semibold transition-all ${
                        destinationType === "account"
                          ? "bg-teal/10 border-teal text-teal"
                          : "border-hairline bg-white text-steel hover:bg-paper"
                      }`}
                    >
                      <Wallet size={14} /> Account Deposit
                    </button>
                  </div>

                  {destinationType === "plant" ? (
                    <Field label="Target Plant (Defaults to purchase plant)">
                      <select value={targetPlantId} onChange={(e) => setTargetPlantId(e.target.value)} className={inputClass}>
                        <option value="">Same as Purchase Plant ({selectedCompany?.name || "Selected"})</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  ) : (
                    <div className="space-y-2">
                      {/* Fixed to exactly these 4 buckets — never a dynamic
                          bank/cash PaymentAccount row (§ Settlement Routing). */}
                      <Field label="Target Account">
                        <select value={accountCategory} onChange={(e) => setAccountCategory(e.target.value as AccountType)} className={inputClass}>
                          <option value="cash">{ACCOUNT_TYPE_LABELS.cash}</option>
                          <option value="office_cash">{ACCOUNT_TYPE_LABELS.office_cash}</option>
                          <option value="dowa_account">{ACCOUNT_TYPE_LABELS.dowa_account}</option>
                          <option value="owner_home">{ACCOUNT_TYPE_LABELS.owner_home}</option>
                        </select>
                      </Field>
                    </div>
                  )}
                </div>

                {(homeExpenseAmount || ownerDrawingsAmount || totalCreditReceived) && (
                  <div className={`px-3 py-2.5 rounded-lg border flex items-center gap-2 ${settlementValid ? "bg-[#EAF5EF] border-[#C7E6D3]" : "bg-[#FBEAEA] border-[#EFC3C3]"}`}>
                    {settlementValid ? <CheckCircle2 size={15} className="text-brand-green flex-shrink-0" /> : <AlertTriangle size={15} className="text-brand-red flex-shrink-0" />}
                    <span className="font-body text-xs">
                      {pkr(homeExpenseAmount || 0)} + {pkr(ownerDrawingsAmount || 0)} = <b>{pkr(bypassSum)}</b>
                      {" "}{settlementValid
                        ? <>leaves <b>{pkr(Math.max(netPlantPayment, 0))}</b> to route to <b>{destinationType === "plant" ? (companies.find(c => c.id === (targetPlantId || companyId))?.name || "Plant") : ACCOUNT_TYPE_LABELS[accountCategory]}</b></>
                        : <>exceeds total credit received ({pkr(totalCreditNum)})</>}
                    </span>
                  </div>
                )}
              </div>

              {/* Delivery & Reference Details */}
              <div className="border-t border-hairline pt-4">
                <Eyebrow>Delivery & Reference Details (optional)</Eyebrow>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <Field label="Ref / Cheque #">
                    <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="Ref #" className={inputClass} />
                  </Field>
                  <Field label="Gate Pass No">
                    <input value={gatePassNo} onChange={(e) => setGatePassNo(e.target.value)} className={inputClass} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Vehicle No">
                    <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Notes">
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remarks" className={inputClass} />
                  </Field>
                </div>
              </div>

              {(selectedCustomer || selectedCompany) && (
                <div className="font-body text-xs text-steel border-t border-hairline pt-3">
                  <div className="text-[10px] uppercase text-steel/70 mb-1">Projected on approval, not immediately</div>
                  {selectedCustomer && <div>Customer balance {pkr(selectedCustomer.current_balance)} → after: <b className="text-ink">{pkr(projectedCustomerBalance!)}</b></div>}
                  {selectedCompany && <div className="mt-1">Plant payable {pkr(selectedCompany.current_balance)} → after: <b className="text-ink">{pkr(projectedPlantBalance!)}</b></div>}
                </div>
              )}

              {error && <div className="font-body text-xs text-brand-red">{error}</div>}

              <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
                {saving ? "Saving…" : editingId ? "Save Changes" : "Save Unified Sale (Pending)"}
              </Button>
            </div>
          </Panel>
        </div>

        {/* RIGHT COLUMN: PENDING QUEUE & RECENT TABLE */}
        <div className="lg:col-span-6 xl:col-span-7 space-y-4">
          
          {/* Last Created Alert */}
          {lastResult && (
            <Panel className="border-2 border-teal">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-teal" />
                  <Eyebrow>{lastResult.display_id} saved</Eyebrow>
                </div>
                <StatusBadge status={lastResult.status} />
              </div>
              <div className="flex flex-col gap-1 font-body text-xs text-steel">
                {lastResult.sales.length > 0 && (
                  <div className="mt-2">
                    <div className="font-semibold text-ink mb-1">Sale items</div>
                    {lastResult.sales.map((sale) => {
                      const product = products.find((p) => p.id === sale.product_id);
                      return (
                        <div key={sale.id} className="flex justify-between text-xs">
                          <span>{product?.name || "Product"} × {sale.quantity}</span>
                          <span>{pkr(sale.total_amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {Number(lastResult.net_plant_payment) > 0 && (
                  <div>Settlement of {pkr(lastResult.net_plant_payment)} routed to <b>{getDestinationLabel(lastResult)}</b></div>
                )}
                {lastResult.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <Button variant="teal" onClick={() => handleApprove(lastResult.id)} disabled={actionBusyId === lastResult.id}>
                      <ThumbsUp size={13} className="mr-1" /> Approve
                    </Button>
                    <Button variant="outline" onClick={() => handleCancel(lastResult.id)} disabled={actionBusyId === lastResult.id}>
                      <Ban size={13} className="mr-1" /> Cancel
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Pending Queue Section */}
          <Panel>
         <div className="flex items-center justify-between">
  <div>
    <Eyebrow>Pending Approval Queue</Eyebrow>
    <SectionCaption>Orders awaiting review. Unapproved orders do not affect ledger balances.</SectionCaption>
  </div>
  <span className="px-2.5 py-1 rounded-md bg-[#FFF6E0] text-[#8A6D00] font-mono text-xs font-semibold border border-[#FFE7A3]">
    {pendingOrders.length} Pending
  </span>
</div>
<div className="overflow-x-auto mt-3 -mx-1 px-1">

  
  <table className="w-full min-w-[920px] border-collapse">
    <thead>
      <tr className="border-b border-hairline text-left">
        <Th>ID</Th>
        <Th>CUSTOMER</Th>
        <Th>PLANT</Th>
        <Th right>SALE</Th>
        <Th right>SETTLED</Th>
        <Th>DESTINATION</Th>
        <Th right>ACTIONS</Th>
      </tr>
    </thead>

    <tbody className="divide-y divide-hairline">
      {pendingOrders.map((r) => {
        const c = customers.find((x) => x.id === r.customer_id);
        const plant = companies.find((x) => x.id === r.company_id);
        const busy = actionBusyId === r.id;

        return (
          <tr
            key={r.id}
            className="hover:bg-paper/60 transition-colors"
          >
            {/* ID */}
            <Td mono>
              <button
                type="button"
                onClick={() => handleViewTransaction(r.id)}
                className="
                  text-teal
                  hover:underline
                  font-mono
                  text-[11px]
                  font-bold
                  whitespace-nowrap
                "
              >
                {r.display_id}
              </button>
            </Td>

            {/* CUSTOMER */}
            <Td bold>
              <div
                className="whitespace-nowrap"
                title={c?.name || "—"}
              >
                {c?.name || "—"}
              </div>
            </Td>

            {/* PLANT */}
            <Td>
              <span
                className="
                  inline-flex
                  items-center
                  px-2
                  py-1
                  rounded-md
                  bg-slate-100
                  text-slate-800
                  text-[11px]
                  font-medium
                  border
                  border-slate-200
                  whitespace-nowrap
                "
              >
                {plant?.name || r.company_id || "—"}
              </span>
            </Td>

            {/* SALE */}
            <Td right mono color="#0F8B8D">
              <span className="whitespace-nowrap">
                {pkr(r.total_selling_amount)}
              </span>
            </Td>

            {/* SETTLED */}
            <Td right mono color="#1E8A5F" bold>
              <span className="whitespace-nowrap">
                {pkr(r.total_credit_received)}
              </span>
            </Td>

            {/* DESTINATION */}
            <Td>
              <span
                className="
                  whitespace-nowrap
                  font-body
                  text-xs
                  text-slate-700
                  font-semibold
                "
              >
                {getDestinationLabel(r)}
              </span>
            </Td>

            {/* ACTIONS */}
            <Td right>
              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">

                {/* Edit */}
                <button
                  type="button"
                  title="Edit Transaction"
                  disabled={busy}
                  onClick={() => handleEditTransaction(r)}
                  className="
                    h-8
                    w-8
                    shrink-0
                    inline-flex
                    items-center
                    justify-center
                    rounded-md
                    text-steel
                    hover:text-ink
                    hover:bg-slate-200/60
                    border
                    border-hairline
                    transition-colors
                    disabled:opacity-50
                  "
                >
                  <Pencil size={13} />
                </button>

                {/* Approve */}
                <button
                  type="button"
                  title="Approve Order"
                  disabled={busy}
                  onClick={() => handleApprove(r.id)}
                  className="
                    h-8
                    shrink-0
                    inline-flex
                    items-center
                    justify-center
                    gap-1
                    px-2.5
                    rounded-md
                    bg-teal/10
                    hover:bg-teal/20
                    text-teal
                    border
                    border-teal/30
                    font-medium
                    text-xs
                    transition-colors
                    disabled:opacity-50
                  "
                >
                  <CheckCircle2 size={13} />
                  <span>Approve</span>
                </button>

                {/* Cancel */}
                <button
                  type="button"
                  title="Cancel Order"
                  disabled={busy}
                  onClick={() => handleCancel(r.id)}
                  className="
                    h-8
                    w-8
                    shrink-0
                    inline-flex
                    items-center
                    justify-center
                    rounded-md
                    text-slate-400
                    hover:text-brand-red
                    hover:bg-red-50
                    border
                    border-transparent
                    hover:border-red-200
                    transition-colors
                    disabled:opacity-50
                  "
                >
                  <Ban size={13} />
                </button>

              </div>
            </Td>
          </tr>
        );
      })}

      {!pendingOrders.length && (
        <tr>
          <td
            colSpan={7}
            className="text-steel font-body text-[13px] py-6 text-center"
          >
            No pending sales awaiting approval.
          </td>
        </tr>
      )}
    </tbody>
  </table>
</div>
          </Panel>

          {/* History Panel */}
          <Panel>
            <Eyebrow>Processed Unified Sales</Eyebrow>
            <SectionCaption>Recent approved and cancelled transactions.</SectionCaption>

            <div className="overflow-x-auto mt-3">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-hairline text-left">
                    <Th>ID</Th>
                    <Th>CUSTOMER</Th>
                    <Th right>SALE</Th>
                    <Th right>SETTLED</Th>
                    <Th center>STATUS</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {completedOrders.map((r) => {
                    const c = customers.find((x) => x.id === r.customer_id);
                    return (
                      <tr key={r.id} className="hover:bg-paper/60 transition-colors">
                        <Td mono>
                          <button
                            type="button"
                            onClick={() => handleViewTransaction(r.id)}
                            className="text-teal hover:underline font-mono text-[11px] cursor-pointer"
                          >
                            {r.display_id}
                          </button>
                        </Td>
                        <Td bold>{c?.name || "—"}</Td>
                        <Td right mono color="#0F8B8D">{pkr(r.total_selling_amount)}</Td>
                        <Td right mono color="#1E8A5F">{pkr(r.total_credit_received)}</Td>
                        <Td center><StatusBadge status={r.status} /></Td>
                      </tr>
                    );
                  })}
                  {!completedOrders.length && (
                    <tr>
                      <td colSpan={5} className="text-steel font-body text-[13px] py-6 text-center">
                        No processed sales found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      {/* TRANSACTION DETAILS MODAL */}
      {(selectedTransaction || loadingTransaction || transactionError) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => { setSelectedTransaction(null); setTransactionError(null); }}
        >
          <div
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {loadingTransaction && <div className="p-6 font-body text-sm text-steel">Loading…</div>}
            {transactionError && !loadingTransaction && (
              <div className="p-6 font-body text-sm text-brand-red">{transactionError}</div>
            )}
            {selectedTransaction && !loadingTransaction && (
              <>
                <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-teal" />
                      <div className="font-mono text-xs text-teal font-semibold">{selectedTransaction.display_id}</div>
                      <StatusBadge status={selectedTransaction.status} />
                    </div>
                    <div className="font-body text-xs text-steel mt-1">
                      {fmtTime(selectedTransaction.date)}
                      {selectedTransaction.approved_at && (
                        <> · approved {fmtTime(selectedTransaction.approved_at)}{selectedTransaction.approved_by ? ` by ${selectedTransaction.approved_by}` : ""}</>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTransaction(null)}
                    className="p-1.5 rounded-md hover:bg-paper text-steel"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="px-5 py-4 flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-paper rounded-lg p-3">
                      <div className="font-mono text-[9px] text-steel uppercase">Customer</div>
                      <div className="font-body text-sm font-semibold text-ink mt-1">
                        {customers.find((c) => c.id === selectedTransaction.customer_id)?.name || "—"}
                      </div>
                    </div>
                    <div className="bg-paper rounded-lg p-3">
                      <div className="font-mono text-[9px] text-steel uppercase">Purchase Plant</div>
                      <div className="font-body text-sm font-semibold text-ink mt-1">
                        {companies.find((c) => c.id === selectedTransaction.company_id)?.name || "—"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="font-mono text-[10px] text-steel uppercase mb-2">Settlement Details</div>
                    <div className="border border-hairline rounded-lg divide-y divide-hairline">
                      <div className="flex justify-between px-3 py-2.5">
                        <span className="font-body text-xs text-steel">Total Credit Received</span>
                        <span className="font-mono text-xs font-semibold">{pkr(selectedTransaction.total_credit_received)}</span>
                      </div>
                      {Number(selectedTransaction.net_plant_payment) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">Routed Settlement ({getDestinationLabel(selectedTransaction)})</span>
                          <span className="font-mono text-xs text-green-700 font-semibold">{pkr(selectedTransaction.net_plant_payment)}</span>
                        </div>
                      )}
                      {Number(selectedTransaction.home_expense_amount) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">Home Expense</span>
                          <span className="font-mono text-xs">{pkr(selectedTransaction.home_expense_amount)}</span>
                        </div>
                      )}
                      {Number(selectedTransaction.owner_drawings_amount) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">Owner Drawings</span>
                          <span className="font-mono text-xs">{pkr(selectedTransaction.owner_drawings_amount)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <div className="flex gap-2">
                      {selectedTransaction.status === "pending" && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => { const row = recent.find((r) => r.id === selectedTransaction.id); if (row) handleEditTransaction(row); setSelectedTransaction(null); }}
                          >
                            <Pencil size={13} className="mr-1" /> Edit
                          </Button>
                          <Button variant="teal" onClick={() => handleApprove(selectedTransaction.id)} disabled={actionBusyId === selectedTransaction.id}>
                            <ThumbsUp size={13} className="mr-1" /> Approve
                          </Button>
                          <Button variant="outline" onClick={() => handleCancel(selectedTransaction.id)} disabled={actionBusyId === selectedTransaction.id}>
                            <Ban size={13} className="mr-1" /> Cancel
                          </Button>
                        </>
                      )}
                    </div>
                    <Button variant="outline" onClick={() => setSelectedTransaction(null)}>Close</Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showNewPlant && (
        <NewPlantModal onClose={() => setShowNewPlant(false)} onCreated={(c) => { setCompanies((prev) => [...prev, c]); setCompanyId(c.id); setShowNewPlant(false); }} />
      )}
    </div>
  );
}

export default function UnifiedSalePage() {
  return (
    <AuthGate>
      <UnifiedSaleBody />
    </AuthGate>
  );
}