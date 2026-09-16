"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PlusCircle, Check, X, AlertTriangle, CheckCircle2, Pencil, Ban, ThumbsUp, Building2, Wallet, ArrowRight, Printer, Maximize2, Search } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import NewPlantModal from "@/components/NewPlantModal";
import AmountInput from "@/components/AmountInput";
import CorrectTransactionModal, { CorrectableKind } from "@/components/CorrectTransactionModal";
import HomeExpenseLinesEditor, { HomeExpenseLine, emptyHomeExpenseLine, homeExpenseLinesTotal, homeExpenseLinesValid, toHomeExpenseLinesPayload } from "@/components/HomeExpenseLinesEditor";
import { api, apiErrorMessage } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString, ACCOUNT_TYPE_LABELS, resolveAccountLabel, fmtNumber } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { resolveRate, NO_PARTY_VALUE } from "@/lib/rates";
import type {
  Company, Customer, Product, ExpenseCategory, RateEntry, PaymentAccount, Party, Employee,
  UnifiedSaleBatch, UnifiedSaleResult, DestinationType, AccountType,
  Sale, Payment, Purchase,
} from "@/lib/types";

// Date filter shape shared by the Approved Sale / Approved Payments cards
// below — "24h / day / month / year" convention, kept as its own small
// type+component so the two filter toolbars don't duplicate inline JSX.
type DateFilter = { type: "24h" | "day" | "month" | "year"; date: string; month: string; year: string };
const defaultDateFilter = (): DateFilter => ({
  type: "24h", date: todayLocalInput(), month: todayLocalInput().slice(0, 7), year: todayLocalInput().slice(0, 4),
});
function matchesDateFilter(isoDate: string, f: DateFilter): boolean {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const t = new Date(isoDate).getTime();
  const localYYYYMMDD = toKarachiDateString(isoDate);
  if (f.type === "24h") return Date.now() - t < ONE_DAY_MS;
  if (f.type === "day") return localYYYYMMDD === f.date;
  if (f.type === "month") return localYYYYMMDD.slice(0, 7) === f.month;
  if (f.type === "year") return localYYYYMMDD.slice(0, 4) === f.year;
  return true;
}
function DateFilterToolbar({ value, onChange }: { value: DateFilter; onChange: (f: DateFilter) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value.type}
        onChange={(e) => onChange({ ...value, type: e.target.value as DateFilter["type"] })}
        className="px-2.5 py-1 bg-paper border border-hairline rounded-md text-xs font-semibold text-ink focus:outline-none"
      >
        <option value="24h">{t("unifiedSale.dateLast24Hours")}</option>
        <option value="day">{t("unifiedSale.dateBySpecificDay")}</option>
        <option value="month">{t("unifiedSale.dateByMonth")}</option>
        <option value="year">{t("unifiedSale.dateByYear")}</option>
      </select>
      {value.type === "day" && (
        <input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} className="px-2 py-1 bg-white border border-hairline rounded-md text-xs font-mono text-ink" />
      )}
      {value.type === "month" && (
        <input type="month" value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })} className="px-2 py-1 bg-white border border-hairline rounded-md text-xs font-mono text-ink" />
      )}
      {value.type === "year" && (
        <input type="number" min="2020" max="2099" value={value.year} onChange={(e) => onChange({ ...value, year: e.target.value })} placeholder="YYYY" className="w-20 px-2 py-1 bg-white border border-hairline rounded-md text-xs font-mono text-ink" />
      )}
    </div>
  );
}

const EPSILON = 0.01;

type ItemRow = { qty: string; purchaseRate: string; sellingRate: string };

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-[#FFF6E0] text-[#8A6D00] border-[#F0DFA0]",
  approved: "bg-[#EAF5EF] text-[#1E8A5F] border-[#C7E6D3]",
  cancelled: "bg-[#F1F1F1] text-steel border-hairline",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = status === "pending" ? "unifiedSale.statusPending" : status === "approved" ? "unifiedSale.statusApproved" : status === "cancelled" ? "unifiedSale.statusCancelled" : null;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full border font-mono text-[10px] uppercase font-medium ${STATUS_STYLES[status] || ""}`}>
      {key ? t(key) : status}
    </span>
  );
}

function UnifiedSaleBody() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [recent, setRecent] = useState<UnifiedSaleBatch[]>([]);

  const [showNewPlant, setShowNewPlant] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  // Payment-Only mode (§ Part A) — a customer who's only paying, no sale
  // happening. A Mode Switch on this same form, not a separate modal or
  // endpoint: BOTH modes post through the same POST /sales/unified
  // (pending -> approve) — Payment Only just sends items: [] and no
  // plant_id (UnifiedSaleBatch.company_id is nullable specifically for
  // this), riding the exact same batch model and approval workflow as a
  // Full Sale rather than the standalone /payment-receipts flow (see
  // handleSubmit's formMode === "payment_only" branch, which is the actual
  // source of truth for this — PaymentReceiptModal's own instant,
  // single-step flow is untouched and unrelated).
  // Only meaningful for a NEW entry: editingId is always a Unified Sale
  // batch (Payment Receipts post instantly and are never "pending"), so
  // editing always forces Full Sale mode — see resetForm/handleEditTransaction.
  const [formMode, setFormMode] = useState<"full_sale" | "payment_only">("full_sale");
  // Approved Sale / Approved Payments (§3/§4) — plain, individual Sale/
  // Payment records (system-wide, not scoped to Unified Sale batches),
  // with Edit wired to the existing, already-proven reverse-then-repost
  // CorrectTransactionModal (see routers/sales.py::correct_sale,
  // routers/payments.py::correct_payment).
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allPayments, setAllPayments] = useState<Payment[]>([]);
  // Purchase Rate (§3) — a plain Sale has no FK to a specific Purchase; only
  // for a Unified-Sale-originated Sale can its matching Purchase be found
  // (same unified_sale_id + same product_id — Unified Sale creates one
  // Sale + one Purchase per line item). Non-Unified-Sale rows show "—".
  const [allPurchases, setAllPurchases] = useState<Purchase[]>([]);
  const [showApprovedSaleModal, setShowApprovedSaleModal] = useState(false);
  const [showApprovedPaymentsModal, setShowApprovedPaymentsModal] = useState(false);
  const [saleDateFilter, setSaleDateFilter] = useState<DateFilter>(defaultDateFilter);
  const [paymentDateFilter, setPaymentDateFilter] = useState<DateFilter>(defaultDateFilter);
  const [correctTarget, setCorrectTarget] = useState<{ kind: CorrectableKind; transaction: Sale | Payment } | null>(null);

  // Per-row draft for the settlement reference (bank transfer/cheque no.)
  // typed in just before approving that row's payment — keyed by batch id.
  const [paymentReferenceDrafts, setPaymentReferenceDrafts] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDisplayId, setEditingDisplayId] = useState<string | null>(null);

  const [date, setDate] = useState(todayLocalInput());
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  // "" means "not yet resolved" (only reachable when the selected company
  // has >1 party and the user hasn't picked one) — see the auto-select
  // effect below and lib/rates.ts's resolveRate, which treats "" as
  // "don't guess."
  const [partyId, setPartyId] = useState("");
  const [gatePassNo, setGatePassNo] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<Record<string, ItemRow>>({});
  const [deliveryCharges, setDeliveryCharges] = useState("");

  // GST on Sale, extended to Unified Sale (optional, locked at entry) —
  // applies to the whole batch's total_selling_amount, not per item.
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstRate, setGstRate] = useState("");

  // Payment Format & Settlement Amounts. Full Sale only ever folds this
  // into a free-text note (POST /sales/unified has no structured method
  // field); Payment Only sends it as the real, required `method` on
  // POST /payment-receipts — so the option set has to be a valid method
  // for that endpoint ("cash" | "bank_transfer" | "cheque" | "online" | "other").
  const [totalCreditReceived, setTotalCreditReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online">("cash");

  // § Multi-line Categorized Home Expense — replaces the legacy single
  // home_expense_amount/home_expense_category_id fields entirely for THIS
  // form going forward (same convention as RecordShopSaleModal): always
  // sent as home_expense_lines (even empty), never the scalar fields.
  const [homeExpenseLines, setHomeExpenseLines] = useState<HomeExpenseLine[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [ownerDrawingsAmount, setOwnerDrawingsAmount] = useState("");

  // Routing State
  const [destinationType, setDestinationType] = useState<DestinationType>("plant");
  const [targetPlantId, setTargetPlantId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  // "account" destination is always one of these 4 fixed buckets — never a
  // dynamically-chosen bank/cash PaymentAccount row.
  const [accountCategory, setAccountCategory] = useState<AccountType>("owner_home"); // was "cash"

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Payment Only now goes through the same pending -> approve workflow as
  // a Full Sale (§ Payment-Only Pending Approval) — this same card shows
  // it too, no separate instant-success banner needed anymore.
  const [lastResult, setLastResult] = useState<UnifiedSaleResult | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<UnifiedSaleResult | null>(null);
  const [loadingTransaction, setLoadingTransaction] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const load = async () => {
    const [c, cu, p, cat, acc, r, parties, ru, sales, payments, purchases, emp] = await Promise.all([
      api.companies.list(), api.customers.list(), api.products.list(),
      api.expenseCategories.list(), api.paymentAccounts.list(), api.rates.latest(),
      api.parties.list(),
      api.unifiedSale.list(),
      // Approved Sale / Approved Payments (§3/§4) — refreshed on the exact
      // same triggers as `recent` above (mount + after every create/
      // approve/edit/cancel action that already calls this function), so
      // a Unified-Sale-approved Sale/Payment shows up here immediately.
      api.sales.list(), api.payments.list(), api.purchases.list(),
      api.employees.list(),
    ]);
    // Active-only: an accidental duplicate product row (same weight_kg as
    // a real one, e.g. a stray "11.8 KG Cylinder2") must not show up as a
    // second Items row here — that's what let someone type a rate into
    // the duplicate's row and see the 11.8->45.4 selling-rate auto-calc
    // "stop working", since the calc keys off product118/product454's
    // specific id, which the duplicate never matched.
    setCompanies(c); setCustomers(cu); setProducts(p.filter((x) => x.active === "active"));
    // § Employee Salary Tracking — Salary is now selectable (§ Multi-line
    // Categorized Home Expense's HomeExpenseLinesEditor has its own
    // Employee picker, same as RecordShopSaleModal).
    setCategories(cat);
    setEmployees(emp);
    setAccounts(acc); setRates(r); setParties(parties); setRecent(ru);
    setAllSales(sales); setAllPayments(payments); setAllPurchases(purchases);
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

  const filteredCompanies = companies.filter((c) =>
    !companySearch.trim() || c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  // A Company can have multiple Parties (e.g. "Houch" has H.GULF, H.Wardak,
  // ...), each with its own separately-entered, genuinely different rate —
  // see lib/rates.ts. Auto-select the common case (0 or 1 party) so most
  // entries need no extra click; require an explicit pick only when there's
  // real ambiguity (>1 party).
  const companyParties = useMemo(
    () => parties.filter((p) => p.company_id === companyId),
    [parties, companyId]
  );

  useEffect(() => {
    if (!companyId) { setPartyId(""); return; }
    if (companyParties.length === 0) { setPartyId(NO_PARTY_VALUE); return; }
    if (companyParties.length === 1) { setPartyId(companyParties[0].id); return; }
    // >1 parties: keep the current pick only if it's still valid for this
    // company (e.g. re-render after rates refresh); otherwise require a
    // fresh, explicit choice rather than silently reusing another party's.
    setPartyId((prev) =>
      prev === NO_PARTY_VALUE || companyParties.some((p) => p.id === prev) ? prev : ""
    );
  }, [companyId, companyParties]);

  // Resolves against the exact (company, party) pair the Rate Dashboard
  // already tracks (§ lib/rates.ts) — never "whichever rate for this
  // company was entered most recently," which silently picks the wrong
  // party's rate whenever a plant has more than one (confirmed happening
  // in production: Houch's 3 parties currently have 3 different rates).
  const resolvedRate = resolveRate(rates, companyId, partyId);

  useEffect(() => {
    if (!companyId || !partyId || !resolvedRate) return;
    setItems((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        const rate = Math.abs(parseFloat(p.weight_kg) - 11.8) < 0.01 ? resolvedRate.rate_118 : resolvedRate.rate_454;
        const existing = next[p.id] || { qty: "", purchaseRate: "", sellingRate: "" };
        next[p.id] = {
          qty: existing.qty,
          purchaseRate: existing.purchaseRate || rate,
          sellingRate: existing.sellingRate || "",
        };
      });
      return next;
    });
  }, [companyId, partyId, resolvedRate, products]);

  // 45.4 KG selling price is always derived from the 11.8 KG selling price
  // by the actual weight ratio — never hard-coded, never entered
  // independently as a second source of truth (§6 45.4 KG Selling Rate).
  const product118 = products.find((p) => Math.abs(parseFloat(p.weight_kg) - 11.8) < 0.01);
  const product454 = products.find((p) => Math.abs(parseFloat(p.weight_kg) - 45.4) < 0.01);
  const RATIO_454 = 45.4 / 11.8;

  const setItemField = (productId: string, field: keyof ItemRow, value: string) => {
    setItems((prev) => {
      const next = { ...prev, [productId]: { ...(prev[productId] || { qty: "", purchaseRate: "", sellingRate: "" }), [field]: value } };
      if (field === "sellingRate" && product118 && product454 && productId === product118.id) {
        const num = parseFloat(value);
        const computed454 = !isNaN(num) && num > 0 ? (num * RATIO_454).toFixed(2) : "";
        next[product454.id] = { ...(next[product454.id] || { qty: "", purchaseRate: "", sellingRate: "" }), sellingRate: computed454 };
      }
      return next;
    });
  };

  const activeItems = useMemo(
    () => products
      .map((p) => ({ product: p, row: items[p.id] }))
      .filter((x) => x.row && parseFloat(x.row.qty) > 0),
    [products, items]
  );

  const deliveryChargesNum = parseFloat(deliveryCharges) || 0;
  // Delivery charges are folded straight into the selling total — raises
  // what the customer owes exactly like another item would, and flows into
  // net_plant_payment through totalCreditReceived below the same way the
  // rest of the sale amount does. Never added to totalPurchase — it's pure
  // margin, no plant cost behind it (matches routers/unified_sale.py).
  const totalSelling = activeItems.reduce((s, x) => s + (parseFloat(x.row!.qty) || 0) * (parseFloat(x.row!.sellingRate) || 0), 0) + deliveryChargesNum;
  const totalPurchase = activeItems.reduce((s, x) => s + (parseFloat(x.row!.qty) || 0) * (parseFloat(x.row!.purchaseRate) || 0), 0);
  const margin = totalSelling - totalPurchase;

  // GST on Sale, extended to Unified Sale (§ GST on Sale) — gst_amount is
  // total_selling_amount (totalSelling, incl. delivery charges) × rate,
  // never touching totalPurchase/margin above. grand_total is what the
  // customer is actually charged; total_selling_amount stays excl.-GST.
  const effectiveGstRate = gstEnabled ? parseFloat(gstRate) || 0 : 0;
  const gstAmount = totalSelling * (effectiveGstRate / 100);
  const grandTotalWithGst = totalSelling + gstAmount;

  const totalCreditNum = parseFloat(totalCreditReceived) || 0;
  const homeExpenseNum = homeExpenseLinesTotal(homeExpenseLines);
  const ownerDrawingsNum = parseFloat(ownerDrawingsAmount) || 0;
  const bypassSum = homeExpenseNum + ownerDrawingsNum;
  const settlementValid = bypassSum <= totalCreditNum + EPSILON;
  const netPlantPayment = totalCreditNum - homeExpenseNum - ownerDrawingsNum;

  const projectedCustomerBalance = selectedCustomer
    ? parseFloat(selectedCustomer.current_balance) + grandTotalWithGst - totalCreditNum
    : null;

  // Settlement only nets off the purchase plant's payable when it's actually
  // the routing target (no target chosen, or target === purchase plant) —
  // otherwise the money never touches the purchase plant's balance.
  const purchasePlantSettlement =
    destinationType === "plant" && (!targetPlantId || targetPlantId === companyId)
      ? netPlantPayment
      : 0;

  const projectedPlantBalance = selectedCompany
    ? parseFloat(selectedCompany.current_balance) + totalPurchase - purchasePlantSettlement
    : null;

  const accountCategoryLabel = (cat: AccountType): string =>
    cat === "office_cash" ? t("payments.officeCash") : cat === "dowa_account" ? t("payments.dowaAccount") : cat === "owner_home" ? t("payments.ownerHome") : ACCOUNT_TYPE_LABELS[cat];

  const targetPlant =
    destinationType === "plant" && targetPlantId && targetPlantId !== companyId
      ? companies.find((c) => c.id === targetPlantId)
      : null;

  const projectedTargetPlantBalance = targetPlant
    ? parseFloat(targetPlant.current_balance) - netPlantPayment
    : null;

  // Vehicle No is only meaningful when cylinders are actually moving —
  // a pure settlement (no items, credit-only) never has a vehicle to
  // record, so it must not block submission. Always false in Payment Only
  // mode too, since activeItems is necessarily empty there (Items Section
  // is hidden, nothing to fill in).
  const vehicleRequired = formMode === "full_sale" && activeItems.length > 0;

  // Payment Only has no purchase plant to fall back on (unlike Full Sale,
  // where an empty Target Plant silently defaults to companyId — see
  // handleSubmit) — POST /payment-receipts' resolve_settlement_destination
  // requires an explicit target_plant_id when routing to a plant, so this
  // mirrors that requirement here rather than letting a 400 surface it.
  const paymentOnlyDestinationValid =
    netPlantPayment <= 0 || destinationType !== "plant" || !!targetPlantId;

  const homeExpenseLinesInvalid = !homeExpenseLinesValid(homeExpenseLines, categories);

  const canSubmit =
    formMode === "payment_only"
      ? !!customerId && !!date && totalCreditNum > 0 &&
        settlementValid &&
        !homeExpenseLinesInvalid &&
        paymentOnlyDestinationValid
      : !!customerId && !!companyId && !!date &&
        (!vehicleRequired || !!vehicleNo.trim()) &&
        (activeItems.length > 0 || totalCreditNum > 0 || deliveryChargesNum > 0) &&
        settlementValid &&
        !homeExpenseLinesInvalid &&
        (!gstEnabled || parseFloat(gstRate) > 0);

  const resetForm = () => {
    setFormMode("full_sale");
    setItems({});
    setDeliveryCharges("");
    setGstEnabled(false); setGstRate("");
    setTotalCreditReceived(""); setPaymentMethod("cash");
    setHomeExpenseLines([]); setOwnerDrawingsAmount("");
    setGatePassNo(""); setVehicleNo(""); setNotes("");
    setCustomerId(""); setCustomerSearch(""); setCompanyId(""); setCompanySearch("");
    setDestinationType("plant"); setTargetPlantId(""); setAccountCategory("owner_home");
    setPaymentReference("");
    setEditingId(null); setEditingDisplayId(null);
    setShowSaleForm(false);
  };

  const handleViewTransaction = async (id: string) => {
    setLoadingTransaction(true);
    setTransactionError(null);
    try {
      const result = await api.unifiedSale.get(id);
      setSelectedTransaction(result);
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : t("unifiedSale.couldNotLoadTransaction"));
    } finally {
      setLoadingTransaction(false);
    }
  };

  const handleEditTransaction = async (row: UnifiedSaleBatch) => {
    // Payment-Only batches (company_id null — § Payment-Only Pending
    // Approval) have no purchase plant/items for this Full-Sale-shaped edit
    // form to load into; Cancel + re-enter is the only path for these, same
    // as any other pending entry that turns out wrong.
    if (row.company_id == null) return;
    setFormMode("full_sale");
    setError(null);
    try {
      const full = await api.unifiedSale.get(row.id);
      setEditingId(full.id);
      setEditingDisplayId(full.display_id);
      setShowSaleForm(true);
      setDate(full.date.slice(0, 10));
      setCustomerId(full.customer_id);
      setCompanyId(full.company_id || "");
      setCompanySearch("");

      setDestinationType(full.destination_type || "plant");
      setTargetPlantId(full.target_plant_id || "");
      // Older batches may have a real PaymentAccount UUID saved from before
      // routing was locked to the 4 fixed buckets — fall back to "cash" since
      // this dropdown can no longer represent an arbitrary account.
      const savedAccount = full.account_id;
   setAccountCategory(
  savedAccount === "office_cash" || savedAccount === "owner_home" || savedAccount === "dowa_account"? savedAccount : "owner_home"
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
      setDeliveryCharges(full.delivery_charges && Number(full.delivery_charges) > 0 ? String(full.delivery_charges) : "");
      setGstEnabled(!!full.gst_enabled);
      setGstRate(full.gst_rate ? String(full.gst_rate) : "");
      setTotalCreditReceived(String(full.total_credit_received));
      // § Multi-line Categorized Home Expense — load the structured lines
      // for editing; a legacy single-amount batch (no lines) is loaded as
      // one editable line, seeded from its category_id via the batch's
      // first Expense row, so the multi-line editor can represent it too.
      setHomeExpenseLines(
        full.home_expense_lines.length > 0
          ? full.home_expense_lines.map((l) => ({
              category_id: l.category_id, employee_id: l.employee_id || "",
              amount: String(l.amount), description: l.description || "",
            }))
          : full.home_expense_amount && Number(full.home_expense_amount) > 0
          ? [{ category_id: full.expense?.category_id || "", employee_id: "", amount: String(full.home_expense_amount), description: "" }]
          : []
      );
      setOwnerDrawingsAmount(String(full.owner_drawings_amount || ""));
      setPaymentReference(full.payment_reference || "");
      setGatePassNo(full.sales[0]?.gate_pass_no || "");
      setVehicleNo(full.sales[0]?.vehicle_no || "");
      setNotes(full.sales[0]?.notes || "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("unifiedSale.couldNotLoadForEditing"));
    }
  };

  // Sale/Load and Plant Payment/Settlement are two independent real-world
  // events — approving one never posts or approves the other (backend
  // enforces this too via separate sale_status/payment_status fields).
  const handleApproveSale = async (id: string) => {
    if (!user || actionBusyId) return;
    setActionBusyId(id);
    try {
      const result = await api.unifiedSale.approveSale(id, user.name);
      if (selectedTransaction?.id === id) setSelectedTransaction(result);
      setLastResult((prev) => (prev?.id === id ? result : prev));
      await load();
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : t("unifiedSale.saleApprovalFailed"));
      await load();
    } finally {
      setActionBusyId(null);
    }
  };

  const handleApprovePayment = async (id: string) => {
    if (!user || actionBusyId) return;
    setActionBusyId(id);
    try {
      const reference = paymentReferenceDrafts[id]?.trim() || undefined;
      const result = await api.unifiedSale.approvePayment(id, user.name, reference);
      if (selectedTransaction?.id === id) setSelectedTransaction(result);
      setLastResult((prev) => (prev?.id === id ? result : prev));
      await load();
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : t("unifiedSale.paymentApprovalFailed"));
      await load();
    } finally {
      setActionBusyId(null);
    }
  };

  // Payment-Only batches (company_id null — § Payment-Only Pending
  // Approval) have no separate sale/load event for a human to approve —
  // this approves both sides atomically in one request instead of the two
  // independent approve calls above.
  const handleApprovePaymentOnly = async (id: string) => {
    if (!user || actionBusyId) return;
    setActionBusyId(id);
    try {
      const reference = paymentReferenceDrafts[id]?.trim() || undefined;
      const result = await api.unifiedSale.approve(id, user.name, reference);
      if (selectedTransaction?.id === id) setSelectedTransaction(result);
      setLastResult((prev) => (prev?.id === id ? result : prev));
      await load();
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : t("unifiedSale.paymentApprovalFailed"));
      await load();
    } finally {
      setActionBusyId(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!user || actionBusyId) return;
    if (!window.confirm(t("unifiedSale.confirmCancelOrder"))) return;
    setActionBusyId(id);
    try {
      const result = await api.unifiedSale.cancel(id, user.name);
      if (selectedTransaction?.id === id) setSelectedTransaction(result);
      setLastResult((prev) => (prev?.id === id ? result : prev));
      await load();
    } catch (e) {
      setTransactionError(e instanceof Error ? e.message : t("unifiedSale.cancelFailed"));
    } finally {
      setActionBusyId(null);
    }
  };

  // Cancel an individual Approved Payment row (§ Unified Sale Payment
  // Cancel) — the only way to fix a wrong amount on a unified-sale-linked
  // payment, since its own correction path deliberately can't touch amount
  // (see routers/unified_sale.py::correct_unified_sale_settlement). Cancel
  // then re-enter correctly. Backend resyncs the batch's Collected/
  // Outstanding (total_credit_received/net_plant_payment) as part of this
  // (routers/payments.py::cancel_payment), so this table's own next load()
  // picks up the corrected figures.
  const handleCancelApprovedPayment = async (id: string) => {
    if (!user || actionBusyId) return;
    if (!window.confirm(t("payments.confirmCancelPayment"))) return;
    setActionBusyId(id);
    try {
      await api.payments.cancel(id, user.name);
      await load();
    } catch (e) {
      alert(apiErrorMessage(e, t("payments.failedCancelPayment")));
    } finally {
      setActionBusyId(null);
    }
  };

  // Cancel an individual Approved Sale line (§ Delete/Reverse an Approved
  // Sale/Payment) — full reversal via the existing cancel machinery, never
  // a hard delete: reverses the customer balance/cylinder transaction (see
  // routers/sales.py::_reverse_sale), and for a Unified-Sale-linked line
  // also cascades to the paired Purchase/plant balance and resyncs the
  // batch's own cached totals (routers/sales.py::cancel_sale), so a
  // multi-line batch's Customer/Company Ledger rows never go stale after
  // one line is reversed. Backend blocks with a clear error if the plant
  // has already been paid against that Purchase.
  const handleCancelApprovedSale = async (id: string) => {
    if (!user || actionBusyId) return;
    if (!window.confirm(t("unifiedSale.confirmCancelSale"))) return;
    setActionBusyId(id);
    try {
      await api.sales.cancel(id, user.name);
      await load();
    } catch (e) {
      alert(apiErrorMessage(e, t("unifiedSale.failedCancelSale")));
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
        destinationType === "account" ? `Category: ${accountCategory}` : "",
        notes,
      ].filter(Boolean).join(" | ");

      if (formMode === "payment_only") {
        // Rides the same pending -> approve Unified Sale machinery as a
        // Full Sale (§ Payment-Only Pending Approval) — POST /sales/unified
        // with items: [] and no plant_id (the DB column is nullable
        // specifically for this). Never touches /payment-receipts, which
        // stays the standalone Payment Register's own instant, single-step
        // flow (see PaymentReceiptModal) — completely untouched by this.
        // company_id ends up NULL, which is how the pending queues below
        // and the approval endpoint tell a Payment-Only batch apart from
        // an ordinary Full Sale.
        const result = await api.unifiedSale.create({
          date: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
          customer_id: customerId,
          plant_id: undefined,
          items: [],
          delivery_charges: 0,
          settlement: {
            total_credit_received: totalCreditNum,
            cash_received: 0,
            home_expense_amount: 0,
            // § Multi-line Categorized Home Expense — replaces the legacy
            // scalar fields entirely for this form (see RecordShopSaleModal).
            home_expense_lines: toHomeExpenseLinesPayload(homeExpenseLines),
            owner_drawings_amount: ownerDrawingsNum,
            destination_type: destinationType,
            target_plant_id: destinationType === "plant" ? targetPlantId : undefined,
            account_id: destinationType === "account" ? accountCategory : undefined,
            payment_reference: paymentReference.trim() || undefined,
          },
          notes: combinedNotes || undefined,
          entered_by: user.name,
        });
        setLastResult(result);
        resetForm();
        await load();
        return;
      }

      const payload = {
        date: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
        customer_id: customerId,
        plant_id: companyId,
        items: activeItems.map((x) => ({
          product_id: x.product.id, quantity: parseFloat(x.row!.qty),
          purchase_rate: parseFloat(x.row!.purchaseRate) || 0, selling_rate: parseFloat(x.row!.sellingRate) || 0,
        })),
        delivery_charges: deliveryChargesNum,
        gst_enabled: gstEnabled,
        gst_rate: gstEnabled ? effectiveGstRate : undefined,
        gst_amount: gstEnabled ? gstAmount : undefined,
        grand_total: gstEnabled ? grandTotalWithGst : undefined,
        settlement: {
          total_credit_received: totalCreditNum,
          cash_received: 0,
          home_expense_amount: 0,
          // § Multi-line Categorized Home Expense — replaces the legacy
          // scalar fields entirely for this form (see RecordShopSaleModal).
          home_expense_lines: toHomeExpenseLinesPayload(homeExpenseLines),
          owner_drawings_amount: ownerDrawingsNum,
          destination_type: destinationType,
          target_plant_id: destinationType === "plant" ? (targetPlantId || companyId) : undefined,
          account_id: destinationType === "account" ? accountCategory : undefined,
          payment_reference: paymentReference.trim() || undefined,
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
      setError(e instanceof Error ? e.message : t("unifiedSale.couldNotSave"));
    } finally {
      setSaving(false);
    }
  };

  // Payment-Only batch (§ Payment-Only Pending Approval) — no purchase
  // plant, no items. The discriminator the create endpoint leaves behind.
  const isPaymentOnlyBatch = (r: UnifiedSaleBatch) => r.company_id == null;

  // § Zero-Payment Sale Auto-Approval — a real (non-Payment-Only) sale
  // that collected nothing at all has no separate payment action to take:
  // the backend auto-approves payment_status the moment Approve Sale is
  // clicked (routers/unified_sale.py's approve_unified_sale_sale), since
  // there's genuinely nothing to post. Never true for a Payment-Only
  // batch — its total_credit_received IS the payment.
  const hasZeroPayment = (r: UnifiedSaleBatch) => !isPaymentOnlyBatch(r) && Number(r.total_credit_received || 0) <= 0;

  // Sale/Load and Plant Payment/Settlement are independent — a batch shows
  // up in one, both, or neither of these two queues depending on which
  // side(s) are still pending. A Payment-Only batch is excluded from the
  // Sale/Load queue entirely — there's no load for a human to check there;
  // it sits in the Settlement queue only, approved as one atomic action
  // (see handleApprovePaymentOnly) rather than the two independent steps.
  const salePendingOrders = useMemo(
    () => recent.filter((r) => r.sale_status === "pending" && !isPaymentOnlyBatch(r)),
    [recent]
  );
  const paymentPendingOrders = useMemo(
    () => recent.filter((r) => r.payment_status === "pending" && !hasZeroPayment(r)),
    [recent]
  );

  // § Full-Screen Expand — Pending Approval tables. Reuses the same row
  // renderers as the inline (dense) tables; the modal just gets more room
  // plus a text search across the fields visible in that table.
  const [expandSection, setExpandSection] = useState<null | "sale" | "payment">(null);
  const [expandSearch, setExpandSearch] = useState("");
  const matchesExpandSearch = (r: UnifiedSaleBatch, extra: (string | null | undefined)[]) => {
    const q = expandSearch.trim().toLowerCase();
    if (!q) return true;
    const c = customers.find((x) => x.id === r.customer_id);
    const plant = companies.find((x) => x.id === r.company_id);
    return [r.display_id, c?.name, plant?.name, ...extra].some((v) => (v || "").toLowerCase().includes(q));
  };
  const expandedSaleRows = useMemo(
    () => salePendingOrders.filter((r) => matchesExpandSearch(r, [r.gate_pass_no, r.vehicle_no, r.notes])),
    [salePendingOrders, expandSearch, customers, companies]
  );
  const expandedPaymentRows = useMemo(
    () => paymentPendingOrders.filter((r) => matchesExpandSearch(r, [r.notes, r.payment_reference])),
    [paymentPendingOrders, expandSearch, customers, companies]
  );

  // § Bug Fix — Approved Payments destination display. A Payment's own
  // account_id is only meaningful for a plain quick-pay row — for a
  // Unified-Sale/Payment-Receipt-sourced row that settled straight to a
  // plant or Owner Home, account_id is legitimately null and
  // resolveAccountLabel's null fallback ("Office Cash") is simply wrong.
  // destination_type/target_plant_id/account_category (resolved backend-
  // side — see routers/payments.py._attach_destination_info) are the real
  // source of truth for where this payment actually went.
  const resolvePaymentAccountLabel = (p: Payment) => {
    if (p.destination_type === "plant") {
      const plant = companies.find((c) => c.id === p.target_plant_id);
      return plant ? t("payments.plantLabel", { name: plant.name }) : t("payments.plantSettlementBadge");
    }
    if (p.destination_type === "account") {
      return resolveAccountLabel(p.account_category ?? p.account_id, accounts);
    }
    return resolveAccountLabel(p.account_id, accounts);
  };

  const getDestinationLabel = (r: UnifiedSaleBatch) => {
    if (r.destination_type === "account") {
      return resolveAccountLabel(r.account_id, accounts);
    }
    const plant = companies.find((c) => c.id === (r.target_plant_id || r.company_id));
    return plant ? plant.name : t("unifiedSale.plantFallback");
  };

  // Approved Sale / Approved Payments (§3/§4) — active only, newest first,
  // narrowed by their own independent date filters.
  const approvedSales = useMemo(
    () => allSales
      .filter((s) => s.status === "active" && matchesDateFilter(s.date, saleDateFilter))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [allSales, saleDateFilter]
  );
  // One Invoice & One Transaction for Multi-Item Sales (§ One Invoice) —
  // several child Sale rows created by the SAME Unified Sale batch (one
  // per product/cylinder size) must appear as ONE row here, not as
  // disconnected separate sales — mirrors how the Customer Ledger already
  // aggregates a batch into a single "unified_sale" row. A plain Sale
  // (unified_sale_id null, from the ordinary New Sale form) still renders
  // on its own. The underlying per-product Sale rows are untouched —
  // FIFO/cylinder-balance/tonnage tracking still keys off them
  // individually; only this list's presentation is grouped.
  type ApprovedSaleRow =
    | { key: string; kind: "plain"; date: string; sale: Sale }
    | { key: string; kind: "batch"; date: string; batch: UnifiedSaleBatch | undefined; batchId: string; children: Sale[] };
  const approvedSaleRows = useMemo<ApprovedSaleRow[]>(() => {
    const batchChildren = new Map<string, Sale[]>();
    const rows: ApprovedSaleRow[] = [];
    for (const s of approvedSales) {
      if (s.unified_sale_id) {
        const arr = batchChildren.get(s.unified_sale_id) || [];
        arr.push(s);
        batchChildren.set(s.unified_sale_id, arr);
      } else {
        rows.push({ key: s.id, kind: "plain", date: s.date, sale: s });
      }
    }
    for (const [batchId, children] of batchChildren) {
      const batch = recent.find((r) => r.id === batchId);
      rows.push({
        key: batchId, kind: "batch", batchId, children,
        date: batch?.date || children[0].date,
        batch,
      });
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [approvedSales, recent]);
  const approvedPayments = useMemo(
    () => allPayments
      .filter((p) => p.status === "active" && matchesDateFilter(p.date, paymentDateFilter))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [allPayments, paymentDateFilter]
  );
  // See the Purchase Rate comment on `allPurchases` above — only resolvable
  // for a Unified-Sale-originated Sale.
  const purchaseRateFor = (s: Sale): string | null => {
    if (!s.unified_sale_id) return null;
    const match = allPurchases.find((p) => p.unified_sale_id === s.unified_sale_id && p.product_id === s.product_id);
    return match?.rate_per_cylinder ?? null;
  };
  // Approved Payments Rate (§3) — a Payment has no rate of its own; if it
  // settles a specific Sale (Payment.sale_id, optional), show that Sale's
  // rate for context rather than inventing one.
  const rateForPayment = (p: Payment): string | null => {
    if (!p.sale_id) return null;
    const sale = allSales.find((s) => s.id === p.sale_id);
    return sale?.rate_per_cylinder ?? null;
  };

  // § Shared table head/row renderers — SECTION A (Sale/Load) and SECTION B
  // (Plant Payment/Settlement) pending-approval tables. Used both inline
  // (dense) and inside the Full-Screen Expand modal (roomier) so the two
  // views never drift out of sync.
  const saleTableHead = (dense: boolean) => (
    <tr className="border-b border-hairline text-left">
      <Th dense={dense}>{t("unifiedSale.colId")}</Th>
      <Th dense={dense}>{t("unifiedSale.colDate")}</Th>
      <Th dense={dense}>{t("unifiedSale.colCustomer")}</Th>
      <Th dense={dense} right>{t("unifiedSale.col118")}</Th>
      <Th dense={dense} right>{t("unifiedSale.col454")}</Th>
      <Th dense={dense}>{t("unifiedSale.colPlant")}</Th>
      <Th dense={dense} right>{t("unifiedSale.colSale")}</Th>
      <Th dense={dense}>{t("unifiedSale.colGatePass")}</Th>
      <Th dense={dense}>{t("unifiedSale.colVehicle")}</Th>
      <Th dense={dense}>{t("unifiedSale.colNotes")}</Th>
      <Th dense={dense} right>{t("unifiedSale.colActions")}</Th>
    </tr>
  );

  const renderSaleRow = (r: UnifiedSaleBatch, dense: boolean) => {
    const c = customers.find((x) => x.id === r.customer_id);
    const plant = companies.find((x) => x.id === r.company_id);
    const busy = actionBusyId === r.id;
    const canEditOrCancel = r.payment_status === "pending";

    return (
      <tr key={r.id} className="hover:bg-paper/60 transition-colors">
        <Td dense={dense} mono>
          <button
            type="button"
            onClick={() => handleViewTransaction(r.id)}
            className="text-teal hover:underline font-mono text-[11px] font-bold whitespace-nowrap"
          >
            {r.display_id}
          </button>
        </Td>
        <Td dense={dense} mono color="#8E8E93">{fmtTime(r.date)}</Td>
        <Td dense={dense} bold>
          <div className="whitespace-nowrap" title={c?.name || "—"}>{c?.name || "—"}</div>
        </Td>
        <Td dense={dense} right mono bold>{Number(r.qty_11_8kg || 0)}</Td>
        <Td dense={dense} right mono bold>{Number(r.qty_45_4kg || 0)}</Td>
        <Td dense={dense}>
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-800 text-[11px] font-medium border border-slate-200 whitespace-nowrap">
            {plant?.name || r.company_id || "—"}
          </span>
        </Td>
        <Td dense={dense} right mono color="#0F8B8D">
          <span className="whitespace-nowrap">{pkr(r.total_selling_amount)}</span>
        </Td>
        <Td dense={dense} mono color="#8E8E93">{r.gate_pass_no || "—"}</Td>
        <Td dense={dense} mono color="#8E8E93">{r.vehicle_no || "—"}</Td>
        <Td dense={dense} color="#8E8E93"><span className="whitespace-nowrap">{r.notes || "—"}</span></Td>
        <Td dense={dense} right>
          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
            {canEditOrCancel && (
              <button
                type="button"
                title={t("unifiedSale.editTransaction")}
                disabled={busy}
                onClick={() => handleEditTransaction(r)}
                className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-steel hover:text-ink hover:bg-slate-200/60 border border-hairline transition-colors disabled:opacity-50"
              >
                <Pencil size={13} />
              </button>
            )}

            <button
              type="button"
              title={t("unifiedSale.approveSale")}
              disabled={busy}
              onClick={() => handleApproveSale(r.id)}
              className="h-8 shrink-0 inline-flex items-center justify-center gap-1 px-2.5 rounded-md bg-teal/10 hover:bg-teal/20 text-teal border border-teal/30 font-medium text-xs transition-colors disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              <span>{t("unifiedSale.approveSale")}</span>
            </button>

            {canEditOrCancel && (
              <button
                type="button"
                title={t("unifiedSale.cancelOrder")}
                disabled={busy}
                onClick={() => handleCancel(r.id)}
                className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-brand-red hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors disabled:opacity-50"
              >
                <Ban size={13} />
              </button>
            )}
          </div>
        </Td>
      </tr>
    );
  };

  const paymentTableHead = (dense: boolean) => (
    <tr className="border-b border-hairline text-left">
      <Th dense={dense}>{t("unifiedSale.colId")}</Th>
      <Th dense={dense}>{t("unifiedSale.colDate")}</Th>
      <Th dense={dense}>{t("unifiedSale.colPlant")}</Th>
      <Th dense={dense}>{t("unifiedSale.colSale")}</Th>
      <Th dense={dense} right>{t("unifiedSale.colSettled")}</Th>
      <Th dense={dense}>{t("unifiedSale.colDestination")}</Th>
      <Th dense={dense}>{t("unifiedSale.colReference")}</Th>
      <Th dense={dense}>{t("unifiedSale.colNotes")}</Th>
      <Th dense={dense} right>{t("unifiedSale.colActions")}</Th>
    </tr>
  );

  const renderPaymentRow = (r: UnifiedSaleBatch, dense: boolean) => {
    const c = customers.find((x) => x.id === r.customer_id);
    const plant = companies.find((x) => x.id === r.company_id);
    const busy = actionBusyId === r.id;
    const canEditOrCancel = r.sale_status === "pending";
    const paymentOnly = isPaymentOnlyBatch(r);
    // Payment-Only never shows Edit (§ handleEditTransaction) —
    // Cancel + re-enter only.
    const canEdit = canEditOrCancel && !paymentOnly;
    const netAmount = Number(r.net_plant_payment || 0) || Number(r.total_credit_received || 0);

    return (
      <tr key={r.id} className="hover:bg-paper/60 transition-colors">
        <Td dense={dense} mono>
          <button
            type="button"
            onClick={() => handleViewTransaction(r.id)}
            className="text-teal hover:underline font-mono text-[11px] font-bold whitespace-nowrap"
          >
            {r.display_id}
          </button>
        </Td>
        <Td dense={dense} mono color="#8E8E93">{fmtTime(r.date)}</Td>
        <Td dense={dense}>
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-800 text-[11px] font-medium border border-slate-200 whitespace-nowrap">
            {plant?.name || r.company_id || "—"}
          </span>
        </Td>
        <Td dense={dense} bold>
          <div className="whitespace-nowrap" title={c?.name || "—"}>{c?.name || "—"}</div>
        </Td>
        <Td dense={dense} right mono color="#1E8A5F" bold>
          <span className="whitespace-nowrap">{pkr(netAmount)}</span>
        </Td>
        <Td dense={dense}>
          <span className="whitespace-nowrap font-body text-xs text-slate-700 font-semibold">
            {getDestinationLabel(r)}
          </span>
        </Td>
        <Td dense={dense}>
          <input
            value={paymentReferenceDrafts[r.id] ?? (r.payment_reference || "")}
            onChange={(e) => setPaymentReferenceDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
            placeholder={t("unifiedSale.referencePlaceholder")}
            className="font-body text-xs px-2 py-1 rounded-md border border-hairline outline-none text-ink bg-white w-32 focus:border-teal"
          />
        </Td>
        <Td dense={dense} color="#8E8E93"><span className="whitespace-nowrap">{r.notes || "—"}</span></Td>
        <Td dense={dense} right>
          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
            {canEdit && (
              <button
                type="button"
                title={t("unifiedSale.editTransaction")}
                disabled={busy}
                onClick={() => handleEditTransaction(r)}
                className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-steel hover:text-ink hover:bg-slate-200/60 border border-hairline transition-colors disabled:opacity-50"
              >
                <Pencil size={13} />
              </button>
            )}

            <button
              type="button"
              title={t("unifiedSale.approvePayment")}
              disabled={busy}
              onClick={() => (paymentOnly ? handleApprovePaymentOnly(r.id) : handleApprovePayment(r.id))}
              className="h-8 shrink-0 inline-flex items-center justify-center gap-1 px-2.5 rounded-md bg-teal/10 hover:bg-teal/20 text-teal border border-teal/30 font-medium text-xs transition-colors disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              <span>{t("unifiedSale.approvePayment")}</span>
            </button>

            {canEditOrCancel && (
              <button
                type="button"
                title={t("unifiedSale.cancelOrder")}
                disabled={busy}
                onClick={() => handleCancel(r.id)}
                className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-brand-red hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors disabled:opacity-50"
              >
                <Ban size={13} />
              </button>
            )}
          </div>
        </Td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("unifiedSale.eyebrow")}
        title={t("unifiedSale.title")}
        caption={t("unifiedSale.caption")}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => { resetForm(); setShowSaleForm(true); }}
          className="group rounded-xl border border-teal/30 bg-teal/5 hover:bg-teal/10 transition-colors p-5 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-lg bg-teal text-white flex items-center justify-center">
              <PlusCircle size={19} />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wide text-teal font-semibold">{t("unifiedSale.createBadge")}</span>
          </div>
          <div className="mt-4 font-display text-lg font-bold text-ink">{t("unifiedSale.newSale")}</div>
          <div className="mt-1 font-body text-xs text-steel">{t("unifiedSale.newSaleCaption")}</div>
        </button>

        <Panel className="!p-5">
          <div className="font-mono text-[10px] uppercase text-steel">{t("unifiedSale.saleLoad")}</div>
          <div className="mt-2 font-display text-2xl font-bold text-[#8A6D00]">{salePendingOrders.length}</div>
          <div className="mt-1 font-body text-xs text-steel">{t("unifiedSale.pendingSaleLoadApprovals")}</div>
        </Panel>

        <Panel className="!p-5">
          <div className="font-mono text-[10px] uppercase text-steel">{t("unifiedSale.plantPayments")}</div>
          <div className="mt-2 font-display text-2xl font-bold text-[#8A6D00]">{paymentPendingOrders.length}</div>
          <div className="mt-1 font-body text-xs text-steel">{t("unifiedSale.pendingSettlementApprovals")}</div>
        </Panel>

        <button
          type="button"
          onClick={() => setShowApprovedSaleModal(true)}
          className="group rounded-xl border border-hairline bg-panel hover:bg-paper transition-colors p-5 text-left"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-[#1E8A5F]" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-steel font-semibold">{t("unifiedSale.approvedSale")}</span>
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-[#1E8A5F]">{allSales.filter((s) => s.status === "active").length}</div>
          <div className="mt-1 font-body text-xs text-teal flex items-center gap-1">
            {t("unifiedSale.viewAllSales")} <ArrowRight size={12} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setShowApprovedPaymentsModal(true)}
          className="group rounded-xl border border-hairline bg-panel hover:bg-paper transition-colors p-5 text-left"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-[#1E8A5F]" />
            <span className="font-mono text-[10px] uppercase tracking-wide text-steel font-semibold">{t("unifiedSale.approvedPayments")}</span>
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-[#1E8A5F]">{allPayments.filter((p) => p.status === "active").length}</div>
          <div className="mt-1 font-body text-xs text-teal flex items-center gap-1">
            {t("unifiedSale.viewAllPayments")} <ArrowRight size={12} />
          </div>
        </button>
      </div>

      <div className="space-y-6">

        {/* NEW / EDIT SALE MODAL */}
        {showSaleForm && (
          <div
            className="fixed inset-0 z-40 bg-black/40 p-3 sm:p-5 flex items-center justify-center"
            onMouseDown={(e) => { if (e.target === e.currentTarget) resetForm(); }}
          >
            <div className="w-full max-w-5xl max-h-[94vh] overflow-hidden bg-white rounded-xl shadow-2xl flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
                <div>
                  <Eyebrow>
                    {editingId
                      ? t("unifiedSale.editPendingSale")
                      : formMode === "payment_only" ? t("unifiedSale.modePaymentOnly") : t("unifiedSale.newUnifiedSale")}
                  </Eyebrow>
                  <div className="font-body text-xs text-steel mt-1">
                    {editingId
                      ? t("unifiedSale.editingId", { id: editingDisplayId })
                      : formMode === "payment_only" ? t("unifiedSale.paymentOnlyCaption") : t("unifiedSale.createSaleSettlementRouting")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink"
                  title={t("unifiedSale.close")}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto p-3 sm:p-5">
                <Panel>
            <div className="flex flex-col gap-4">
              {editingId && (
                <div className="flex items-center justify-between px-3 py-2 bg-[#FFF6E0] border border-[#F0DFA0] rounded-lg">
                  <span className="font-body text-xs text-[#8A6D00]">{t("unifiedSale.editingPendingOrder", { id: editingDisplayId })}</span>
                  <button type="button" onClick={resetForm} className="font-body text-xs text-[#8A6D00] underline">
                    {t("unifiedSale.cancelEdit")}
                  </button>
                </div>
              )}

              {/* Mode Switch — editing is always a Full Sale (a Unified Sale
                  batch); Payment Only posts through the same POST
                  /sales/unified endpoint (items: [], no plant_id — see
                  handleSubmit) and has no separate pending state to edit
                  back into, so the toggle only makes sense for a brand-new
                  entry. */}
              {!editingId && (
                <div className="grid grid-cols-2 gap-2 p-1 bg-paper rounded-lg border border-hairline">
                  <button
                    type="button"
                    onClick={() => setFormMode("full_sale")}
                    className={`py-2 rounded-md font-body text-[13px] font-semibold transition-colors ${
                      formMode === "full_sale" ? "bg-teal text-white" : "text-steel hover:bg-white"
                    }`}
                  >
                    {t("unifiedSale.modeFullSale")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMode("payment_only")}
                    className={`py-2 rounded-md font-body text-[13px] font-semibold transition-colors ${
                      formMode === "payment_only" ? "bg-teal text-white" : "text-steel hover:bg-white"
                    }`}
                  >
                    {t("unifiedSale.modePaymentOnly")}
                  </button>
                </div>
              )}

              <div className={`grid grid-cols-1 ${formMode === "full_sale" ? "sm:grid-cols-2" : ""} gap-3`}>
                <Field label={t("unifiedSale.date")}>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                </Field>
                {formMode === "full_sale" && (
                  <Field label={t("unifiedSale.purchasePlant")}>
                    <div className="relative">
                      <div className="flex gap-1.5">
                        <input
                          value={selectedCompany ? selectedCompany.name : companySearch}
                          onChange={(e) => { setCompanyId(""); setCompanySearch(e.target.value); }}
                          placeholder={t("unifiedSale.searchOrAddPlant")}
                          className={`${inputClass} flex-1`}
                        />
                        <Button variant="outline" onClick={() => setShowNewPlant(true)}><PlusCircle size={14} /></Button>
                      </div>
                      {!companyId && companySearch.trim() && (
                        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-52 overflow-y-auto shadow-lg">
                          {filteredCompanies.slice(0, 8).map((c) => (
                            <button
                              key={c.id}
                              onClick={() => { setCompanyId(c.id); setCompanySearch(""); }}
                              className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px]"
                            >
                              <span className="font-semibold text-ink">{c.name}</span>
                            </button>
                          ))}
                          {!filteredCompanies.length && (
                            <button
                              onClick={() => setShowNewPlant(true)}
                              className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px] text-teal"
                            >
                              {t("unifiedSale.addAsNewPlant", { name: companySearch.trim() })}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </Field>
                )}
              </div>

              {/* Party — only shown when the selected plant genuinely has
                  more than one (auto-selected silently for 0 or 1, so the
                  common case needs no extra click; see the effect above). */}
              {formMode === "full_sale" && companyId && companyParties.length > 1 && (
                <Field label={t("rateDashboard.party")}>
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">{t("rateDashboard.selectParty")}</option>
                    <option value={NO_PARTY_VALUE}>{t("rateDashboard.noPartyOption")}</option>
                    {companyParties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
              )}

              {formMode === "full_sale" && companyId && partyId && !resolvedRate && (
                <div className="px-3 py-2.5 rounded-lg border flex items-center gap-2 bg-[#FBEAEA] border-[#EFC3C3]">
                  <AlertTriangle size={15} className="text-brand-red flex-shrink-0" />
                  <span className="font-body text-xs">
                    {t("rateDashboard.noRateForPair", {
                      company: selectedCompany?.name || "",
                      party: partyId === NO_PARTY_VALUE
                        ? t("rateDashboard.noPartyOption")
                        : companyParties.find((p) => p.id === partyId)?.name || "",
                    })}
                  </span>
                </div>
              )}

              <Field label={t("unifiedSale.customer")}>
                <div className="relative">
                  <input
                    value={selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.display_id}` : customerSearch}
                    onChange={(e) => { setCustomerId(""); setCustomerSearch(e.target.value); }}
                    placeholder={t("unifiedSale.searchCustomer")}
                    className={inputClass}
                  />
                  {!customerId && customerSearch.trim() && (
                    <div className="absolute z-20 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-52 overflow-y-auto shadow-lg">
                      {filteredCustomers.slice(0, 8).map((c) => (
                        <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(""); }} className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px]">
                          <span className="font-semibold text-ink">{c.name}</span> <span className="text-steel">· {c.display_id} · {c.mobile}</span>
                        </button>
                      ))}
                      {!filteredCustomers.length && <div className="px-3 py-2 font-body text-[13px] text-steel">{t("unifiedSale.noMatch")}</div>}
                    </div>
                  )}
                </div>
              </Field>

              {/* Delivery Details, Items, GST — Full Sale only. Payment Only
                  has no physical delivery, no items, and nothing to charge
                  GST against; hiding rather than disabling avoids a form
                  full of irrelevant empty/disabled sections. */}
              {formMode === "full_sale" && (
              <>
              <div className="border-t border-hairline pt-4">
                <Eyebrow>{t("unifiedSale.deliveryDetails")}</Eyebrow>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <Field label={vehicleRequired ? t("unifiedSale.vehicleNoRequired") : t("unifiedSale.vehicleNoOptional")}>
                    <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} required={vehicleRequired} className={inputClass} />
                  </Field>
                  <Field label={t("unifiedSale.gatePassNo")}>
                    <input value={gatePassNo} onChange={(e) => setGatePassNo(e.target.value)} className={inputClass} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label={t("unifiedSale.deliveryChargesRs")}>
                    <AmountInput value={deliveryCharges} onChange={setDeliveryCharges} placeholder="0" className={inputClass} />
                  </Field>
                  <Field label={t("unifiedSale.notes")}>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("unifiedSale.remarksPlaceholder")} className={inputClass} />
                  </Field>
                </div>
              </div>

              {/* Items Section */}
              <div className="border-t border-hairline pt-4">
                <Eyebrow>{t("unifiedSale.itemsOptional")}</Eyebrow>
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
                          <input type="number" value={row.qty} onChange={(e) => setItemField(p.id, "qty", e.target.value)} placeholder={t("unifiedSale.qtyPlaceholder")} className={inputClass} />
                          <AmountInput value={row.purchaseRate} onChange={(v) => setItemField(p.id, "purchaseRate", v)} placeholder={t("unifiedSale.purchasePlaceholder")} className={inputClass} />
                          <AmountInput value={row.sellingRate} onChange={(v) => setItemField(p.id, "sellingRate", v)} placeholder={t("unifiedSale.sellingPlaceholder")} className={inputClass} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(activeItems.length > 0 || deliveryChargesNum > 0) && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="px-3 py-2 bg-ink rounded-md">
                      <div className="font-mono text-[9.5px] text-[#9FD8D8] uppercase">{t("unifiedSale.sellingTotal")}</div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white mt-0.5">{pkr(totalSelling)}</div>
                    </div>
                    <div className="px-3 py-2 bg-ink rounded-md">
                      <div className="font-mono text-[9.5px] text-[#9FD8D8] uppercase">{t("unifiedSale.purchaseTotal")}</div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white mt-0.5">{pkr(totalPurchase)}</div>
                    </div>
                    <div className="px-3 py-2 bg-ink rounded-md">
                      <div className="font-mono text-[9.5px] text-[#9FD8D8] uppercase">{t("unifiedSale.margin")}</div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white mt-0.5">{pkr(margin)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* GST Section (§ GST on Sale) — optional, applies to the
                  whole batch's total_selling_amount; frozen server-side
                  at create/edit time. */}
              <div className="border-t border-hairline pt-4">
                <Eyebrow>{t("unifiedSale.gstSectionTitle")}</Eyebrow>
                <div className="flex items-center gap-3 mt-2">
                  <label className="flex items-center gap-1.5 font-body text-[13px] text-ink cursor-pointer">
                    <input type="checkbox" checked={gstEnabled} onChange={(e) => setGstEnabled(e.target.checked)} />
                    {t("unifiedSale.applyGst")}
                  </label>
                  {gstEnabled && (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                      placeholder="Rate %"
                      className={`${inputClass} w-24`}
                    />
                  )}
                </div>

                {gstEnabled && effectiveGstRate > 0 && (
                  <div className="flex flex-col gap-1 px-3 py-2.5 bg-ink rounded-lg mt-3">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-[10.5px] text-[#9FD8D8] tracking-wide uppercase">
                        {t("unifiedSale.valueExclTax")}
                      </span>
                      <span className="font-display font-semibold text-sm text-white">{pkr(totalSelling)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-[10.5px] text-[#9FD8D8] tracking-wide uppercase">
                        GST @ {gstRate}%
                      </span>
                      <span className="font-display font-semibold text-sm text-white">{pkr(gstAmount)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-white/20 pt-1 mt-0.5">
                      <span className="font-mono text-[11px] text-[#9FD8D8] tracking-wide uppercase">
                        {t("unifiedSale.grandTotal")}
                      </span>
                      <span className="font-display font-bold text-lg text-white">{pkr(grandTotalWithGst)}</span>
                    </div>
                  </div>
                )}
              </div>
              </>
              )}

              {/* Settlement Section */}
              <div className="border-t border-hairline pt-4 space-y-3">
                <Eyebrow>{t("unifiedSale.paymentSettlementRouting")}</Eyebrow>
                <SectionCaption>
                  {t("unifiedSale.paymentSettlementCaption")}
                </SectionCaption>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label={t("unifiedSale.paymentFormat")}>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className={inputClass}>
                      <option value="cash">{t("unifiedSale.methodCash")}</option>
                      <option value="online">{t("unifiedSale.methodOnline")}</option>
                      <option value="cheque">{t("unifiedSale.methodCheque")}</option>
                      <option value="bank_transfer">{t("expenses.methodBankTransfer")}</option>
                    </select>
                  </Field>

                  <Field label={t("unifiedSale.totalReceivedPkr")}>
                    <AmountInput value={totalCreditReceived} onChange={setTotalCreditReceived} placeholder="0" className={`${inputClass} font-mono font-bold text-teal`} />
                  </Field>
                </div>

                {/* § Multi-line Categorized Home Expense — repeatable
                    category+amount rows, same component/pattern as
                    RecordShopSaleModal's Deductions section. */}
                <div>
                  <div className="font-body text-[11px] text-steel mb-1.5">{t("unifiedSale.homeExpense")}</div>
                  <HomeExpenseLinesEditor
                    lines={homeExpenseLines}
                    onChange={setHomeExpenseLines}
                    categories={categories.filter((c) => c.active === "active")}
                    onCategoriesChange={(next) => setCategories(next)}
                    employees={employees}
                  />
                </div>

                <Field label={t("unifiedSale.ownerDrawings")}>
                  <AmountInput value={ownerDrawingsAmount} onChange={setOwnerDrawingsAmount} placeholder="0" className={inputClass} />
                </Field>

                {/* Destination Routing Selector */}
                <div className="p-3 bg-paper rounded-lg border border-hairline space-y-3">
                  <div className="font-mono text-[10px] text-steel uppercase font-semibold">{t("unifiedSale.routeRemainingBalanceTo", { amount: pkr(Math.max(netPlantPayment, 0)) })}</div>
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
                      <Building2 size={14} /> {t("unifiedSale.plantSettlementOption")}
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
                      <Wallet size={14} /> {t("unifiedSale.accountDepositOption")}
                    </button>


                  </div>

                  {destinationType === "plant" ? (
                    // Payment Only has no purchase plant to fall back on, so
                    // the "same as purchase plant" default option (blank
                    // value) only makes sense in Full Sale mode — an
                    // explicit pick is required here instead (see
                    // paymentOnlyDestinationValid in canSubmit above).
                    <Field label={formMode === "full_sale" ? t("unifiedSale.targetPlantDefault") : t("unifiedSale.targetPlantRequired")}>
                      <select value={targetPlantId} onChange={(e) => setTargetPlantId(e.target.value)} className={inputClass}>
                        {formMode === "full_sale" ? (
                          <option value="">{t("unifiedSale.sameAsPurchasePlant", { name: selectedCompany?.name || t("unifiedSale.selectedFallback") })}</option>
                        ) : (
                          <option value="">{t("unifiedSale.selectPlant")}</option>
                        )}
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  ) : (
                    <div className="space-y-2">
                      {/* Fixed to exactly these 4 buckets — never a dynamic
                          bank/cash PaymentAccount row (§ Settlement Routing). */}
                      <Field label={t("unifiedSale.targetAccount")}>
<select value={accountCategory} onChange={(e) => setAccountCategory(e.target.value as AccountType)} className={inputClass}>
  <option value="office_cash">{t("payments.officeCash")}</option>
  <option value="dowa_account">{t("payments.dowaAccount")}</option>
  <option value="owner_home">{t("payments.ownerHome")}</option>
</select>
                      </Field>
                    </div>
                  )}
                </div>

                <Field label={t("unifiedSale.settlementReferenceOptional")}>
                  <input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder={t("unifiedSale.settlementReferencePlaceholder")}
                    className={inputClass}
                  />
                </Field>

                {(homeExpenseNum > 0 || ownerDrawingsAmount || totalCreditReceived) && (
                  <div className={`px-3 py-2.5 rounded-lg border flex items-center gap-2 ${settlementValid ? "bg-[#EAF5EF] border-[#C7E6D3]" : "bg-[#FBEAEA] border-[#EFC3C3]"}`}>
                    {settlementValid ? <CheckCircle2 size={15} className="text-brand-green flex-shrink-0" /> : <AlertTriangle size={15} className="text-brand-red flex-shrink-0" />}
                    <span className="font-body text-xs">
                      {pkr(homeExpenseNum)} + {pkr(ownerDrawingsAmount || 0)} = <b>{pkr(bypassSum)}</b>
                      {" "}{settlementValid
                        ? <Trans
                            i18nKey="unifiedSale.settlementLeavesTo"
                            values={{ remaining: pkr(Math.max(netPlantPayment, 0)), destination: destinationType === "plant" ? (companies.find(c => c.id === (targetPlantId || companyId))?.name || t("unifiedSale.plantFallback")) : accountCategoryLabel(accountCategory) }}
                            components={{ 1: <b />, 2: <b /> }}
                          />
                        : t("unifiedSale.settlementExceeds", { total: pkr(totalCreditNum) })}
                    </span>
                  </div>
                )}
              </div>

              {(selectedCustomer || selectedCompany) && (
                <div className="font-body text-xs text-steel border-t border-hairline pt-3">
                  <div className="text-[10px] uppercase text-steel/70 mb-1">{t("unifiedSale.projectedOnApproval")}</div>
                  {selectedCustomer && <div>{t("unifiedSale.customerBalanceAfter", { before: pkr(selectedCustomer.current_balance), after: "" })}<b className="text-ink">{pkr(projectedCustomerBalance!)}</b></div>}
                  {selectedCompany && (
                    <div className="mt-1">
                      {t("unifiedSale.plantPayableAfter", { name: selectedCompany.name, before: pkr(selectedCompany.current_balance), after: "" })}
                      <b className="text-ink">{pkr(projectedPlantBalance!)}</b>
                    </div>
                  )}
                  {targetPlant && (
                    <div className="mt-1">
                      {t("unifiedSale.settlementPlantPayableAfter", { name: targetPlant.name, before: pkr(targetPlant.current_balance), after: "" })}
                      <b className="text-ink">{pkr(projectedTargetPlantBalance!)}</b>
                    </div>
                  )}
                </div>
              )}

              {error && <div className="font-body text-xs text-brand-red">{error}</div>}

              <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
                {saving
                  ? t("unifiedSale.saving")
                  : editingId
                  ? t("unifiedSale.saveChanges")
                  : formMode === "payment_only" ? t("unifiedSale.modePaymentOnly") : t("unifiedSale.saveUnifiedSalePending")}
              </Button>
            </div>
                </Panel>
              </div>
            </div>
          </div>
        )}

        {/* PENDING QUEUE & RECENT TABLE */}
        <div className="space-y-6">

          {/* Last Created Alert */}
          {lastResult && (
            <Panel className="border-2 border-teal">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-teal" />
                  <Eyebrow>{t("unifiedSale.savedBadge", { id: lastResult.display_id })}</Eyebrow>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase text-steel">{t("unifiedSale.colSale")}</span>
                  <StatusBadge status={lastResult.sale_status} />
                  <span className="font-mono text-[9px] uppercase text-steel ml-1.5">{t("customerLedger.colPayment")}</span>
                  <StatusBadge status={lastResult.payment_status} />
                </div>
              </div>
              <div className="flex flex-col gap-1 font-body text-xs text-steel">
                {lastResult.sales.length > 0 && (
                  <div className="mt-2">
                    <div className="font-semibold text-ink mb-1">{t("unifiedSale.saleItems")}</div>
                    {lastResult.sales.map((sale) => {
                      const product = products.find((p) => p.id === sale.product_id);
                      return (
                        <div key={sale.id} className="flex justify-between text-xs">
                          <span>{product?.name || t("unifiedSale.colProduct")} × {fmtNumber(sale.quantity, 2)}</span>
                          <span>{pkr(sale.total_amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {Number(lastResult.delivery_charges) > 0 && (
                  <div className="flex justify-between text-xs">
                    <span>{t("unifiedSale.deliveryChargesLabel")}</span>
                    <span>{pkr(lastResult.delivery_charges)}</span>
                  </div>
                )}
                {Number(lastResult.net_plant_payment) > 0 && (
                  <div>
                    <Trans
                      i18nKey="unifiedSale.settlementRoutedTo"
                      values={{ amount: pkr(lastResult.net_plant_payment), destination: getDestinationLabel(lastResult) }}
                      components={{ 1: <b /> }}
                    />
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {isPaymentOnlyBatch(lastResult) ? (
                    lastResult.payment_status === "pending" && (
                      <Button variant="teal" onClick={() => handleApprovePaymentOnly(lastResult.id)} disabled={actionBusyId === lastResult.id}>
                        <ThumbsUp size={13} className="mr-1" /> {t("unifiedSale.approvePayment")}
                      </Button>
                    )
                  ) : (
                    <>
                      {lastResult.sale_status === "pending" && (
                        <Button variant="teal" onClick={() => handleApproveSale(lastResult.id)} disabled={actionBusyId === lastResult.id}>
                          <ThumbsUp size={13} className="mr-1" /> {t("unifiedSale.approveSale")}
                        </Button>
                      )}
                      {lastResult.payment_status === "pending" && !hasZeroPayment(lastResult) && (
                        <Button variant="teal" onClick={() => handleApprovePayment(lastResult.id)} disabled={actionBusyId === lastResult.id}>
                          <ThumbsUp size={13} className="mr-1" /> {t("unifiedSale.approvePayment")}
                        </Button>
                      )}
                    </>
                  )}
                  {lastResult.sale_status === "pending" && lastResult.payment_status === "pending" && (
                    <Button variant="outline" onClick={() => handleCancel(lastResult.id)} disabled={actionBusyId === lastResult.id}>
                      <Ban size={13} className="mr-1" /> {t("unifiedSale.cancel")}
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {/* SECTION A — Sale / Load pending approval */}
          <Panel>
            <div className="flex items-center justify-between">
              <div>
                <Eyebrow>{t("unifiedSale.saleLoadPendingApproval")}</Eyebrow>
                <SectionCaption>{t("unifiedSale.saleLoadPendingCaption")}</SectionCaption>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-[#FFF6E0] text-[#8A6D00] font-mono text-xs font-semibold border border-[#FFE7A3]">
                  {t("unifiedSale.pendingCount", { count: salePendingOrders.length })}
                </span>
                <button
                  type="button"
                  title={t("unifiedSale.expandTable")}
                  onClick={() => { setExpandSearch(""); setExpandSection("sale"); }}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-steel hover:text-ink hover:bg-slate-200/60 border border-hairline transition-colors"
                >
                  <Maximize2 size={13} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto mt-3 -mx-1 px-1">
              <table className="w-full min-w-[1250px] border-collapse">
                <thead>{saleTableHead(true)}</thead>
                <tbody className="divide-y divide-hairline">
                  {salePendingOrders.map((r) => renderSaleRow(r, true))}

                  {!salePendingOrders.length && (
                    <tr>
                      <td colSpan={11} className="text-steel font-body text-[13px] py-6 text-center">
                        {t("unifiedSale.noSalesAwaitingApproval")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* SECTION B — Plant Payment / Settlement pending approval */}
          <Panel>
            <div className="flex items-center justify-between">
              <div>
                <Eyebrow>{t("unifiedSale.plantPaymentSettlementPendingApproval")}</Eyebrow>
                <SectionCaption>{t("unifiedSale.plantPaymentPendingCaption")}</SectionCaption>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-[#FFF6E0] text-[#8A6D00] font-mono text-xs font-semibold border border-[#FFE7A3]">
                  {t("unifiedSale.pendingCount", { count: paymentPendingOrders.length })}
                </span>
                <button
                  type="button"
                  title={t("unifiedSale.expandTable")}
                  onClick={() => { setExpandSearch(""); setExpandSection("payment"); }}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-steel hover:text-ink hover:bg-slate-200/60 border border-hairline transition-colors"
                >
                  <Maximize2 size={13} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto mt-3 -mx-1 px-1">
              <table className="w-full min-w-[1150px] border-collapse">
                <thead>{paymentTableHead(true)}</thead>
                <tbody className="divide-y divide-hairline">
                  {paymentPendingOrders.map((r) => renderPaymentRow(r, true))}

                  {!paymentPendingOrders.length && (
                    <tr>
                      <td colSpan={9} className="text-steel font-body text-[13px] py-6 text-center">
                        {t("unifiedSale.noPlantPaymentsAwaitingApproval")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* § Full-Screen Expand — Pending Approval tables */}
          {expandSection && (
            <div
              className="fixed inset-0 z-[60] bg-white p-6 overflow-auto flex flex-col"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setExpandSection(null); }}
            >
              <div className="w-full h-full max-w-none max-h-none overflow-hidden bg-white rounded-xl shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0 gap-3 flex-wrap">
                  <div>
                    <Eyebrow>
                      {expandSection === "sale" ? t("unifiedSale.saleLoadPendingApproval") : t("unifiedSale.plantPaymentSettlementPendingApproval")}
                    </Eyebrow>
                    <SectionCaption>
                      {t("unifiedSale.pendingCount", { count: expandSection === "sale" ? expandedSaleRows.length : expandedPaymentRows.length })}
                    </SectionCaption>
                  </div>
                  <div className="flex items-center gap-2 flex-1 justify-end min-w-[220px]">
                    <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5 w-full max-w-[320px]">
                      <Search size={13} className="text-steel shrink-0" />
                      <input
                        autoFocus
                        value={expandSearch}
                        onChange={(e) => setExpandSearch(e.target.value)}
                        placeholder={t("unifiedSale.expandSearchPlaceholder")}
                        className="border-none outline-none font-body text-xs py-2 w-full"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandSection(null)}
                      className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-steel hover:text-ink hover:bg-slate-200/60 border border-hairline transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div className="min-w-full overflow-x-auto overflow-y-auto p-4 flex-1">
                  {expandSection === "sale" ? (
                    <table className="w-full min-w-[1250px] border-collapse">
                      <thead>{saleTableHead(true)}</thead>
                      <tbody className="divide-y divide-hairline">
                        {expandedSaleRows.map((r) => renderSaleRow(r, true))}
                        {!expandedSaleRows.length && (
                          <tr>
                            <td colSpan={11} className="text-steel font-body text-xs py-6 text-center whitespace-nowrap">
                              {t("unifiedSale.noSalesAwaitingApproval")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full min-w-[1150px] border-collapse">
                      <thead>{paymentTableHead(true)}</thead>
                      <tbody className="divide-y divide-hairline">
                        {expandedPaymentRows.map((r) => renderPaymentRow(r, true))}
                        {!expandedPaymentRows.length && (
                          <tr>
                            <td colSpan={9} className="text-steel font-body text-xs py-6 text-center whitespace-nowrap">
                              {t("unifiedSale.noPlantPaymentsAwaitingApproval")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* APPROVED SALE — plain Sale records, system-wide (§3/§4) */}
          {showApprovedSaleModal && (
            <div
              className="fixed inset-0 z-40 bg-black/40 p-3 sm:p-5 flex items-center justify-center"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setShowApprovedSaleModal(false); }}
            >
              <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden bg-white rounded-xl shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
                  <div>
                    <Eyebrow>{t("unifiedSale.approvedSale")}</Eyebrow>
                    <div className="font-body text-xs text-steel mt-1">{t("unifiedSale.approvedSaleCaption")}</div>
                  </div>
                  <button type="button" onClick={() => setShowApprovedSaleModal(false)} className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink" title={t("unifiedSale.close")}>
                    <X size={18} />
                  </button>
                </div>
                <div className="overflow-y-auto p-3 sm:p-5">
                  <Panel>
                    <div className="mt-1"><DateFilterToolbar value={saleDateFilter} onChange={setSaleDateFilter} /></div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[1450px] border-collapse">
                        <thead>
                          <tr className="border-b border-hairline text-left">
                            <Th>{t("unifiedSale.colId")}</Th>
                            <Th>{t("unifiedSale.colDate")}</Th>
                            <Th>{t("unifiedSale.colCustomer")}</Th>
                            <Th>{t("unifiedSale.colProduct")}</Th>
                            <Th right>{t("unifiedSale.colQty")}</Th>
                            <Th right>{t("unifiedSale.colSellingRate")}</Th>
                            <Th right>{t("unifiedSale.colPurchaseRate")}</Th>
                            <Th right>{t("unifiedSale.colValueExclTax")}</Th>
                            <Th right>{t("unifiedSale.colGstRate")}</Th>
                            <Th right>{t("unifiedSale.colGstAmount")}</Th>
                            <Th right>{t("unifiedSale.colDeliveryCharges")}</Th>
                            <Th right>{t("unifiedSale.colGrandTotal")}</Th>
                            <Th>{t("unifiedSale.colEnteredBy")}</Th>
                            <Th center>{t("unifiedSale.colEdit")}</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {approvedSaleRows.map((row) => {
                            if (row.kind === "plain") {
                              const s = row.sale;
                              const c = customers.find((x) => x.id === s.customer_id);
                              const product = products.find((x) => x.id === s.product_id);
                              const purchaseRate = purchaseRateFor(s);
                              return (
                                <tr key={row.key} className="hover:bg-paper/60 transition-colors">
                                  <Td mono>{s.display_id}</Td>
                                  <Td mono>{fmtTime(s.date)}</Td>
                                  <Td bold>{c?.name || "—"}</Td>
                                  <Td>{product?.name || "—"}</Td>
                                  <Td right mono>{fmtNumber(s.quantity, 2)}</Td>
                                  <Td right mono>{s.rate_per_cylinder ? pkr(s.rate_per_cylinder) : "—"}</Td>
                                  <Td right mono color="#8E8E93">{purchaseRate ? pkr(purchaseRate) : "—"}</Td>
                                  <Td right mono>{pkr(s.total_amount)}</Td>
                                  <Td right mono>{s.gst_rate ? `${s.gst_rate}%` : "—"}</Td>
                                  <Td right mono>{s.gst_amount && parseFloat(s.gst_amount) > 0 ? pkr(s.gst_amount) : "—"}</Td>
                                  <Td right mono>—</Td>
                                  <Td right mono bold>{pkr(s.grand_total ?? s.total_amount)}</Td>
                                  <Td mono>{s.entered_by}</Td>
                                  <Td center>
                                    <div className="flex items-center justify-center gap-1">
                                      <button type="button" onClick={() => setCorrectTarget({ kind: "sale", transaction: s })} className="p-1.5 rounded-md hover:bg-paper text-steel hover:text-teal" title={t("unifiedSale.correctThisSale")}>
                                        <Pencil size={13} />
                                      </button>
                                      <a href={api.sales.invoiceUrl(s.id)} target="_blank" rel="noreferrer" className="p-1.5 rounded-md hover:bg-paper text-steel hover:text-teal" title={t("unifiedSale.viewPrintInvoice")}>
                                        <Printer size={13} />
                                      </a>
                                    </div>
                                  </Td>
                                </tr>
                              );
                            }

                            // One Invoice & One Transaction for Multi-Item
                            // Sales (§ One Invoice) — a bold parent summary
                            // row for the whole batch (one combined invoice
                            // button), followed by its individual line
                            // items indented underneath so each product can
                            // still be corrected on its own.
                            const { batch, batchId, children } = row;
                            const c = customers.find((x) => x.id === children[0].customer_id);
                            const productNames = children
                              .map((s) => products.find((x) => x.id === s.product_id)?.name || "—")
                              .join(", ");
                            const sellingRates = children.map((s) => (s.rate_per_cylinder ? pkr(s.rate_per_cylinder) : "—")).join(", ");
                            const purchaseRates = children.map((s) => { const r = purchaseRateFor(s); return r ? pkr(r) : "—"; }).join(", ");
                            const totalQty = children.reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);
                            const valueExclTax = batch ? batch.total_selling_amount : children.reduce((sum, s) => sum + (parseFloat(s.total_amount) || 0), 0);
                            const grandTotal = (batch?.grand_total) ?? valueExclTax;
                            return (
                              <Fragment key={row.key}>
                                <tr className="bg-teal/5 hover:bg-teal/10 transition-colors">
                                  <Td mono bold>{batch?.display_id || t("unifiedSale.unifiedSaleFallback")}</Td>
                                  <Td mono>{fmtTime(row.date)}</Td>
                                  <Td bold>{c?.name || "—"}</Td>
                                  <Td>{productNames}</Td>
                                  <Td right mono>{fmtNumber(totalQty, 2)}</Td>
                                  <Td right mono>{sellingRates}</Td>
                                  <Td right mono color="#8E8E93">{purchaseRates}</Td>
                                  <Td right mono>{pkr(valueExclTax)}</Td>
                                  <Td right mono>{batch?.gst_rate ? `${batch.gst_rate}%` : "—"}</Td>
                                  <Td right mono>{batch?.gst_amount && parseFloat(batch.gst_amount) > 0 ? pkr(batch.gst_amount) : "—"}</Td>
                                  <Td right mono>{batch?.delivery_charges && parseFloat(batch.delivery_charges) > 0 ? pkr(batch.delivery_charges) : "—"}</Td>
                                  <Td right mono bold>{pkr(grandTotal)}</Td>
                                  <Td mono>{batch?.entered_by || children[0].entered_by}</Td>
                                  <Td center>
                                    <a href={api.unifiedSale.invoiceUrl(batchId)} target="_blank" rel="noreferrer" className="inline-flex p-1.5 rounded-md hover:bg-paper text-steel hover:text-teal" title={t("unifiedSale.viewPrintCombinedInvoice")}>
                                      <Printer size={13} />
                                    </a>
                                  </Td>
                                </tr>
                                {children.map((s) => {
                                  const product = products.find((x) => x.id === s.product_id);
                                  const purchaseRate = purchaseRateFor(s);
                                  return (
                                    <tr key={s.id} className="hover:bg-paper/60 transition-colors text-steel">
                                      <Td mono><span className="pl-4 inline-block">↳ {s.display_id}</span></Td>
                                      <Td mono>{fmtTime(s.date)}</Td>
                                      <Td>{null}</Td>
                                      <Td>{product?.name || "—"}</Td>
                                      <Td right mono>{fmtNumber(s.quantity, 2)}</Td>
                                      <Td right mono>{s.rate_per_cylinder ? pkr(s.rate_per_cylinder) : "—"}</Td>
                                      <Td right mono color="#8E8E93">{purchaseRate ? pkr(purchaseRate) : "—"}</Td>
                                      <Td right mono>{pkr(s.total_amount)}</Td>
                                      <Td right mono>—</Td>
                                      <Td right mono>—</Td>
                                      <Td right mono>—</Td>
                                      <Td right mono>{pkr(s.total_amount)}</Td>
                                      <Td mono>{s.entered_by}</Td>
                                      <Td center>
                                        <div className="flex items-center justify-center gap-1">
                                          <button type="button" onClick={() => setCorrectTarget({ kind: "sale", transaction: s })} className="p-1.5 rounded-md hover:bg-paper text-steel hover:text-teal" title={t("unifiedSale.correctThisSale")}>
                                            <Pencil size={13} />
                                          </button>
                                          {/* Unified-Sale-linked only, same scoping as the Approved
                                              Payments table's own cancel button below — full reversal
                                              via cancel_sale (§ Delete/Reverse an Approved Sale). */}
                                          {!!s.unified_sale_id && (
                                            <button
                                              type="button"
                                              disabled={actionBusyId === s.id}
                                              onClick={() => handleCancelApprovedSale(s.id)}
                                              className="p-1.5 rounded-md text-slate-400 hover:text-brand-red hover:bg-red-50 disabled:opacity-50"
                                              title={t("unifiedSale.cancelThisSale")}
                                            >
                                              <Ban size={13} />
                                            </button>
                                          )}
                                        </div>
                                      </Td>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                          {!approvedSaleRows.length && (
                            <tr><td colSpan={14} className="text-steel font-body text-[13px] py-6 text-center">{t("unifiedSale.noSalesFoundFilter")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </div>
              </div>
            </div>
          )}

          {/* APPROVED PAYMENTS — plain Payment records, system-wide (§3/§4) */}
          {showApprovedPaymentsModal && (
            <div
              className="fixed inset-0 z-40 bg-black/40 p-3 sm:p-5 flex items-center justify-center"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setShowApprovedPaymentsModal(false); }}
            >
              <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden bg-white rounded-xl shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
                  <div>
                    <Eyebrow>{t("unifiedSale.approvedPayments")}</Eyebrow>
                    <div className="font-body text-xs text-steel mt-1">{t("unifiedSale.approvedPaymentsCaption")}</div>
                  </div>
                  <button type="button" onClick={() => setShowApprovedPaymentsModal(false)} className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink" title={t("unifiedSale.close")}>
                    <X size={18} />
                  </button>
                </div>
                <div className="overflow-y-auto p-3 sm:p-5">
                  <Panel>
                    <div className="mt-1"><DateFilterToolbar value={paymentDateFilter} onChange={setPaymentDateFilter} /></div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[950px] border-collapse">
                        <thead>
                          <tr className="border-b border-hairline text-left">
                            <Th>{t("unifiedSale.colId")}</Th>
                            <Th>{t("unifiedSale.colDate")}</Th>
                            <Th>{t("unifiedSale.colCustomer")}</Th>
                            <Th right>{t("unifiedSale.colAmount")}</Th>
                            <Th>{t("unifiedSale.colMethod")}</Th>
                            <Th>{t("unifiedSale.colAccount")}</Th>
                            <Th right>{t("unifiedSale.colRate")}</Th>
                            <Th>{t("unifiedSale.colEnteredBy")}</Th>
                            <Th center>{t("unifiedSale.colEdit")}</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {approvedPayments.map((p) => {
                            const c = customers.find((x) => x.id === p.customer_id);
                            const rate = rateForPayment(p);
                            return (
                              <tr key={p.id} className="hover:bg-paper/60 transition-colors">
                                <Td mono>{p.display_id}</Td>
                                <Td mono>{fmtTime(p.date)}</Td>
                                <Td bold>{c?.name || "—"}</Td>
                                <Td right mono bold color="#1E8A5F">{pkr(p.amount)}</Td>
                                <Td mono>{p.method}</Td>
                                <Td mono color="#8E8E93">{resolvePaymentAccountLabel(p)}</Td>
                                <Td right mono color="#8E8E93">{rate ? pkr(rate) : "—"}</Td>
                                <Td mono>{p.entered_by}</Td>
                                <Td center>
                                  <div className="flex items-center justify-center gap-1">
                                    <button type="button" onClick={() => setCorrectTarget({ kind: "payment", transaction: p })} className="p-1.5 rounded-md hover:bg-paper text-steel hover:text-teal" title={t("unifiedSale.correctThisPayment")}>
                                      <Pencil size={13} />
                                    </button>
                                    <a href={api.payments.invoiceUrl(p.id)} target="_blank" rel="noreferrer" className="p-1.5 rounded-md hover:bg-paper text-steel hover:text-teal" title={t("unifiedSale.viewPrintInvoice")}>
                                      <Printer size={13} />
                                    </a>
                                    {/* Unified-Sale-linked only — its own correction path can't
                                        change the amount (see handleCancelApprovedPayment above),
                                        so cancel-then-re-enter is the only fix for a wrong amount. */}
                                    {!!p.unified_sale_id && (
                                      <button
                                        type="button"
                                        disabled={actionBusyId === p.id}
                                        onClick={() => handleCancelApprovedPayment(p.id)}
                                        className="p-1.5 rounded-md text-slate-400 hover:text-brand-red hover:bg-red-50 disabled:opacity-50"
                                        title={t("unifiedSale.cancelThisPayment")}
                                      >
                                        <Ban size={13} />
                                      </button>
                                    )}
                                  </div>
                                </Td>
                              </tr>
                            );
                          })}
                          {!approvedPayments.length && (
                            <tr><td colSpan={9} className="text-steel font-body text-[13px] py-6 text-center">{t("unifiedSale.noPaymentsFoundFilter")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </div>
              </div>
            </div>
          )}

          {correctTarget && (
            <CorrectTransactionModal
              kind={correctTarget.kind}
              transaction={correctTarget.transaction}
              onClose={() => setCorrectTarget(null)}
              onSaved={() => { setCorrectTarget(null); load(); }}
            />
          )}
        </div>
      </div>

      {/* TRANSACTION DETAILS MODAL */}
      {(selectedTransaction || loadingTransaction || transactionError) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => { setSelectedTransaction(null); setTransactionError(null); }}
        >
          <div
            className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-white rounded-xl shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {loadingTransaction && <div className="p-6 font-body text-sm text-steel">{t("common.loading")}</div>}
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
                      <span className="font-mono text-[9px] uppercase text-steel">{t("unifiedSale.colSale")}</span>
                      <StatusBadge status={selectedTransaction.sale_status} />
                      <span className="font-mono text-[9px] uppercase text-steel">{t("customerLedger.colPayment")}</span>
                      <StatusBadge status={selectedTransaction.payment_status} />
                    </div>
                    <div className="font-body text-xs text-steel mt-1">
                      {fmtTime(selectedTransaction.date)}
                      {selectedTransaction.sale_approved_at && (
                        <> · {selectedTransaction.sale_approved_by
                          ? t("unifiedSale.saleApprovedBy", { time: fmtTime(selectedTransaction.sale_approved_at), name: selectedTransaction.sale_approved_by })
                          : t("unifiedSale.saleApprovedAt", { time: fmtTime(selectedTransaction.sale_approved_at) })}</>
                      )}
                      {selectedTransaction.payment_approved_at && (
                        <> · {selectedTransaction.payment_approved_by
                          ? t("unifiedSale.paymentApprovedBy", { time: fmtTime(selectedTransaction.payment_approved_at), name: selectedTransaction.payment_approved_by })
                          : t("unifiedSale.paymentApprovedAt", { time: fmtTime(selectedTransaction.payment_approved_at) })}</>
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
                      <div className="font-mono text-[9px] text-steel uppercase">{t("unifiedSale.customer")}</div>
                      <div className="font-body text-sm font-semibold text-ink mt-1">
                        {customers.find((c) => c.id === selectedTransaction.customer_id)?.name || "—"}
                      </div>
                    </div>
                    <div className="bg-paper rounded-lg p-3">
                      <div className="font-mono text-[9px] text-steel uppercase">{t("unifiedSale.purchasePlant")}</div>
                      <div className="font-body text-sm font-semibold text-ink mt-1">
                        {companies.find((c) => c.id === selectedTransaction.company_id)?.name || "—"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="font-mono text-[10px] text-steel uppercase mb-2">{t("unifiedSale.settlementDetails")}</div>
                    <div className="border border-hairline rounded-lg divide-y divide-hairline">
                      <div className="flex justify-between px-3 py-2.5">
                        <span className="font-body text-xs text-steel">{t("unifiedSale.totalCreditReceived")}</span>
                        <span className="font-mono text-xs font-semibold">{pkr(selectedTransaction.total_credit_received)}</span>
                      </div>
                      {Number(selectedTransaction.delivery_charges) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">{t("unifiedSale.deliveryChargesInclSale")}</span>
                          <span className="font-mono text-xs">{pkr(selectedTransaction.delivery_charges)}</span>
                        </div>
                      )}
                      {Number(selectedTransaction.net_plant_payment) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">{t("unifiedSale.routedSettlement", { destination: getDestinationLabel(selectedTransaction) })}</span>
                          <span className="font-mono text-xs text-green-700 font-semibold">{pkr(selectedTransaction.net_plant_payment)}</span>
                        </div>
                      )}
                      {Number(selectedTransaction.home_expense_amount) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">{t("unifiedSale.homeExpense")}</span>
                          <span className="font-mono text-xs">{pkr(selectedTransaction.home_expense_amount)}</span>
                        </div>
                      )}
                      {Number(selectedTransaction.owner_drawings_amount) > 0 && (
                        <div className="flex justify-between px-3 py-2.5">
                          <span className="font-body text-xs text-steel">{t("unifiedSale.ownerDrawings")}</span>
                          <span className="font-mono text-xs">{pkr(selectedTransaction.owner_drawings_amount)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <div className="flex flex-wrap gap-2">
                      {selectedTransaction.sale_status === "pending" && selectedTransaction.payment_status === "pending" && !isPaymentOnlyBatch(selectedTransaction) && (
                        <Button
                          variant="outline"
                          onClick={() => { const row = recent.find((r) => r.id === selectedTransaction.id); if (row) handleEditTransaction(row); setSelectedTransaction(null); }}
                        >
                          <Pencil size={13} className="mr-1" /> {t("unifiedSale.edit")}
                        </Button>
                      )}
                      {isPaymentOnlyBatch(selectedTransaction) ? (
                        selectedTransaction.payment_status === "pending" && (
                          <Button variant="teal" onClick={() => handleApprovePaymentOnly(selectedTransaction.id)} disabled={actionBusyId === selectedTransaction.id}>
                            <ThumbsUp size={13} className="mr-1" /> {t("unifiedSale.approvePayment")}
                          </Button>
                        )
                      ) : (
                        <>
                          {selectedTransaction.sale_status === "pending" && (
                            <Button variant="teal" onClick={() => handleApproveSale(selectedTransaction.id)} disabled={actionBusyId === selectedTransaction.id}>
                              <ThumbsUp size={13} className="mr-1" /> {t("unifiedSale.approveSale")}
                            </Button>
                          )}
                          {selectedTransaction.payment_status === "pending" && !hasZeroPayment(selectedTransaction) && (
                            <Button variant="teal" onClick={() => handleApprovePayment(selectedTransaction.id)} disabled={actionBusyId === selectedTransaction.id}>
                              <ThumbsUp size={13} className="mr-1" /> {t("unifiedSale.approvePayment")}
                            </Button>
                          )}
                        </>
                      )}
                      {selectedTransaction.sale_status === "pending" && selectedTransaction.payment_status === "pending" && (
                        <Button variant="outline" onClick={() => handleCancel(selectedTransaction.id)} disabled={actionBusyId === selectedTransaction.id}>
                          <Ban size={13} className="mr-1" /> {t("unifiedSale.cancel")}
                        </Button>
                      )}
                    </div>
                    <Button variant="outline" onClick={() => setSelectedTransaction(null)}>{t("unifiedSale.close")}</Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showNewPlant && (
        <NewPlantModal
          initialName={companySearch}
          onClose={() => setShowNewPlant(false)}
          onCreated={(c) => { setCompanies((prev) => [...prev, c]); setCompanyId(c.id); setCompanySearch(""); setShowNewPlant(false); }}
        />
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