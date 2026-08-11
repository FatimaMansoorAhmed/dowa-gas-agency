export type Company = { id: string; name: string };
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
  name: string;
  mobile: string;
  address: string | null;
  opening_balance: string;
  current_balance: string;
  status: "active" | "inactive";
  created_at: string;
  opening_balance_month: string;
  last_overpayment_amount: string | null;
  last_overpayment_date: string | null;
};

export type User = { name: string; role: "CEO" | "Staff" };
