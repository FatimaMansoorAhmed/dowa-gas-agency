"use client";
import { useEffect, useState } from "react";
import { Search, PlusCircle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, inputClass, BalanceTag, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime } from "@/lib/format";
import ReceivePaymentModal from "@/components/ReceivePaymentModal";
import type { Customer, CustomerLedgerSummary } from "@/lib/types";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function CustomerLedgerBody() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<CustomerLedgerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);

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
        caption="Opening balance is always derived from the ledger, never edited by hand — pick a customer and a month to see exactly how the balance moved."
      />

      <div className="grid grid-cols-[0.65fr_1.5fr] gap-4">
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
                <div className="font-body text-[13px] font-semibold text-ink">{c.name}</div>
                <div className="font-mono text-[10.5px] text-steel">
                  {c.display_id ?? ""} · {c.mobile}
                </div>
                <div className="mt-1">
                  <BalanceTag amount={c.current_balance} />
                </div>
              </button>
            ))}
          </div>
        </Panel>

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
                    <div className="font-display font-bold text-xl text-ink">{summary?.customer.name}</div>
                    <div className="font-mono text-xs text-steel mt-1">
                      {summary?.customer.display_id ?? ""} · {summary?.customer.mobile}{" "}
                      {summary?.customer.shop_name ? `· ${summary.customer.shop_name}` : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button variant="teal" onClick={() => setIsPayModalOpen(true)}>
                      <PlusCircle size={15} /> Receive Payment
                    </Button>

                    <div className="flex gap-2">
                      <select
                        value={mo}
                        onChange={(e) => setMonth(`${year}-${e.target.value}`)}
                        className={`${inputClass} w-[100px]`}
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
                        className={`${inputClass} w-[100px]`}
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
                      <Eyebrow>Closing Balance ({mo}/{year})</Eyebrow>
                      <div className="font-display font-bold text-lg text-ink">{pkr(summary.closing_balance)}</div>
                    </Panel>
                  </div>
                  <div className="grid grid-cols-5 gap-3 mb-4">
                    <Panel>
                      <Eyebrow>11.8 KG Sold</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{summary.total_118}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>45.4 KG Sold</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{summary.total_454}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Total KG</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{summary.total_kg}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Total Ton</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{parseFloat(summary.total_ton || "0").toFixed(2)}</div>
                    </Panel>
                    <Panel>
                      <Eyebrow>Transactions</Eyebrow>
                      <div className="font-mono font-semibold text-base text-ink">{summary.total_transactions}</div>
                    </Panel>
                  </div>

                  <Panel>
                    <Eyebrow>Daily Running Balance</Eyebrow>
                    <SectionCaption>
                      Every row carries the balance forward — click any total above and this is what it's built from.
                    </SectionCaption>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <Th>Date</Th>
                          <Th>ID</Th>
                          <Th>Description</Th>
                          <Th right>11.8 KG</Th>
                          <Th right>45.4 KG</Th>
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
                            <td className="text-steel font-body text-[13px] py-4">No transactions this month.</td>
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