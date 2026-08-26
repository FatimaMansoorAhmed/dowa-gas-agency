"use client";
import { useEffect, useState } from "react";
import { Search, PlusCircle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, BalanceTag, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import ReceivePaymentModal from "@/components/ReceivePaymentModal";
import type { Customer, CustomerLedgerSummary, CustomerFlag } from "@/lib/types";

// Derived from the Asia/Karachi-aware todayLocalInput() ("YYYY-MM-DD"), so
// "this month" reflects the Karachi calendar even off-Karachi machines.
function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function CustomerLedgerBody() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [flags, setFlags] = useState<CustomerFlag[]>([]);

  const loadCustomers = () => {
    api.customers.list().then(setCustomers);
  };

  const loadLedger = () => {
    if (!customerId) {
      setSummary(null);
      return;
    }
    setLoading(true);
    api.ledger.customerMonth(customerId, month).then(setSummary).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    loadLedger();
  }, [customerId, month]);

  // Powers the 🚩 badge in the sidebar for every customer, for the
  // currently-selected month — same Flag Rule as the detail panel above.
  useEffect(() => {
    api.ledger.customerFlags(month).then(setFlags);
  }, [month]);

  const flaggedIds = new Set(flags.filter((f) => f.flagged).map((f) => f.customer.id));

  const filtered = customers.filter(
    (c) =>
      !search.trim() ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.mobile.includes(search) ||
      (c.display_id ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const [year, mo] = month.split("-");
  const monthOptions = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const yearOptions = [2025, 2026, 2027];

  return (
    <div>
      <PageHeader
        eyebrow="Customer Ledger"
        title="Monthly statement, running balance"
        caption="Opening balance is derived from the ledger — select a customer to view cash & cylinder balances."
      />

      <div className="grid grid-cols-[0.65fr_1.5fr] gap-4">
        {/* Customer Sidebar */}
        <Panel>
          <Eyebrow>Customers</Eyebrow>
          <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5 mb-3">
            <Search size={13} className="text-steel" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="border-none outline-none font-body text-xs py-1.5 w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5 max-h-[520px] overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setCustomerId(c.id)}
                className={`text-left px-3 py-2.5 rounded-lg border ${
                  customerId === c.id ? "border-teal bg-[#EAF6F6]" : "border-hairline bg-paper"
                }`}
              >
                <div className="font-body text-[13px] font-semibold text-ink flex items-center gap-1">
                  {c.name}
                  {flaggedIds.has(c.id) && <span title="Flagged this month">🚩</span>}
                </div>
                <div className="font-mono text-[10.5px] text-steel">
                  {c.display_id ?? ""} · {c.mobile}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <BalanceTag
                    amount={customerId === c.id && summary ? summary.closing_balance : c.current_balance}
                  />
                  <span className="font-mono text-[10px] text-steel">
                    11.8k: {c.cylinder_balance_118 || 0}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </Panel>

        {/* Ledger Details */}
        <div>
          {!customerId && (
            <Panel>
              <div className="font-body text-[13px] text-steel py-10 text-center">
                Select a customer to view their statement.
              </div>
            </Panel>
          )}

          {customerId && (
            <>
              <Panel className="mb-4">
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div>
                    <div className="font-mono text-[10.5px] text-steel tracking-wide uppercase mb-0.5">
                      DOWA Gas Agency
                    </div>
                    <div className="font-display font-bold text-xl text-ink flex items-center gap-2">
                      {summary?.customer.name}
                      {summary?.flagged && (
                        <span
                          title="Flagged — this month's closing balance is above its opening balance"
                          className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FBEAEA] text-brand-red border border-[#EFC3C3]"
                        >
                          🚩 Flagged
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-steel mt-1">
                      {summary?.customer.display_id ?? ""} · {summary?.customer.mobile}{" "}
                      {summary?.customer.shop_name ? `· ${summary.customer.shop_name}` : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="teal" onClick={() => setIsPayModalOpen(true)}>
                      <PlusCircle size={15} /> Receive Payment
                    </Button>

                    <div className="flex gap-1.5 ml-1">
                      <select
                        value={mo}
                        onChange={(e) => setMonth(`${year}-${e.target.value}`)}
                        className={`${inputClass} w-[75px]`}
                      >
                        {monthOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <select
                        value={year}
                        onChange={(e) => setMonth(`${e.target.value}-${mo}`)}
                        className={`${inputClass} w-[85px]`}
                      >
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </Panel>

              {loading && (
                <Panel>
                  <div className="font-body text-steel p-6">Loading…</div>
                </Panel>
              )}

              {!loading && summary && (
                <>
                  {/* Financial Stats */}
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <Panel>
                      <Eyebrow>Opening Balance</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.opening_balance)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Total Sales</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.total_sales)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Total Payments</Eyebrow>
                      <div className="font-display font-bold text-lg text-brand-green">
                        {pkr(summary.total_payments)}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Closing Cash Balance</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.closing_balance)}</div>
                    </Panel>
                  </div>

                  {/* Cylinder Inventory Stats */}
                  <div className="grid grid-cols-5 gap-3 mb-4">
                    <Panel>
                      <Eyebrow>11.8 KG Sold</Eyebrow>
                      <div className="font-mono font-semibold text-base text-amber-600">
                        {summary.total_118 || 0}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>45.4 KG Sold</Eyebrow>
                      <div className="font-mono font-semibold text-base text-purple-600">
                        {summary.total_454 || 0}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Total KG Sold</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{summary.total_kg}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Total Ton</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">
                        {parseFloat(summary.total_ton || "0").toFixed(2)}
                      </div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Empty Cylinders</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">
                        11.8k: {summary.customer.empty_cylinders_118 || 0} · 45.4k: {summary.customer.empty_cylinders_454 || 0}
                      </div>
                    </Panel>
                  </div>

                  {/* Combined Ledger Table */}
                  <Panel>
                    <Eyebrow>Daily Running Balance</Eyebrow>
                    <SectionCaption>
                      Tracks cash flow along with cylinder movements for this month.
                    </SectionCaption>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <Th>Date</Th>
                          <Th>ID</Th>
                          <Th>Description</Th>
                          <Th right>11.8 KG Sold</Th>
                          <Th right>45.4 KG Sold</Th>
                          <Th right>Sale</Th>
                          <Th right>Payment</Th>
                          <Th right>Balance</Th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <Td colSpan={7}>Opening balance</Td>
                          <Td right mono bold>
                            {pkr(summary.opening_balance)}
                          </Td>
                        </tr>
                        {summary.rows.map((r) => (
                          <tr key={r.ref_id}>
                            <Td mono>{fmtTime(r.date)}</Td>
                            <Td mono>{r.display_id ?? ""}</Td>
                            <Td>{r.description}</Td>
                            <Td right mono>{parseFloat(r.qty_118) ? r.qty_118 : "—"}</Td>
                            <Td right mono>{parseFloat(r.qty_454) ? r.qty_454 : "—"}</Td>
                            <Td right mono>
                              {parseFloat(r.sale_amount) ? pkr(r.sale_amount) : "—"}
                            </Td>
                            <Td right mono color="#1E8A5F">
                              {parseFloat(r.payment_amount) ? pkr(r.payment_amount) : "—"}
                            </Td>
                            <Td right mono bold>
                              <BalanceTag amount={r.running_balance} />
                            </Td>
                          </tr>
                        ))}
                        {!summary.rows.length && (
                          <tr>
                            <td colSpan={8} className="text-steel font-body text-[13px] py-4 text-center">
                              No transactions this month.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Panel>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Receive Payment Modal */}
      <ReceivePaymentModal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        defaultCustomerId={customerId}
        onSuccess={() => {
          loadLedger();
          loadCustomers();
        }}
      />
    </div>
  );
}

export default function CustomerLedgerPage() {
  return (
    <AuthGate>
      <CustomerLedgerBody />
    </AuthGate>
  );
}