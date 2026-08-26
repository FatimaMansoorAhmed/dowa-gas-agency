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

export type Sale = {
  id: string; display_id: string; date: string;
  customer_id: string; product_id: string; company_id: string | null;
  quantity: string; weight_per_cylinder: string; total_kg: string;
  rate_per_kg: string | null; rate_per_cylinder: string | null; total_amount: string;
  gate_pass_no: string | null; vehicle_no: string | null; notes: string | null;
  status: string; entered_by: string; created_at: string;
  unified_sale_id?: string | null;
};

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
};

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
};

export type CustomerLedgerSummary = {
  customer: Customer; month: string;
  opening_balance: string; total_sales: string; total_payments: string;
  total_118: string; total_454: string; total_kg: string; total_ton: string; total_transactions: number;
  closing_balance: string; flagged: boolean; rows: LedgerRow[];
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
};

export type CompanyPayment = {
  id: string; display_id: string; date: string;
  company_id: string; purchase_id: string | null;
  amount: string; method: string; account_id: string;
  reference_no: string | null; paid_by: string | null; notes: string | null;
  excess_amount: string | null; status: string; entered_by: string; created_at: string;
};

export type CompanyLedgerRow = {
  date: string; kind: "purchase" | "payment" | "unified_sale"; ref_id: string; display_id: string;
  description: string; purchase_amount: string; payment_amount: string; running_balance: string;
  qty_118: string; qty_454: string;
};

export type CompanyLedgerSummary = {
  company: Company; month: string;
  opening_balance: string; total_purchases: string; total_payments: string;
  total_118: string; total_454: string; total_kg: string; total_ton: string; total_transactions: number;
  closing_balance: string; rows: CompanyLedgerRow[];
};

export type PlantLedgerSummaryRow = {
  company: Company;
  opening_balance: string; total_118: string; total_454: string; total_kg: string;
  total_purchases: string; total_payments: string; closing_balance: string;
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
};

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
  qty_11_8kg: string;
  qty_45_4kg: string;
  total_kg: string;
  status: "pending" | "approved" | "cancelled";
  approved_at: string | null;
  approved_by: string | null;
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

export type EmptyCylinderSale = {
  id: string;
  display_id: string;
  date: string;
  customer_id: string;
  cylinder_size: "118" | "454";
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