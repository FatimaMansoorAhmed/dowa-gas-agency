const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

import type {
  Company, Party, RateEntry, Customer, Product, PaymentAccount, ExpenseCategory,
  Sale, Payment, Expense, CustomerLedgerSummary, CustomerFlag, Purchase, CompanyPayment,
  CompanyLedgerSummary, PlantLedgerSummaryRow, CylinderTransaction, CylinderBalance, OwnerDrawing, UnifiedSaleBatch, UnifiedSaleResult, DestinationType,
  AccountType, AccountTransferResult, CylinderTransactionCreate, CustomerCombinedLedger, EmptyCylinderSale,
  OwnerCapital, OwnerCapitalDestination
} from "./types";

export const api = {
  companies: {
    list: () => request<Company[]>("/companies"),
    get: (id: string) => request<Company>(`/companies/${id}`),
    create: (payload: { name: string; mobile?: string; opening_balance?: number; opening_balance_date?: string }) =>
      request<Company>("/companies", { method: "POST", body: JSON.stringify(payload) }),
  },
  parties: {
    list: (companyId?: string) => request<Party[]>(`/parties${companyId ? `?company_id=${companyId}` : ""}`),
    create: (company_id: string, name: string) =>
      request<Party>("/parties", { method: "POST", body: JSON.stringify({ company_id, name }) }),
  },
  rates: {
    list: () => request<RateEntry[]>("/rates"),
    latest: () => request<RateEntry[]>("/rates/latest"),
    create: (payload: { company_id: string; party_id: string; rate_118: number; entered_by: string; timestamp?: string }) =>
      request<RateEntry>("/rates", { method: "POST", body: JSON.stringify(payload) }),
  },
  customers: {
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
    addCylinderTransaction: (customerId: string, payload: CylinderTransactionCreate) =>
      request<{ status: string; data: CylinderTransaction }>(`/customers/${customerId}/cylinders`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    // Sell a customer's empty cylinders back — decreases their empty
    // cylinder balance and posts the sale amount to the Customer Ledger.
    sellEmptyCylinders: (
      customerId: string,
      payload: {
        cylinder_size: "118" | "454"; cylinder_type?: "cross" | "pso";
        quantity: number; amount: number; notes?: string; entered_by: string;
      }
    ) =>
      request<EmptyCylinderSale>(`/customers/${customerId}/empty-cylinders/sell`, {
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
    }) => request<Sale>("/sales", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<Sale>(`/sales/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
  },
  payments: {
    list: (params?: { customer_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Payment[]>(`/payments${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; customer_id: string; sale_id?: string; amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      account_id: string; reference_no?: string; received_by?: string; notes?: string; entered_by: string;
    }) => request<Payment>("/payments", { method: "POST", body: JSON.stringify(payload) }),
    cancel: (id: string, by: string) => request<Payment>(`/payments/${id}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
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
  },

  expenses: {
    list: (params?: { category_id?: string; account_id?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<Expense[]>(`/expenses${q ? `?${q}` : ""}`);
    },
    create: (payload: {
      date: string; category_id: string; amount: number; account_id: string; method?: string;
      description?: string; vendor?: string; reference_no?: string; entered_by: string;
    }) => request<Expense>("/expenses", { method: "POST", body: JSON.stringify(payload) }),
  },
  ledger: {
    customerMonth: (customerId: string, month: string) =>
      request<CustomerLedgerSummary>(`/ledger/customer/${customerId}?month=${month}`),
    companyMonth: (companyId: string, month: string) =>
      request<CompanyLedgerSummary>(`/ledger/company/${companyId}?month=${month}`),
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
      plant_id: string; 
      items: { 
        product_id: string; 
        quantity: number; 
        purchase_rate: number; 
        selling_rate: number;
      }[]; 
      settlement: { 
        total_credit_received: number; 
        cash_received?: number; 
        cash_account_id?: string; 
        home_expense_amount: number; 
        home_expense_category_id?: string; 
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
        settlement: { 
          total_credit_received: number; 
          cash_received?: number; 
          cash_account_id?: string; 
          home_expense_amount: number; 
          home_expense_category_id?: string; 
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
  },
};