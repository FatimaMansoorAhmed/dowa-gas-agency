const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const API_BASE = BASE;

// CSRF token (§ Auth Module) — handed to us only in the login/`/auth/me`
// JSON response body, never as a cookie (a cross-site attacker's forged
// request can carry the session cookie but can't read that response, per
// Same-Origin Policy, so it can't know this value). Kept in memory only —
// lib/auth.tsx sets it after login/hydration, never persisted to storage.
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

// Set by lib/auth.tsx so ANY 401/403 (not just the initial /auth/me
// hydration) resyncs local auth state against the server's real, current
// session — a suspended user's very next request anywhere in the app, or
// (§ stale-tab bug) a tab whose React state still shows an old identity
// after a different account logged in elsewhere in the same browser
// (cookies are shared across tabs, but in-memory `user` state isn't —
// nothing previously resynced it on a plain role/permission 403, only on
// a CSRF-flavored one, so a tab could go on showing "Owner" indefinitely
// after the real cookie became a staff session in another tab). Called
// with the fetched /auth/me payload so callers always get the true
// current identity, never a guess.
let onAuthResync: ((me: { authenticated: boolean; user?: unknown; csrf_token?: string }) => void) | null = null;
export function setAuthResyncHandler(handler: typeof onAuthResync) {
  onAuthResync = handler;
}

async function fetchMe(): Promise<{ authenticated: boolean; user?: unknown; csrf_token?: string }> {
  const res = await fetch(`${BASE}/auth/me`, { credentials: "include", cache: "no-store" });
  return res.json();
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(path: string, options?: RequestInit, _retried = false): Promise<T> {
  const method = (options?.method || "GET").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options?.headers as Record<string, string> || {}) };
  if (MUTATING_METHODS.has(method) && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 401) {
    const me = await fetchMe().catch(() => ({ authenticated: false as const }));
    onAuthResync?.(me);
    const body = await res.text();
    throw new Error(`API ${path} failed (401): ${body}`);
  }

  if (res.status === 403 && !_retried) {
    const bodyText = await res.text();
    const me = await fetchMe().catch(() => ({ authenticated: false as const }));
    onAuthResync?.(me);
    if (bodyText.includes("CSRF") && me.authenticated && me.csrf_token) {
      // Stale in-memory token specifically (e.g. another tab logged out
      // and back in) — the resynced identity is still valid, so retry
      // this exact request once with the fresh token rather than
      // surfacing a confusing CSRF error for what's really a timing gap.
      setCsrfToken(me.csrf_token);
      return request<T>(path, options, true);
    }
    // Any other 403 (role/permission denial, e.g. "Owner access
    // required") means the REAL current session genuinely can't do
    // this — onAuthResync above already corrected local state so the UI
    // reflects who's actually logged in; still throw so the caller's
    // error handling surfaces it.
    throw new Error(`API ${path} failed (403): ${bodyText}`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

// Every throw above shares the "API {path} failed ({status}): {body}" shape,
// where {body} is the raw response text — typically FastAPI's own JSON,
// `{"detail": "..."}` for a plain HTTPException or `{"detail": [{"msg":
// ...}, ...]}` for a 422 Pydantic validation error. Callers that catch an
// API error and show it to the user should extract the real message through
// this instead of a generic fallback string, which just hides whatever
// actually went wrong (see CorrectTransactionModal.handleSubmit).
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  const match = e.message.match(/^API .+ failed \(\d+\): ([\s\S]*)$/);
  const body = match ? match[1] : e.message;
  try {
    const detail = JSON.parse(body)?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail.map((d) => (d && typeof d === "object" ? d.msg || JSON.stringify(d) : String(d))).join("; ");
    }
  } catch {
    // Not JSON (or no `detail`) — fall through to the raw body/message.
  }
  return body.trim() || fallback;
}

import type {
  Company, Party, RateEntry, Customer, Product, PaymentAccount, ExpenseCategory,
  Sale, Payment, Expense, CustomerLedgerSummary, CustomerFlag, Purchase, CompanyPayment,
  CompanyLedgerSummary, PlantLedgerSummaryRow, CylinderTransaction, CylinderBalance, OwnerDrawing, UnifiedSaleBatch, UnifiedSaleResult, DestinationType,
  AccountType, AccountTransferResult, CylinderTransactionCreate, CustomerCombinedLedger, CylinderReturn,
  OwnerCapital, OwnerCapitalDestination, DailyReportData, GeneratedReport, SendWhatsAppResult,
  WhatsAppRecipient, WhatsAppSendLog,
  BoardRate, ShopListRow, ShopDetailOut, ShopSale, ShopStockBatch, ShopStockBatchCreate,
  ShopSupplyCustomer, ShopSupplyCustomerLedgerOut, ShopCustomerPayment, ShopExpenseTransaction, ShopBusinessLedgerOut,
  ShopCashTransfer, ShopCashTransferCreate,
  AccountTransferRecord, User, UserAccessAuditRow,
  Employee, EmployeeLedgerSummary,
} from "./types";

export const api = {
  companies: {
    remove: (id: string) => request<{ deleted: boolean; name: string }>(`/companies/${id}`, { method: "DELETE" }),
    list: () => request<Company[]>("/companies"),
    get: (id: string) => request<Company>(`/companies/${id}`),
    create: (payload: { name: string; mobile?: string; opening_balance?: number; opening_balance_date?: string }) =>
      request<Company>("/companies", { method: "POST", body: JSON.stringify(payload) }),
    correctOpeningBalance: (id: string, payload: { new_value: number; reason: string }) =>
      request<Company>(`/companies/${id}/opening-balance`, { method: "PATCH", body: JSON.stringify(payload) }),
    hideFromRateDashboard: (id: string) =>
      request<Company>(`/companies/${id}/hide-from-rate-dashboard`, { method: "PATCH" }),
    showOnRateDashboard: (id: string) =>
      request<Company>(`/companies/${id}/show-on-rate-dashboard`, { method: "PATCH" }),
  },
  parties: {
    list: (companyId?: string) => request<Party[]>(`/parties${companyId ? `?company_id=${companyId}` : ""}`),
    create: (company_id: string, name: string) =>
      request<Party>("/parties", { method: "POST", body: JSON.stringify({ company_id, name }) }),
  },
  rates: {
    list: () => request<RateEntry[]>("/rates"),
    latest: () => request<RateEntry[]>("/rates/latest"),
    create: (payload: { company_id: string; party_id?: string | null; rate_118: number; entered_by: string; timestamp?: string }) =>
      request<RateEntry>("/rates", { method: "POST", body: JSON.stringify(payload) }),
  },
  customers: {
    remove: (id: string) => request<{ deleted: boolean; name: string }>(`/customers/${id}`, { method: "DELETE" }),
    list: (search?: string) => {
      const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      return request<Customer[]>(`/customers/${query}`);
    },
    get: (id: string) => request<Customer>(`/customers/${id}`),
    create: (payload: {
      name: string; mobile: string; alt_mobile?: string; shop_name?: string; address?: string;
      city_area?: string; opening_balance: number; opening_balance_date?: string;
      empty_cylinders_118?: number; empty_cylinders_454?: number;
      empty_cylinders_118_cross?: number; empty_cylinders_118_pso?: number;
      empty_cylinders_454_cross?: number; empty_cylinders_454_pso?: number;
    }) => request<Customer>("/customers/", { method: "POST", body: JSON.stringify(payload) }),
    adjust: (id: string, kind: "payment" | "charge", amount: number) =>
      request<Customer>(`/customers/${id}/adjust`, { method: "PATCH", body: JSON.stringify({ kind, amount }) }),
    correctOpeningBalance: (id: string, payload: { new_value: number; reason: string }) =>
      request<Customer>(`/customers/${id}/opening-balance`, { method: "PATCH", body: JSON.stringify(payload) }),
    addCylinderTransaction: (customerId: string, payload: CylinderTransactionCreate) =>
      request<{ status: string; data: CylinderTransaction }>(`/customers/${customerId}/cylinders`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    // 2. Full Combined Cash + Cylinder Ledger Fetch Karna
    getLedger: (customerId: string) =>
      request<CustomerCombinedLedger>(`/customers/${customerId}/ledger`),

  },
  products: {
    list: () => request<Product[]>("/products"),
    create: (name: string, weight_kg: number) =>
      request<Product>("/products", { method: "POST", body: JSON.stringify({ name, weight_kg }) }),
  },
  paymentAccounts: {
    list: () => request<PaymentAccount[]>("/payment-accounts"),
    create: (name: string, kind: "cash" | "bank", opening_balance = 0, account_type?: AccountType) =>
      request<PaymentAccount>("/payment-accounts", { method: "POST", body: JSON.stringify({ name, kind, opening_balance, account_type }) }),
    transfer: (payload: { from_account_id: string; to_account_id: string; amount: number; notes?: string; entered_by: string }) =>
      request<AccountTransferResult>("/payment-accounts/transfer", { method: "POST", body: JSON.stringify(payload) }),
    transfers: {
      list: (accountId?: string) =>
        request<AccountTransferRecord[]>(`/payment-accounts/transfers${accountId ? `?account_id=${accountId}` : ""}`),
    },
  },
  expenseCategories: {
    list: () => request<ExpenseCategory[]>("/expense-categories"),
    create: (name: string, description?: string) =>
      request<ExpenseCategory>("/expense-categories", { method: "POST", body: JSON.stringify({ name, description }) }),
  },
  sales: {
    list: (params?: { customer_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Sale[]>(`/sales${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; customer_id: string; product_id: string; company_id?: string;
      quantity: number; rate_per_cylinder: number; gate_pass_no?: string;
      vehicle_no?: string; notes?: string; entered_by: string; cylinders_returned?: number;
      emergency_transfer_shop_id?: string;
      gst_enabled?: boolean; gst_rate?: number; discount_enabled?: boolean; discount_rate?: number;
    }) => request<Sale>("/sales", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<Sale>(`/sales/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    // Ledger Correction (§1): reverses this sale, marks it "corrected"
    // (kept in history), and posts a brand-new Sale with the corrected values.
    correct: (id: string, payload: {
      date: string; customer_id: string; product_id: string; company_id?: string;
      quantity: number; rate_per_cylinder: number; gate_pass_no?: string;
      vehicle_no?: string; notes?: string; entered_by: string; cylinders_returned?: number;
      correction_reason: string; corrected_by: string;
      emergency_transfer_shop_id?: string;
      gst_enabled?: boolean; gst_rate?: number; discount_enabled?: boolean; discount_rate?: number;
    }) => request<Sale>(`/sales/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
    invoiceUrl: (id: string) => `${BASE}/sales/${id}/invoice`,
  },
  // Emergency Transfer (§ Shop — Emergency Transfer) — a real (non-shop)
  // customer needs cylinders urgently and is directed to a shop instead
  // of a plant. Posts a genuine Sale (see api.sales above for correct/
  // cancel — reused as-is, no separate endpoints needed) while drawing
  // physical stock from the named shop's own FIFO stock.
  emergencyTransfer: {
    create: (payload: {
      date: string; customer_id: string; shop_id: string; product_id: string;
      quantity: number; rate_per_cylinder: number; notes?: string;
      amount_collected_now?: number; payment_method?: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      destination_account_id?: string;
    }) => request<Sale>("/sales/emergency-transfer", { method: "POST", body: JSON.stringify(payload) }),
  },
  payments: {
    list: (params?: { customer_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Payment[]>(`/payments${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; customer_id: string; sale_id?: string; amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      account_id: string; source_account_id?: string;
      reference_no?: string; received_by?: string; notes?: string; entered_by: string;
    }) => request<Payment>("/payments", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<Payment>(`/payments/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    correct: (id: string, payload: {
      date: string; customer_id: string; sale_id?: string; amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      account_id: string; source_account_id?: string;
      reference_no?: string; received_by?: string; notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
    }) => request<Payment>(`/payments/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
    invoiceUrl: (id: string) => `${BASE}/payments/${id}/invoice`,
  },
  
  // Endpoint group for Standalone Payment Receipts with destination routing
  paymentReceipts: {
    list: (params?: { customer_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Payment[]>(`/payment-receipts${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string;
      customer_id: string;
      amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      home_expense_amount?: number;
      home_expense_category_id?: string;
      owner_drawings_amount?: number;
      destination_type: DestinationType;
      target_plant_id?: string;
      account_id?: string;
      reference_no?: string;
      notes?: string;
      entered_by: string;
    }) => request<Payment>("/payment-receipts", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<Payment>(`/payment-receipts/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    // § Bug Fix — Correction Modal Routing, Case 1. Same shape as create,
    // plus the correction fields — reverses the original's routing and
    // reposts with the corrected values (see routers/payment_receipts.py::
    // correct_payment_receipt).
    correct: (id: string, payload: {
      date: string;
      customer_id: string;
      amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      home_expense_amount?: number;
      home_expense_category_id?: string;
      owner_drawings_amount?: number;
      destination_type: DestinationType;
      target_plant_id?: string;
      account_id?: string;
      reference_no?: string;
      notes?: string;
      entered_by: string;
      correction_reason: string;
      corrected_by: string;
    }) => request<Payment>(`/payment-receipts/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
  },

  // Return Cylinder (Customer Ledger) / Add Empty Cylinder — one endpoint
  // for all 3 modes; "cash" mode routes exactly like paymentReceipts.create
  // above (same destination_type/home_expense/owner_drawings fields).
  cylinderReturns: {
    list: (params?: { customer_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<CylinderReturn[]>(`/cylinder-returns${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date?: string;
      customer_id: string;
      cylinder_size: "118" | "454";
      cylinder_type?: "cross" | "pso";
      quantity: number;
      mode: "transfer" | "cash" | "manual_add";
      origin?: "return_cylinder" | "sell_cylinder";
      to_customer_id?: string;
      amount?: number;
      method?: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      home_expense_amount?: number;
      home_expense_category_id?: string;
      owner_drawings_amount?: number;
      destination_type?: DestinationType;
      target_plant_id?: string;
      account_id?: string;
      reference_no?: string;
      notes?: string;
      entered_by: string;
    }) => request<CylinderReturn>("/cylinder-returns", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) =>
      request<CylinderReturn>(`/cylinder-returns/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
  },

  expenses: {
    list: (params?: { category_id?: string; account_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Expense[]>(`/expenses${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; category_id: string; amount: number; account_id: string; method?: string;
      description?: string; vendor?: string; reference_no?: string; entered_by: string;
      employee_id?: string;
    }) => request<Expense>("/expenses", { method: "POST", body: JSON.stringify(payload) }),
  },
  // § Employee Salary Tracking
  employees: {
    remove: (id: string) => request<{ deleted: boolean; name: string }>(`/employees/${id}`, { method: "DELETE" }),
    list: () => request<Employee[]>("/employees"),
    create: (payload: { name: string; monthly_salary: number; entered_by: string }) =>
      request<Employee>("/employees", { method: "POST", body: JSON.stringify(payload) }),
    get: (id: string) => request<Employee>(`/employees/${id}`),
    update: (id: string, payload: { monthly_salary?: number; status?: "active" | "inactive" }) =>
      request<Employee>(`/employees/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    ledger: (id: string, month: string) =>
      request<EmployeeLedgerSummary>(`/employees/${id}/ledger?month=${month}`),
  },
  ledger: {
    customerMonth: (customerId: string, month: string) =>
      request<CustomerLedgerSummary>(`/ledger/customer/${customerId}?month=${month}`),
    customerStatementUrl: (customerId: string, month: string) =>
      `${BASE}/ledger/customer/${customerId}/statement?month=${month}`,
    companyMonth: (companyId: string, month: string) =>
      request<CompanyLedgerSummary>(`/ledger/company/${companyId}?month=${month}`),
    companyStatementUrl: (companyId: string, month: string) =>
      `${BASE}/ledger/company/${companyId}/statement?month=${month}`,
    plantSummary: (month: string) =>
      request<PlantLedgerSummaryRow[]>(`/ledger/companies?month=${month}`),
    customerFlags: (month: string) =>
      request<CustomerFlag[]>(`/ledger/customers/flags?month=${month}`),
  },
  purchases: {
    list: (params?: { company_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Purchase[]>(`/purchases${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; company_id: string; product_id: string; quantity: number;
      rate_per_cylinder: number; additional_charges?: number; transport_charges?: number;
      other_charges?: number; gate_pass_no?: string; vehicle_no?: string;
      driver_name?: string; driver_contact?: string; notes?: string; entered_by: string;
    }) => request<Purchase>("/purchases", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<Purchase>(`/purchases/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    correct: (id: string, payload: {
      date: string; company_id: string; product_id: string; quantity: number;
      rate_per_cylinder: number; additional_charges?: number; transport_charges?: number;
      other_charges?: number; gate_pass_no?: string; vehicle_no?: string;
      driver_name?: string; driver_contact?: string; notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
    }) => request<Purchase>(`/purchases/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
    invoiceUrl: (id: string) => `${BASE}/purchases/${id}/invoice`,
  },
  companyPayments: {
    list: (params?: { company_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<CompanyPayment[]>(`/company-payments${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; company_id: string; purchase_id?: string; amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      account_id: string; reference_no?: string; paid_by?: string; notes?: string; entered_by: string;
    }) => request<CompanyPayment>("/company-payments", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<CompanyPayment>(`/company-payments/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    correct: (id: string, payload: {
      date: string; company_id: string; purchase_id?: string; amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other" | "direct_settlement";
      account_id?: string; reference_no?: string; paid_by?: string; notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
    }) => request<CompanyPayment>(`/company-payments/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
    invoiceUrl: (id: string) => `${BASE}/company-payments/${id}/invoice`,
  },
  cylinderTransactions: {
    list: (params?: { customer_id?: string; product_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<CylinderTransaction[]>(`/cylinder-transactions${q ? `?${q}` : ""}`);
    },
    balances: (customerId?: string) =>
      request<CylinderBalance[]>(`/cylinder-transactions/balances${customerId ? `?customer_id=${customerId}` : ""}`),
    create: (payload: {
      date: string; customer_id: string; product_id: string;
      qty_out?: number; qty_in?: number; notes?: string; entered_by: string;
    }) => request<CylinderTransaction>("/cylinder-transactions", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) =>
      request<CylinderTransaction>(`/cylinder-transactions/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
  },
  ownerDrawings: {
    list: (month?: string) => request<OwnerDrawing[]>(`/owner-drawings${month ? `?month=${month}` : ""}`),
    create: (payload: { date: string; amount: number; account_id?: string; notes?: string; entered_by: string }) =>
      request<OwnerDrawing>("/owner-drawings", { method: "POST", body: JSON.stringify(payload) }),
  },
  // Owner Capital / Re-Investment: fresh capital injected by the owner,
  // routed either straight to one PaymentAccount ("account") or straight
  // to a plant's payable via the existing plant-payment accounting
  // ("plant") — never mixed with Sale/Payment logic.
  ownerCapital: {
    list: (params?: { destination_type?: OwnerCapitalDestination; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<OwnerCapital[]>(`/owner-capital${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string;
      amount: number;
      destination_type: OwnerCapitalDestination;
      account_id?: string;
      target_plant_id?: string;
      notes?: string;
      entered_by: string;
    }) => request<OwnerCapital>("/owner-capital", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) =>
      request<OwnerCapital>(`/owner-capital/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
  },
  unifiedSale: { 
    list: (params?: { customer_id?: string; month?: string }) => { 
      const q = new URLSearchParams(params as Record<string, string>).toString(); 
      return request<UnifiedSaleBatch[]>(
        `/sales/unified${q ? `?${q}` : ""}`
      ); 
    },

    get: (id: string) =>
      request<UnifiedSaleResult>(`/sales/unified/${id}`),

    create: (payload: {
      date: string;
      customer_id: string;
      // Absent for a Payment-Only batch (§ Payment-Only Pending Approval) —
      // no purchase plant, items always []. Required whenever items is
      // non-empty (enforced server-side).
      plant_id?: string;
      items: {
        product_id: string; 
        quantity: number; 
        purchase_rate: number;
        selling_rate: number;
      }[];
      // Optional, defaults to 0 server-side — folded into total_selling_amount.
      delivery_charges?: number;
      settlement: {
        total_credit_received: number;
        cash_received?: number;
        cash_account_id?: string;
        home_expense_amount: number;
        home_expense_category_id?: string;
        // § Multi-line Categorized Home Expense — when non-empty, REPLACES
        // home_expense_amount/home_expense_category_id above entirely for
        // this settlement's math (see routers/unified_sale.py).
        home_expense_lines?: { category_id: string; amount: number; employee_id?: string; description?: string }[];
        owner_drawings_amount: number;
        destination_type?: DestinationType;
        target_plant_id?: string;
        account_id?: string;
        payment_reference?: string;
      };
      gate_pass_no?: string;
      vehicle_no?: string;
      notes?: string;
      entered_by?: string;
      // GST on Sale, extended to Unified Sale (optional, locked at entry) —
      // gst_enabled/gst_rate are what the backend actually uses (recomputes
      // gst_amount/grand_total server-side from these); gst_amount/
      // grand_total are included too for the request to carry the same
      // breakdown the modal previews, though the server never trusts a
      // client-supplied total.
      gst_enabled?: boolean;
      gst_rate?: number;
      gst_amount?: number;
      discount_enabled?: boolean;
      discount_rate?: number;
      grand_total?: number;
    }) => request<UnifiedSaleResult>(
      "/sales/unified",
      { method: "POST", body: JSON.stringify(payload) }
    ),

    update: (
      id: string, 
      payload: { 
        date: string; 
        customer_id: string; 
        plant_id: string; 
        items: { 
          product_id: string; 
          quantity: number; 
          purchase_rate: number;
          selling_rate: number;
        }[];
        delivery_charges?: number;
        settlement: {
          total_credit_received: number; 
          cash_received?: number; 
          cash_account_id?: string; 
          home_expense_amount: number;
          home_expense_category_id?: string;
          home_expense_lines?: { category_id: string; amount: number; employee_id?: string; description?: string }[];
          owner_drawings_amount: number;
          destination_type?: DestinationType;
          target_plant_id?: string;
          account_id?: string;
          payment_reference?: string;
        };
        gate_pass_no?: string;
        vehicle_no?: string;
        notes?: string;
        entered_by?: string;
        gst_enabled?: boolean;
        gst_rate?: number;
        gst_amount?: number;
        discount_enabled?: boolean;
        discount_rate?: number;
        grand_total?: number;
      }
    ) => request<UnifiedSaleResult>(`/sales/unified/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

    approveSale: (id: string, approved_by?: string) =>
      request<UnifiedSaleResult>(`/sales/unified/${id}/approve-sale${approved_by ? `?by=${encodeURIComponent(approved_by)}` : ""}`, {
        method: "POST",
      }),

    approvePayment: (id: string, approved_by?: string, reference?: string) => {
      const params = new URLSearchParams();
      if (approved_by) params.set("by", approved_by);
      if (reference) params.set("reference", reference);
      const q = params.toString();
      return request<UnifiedSaleResult>(`/sales/unified/${id}/approve-payment${q ? `?${q}` : ""}`, {
        method: "POST",
      });
    },

    cancel: (id: string, cancelled_by?: string) =>
      request<UnifiedSaleResult>(`/sales/unified/${id}/cancel${cancelled_by ? `?by=${encodeURIComponent(cancelled_by)}` : ""}`, {
        method: "POST",
      }),

    // Payment-Only batches only (company_id null) — approves both sides
    // atomically in one request, since there's no separate sale/load event
    // for a human to approve. approveSale/approvePayment above are for a
    // Full Sale's independent two-step approval.
    approve: (id: string, approved_by?: string, reference?: string) => {
      const params = new URLSearchParams();
      if (approved_by) params.set("by", approved_by);
      if (reference) params.set("reference", reference);
      const q = params.toString();
      return request<UnifiedSaleResult>(`/sales/unified/${id}/approve${q ? `?${q}` : ""}`, {
        method: "POST",
      });
    },
    // § Bug Fix — Correction Modal Routing, Case 2. Corrects WHERE an
    // already-approved settlement's money went (and the home_expense/
    // owner_drawings split) — never total_credit_received itself, which
    // stays whatever the sale side already posted (see
    // routers/unified_sale.py::correct_unified_sale_settlement).
    correctSettlement: (id: string, payload: {
      home_expense_amount?: number;
      home_expense_category_id?: string;
      home_expense_lines?: { category_id: string; amount: number; employee_id?: string; description?: string }[];
      owner_drawings_amount?: number;
      destination_type: DestinationType;
      target_plant_id?: string;
      account_id?: string;
      payment_reference?: string;
      correction_reason: string;
      corrected_by: string;
    }) => request<UnifiedSaleResult>(`/sales/unified/${id}/correct-settlement`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    // § Amount Correction for Unified-Sale-Linked Payments — the sibling
    // of correctSettlement above. Corrects ONLY total_credit_received
    // (see routers/unified_sale.py::correct_unified_sale_amount); routing
    // is untouched here, same "one concern each" split as the backend.
    correctAmount: (id: string, payload: {
      amount: number;
      correction_reason: string;
      corrected_by: string;
    }) => request<UnifiedSaleResult>(`/sales/unified/${id}/correct-amount`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    // One combined invoice PDF for the whole batch (§ One Invoice for
    // Multi-Item Sales) — every line item on one document, not a separate
    // invoice per product.
    invoiceUrl: (id: string) => `${BASE}/sales/unified/${id}/invoice`,
  },
  // Daily PDF Reports (§5, §6, §7, §8).
  reports: {
    list: (params?: { report_type?: string; date_from?: string; date_to?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<GeneratedReport[]>(`/reports${q ? `?${q}` : ""}`);
    },
    get: (id: string) => request<GeneratedReport>(`/reports/${id}`),
    // Powers the Daily Activity screen/print AND is what the PDF is
    // rendered from server-side — same aggregator, so they can't disagree.
    dailyData: (businessDate: string) => request<DailyReportData>(`/reports/daily/${businessDate}/data`),
    // Every generation produces BOTH an English and an Urdu row (§ Phase
    // D3) — always returns a 2-element array now, never a single object.
    generateDaily: (businessDate: string, generatedBy: string) =>
      request<GeneratedReport[]>(
        `/reports/daily/generate?business_date=${businessDate}&generated_by=${encodeURIComponent(generatedBy)}`,
        { method: "POST" }
      ),
    downloadUrl: (id: string) => `${BASE}/reports/${id}/download`,
    // Same file as downloadUrl, but the backend sends Content-Disposition:
    // inline — opens in the browser's own PDF viewer instead of forcing a
    // save dialog. Used by the Eye (preview) icon; downloadUrl stays the
    // Download icon's dedicated attachment trigger.
    viewUrl: (id: string) => `${BASE}/reports/${id}/view`,
    sendWhatsApp: (id: string, to?: string) =>
      request<SendWhatsAppResult>(`/reports/${id}/send-whatsapp${to ? `?to=${encodeURIComponent(to)}` : ""}`, {
        method: "POST",
      }),
    // § WhatsApp Recipients & Daily Scheduler
    whatsappRecipients: {
      list: () => request<WhatsAppRecipient[]>("/reports/whatsapp/recipients"),
      create: (payload: { phone_number: string; label?: string }) =>
        request<WhatsAppRecipient>("/reports/whatsapp/recipients", { method: "POST", body: JSON.stringify(payload) }),
      deactivate: (id: string) => request<WhatsAppRecipient>(`/reports/whatsapp/recipients/${id}/deactivate`, { method: "PATCH" }),
      activate: (id: string) => request<WhatsAppRecipient>(`/reports/whatsapp/recipients/${id}/activate`, { method: "PATCH" }),
    },
    whatsappAutoSend: {
      get: () => request<{ enabled: boolean }>("/reports/whatsapp/auto-send"),
      set: (enabled: boolean) =>
        request<{ enabled: boolean }>("/reports/whatsapp/auto-send", { method: "PUT", body: JSON.stringify({ enabled }) }),
    },
    whatsappLog: (reportId: string) => request<WhatsAppSendLog[]>(`/reports/${reportId}/whatsapp-log`),
  },
  // Board Rate history — the single system-wide daily rate/kg Shop Sales
  // are priced from (§ Shop Management, distinct from RateEntry above,
  // which is a per-plant quote never wired to actual sale pricing).
  boardRates: {
    list: () => request<BoardRate[]>("/board-rates"),
    latest: (date?: string) => request<BoardRate>(`/board-rates/latest${date ? `?date=${encodeURIComponent(date)}` : ""}`),
    create: (payload: { effective_date: string; rate_per_kg: number; entered_by: string }) =>
      request<BoardRate>("/board-rates", { method: "POST", body: JSON.stringify(payload) }),
  },
  // Shops — a Shop is a Customer row with customer_type="shop" (§ Shop
  // Management). Loads are entered via the ordinary api.sales.create/
  // correct above (customer_id = a shop's id) — there is no separate
  // "shop load" endpoint; the stock batch is created automatically,
  // server-side, in that same request.
  shops: {
    list: () => request<ShopListRow[]>("/shops"),
    // Shop Sales across every shop, not scoped to one — used by the
    // Dashboard's Total Tonnage card (§ Dashboard) to sum quantity_kg.
    salesList: (month?: string) => request<ShopSale[]>(`/shops/sales${month ? `?month=${month}` : ""}`),
    create: (payload: {
      name: string; mobile: string; address?: string; city_area?: string;
      opening_balance?: number; opening_balance_date?: string; entered_by?: string;
    }) => request<Customer>("/shops", { method: "POST", body: JSON.stringify(payload) }),
    detail: (id: string, params?: { date?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<ShopDetailOut>(`/shops/${id}${q ? `?${q}` : ""}`);
    },
    stock: (id: string, date?: string) => 
      request<ShopDetailOut["stock"]>(`/shops/${id}/stock${date ? `?date=${date}` : ""}`),
    batches: (id: string, month?: string) =>
      request<ShopStockBatch[]>(`/shops/${id}/batches${month ? `?month=${month}` : ""}`),
    correctOpeningCash: (id: string, payload: { new_value: number; reason: string }) =>
      request<PaymentAccount>(`/shops/${id}/opening-cash`, { method: "PATCH", body: JSON.stringify(payload) }),
    // Add Filled Cylinder Stock (§ Shop Management) — manually adds an
    // existing batch to this shop's FIFO stock, e.g. onboarding a shop
    // that already has physical stock on-site. No backing Sale.
    addStockBatch: (shopId: string, payload: ShopStockBatchCreate) =>
      request<ShopStockBatch>(`/shops/${shopId}/stock-batches`, { method: "POST", body: JSON.stringify(payload) }),
    cancelStockBatch: (batchId: string, by: string) =>
      request<ShopStockBatch>(`/shops/stock-batches/${batchId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    getSale: (saleId: string) => request<ShopSale>(`/shops/sales/${saleId}`),
    createSale: (shopId: string, payload: {
      date: string; product_id: string; quantity: number; unit?: "cylinder" | "kg";
      // § Board Rate manual entry — required, no system-wide auto-resolve;
      // the user types this every time (see routers/shops.py::_apply_shop_sale).
      board_rate_per_kg: number;
      // § Selling Price override — optional; when set, REPLACES the final
      // total_amount outright (post board-rate calculation), NOT
      // sale_rate_per_cylinder — that stays board-rate-derived as the
      // audit trail of what the calculation would have produced.
      manual_total_amount?: number;
      // § GST on Shop Sale — optional, default off (same convention as
      // Sale/Unified Sale's own gst_enabled/gst_rate).
      gst_enabled?: boolean; gst_rate?: number; discount_enabled?: boolean; discount_rate?: number;
      supply_customer_id?: string; payment_type?: "cash" | "credit";
      // Inline Settlement (§2) — omitted means "fully paid" for cash,
      // "fully credit" (0) for credit; a credit sale may set any amount
      // from 0 up to the sale total for a partial payment.
      amount_received?: number; destination_account_id?: string;
      notes?: string; entered_by: string;
      // Settlement routing (sent alongside destination_type when funds
      // were collected) — § Multi-line Categorized Home Expense:
      // home_expense_lines REPLACES home_expense_amount/category_id/
      // employee_id entirely when non-empty.
      destination_type?: "plant" | "account"; target_plant_id?: string; account_id?: string;
      home_expense_amount?: number; home_expense_category_id?: string; home_expense_employee_id?: string;
      home_expense_lines?: { category_id: string; amount: number; employee_id?: string; description?: string }[];
      owner_drawings_amount?: number;
    }) => request<ShopSale>(`/shops/${shopId}/sales`, { method: "POST", body: JSON.stringify(payload) }),
    cancelSale: (saleId: string, by: string) =>
      request<ShopSale>(`/shops/sales/${saleId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    correctSale: (saleId: string, payload: {
      date: string; product_id: string; quantity: number; unit?: "cylinder" | "kg";
      board_rate_per_kg: number;
      manual_total_amount?: number;
      gst_enabled?: boolean; gst_rate?: number; discount_enabled?: boolean; discount_rate?: number;
      supply_customer_id?: string; payment_type?: "cash" | "credit";
      amount_received?: number; destination_account_id?: string;
      notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
      destination_type?: "plant" | "account"; target_plant_id?: string; account_id?: string;
      home_expense_amount?: number; home_expense_category_id?: string; home_expense_employee_id?: string;
      home_expense_lines?: { category_id: string; amount: number; employee_id?: string; description?: string }[];
      owner_drawings_amount?: number;
    }) => request<ShopSale>(`/shops/sales/${saleId}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
    saleInvoiceUrl: (saleId: string) => `${BASE}/shops/sales/${saleId}/invoice`,
    // Full-activity-log Shop Statement PDF (§ Shop Statement) — mirrors
    // api.ledger.customerStatementUrl/companyStatementUrl exactly (a
    // read-only, on-demand backend-rendered PDF, month-scoped).
    statementUrl: (shopId: string, month: string) => `${BASE}/shops/${shopId}/statement?month=${month}`,
    deletePasswordStatus: () => request<{ is_set: boolean }>("/shops/delete-password/status"),
    setDeletePassword: (payload: { new_password: string; current_password?: string }) =>
      request<{ status: string }>("/shops/delete-password/set", { method: "POST", body: JSON.stringify(payload) }),
    deleteShop: (shopId: string, password: string) =>
      request<{ status: string }>(`/shops/${shopId}`, { method: "DELETE", body: JSON.stringify({ password }) }),

    // ---- Engine 3: Shop Business Finance ----
    customers: {
      remove: (supplyCustomerId: string) =>
        request<{ deleted: boolean; name: string }>(`/shops/customers/${supplyCustomerId}`, { method: "DELETE" }),
      list: (shopId: string) => request<ShopSupplyCustomer[]>(`/shops/${shopId}/customers`),
      create: (shopId: string, payload: {
        name: string; mobile?: string; address?: string; opening_balance?: number; entered_by: string;
      }) => request<ShopSupplyCustomer>(`/shops/${shopId}/customers`, { method: "POST", body: JSON.stringify(payload) }),
      get: (supplyCustomerId: string) => request<ShopSupplyCustomer>(`/shops/customers/${supplyCustomerId}`),
      ledger: (supplyCustomerId: string) => request<ShopSupplyCustomerLedgerOut>(`/shops/customers/${supplyCustomerId}/ledger`),
      // All-time Supply Customer Statement PDF (§ Supply Customer Statement)
      // — mirrors statementUrl above (a read-only, on-demand backend-
      // rendered PDF), no month param since this ledger isn't month-scoped.
      statementUrl: (supplyCustomerId: string) => `${BASE}/shops/customers/${supplyCustomerId}/statement`,
    },
    customerPayments: {
      create: (shopId: string, supplyCustomerId: string, payload: {
        date: string; supply_customer_id: string; amount: number; method?: string;
        account_id?: string; shop_sale_id?: string; notes?: string; entered_by: string;
        // Settlement Routing (§ Payment Only mode) — same 3-way split as
        // ShopSale/ShopCashTransfer. Presence of destination_type selects
        // this path over the legacy account_id path above.
        home_expense_amount?: number; home_expense_description?: string;
        home_expense_category_id?: string; home_expense_employee_id?: string;
        owner_drawings_amount?: number;
        destination_type?: DestinationType; target_plant_id?: string;
        settlement_account_id?: string;
      }) => request<ShopCustomerPayment>(`/shops/${shopId}/customers/${supplyCustomerId}/payments`, { method: "POST", body: JSON.stringify(payload) }),
      cancel: (paymentId: string, by: string) =>
        request<ShopCustomerPayment>(`/shops/customer-payments/${paymentId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    },
    expenses: {
      list: (shopId: string, month?: string) =>
        request<ShopExpenseTransaction[]>(`/shops/${shopId}/expenses${month ? `?month=${month}` : ""}`),
      create: (shopId: string, payload: {
        date: string;
        lines: { category_id?: string; line_type: "expense" | "owner_withdrawal"; amount: number; description?: string; employee_id?: string }[];
        account_id?: string; payment_source?: string; notes?: string; entered_by: string;
        // § Shop Expense/Withdrawal Attribution — pass whichever context
        // the calling form actually has (a known supply customer and/or
        // the sale it was entered alongside); both optional.
        supply_customer_id?: string; shop_sale_id?: string;
      }) => request<ShopExpenseTransaction>(`/shops/${shopId}/expenses`, { method: "POST", body: JSON.stringify(payload) }),
      cancel: (expenseId: string, by: string) =>
        request<ShopExpenseTransaction>(`/shops/expenses/${expenseId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    },
    businessLedger: (shopId: string, params?: { date?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<ShopBusinessLedgerOut>(`/shops/${shopId}/business-ledger${q ? `?${q}` : ""}`);
    },
    cashTransfers: {
      create: (shopId: string, payload: ShopCashTransferCreate) =>
        request<ShopCashTransfer>(`/shops/${shopId}/cash-transfers`, { method: "POST", body: JSON.stringify(payload) }),
      cancel: (transferId: string, by: string) =>
        request<ShopCashTransfer>(`/shops/cash-transfers/${transferId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    },
  },
  users: {
    list: (status?: string) => request<User[]>(`/users${status ? `?status=${status}` : ""}`),
    audit: (userId: string) => request<UserAccessAuditRow[]>(`/users/${userId}/audit`),
    approve: (userId: string, role: "owner" | "staff") =>
      request<User>(`/users/${userId}/approve`, { method: "PATCH", body: JSON.stringify({ role }) }),
    reject: (userId: string, reason?: string) =>
      request<User>(`/users/${userId}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    suspend: (userId: string, reason?: string) =>
      request<User>(`/users/${userId}/suspend`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    reactivate: (userId: string) =>
      request<User>(`/users/${userId}/reactivate`, { method: "PATCH" }),
  },
};