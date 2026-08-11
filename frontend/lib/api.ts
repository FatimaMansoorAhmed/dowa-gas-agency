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

export const api = {
companies: {
    list: () => request<import("./types").Company[]>("/companies"),
    create: (name: string) =>
      request<import("./types").Company>("/companies", { 
        method: "POST", 
        body: JSON.stringify({ name }) 
      }),
  },
  parties: {
    list: (companyId?: string) =>
      request<import("./types").Party[]>(`/parties${companyId ? `?company_id=${companyId}` : ""}`),
    create: (company_id: string, name: string) =>
      request<import("./types").Party>("/parties", { method: "POST", body: JSON.stringify({ company_id, name }) }),
  },
  rates: {
    list: () => request<import("./types").RateEntry[]>("/rates"),
    latest: () => request<import("./types").RateEntry[]>("/rates/latest"),
    create: (payload: {
      company_id: string; party_id: string; rate_118: number; entered_by: string; timestamp?: string;
    }) => request<import("./types").RateEntry>("/rates", { method: "POST", body: JSON.stringify(payload) }),
  },
  customers: {
    list: (search?: string) =>
      request<import("./types").Customer[]>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    create: (payload: { name: string; mobile: string; address?: string; opening_balance: number }) =>
      request<import("./types").Customer>("/customers", { method: "POST", body: JSON.stringify(payload) }),
    adjust: (id: string, kind: "payment" | "charge", amount: number) =>
      request<import("./types").Customer>(`/customers/${id}/adjust`, {
        method: "PATCH", body: JSON.stringify({ kind, amount }),
      }),
  },
};
