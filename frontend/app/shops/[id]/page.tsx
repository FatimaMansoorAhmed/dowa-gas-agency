"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PlusCircle, ShoppingCart, RefreshCw, Pencil, Users, Wallet } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Th, Td, inputClass, BalanceTag, Button } from "@/components/ui";
import ReceivePaymentModal from "@/components/ReceivePaymentModal";
import RecordShopSaleModal from "@/components/RecordShopSaleModal";
import RecordShopAdjustmentModal from "@/components/RecordShopAdjustmentModal";
import AddSupplyCustomerModal from "@/components/AddSupplyCustomerModal";
import RecordSupplyCustomerPaymentModal from "@/components/RecordSupplyCustomerPaymentModal";
import RecordShopExpenseModal from "@/components/RecordShopExpenseModal";
import CorrectTransactionModal, { CorrectableKind } from "@/components/CorrectTransactionModal";
import PrintButton from "@/components/PrintButton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import type { ShopDetailOut, ShopTransactionRow, Sale, Payment, ShopSale, ShopSupplyCustomer, ShopBusinessLedgerOut } from "@/lib/types";

function currentMonth() {
  return todayLocalInput().slice(0, 7);
}

function ShopDetailBody() {
  const params = useParams();
  const shopId = params.id as string;
  const { user } = useAuth();

  const [date, setDate] = useState(todayLocalInput());
  const [month, setMonth] = useState(currentMonth());
  const [detail, setDetail] = useState<ShopDetailOut | null>(null);
  const [loading, setLoading] = useState(true);

  const [showPay, setShowPay] = useState(false);
  const [showSale, setShowSale] = useState(false);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [payCustomerTarget, setPayCustomerTarget] = useState<ShopSupplyCustomer | null>(null);

  const [supplyCustomers, setSupplyCustomers] = useState<ShopSupplyCustomer[]>([]);
  const [ledger, setLedger] = useState<ShopBusinessLedgerOut | null>(null);

  const [correctTarget, setCorrectTarget] = useState<{ kind: CorrectableKind; transaction: Sale | Payment | ShopSale } | null>(null);
  const [correctLoading, setCorrectLoading] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.shops.detail(shopId, { date, month }).then(setDetail).finally(() => setLoading(false));
    api.shops.customers.list(shopId).then(setSupplyCustomers);
    api.shops.businessLedger(shopId, { date, month }).then(setLedger);
  };
  useEffect(() => { load(); }, [shopId, date, month]);

  const openCorrect = async (row: ShopTransactionRow) => {
    if (!row.correctable) return;
    setCorrectLoading(row.ref_id);
    try {
      if (row.kind === "load") {
        const list = await api.sales.list({ customer_id: shopId });
        const tx = list.find((s) => s.id === row.ref_id);
        if (tx) setCorrectTarget({ kind: "sale", transaction: tx });
      } else if (row.kind === "payment") {
        const list = await api.payments.list({ customer_id: shopId });
        const tx = list.find((p) => p.id === row.ref_id);
        if (tx) setCorrectTarget({ kind: "payment", transaction: tx });
      } else if (row.kind === "shop_sale") {
        const tx = await api.shops.getSale(row.ref_id);
        setCorrectTarget({ kind: "shopSale", transaction: tx });
      }
    } finally {
      setCorrectLoading(null);
    }
  };

  const [year, mo] = month.split("-");

  if (loading && !detail) {
    return <Panel><div className="font-body text-steel p-6">Loading…</div></Panel>;
  }
  if (!detail) return null;

  const s = detail.stock;
  const allCorrections = [
    ...detail.corrections.map((c) => ({ ...c, kind: c.kind as string })),
    ...detail.shop_sale_corrections.map((c) => ({ ...c, kind: "shop_sale" })),
  ].sort((a, b) => (a.corrected_at < b.corrected_at ? 1 : -1));

  return (
    <div>
      <PageHeader
        eyebrow="Shop"
        title={detail.customer.name}
        caption={`${detail.customer.display_id} · ${detail.customer.mobile}`}
        action={
          <div className="flex items-center gap-2 no-print">
            <Button variant="teal" onClick={() => setShowPay(true)}><PlusCircle size={14} /> Receive Payment</Button>
            <Button variant="outline" onClick={() => setShowSale(true)}><ShoppingCart size={14} /> Record Shop Sale</Button>
            <Button variant="outline" onClick={() => setShowAdjustment(true)}><RefreshCw size={14} /> Return / Adjustment</Button>
            <Button variant="outline" onClick={() => setShowExpense(true)}><Wallet size={14} /> Record Expense</Button>
            <Button variant="outline" onClick={() => setShowAddCustomer(true)}><Users size={14} /> Add Supply Customer</Button>
            <PrintButton label="Print" />
          </div>
        }
      />

      <div className="print-area">
        <div className="flex items-center gap-3 mb-4 no-print">
          <BalanceTag amount={detail.customer.current_balance} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-[160px]`} />
        </div>

        {/* Stock summary cards (§28) */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Panel><Eyebrow>Opening Stock</Eyebrow><div className="font-display font-bold text-2xl text-ink">{s.total_opening_stock}</div></Panel>
          <Panel><Eyebrow>Today's New Load</Eyebrow><div className="font-display font-bold text-2xl text-brand-green">+{s.total_new_load}</div></Panel>
          <Panel><Eyebrow>Today's Sales</Eyebrow><div className="font-display font-bold text-2xl text-ink">-{s.total_sales}</div></Panel>
          <Panel><Eyebrow>Closing Stock</Eyebrow><div className="font-display font-bold text-2xl text-ink">{s.total_closing_stock}</div></Panel>
        </div>

        {(s.total_returns !== "0" || s.total_adjustments !== "0") && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Panel><Eyebrow>Today's Returns</Eyebrow><div className="font-mono font-semibold text-lg text-ink">{s.total_returns}</div></Panel>
            <Panel><Eyebrow>Today's Adjustments</Eyebrow><div className="font-mono font-semibold text-lg text-ink">{s.total_adjustments}</div></Panel>
          </div>
        )}

        {/* Shop Cash (§24, Engine 3) — derived, never stored. Separate from
            Customer.current_balance (the Dowa payable shown in the tag above). */}
        <Panel className="mb-4">
          <Eyebrow>Shop Cash — {detail.cash.business_date}</Eyebrow>
          <div className="grid grid-cols-6 gap-3 mt-2">
            <div>
              <div className="font-mono text-[10px] uppercase text-steel">Opening</div>
              <div className="font-mono font-semibold text-[15px] text-ink">{pkr(detail.cash.opening_cash)}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-steel">Cash Sales</div>
              <div className="font-mono font-semibold text-[15px] text-brand-green">+{pkr(detail.cash.cash_retail_sales)}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-steel">Collections</div>
              <div className="font-mono font-semibold text-[15px] text-brand-green">+{pkr(detail.cash.supply_customer_collections)}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-steel">Expenses</div>
              <div className="font-mono font-semibold text-[15px] text-brand-red">-{pkr(detail.cash.expenses)}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-steel">Withdrawals</div>
              <div className="font-mono font-semibold text-[15px] text-brand-red">-{pkr(detail.cash.owner_withdrawals)}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-steel">Closing</div>
              <div className="font-mono font-bold text-[16px] text-ink">{pkr(detail.cash.closing_cash)}</div>
            </div>
          </div>
          {detail.cash.dowa_payments !== "0" && (
            <div className="font-mono text-[11px] text-steel mt-2">Payments to Dowa today: -{pkr(detail.cash.dowa_payments)}</div>
          )}
        </Panel>

        {/* Board Rate / Cylinder Weight / Sale Rate, per product (§10/§28) */}
        {s.products.length > 0 && (
          <Panel className="mb-4">
            <Eyebrow>Board Rate & Sale Pricing — {s.business_date}</Eyebrow>
            <div className="flex flex-col gap-2 mt-2">
              {s.products.map((p) => (
                <div key={p.product_id} className="grid grid-cols-7 gap-3 items-center border-b border-hairline pb-2 last:border-0 last:pb-0">
                  <div className="font-body text-[13px] font-semibold text-ink">{p.product_name}</div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Board Rate</div>
                    <div className="font-mono text-[13px] text-ink">{p.board_rate_per_kg ? `${pkr(p.board_rate_per_kg)}/kg` : "not set"}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Physical</div>
                    <div className="font-mono text-[13px] text-ink">{p.cylinder_weight} kg</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Wastage</div>
                    <div className="font-mono text-[13px] text-ink">-{p.wastage_kg} kg</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Saleable</div>
                    <div className="font-mono text-[13px] text-ink">{p.saleable_kg} kg</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Sale Rate</div>
                    <div className="font-mono text-[13px] text-ink">{p.sale_rate_per_cylinder ? pkr(p.sale_rate_per_cylinder) : "—"}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Today's Sales Value</div>
                    <div className="font-mono text-[13px] font-semibold text-brand-green">{pkr(p.todays_sales_amount)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Supply Customers (§25, Engine 3) — the shop's own customers,
            entirely separate from the Dowa Customer Ledger. */}
        {supplyCustomers.length > 0 && (
          <Panel className="mb-4">
            <Eyebrow>Supply Customers</Eyebrow>
            <table className="w-full border-collapse mt-2">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Mobile</Th>
                  <Th right>Outstanding</Th>
                  <Th center><span className="print:hidden">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {supplyCustomers.map((c) => (
                  <tr key={c.id}>
                    <Td>{c.name}</Td>
                    <Td mono>{c.mobile ?? "—"}</Td>
                    <Td right mono>{pkr(c.current_balance)}</Td>
                    <Td center>
                      <button
                        onClick={() => setPayCustomerTarget(c)}
                        title="Receive payment from this customer"
                        className="print:hidden bg-transparent border-none cursor-pointer text-teal text-[12px] font-body"
                      >
                        Receive Payment
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {/* Shop Business Ledger (§28E, Engine 3) — cash sales, credit sales,
            customer collections, expenses, owner withdrawals, Dowa payments.
            Never a Load or a Dowa Customer Sale — those stay in the Dowa
            Transaction History table below. */}
        {ledger && ledger.rows.length > 0 && (
          <Panel className="mb-4">
            <Eyebrow>Shop Business Ledger — {ledger.business_date}</Eyebrow>
            <table className="w-full border-collapse mt-2">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>ID</Th>
                  <Th>Description</Th>
                  <Th right>Amount</Th>
                  <Th right>Cash Impact</Th>
                  <Th>Entered By</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr key={r.ref_id}>
                    <Td mono>{fmtTime(r.date)}</Td>
                    <Td mono>{{
                      cash_sale: "Cash Sale", credit_sale: "Credit Sale", customer_payment: "Customer Payment",
                      expense: "Expense", owner_withdrawal: "Owner Withdrawal", dowa_payment: "Payment to Dowa",
                    }[r.kind]}</Td>
                    <Td mono>{r.display_id}</Td>
                    <Td>{r.description}</Td>
                    <Td right mono>{pkr(r.amount)}</Td>
                    <Td right mono color={parseFloat(r.cash_impact) >= 0 ? undefined : "#9B4A4A"}>
                      {parseFloat(r.cash_impact) >= 0 ? "+" : ""}{pkr(r.cash_impact)}
                    </Td>
                    <Td mono>{r.entered_by}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {/* Transaction history */}
        <Panel>
          <div className="flex items-center justify-between mb-1 no-print">
            <Eyebrow>Transaction History</Eyebrow>
            <div className="flex gap-1.5">
              <select value={mo} onChange={(e) => setMonth(`${year}-${e.target.value}`)} className={`${inputClass} w-[75px]`}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={year} onChange={(e) => setMonth(`${e.target.value}-${mo}`)} className={`${inputClass} w-[85px]`}>
                {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <table className="w-full border-collapse mt-2">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>ID</Th>
                <Th>Description</Th>
                <Th right>Quantity</Th>
                <Th right>Rate/kg</Th>
                <Th right>Amount</Th>
                <Th>Entered By</Th>
                <Th>Status</Th>
                <Th center><span className="print:hidden">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {detail.transactions.map((t) => (
                <tr key={t.ref_id}>
                  <Td mono>{fmtTime(t.date)}</Td>
                  <Td mono>{t.kind === "load" ? "Load" : t.kind === "shop_sale" ? "Shop Sale" : t.kind === "payment" ? "Payment" : t.kind === "return" ? "Return" : "Adjustment"}</Td>
                  <Td mono>{t.display_id}</Td>
                  <Td>{t.description}</Td>
                  <Td right mono>{t.quantity ?? "—"}</Td>
                  <Td right mono>{t.board_rate_per_kg ?? t.load_rate_per_kg ?? "—"}</Td>
                  <Td right mono>{t.amount ? pkr(t.amount) : "—"}</Td>
                  <Td mono>{t.entered_by}</Td>
                  <Td mono>{t.status}</Td>
                  <Td center>
                    {t.correctable && (
                      <button
                        onClick={() => openCorrect(t)}
                        disabled={correctLoading === t.ref_id}
                        title="Correct this transaction"
                        className="print:hidden bg-transparent border-none cursor-pointer text-steel hover:text-teal disabled:opacity-40"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
              {!detail.transactions.length && (
                <tr><td colSpan={10} className="text-steel font-body text-[13px] py-4 text-center">No transactions this month.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        {/* Correction History — union of Load/Payment corrections (existing
            Customer Ledger mechanism) and Shop Sale corrections. */}
        {allCorrections.length > 0 && (
          <Panel className="mt-4">
            <button
              onClick={() => setShowCorrections((v) => !v)}
              className="print:hidden bg-transparent border-none cursor-pointer flex items-center gap-1.5 w-full text-left"
            >
              <Eyebrow>Correction History ({allCorrections.length})</Eyebrow>
            </button>
            <table className={`w-full border-collapse mt-2 ${showCorrections ? "" : "hidden print:table"}`}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Original ID</Th>
                  <Th>Description</Th>
                  <Th right>Original Amount</Th>
                  <Th>Reason</Th>
                  <Th>Corrected By</Th>
                  <Th>Corrected At</Th>
                  <Th>Replaced By</Th>
                </tr>
              </thead>
              <tbody>
                {allCorrections.map((c) => (
                  <tr key={c.ref_id}>
                    <Td mono>{fmtTime(c.date)}</Td>
                    <Td mono>{c.kind}</Td>
                    <Td mono color="#9B4A4A">{c.display_id}</Td>
                    <Td>{c.description}</Td>
                    <Td right mono>{pkr(c.original_amount)}</Td>
                    <Td>{c.correction_reason}</Td>
                    <Td mono>{c.corrected_by}</Td>
                    <Td mono>{fmtTime(c.corrected_at)}</Td>
                    <Td mono>{c.corrected_display_id ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      {showPay && (
        <ReceivePaymentModal
          isOpen={showPay}
          onClose={() => setShowPay(false)}
          defaultCustomerId={shopId}
          onSuccess={() => { setShowPay(false); load(); }}
        />
      )}
      {showSale && (
        <RecordShopSaleModal shopId={shopId} onClose={() => setShowSale(false)} onSaved={() => { setShowSale(false); load(); }} />
      )}
      {showAdjustment && (
        <RecordShopAdjustmentModal shopId={shopId} onClose={() => setShowAdjustment(false)} onSaved={() => { setShowAdjustment(false); load(); }} />
      )}
      {showExpense && (
        <RecordShopExpenseModal shopId={shopId} onClose={() => setShowExpense(false)} onSaved={() => { setShowExpense(false); load(); }} />
      )}
      {showAddCustomer && (
        <AddSupplyCustomerModal shopId={shopId} onClose={() => setShowAddCustomer(false)} onCreated={() => { setShowAddCustomer(false); load(); }} />
      )}
      {payCustomerTarget && (
        <RecordSupplyCustomerPaymentModal
          shopId={shopId}
          customer={payCustomerTarget}
          onClose={() => setPayCustomerTarget(null)}
          onSaved={() => { setPayCustomerTarget(null); load(); }}
        />
      )}
      {correctTarget && (
        <CorrectTransactionModal
          kind={correctTarget.kind}
          transaction={correctTarget.transaction}
          onClose={() => setCorrectTarget(null)}
          onSaved={() => { setCorrectTarget(null); load(); }}
        />
      )}
    </div>
  );
}

export default function ShopDetailPage() {
  return (
    <AuthGate>
      <ShopDetailBody />
    </AuthGate>
  );
}
