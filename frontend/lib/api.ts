const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const API_BASE = BASE;

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
  OwnerCapital, OwnerCapitalDestination, DailyReportData, GeneratedReport, SendWhatsAppResult,
  BoardRate, ShopListRow, ShopDetailOut, ShopSale, ShopStockAdjustment, ShopStockBatch,
  ShopSupplyCustomer, ShopCustomerPayment, ShopExpenseTransaction, ShopBusinessLedgerOut,
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
    // Ledger Correction (§1): reverses this sale, marks it "corrected"
    // (kept in history), and posts a brand-new Sale with the corrected values.
    correct: (id: string, payload: {
      date: string; customer_id: string; product_id: string; company_id?: string;
      quantity: number; rate_per_cylinder: number; gate_pass_no?: string;
      vehicle_no?: string; notes?: string; entered_by: string; cylinders_returned?: number;
      correction_reason: string; corrected_by: string;
    }) => request<Sale>(`/sales/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
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
    correct: (id: string, payload: {
      date: string; customer_id: string; sale_id?: string; amount: number;
      method: "cash" | "bank_transfer" | "cheque" | "online" | "other";
      account_id: string; reference_no?: string; received_by?: string; notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
    }) => request<Payment>(`/payments/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
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
    correct: (id: string, payload: {
      date: string; company_id: string; product_id: string; quantity: number;
      rate_per_cylinder: number; additional_charges?: number; transport_charges?: number;
      other_charges?: number; gate_pass_no?: string; vehicle_no?: string;
      driver_name?: string; driver_contact?: string; notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
    }) => request<Purchase>(`/purchases/${id}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
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
    generateDaily: (businessDate: string, generatedBy: string) =>
      request<GeneratedReport>(
        `/reports/daily/generate?business_date=${businessDate}&generated_by=${encodeURIComponent(generatedBy)}`,
        { method: "POST" }
      ),
    downloadUrl: (id: string) => `${BASE}/reports/${id}/download`,
    sendWhatsApp: (id: string, to?: string) =>
      request<SendWhatsAppResult>(`/reports/${id}/send-whatsapp${to ? `?to=${encodeURIComponent(to)}` : ""}`, {
        method: "POST",
      }),
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
    batches: (id: string) => request<ShopStockBatch[]>(`/shops/${id}/batches`),
    getSale: (saleId: string) => request<ShopSale>(`/shops/sales/${saleId}`),
    createSale: (shopId: string, payload: {
      date: string; product_id: string; quantity: number; unit?: "cylinder" | "kg";
      supply_customer_id?: string; payment_type?: "cash" | "credit";
      notes?: string; entered_by: string;
    }) => request<ShopSale>(`/shops/${shopId}/sales`, { method: "POST", body: JSON.stringify(payload) }),
    cancelSale: (saleId: string, by: string) =>
      request<ShopSale>(`/shops/sales/${saleId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    correctSale: (saleId: string, payload: {
      date: string; product_id: string; quantity: number; unit?: "cylinder" | "kg";
      supply_customer_id?: string; payment_type?: "cash" | "credit";
      notes?: string; entered_by: string;
      correction_reason: string; corrected_by: string;
    }) => request<ShopSale>(`/shops/sales/${saleId}/correct`, { method: "PATCH", body: JSON.stringify(payload) }),
    createAdjustment: (shopId: string, payload: {
      date: string; product_id: string; adjustment_type: "return" | "adjustment";
      quantity_delta: number; reason?: string; entered_by: string;
    }) => request<ShopStockAdjustment>(`/shops/${shopId}/adjustments`, { method: "POST", body: JSON.stringify(payload) }),
    cancelAdjustment: (adjustmentId: string, by: string) =>
      request<ShopStockAdjustment>(`/shops/adjustments/${adjustmentId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),

    // ---- Engine 3: Shop Business Finance ----
    customers: {
      list: (shopId: string) => request<ShopSupplyCustomer[]>(`/shops/${shopId}/customers`),
      create: (shopId: string, payload: {
        name: string; mobile?: string; address?: string; opening_balance?: number; entered_by: string;
      }) => request<ShopSupplyCustomer>(`/shops/${shopId}/customers`, { method: "POST", body: JSON.stringify(payload) }),
      get: (supplyCustomerId: string) => request<ShopSupplyCustomer>(`/shops/customers/${supplyCustomerId}`),
    },
    customerPayments: {
      create: (shopId: string, supplyCustomerId: string, payload: {
        date: string; supply_customer_id: string; amount: number; method?: string; notes?: string; entered_by: string;
      }) => request<ShopCustomerPayment>(`/shops/${shopId}/customers/${supplyCustomerId}/payments`, { method: "POST", body: JSON.stringify(payload) }),
      cancel: (paymentId: string, by: string) =>
        request<ShopCustomerPayment>(`/shops/customer-payments/${paymentId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    },
    expenses: {
      list: (shopId: string, month?: string) =>
        request<ShopExpenseTransaction[]>(`/shops/${shopId}/expenses${month ? `?month=${month}` : ""}`),
      create: (shopId: string, payload: {
        date: string;
        lines: { category_id: string; line_type: "expense" | "owner_withdrawal"; amount: number; description?: string }[];
        payment_source?: string; notes?: string; entered_by: string;
      }) => request<ShopExpenseTransaction>(`/shops/${shopId}/expenses`, { method: "POST", body: JSON.stringify(payload) }),
      cancel: (expenseId: string, by: string) =>
        request<ShopExpenseTransaction>(`/shops/expenses/${expenseId}/cancel?by=${encodeURIComponent(by)}`, { method: "PATCH" }),
    },
    businessLedger: (shopId: string, params?: { date?: string; month?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<ShopBusinessLedgerOut>(`/shops/${shopId}/business-ledger${q ? `?${q}` : ""}`);
    },
  },
};