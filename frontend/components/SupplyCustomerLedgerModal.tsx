"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Search, Banknote } from "lucide-react";
import { Th, Td, Eyebrow, BalanceTag } from "./ui";
import { api } from "@/lib/api";
import { pkr, fmtTime } from "@/lib/format";
import type { ShopSupplyCustomer, ShopSupplyCustomerLedgerOut } from "@/lib/types";

/** Supply Customer Ledger (§ Shop Customer Ledger) — the shop-scoped mirror
 * of the main Customer Ledger page, scaled down to a modal since a shop's
 * own customer book is a small, secondary concern off the Shop Detail page
 * rather than a top-level nav item. All-time, not month-scoped — see
 * GET /shops/customers/{id}/ledger's docstring for why. Read-only: to
 * receive a payment, this closes and hands off to the existing
 * RecordSupplyCustomerPaymentModal via onReceivePayment, rather than
 * stacking two modals. */
export default function SupplyCustomerLedgerModal({
  customers,
  initialCustomerId,
  onClose,
  onReceivePayment,
}: {
  customers: ShopSupplyCustomer[];
  initialCustomerId?: string;
  onClose: () => void;
  onReceivePayment: (customer: ShopSupplyCustomer) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialCustomerId || customers[0]?.id || "");
  const [ledger, setLedger] = useState<ShopSupplyCustomerLedgerOut | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedId) { setLedger(null); return; }
    setLoading(true);
    api.shops.customers.ledger(selectedId)
      .then(setLedger)
      .finally(() => setLoading(false));
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (c.mobile || "").includes(q));
  }, [customers, search]);

  const selected = customers.find((c) => c.id === selectedId) || null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(11,33,56,0.5)] p-3 sm:p-5 flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden bg-white rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <div>
            <Eyebrow>Supply Customer Ledger</Eyebrow>
            <div className="font-body text-xs text-steel mt-1">
              This shop's own retail customers — cylinders bought, rate, and running balance with the shop. Separate from the Dowa Customer Ledger.
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-paper text-steel hover:text-ink" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          {/* Customer list */}
          <div className="w-full sm:w-[260px] shrink-0 border-b sm:border-b-0 sm:border-r border-hairline flex flex-col overflow-hidden max-h-[220px] sm:max-h-none">
            <div className="p-3 border-b border-hairline">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customers…"
                  className="w-full pl-7 pr-2.5 py-1.5 bg-paper border border-hairline rounded-md text-xs font-body text-ink focus:outline-none focus:border-teal"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-hairline/60 transition-colors ${c.id === selectedId ? "bg-teal/10" : "hover:bg-paper"}`}
                >
                  <div className="font-body text-[12.5px] font-semibold text-ink truncate">{c.name}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-steel">{c.mobile || "No mobile"}</span>
                    <span className="font-mono text-[11px] font-semibold text-ink">{pkr(c.current_balance)}</span>
                  </div>
                </button>
              ))}
              {!filtered.length && (
                <div className="p-4 text-center text-steel font-body text-[12px]">No customers found.</div>
              )}
            </div>
          </div>

          {/* Ledger detail */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-5">
            {!selected && (
              <div className="text-center text-steel font-body text-sm py-12">Select a customer to view their ledger.</div>
            )}
            {selected && (
              <>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-display text-lg font-bold text-ink">{selected.name}</div>
                    <div className="mt-1 font-body text-xs text-steel">
                      {[selected.mobile, selected.address].filter(Boolean).join(" · ") || "No contact details"}
                    </div>
                  </div>
                  {parseFloat(selected.current_balance) > 0 && (
                    <button
                      type="button"
                      onClick={() => onReceivePayment(selected)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-700"
                    >
                      <Banknote size={13} /> Receive Payment
                    </button>
                  )}
                </div>

                {loading && <div className="mt-6 text-center text-steel font-body text-sm">Loading ledger…</div>}

                {!loading && ledger && (
                  <>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">Opening Balance</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-ink">{pkr(ledger.opening_balance)}</div>
                      </div>
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">Total Sales (Credit)</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-ink">{pkr(ledger.total_sales)}</div>
                      </div>
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">Collected at Sale</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-slate-600">{pkr(ledger.total_collected_at_sale)}</div>
                      </div>
                      <div className="rounded-lg border border-hairline bg-panel p-3">
                        <div className="font-mono text-[9.5px] uppercase text-steel">Total Payments</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-[#1E8A5F]">{pkr(ledger.total_payments)}</div>
                      </div>
                      <div className="rounded-lg border border-teal/30 bg-teal/5 p-3">
                        <div className="font-mono text-[9.5px] uppercase text-teal">Closing Balance</div>
                        <div className="mt-1"><BalanceTag amount={ledger.closing_balance} /></div>
                      </div>
                    </div>

                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[700px] border-collapse">
                        <thead>
                          <tr className="border-b border-hairline text-left">
                            <Th>Date</Th>
                            <Th>ID</Th>
                            <Th>Description</Th>
                            <Th right>Rate</Th>
                            <Th right>Remaianing Amount</Th>
                            <Th right>Payment</Th>
                            <Th right>Balance</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {ledger.rows.map((r) => (
                            <tr key={r.ref_id} className="hover:bg-paper/60 transition-colors">
                              <Td mono>{fmtTime(r.date)}</Td>
                              <Td mono>{r.display_id}</Td>
                              <Td>{r.description}</Td>
                              <Td right mono color="#8E8E93">{r.rate ? pkr(r.rate) : "—"}</Td>
                              <Td right mono>{parseFloat(r.sale_amount) ? pkr(r.sale_amount) : "—"}</Td>
                              <Td right mono color="#1E8A5F">{parseFloat(r.payment_amount) ? pkr(r.payment_amount) : "—"}</Td>
                              <Td right mono bold>{pkr(r.running_balance)}</Td>
                            </tr>
                          ))}
                          {!ledger.rows.length && (
                            <tr><td colSpan={7} className="text-steel font-body text-[13px] py-6 text-center">No transactions yet for this customer.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
