export type Company = {
  id: string;
  name: string;
  mobile: string | null;
  opening_balance: string;
  opening_balance_date: string;
  current_balance: string;
  opening_balance_month: string;
  last_overpayment_amount: string | null;
  last_overpayment_date: string | null;
  account_credit: string;
};

export type Party = { id: string; company_id: string; name: string };

export type RateEntry = {
  id: string;
  company_id: string;
  party_id: string;
  rate_118: string;
  rate_454: string;
  entered_by: string;
  timestamp: string;
};

export type Customer = {
  id: string;
  display_id: string;
  name: string;
  mobile: string;
  alt_mobile: string | null;
  shop_name: string | null;
  address: string | null;
  city_area: string | null;
  opening_balance: string;
  opening_balance_date: string;
  current_balance: string;
  status: "active" | "inactive";
  created_at: string;
  last_transaction_at: string | null;
  opening_balance_month: string;
  last_overpayment_amount: string | null;
  last_overpayment_date: string | null;
  account_credit: string;
  cylinder_balance_118: string;
  cylinder_balance_454: string;
  empty_cylinders: string;
  empty_cylinders_118: string;
  empty_cylinders_454: string;
  // Cross/PSO breakdown within each size — cross + pso == the size total
  // above for any customer entered through the typed flow; 0/0 for
  // customers created before this feature existed (their size total is
  // preserved but unclassified).
  empty_cylinders_118_cross: string;
  empty_cylinders_118_pso: string;
  empty_cylinders_454_cross: string;
  empty_cylinders_454_pso: string;
  // "individual" (default, the original meaning of this table) | "shop" —
  // a Shop IS a Customer row (§ Shop Management), reusing the entire
  // Sale/Payment/Customer-Ledger pipeline for the money side unchanged.
  customer_type: "individual" | "shop";
};

export type Product = { id: string; name: string; weight_kg: string; active: string };

export type AccountType = "office_cash" | "owner_home" | "dowa_account";

export type PaymentAccount = {
  id: string;
  name: string;
  kind: "cash" | "bank";
  account_type?: AccountType;
  opening_balance: string;
  current_balance: string;
  active: string;
};

export type AccountTransferResult = {
  from_account: PaymentAccount;
  to_account: PaymentAccount;
};

export type ExpenseCategory = { id: string; name: string; description: string | null; active: string };

// Ledger Corrections (§1) — present on Sale/Payment/Purchase/CompanyPayment.
// corrected_from_id points at the ORIGINAL row this one replaces; the
// original itself gets status="corrected" plus the other 3 fields.
export type CorrectionFields = {
  corrected_by?: string | null;
  corrected_at?: string | null;
  correction_reason?: string | null;
  corrected_from_id?: string | null;
};

export type Sale = {
  id: string; display_id: string; date: string;
  customer_id: string; product_id: string; company_id: string | null;
  quantity: string; weight_per_cylinder: string; total_kg: string;
  rate_per_kg: string | null; rate_per_cylinder: string | null; total_amount: string;
  gate_pass_no: string | null; vehicle_no: string | null; notes: string | null;
  status: string; entered_by: string; created_at: string;
  unified_sale_id?: string | null;
} & CorrectionFields;

export type Payment = {
  id: string; display_id: string; date: string;
  customer_id: string; sale_id: string | null;
  amount: string; method: string; account_id: string | null;
  reference_no: string | null; received_by: string | null; notes: string | null;
  excess_amount: string | null; status: string; entered_by: string; created_at: string;
  unified_sale_id?: string | null;
  // Present only on rows created via /payment-receipts (destination routing) —
  // null/undefined on ordinary quick-pay rows from /payments.
  destination_type?: DestinationType | null;
  target_plant_id?: string | null;
  account_category?: string | null;
  net_settlement_amount?: string | null;
} & CorrectionFields;

export type Expense = {
  id: string; display_id: string; date: string; category_id: string;
  amount: string; account_id: string | null; method: string;
  description: string | null; vendor: string | null; reference_no: string | null;
  status: string; entered_by: string; created_at: string;
  unified_sale_id?: string | null;
  // Set only when this expense was funded straight out of a customer's
  // payment (bypassing a Dowa account) — null for ordinary account-funded expenses.
  customer_id?: string | null;
  customer_name?: string | null;
};

export type LedgerRow = {
  date: string; kind: "sale" | "payment" | "unified_sale" | "empty_cylinder_sale" | "cylinder_transaction"; ref_id: string; display_id: string;
  description: string; sale_amount: string; payment_amount: string; running_balance: string;
  qty_118: string; qty_454: string; qty_empty: string;
  cyl_out: string; cyl_in: string;
  entered_by: string;
  // True only for "sale"/"payment" rows — the two kinds the Correct action
  // applies to (§1 Scope).
  correctable: boolean;
};

// One superseded (status="corrected") original transaction, kept for the
// read-only Correction History panel (§1) — never mixed into `rows` above.
export type CorrectionHistoryRow = {
  kind: "sale" | "payment" | "purchase" | "company_payment";
  date: string; ref_id: string; display_id: string; description: string;
  original_amount: string; correction_reason: string;
  corrected_by: string; corrected_at: string;
  corrected_display_id: string | null;
};

export type CustomerLedgerSummary = {
  customer: Customer; month: string;
  opening_balance: string; total_sales: string; total_payments: string;
  total_118: string; total_454: string; total_kg: string; total_ton: string; total_transactions: number;
  closing_balance: string; flagged: boolean; rows: LedgerRow[];
  corrections: CorrectionHistoryRow[];
};

export type CustomerFlag = {
  customer: Customer;
  month: string;
  opening_balance: string;
  closing_balance: string;
  flagged: boolean;
};

export type Purchase = {
  id: string; display_id: string; date: string;
  company_id: string; product_id: string;
  quantity: string; weight_per_cylinder: string; total_kg: string;
  rate_per_kg: string | null; rate_per_cylinder: string | null;
  additional_charges: string; transport_charges: string; other_charges: string;
  total_amount: string;
  gate_pass_no: string | null; vehicle_no: string | null;
  driver_name: string | null; driver_contact: string | null; notes: string | null;
  status: string; entered_by: string; created_at: string;
  unified_sale_id?: string | null;
} & CorrectionFields;

export type CompanyPayment = {
  id: string; display_id: string; date: string;
  company_id: string; purchase_id: string | null;
  amount: string; method: string; account_id: string;
  reference_no: string | null; paid_by: string | null; notes: string | null;
  excess_amount: string | null; status: string; entered_by: string; created_at: string;
} & CorrectionFields;

export type CompanyLedgerRow = {
  date: string; kind: "purchase" | "payment" | "unified_sale"; ref_id: string; display_id: string;
  description: string; purchase_amount: string; payment_amount: string; running_balance: string;
  qty_118: string; qty_454: string;
  // The specific vehicle for this individual purchase/unified-sale
  // transaction — absent for payment rows.
  vehicle_no?: string | null;
  entered_by: string;
  // True only for "purchase"/"payment" rows — see LedgerRow.correctable.
  correctable: boolean;
};

export type CompanyLedgerSummary = {
  company: Company; month: string;
  opening_balance: string; total_purchases: string; total_payments: string;
  total_118: string; total_454: string; total_kg: string; total_ton: string; total_transactions: number;
  closing_balance: string; rows: CompanyLedgerRow[];
  corrections: CorrectionHistoryRow[];
};

export type PlantLedgerSummaryRow = {
  company: Company;
  opening_balance: string; total_118: string; total_454: string; total_kg: string;
  total_purchases: string; total_payments: string; closing_balance: string;
  // Vehicle from the most recent Purchase this plant received this month.
  vehicle_no?: string | null;
};

export type CylinderTransaction = {
  id: string; display_id: string; date: string;
  customer_id: string; product_id: string; sale_id: string | null;
  qty_out: string; qty_in: string;
  notes: string | null; status: string; entered_by: string; created_at: string;
};

export type CylinderBalance = { customer_id: string; product_id: string; balance: string };

export type User = { name: string; role: "CEO" | "Staff" };

/* --- Naye Types (Unified Sale & Payment System) --- */

export type OwnerDrawing = {
  id: string;
  display_id: string;
  date: string;
  amount: string;
  account_id: string | null;
  notes: string | null;
  unified_sale_id: string | null;
  status: string;
  entered_by: string;
  created_at: string;
};

export type OwnerCapitalDestination = "account" | "plant";

export type OwnerCapital = {
  id: string;
  display_id: string;
  date: string;
  amount: string;
  destination_type: OwnerCapitalDestination;
  account_id: string | null;
  target_plant_id: string | null;
  notes: string | null;
  status: string;
  entered_by: string;
  created_at: string;
};

export type UnifiedSaleItem = {
  product_id: string;
  quantity: number;
  purchase_rate: number;
  selling_rate: number;
};

export type DestinationType = "plant" | "account";

export type UnifiedSaleSettlement = {
  total_credit_received: number;
  cash_received?: number;
  cash_account_id?: string;
  home_expense_amount: number;
  home_expense_category_id?: string;
  owner_drawings_amount: number;
  // Flexible Destination Routing
  destination_type?: DestinationType;
  target_plant_id?: string;
  account_id?: string;
  payment_reference?: string;
};

export type ApprovalStatus = "pending" | "approved" | "cancelled";

export type UnifiedSaleBatch = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  company_id: string;
  total_selling_amount: string;
  total_purchase_amount: string;
  total_credit_received: string;
  net_plant_payment: string;
  home_expense_amount: string;
  owner_drawings_amount: string;
  destination_type?: DestinationType;
  target_plant_id?: string | null;
  account_id?: string | null;
  vehicle_no?: string | null;
  gate_pass_no?: string | null;
  notes?: string | null;
  payment_reference?: string | null;
  qty_11_8kg: string;
  qty_45_4kg: string;
  total_kg: string;
  // Legacy aggregate — "approved" only once both sale_status and
  // payment_status are approved. Prefer the two fields below for the
  // Unified Sale page's independent Sale/Payment workflow.
  status: ApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  sale_status: ApprovalStatus;
  sale_approved_at: string | null;
  sale_approved_by: string | null;
  payment_status: ApprovalStatus;
  payment_approved_at: string | null;
  payment_approved_by: string | null;
  entered_by: string;
  created_at: string;
};

export type UnifiedSaleResult = UnifiedSaleBatch & {
  sales: Sale[];
  purchases: Purchase[];
  // Named to match the backend's UnifiedSaleOut.plant_payment — this is a
  // CompanyPayment (the 3-way settlement), never a customer Payment.
  plant_payment: CompanyPayment | null;
  expense: Expense | null;
  owner_drawing: OwnerDrawing | null;
};

export type PaymentReceipt = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  customer_name: string;
  total_credit_received: number;
  destination_type: DestinationType;
  destination_name: string;
  home_expense_amount: number;
  home_expense_category?: string;
  owner_drawings_amount: number;
  net_settlement_amount: number;
  unified_sale_id?: string;
  entered_by: string;
};
export interface CylinderTransactionCreate {
  customer_id: string;
  product_id?: string;
  qty_out: number;
  qty_in: number;
  transaction_type: string;
  notes?: string;
  entered_by: string;
}

export type CylinderType = "cross" | "pso";

export type EmptyCylinderSale = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  cylinder_size: "118" | "454";
  // Absent/null on sales recorded before typed tracking existed.
  cylinder_type: CylinderType | null;
  quantity: string;
  amount: string;
  notes: string | null;
  status: string;
  entered_by: string;
  created_at: string;
};

export interface LedgerEntry {
  id: string;
  date: string;
  type: string;
  description: string;
  debit: number;
  credit: number;
  cyl_out: number;
  cyl_in: number;
  cash_balance: number;
  cyl_balance: number;
}

export interface CustomerCombinedLedger {
  customer_name: string;
  opening_balance: number;
  current_cash_balance: number;
  current_cyl_118: number;
  current_cyl_454: number;
  ledger: LedgerEntry[];
}

/* --- Reporting (§5, §6, §7, §8) --- */

export type ReportableTransaction = {
  id: string; type: string; date: string; display_id: string; description: string;
  amount: string | null; customer: string | null; plant: string | null;
  reference: string | null; entered_by: string; approval_info: string | null; status: string;
};

export type ReportSection = {
  key: string; label: string; rows: ReportableTransaction[]; financial_total: string | null;
};

export type DailySummary = {
  total_sales: string; total_purchases: string; total_customer_payments: string;
  total_plant_payments: string; total_investments: string; total_expenses: string;
  total_owner_drawings: string; net_cash_movement: string;
  total_cylinders_out: string; total_cylinders_in: string;
};

export type DailyReportData = {
  business_date: string; sections: ReportSection[]; summary: DailySummary;
};

export type WhatsAppStatus = "not_sent" | "sent" | "failed" | "unavailable";

export type GeneratedReport = {
  id: string; report_type: string; business_date: string;
  generated_at: string; generated_by: string;
  whatsapp_status: WhatsAppStatus; whatsapp_sent_at: string | null; whatsapp_error: string | null;
};

export type SendWhatsAppResult = { report: GeneratedReport; message: string };

/* --- Shop Management + Board Rate --- */

export type BoardRate = {
  id: string;
  effective_date: string;
  rate_per_kg: string;
  entered_by: string;
  created_at: string;
};

export type ShopStockBatch = {
  id: string;
  customer_id: string;
  product_id: string;
  source_sale_id: string | null;
  transaction_date: string;
  quantity_received: string;
  quantity_remaining: string;
  load_rate_per_kg: string;
  status: string;
  entered_by: string;
  created_at: string;
};

export type ShopSale = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  product_id: string;
  quantity: string;
  unit: "cylinder" | "kg";
  quantity_kg: string | null;
  supply_customer_id: string | null;
  payment_type: "cash" | "credit";
  board_rate_per_kg_used: string;
  cylinder_weight_used: string;
  saleable_kg_used: string | null;
  sale_rate_per_cylinder: string;
  total_amount: string;
  notes: string | null;
  status: string;
  entered_by: string;
  created_at: string;
} & CorrectionFields;

export type ShopStockAdjustment = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  product_id: string;
  adjustment_type: "return" | "adjustment";
  quantity_delta: string;
  reason: string | null;
  status: string;
  entered_by: string;
  created_at: string;
};

export type ShopListRow = {
  customer: Customer;
  current_stock: string;
  today_load: string;
  today_sales: string;
  today_returns: string;
  current_balance: string;
  last_activity: string | null;
};

export type ShopProductStockSummary = {
  product_id: string;
  product_name: string;
  opening_stock: string;
  new_load: string;
  sales: string;
  returns: string;
  adjustments: string;
  closing_stock: string;
  board_rate_per_kg: string | null;
  cylinder_weight: string;
  wastage_kg: string;
  saleable_kg: string;
  sale_rate_per_cylinder: string | null;
  todays_sales_amount: string;
};

export type ShopStockSummary = {
  business_date: string;
  products: ShopProductStockSummary[];
  total_opening_stock: string;
  total_new_load: string;
  total_sales: string;
  total_returns: string;
  total_adjustments: string;
  total_closing_stock: string;
  total_sales_amount: string;
};

export type ShopTransactionRow = {
  kind: "load" | "shop_sale" | "return" | "adjustment" | "payment";
  date: string;
  ref_id: string;
  display_id: string;
  description: string;
  quantity: string | null;
  board_rate_per_kg: string | null;
  cylinder_weight: string | null;
  sale_rate_per_cylinder: string | null;
  load_rate_per_kg: string | null;
  amount: string | null;
  entered_by: string;
  status: string;
  correctable: boolean;
};

export type ShopSaleCorrectionRow = {
  date: string;
  ref_id: string;
  display_id: string;
  description: string;
  original_amount: string;
  correction_reason: string;
  corrected_by: string;
  corrected_at: string;
  corrected_display_id: string | null;
};

// ---------- Shop Business Finance (Engine 3) ----------

export type ShopSupplyCustomer = {
  id: string;
  shop_id: string;
  name: string;
  mobile: string | null;
  address: string | null;
  opening_balance: string;
  current_balance: string;
  status: string;
  entered_by: string;
  created_at: string;
};

export type ShopCustomerPayment = {
  id: string;
  display_id: string;
  date: string;
  shop_id: string;
  supply_customer_id: string;
  amount: string;
  method: string;
  notes: string | null;
  status: string;
  entered_by: string;
  created_at: string;
};

export type ShopExpenseLine = {
  id: string;
  category_id: string;
  category_name: string | null;
  line_type: "expense" | "owner_withdrawal";
  amount: string;
  description: string | null;
};

export type ShopExpenseTransaction = {
  id: string;
  display_id: string;
  date: string;
  shop_id: string;
  total_amount: string;
  payment_source: string | null;
  notes: string | null;
  status: string;
  entered_by: string;
  created_at: string;
  lines: ShopExpenseLine[];
};

export type ShopCashSummary = {
  business_date: string;
  opening_cash: string;
  cash_retail_sales: string;
  supply_customer_collections: string;
  expenses: string;
  owner_withdrawals: string;
  dowa_payments: string;
  closing_cash: string;
};

export type ShopBusinessLedgerRow = {
  kind: "cash_sale" | "credit_sale" | "customer_payment" | "expense" | "owner_withdrawal" | "dowa_payment";
  date: string;
  ref_id: string;
  display_id: string;
  description: string;
  amount: string;
  cash_impact: string;
  entered_by: string;
  status: string;
};

export type ShopBusinessLedgerOut = {
  business_date: string;
  cash: ShopCashSummary;
  rows: ShopBusinessLedgerRow[];
};

export type ShopDetailOut = {
  customer: Customer;
  stock: ShopStockSummary;
  cash: ShopCashSummary;
  transactions: ShopTransactionRow[];
  corrections: CorrectionHistoryRow[];
  shop_sale_corrections: ShopSaleCorrectionRow[];
};