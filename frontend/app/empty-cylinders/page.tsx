"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Th, Td, Button } from "@/components/ui";
import { api } from "@/lib/api";
import AddEmptyCylinderModal from "@/components/AddEmptyCylinderModal";
import ReturnCylinderModal from "@/components/ReturnCylinderModal";
import type { Customer } from "@/lib/types";

// "legacy" = the untyped, unclassified remainder of a size's balance for
// customers that predate typed Cross/PSO tracking (or predate any typed
// sale) — total_for_size − cross − pso.
type SellType = "cross" | "pso" | "legacy";

function unclassified(c: Customer, size: "118" | "454"): number {
  const total = parseFloat((size === "454" ? c.empty_cylinders_454 : c.empty_cylinders_118) || "0");
  const cross = parseFloat((size === "454" ? c.empty_cylinders_454_cross : c.empty_cylinders_118_cross) || "0");
  const pso = parseFloat((size === "454" ? c.empty_cylinders_454_pso : c.empty_cylinders_118_pso) || "0");
  return Math.max(total - cross - pso, 0);
}

function EmptyCylindersBody() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  // "Sell Cylinder" (§ Empty Cylinders page) now reuses ReturnCylinderModal
  // in mode="cash"/variant="sell" — the EXACT SAME code path as Customer
  // Ledger's Return Cylinder — Cash Mode (POST /cylinder-returns), instead
  // of the old, separate, unrouted /empty-cylinders/sell endpoint. Full
  // parity: Payment creation + settlement routing, correct balance
  // direction (customer is credited, not debited), overpayment handling,
  // and cancel support.
  const [sellModal, setSellModal] = useState<Customer | null>(null);
  const [addModal, setAddModal] = useState<Customer | null>(null);

  const load = async (q?: string) => setCustomers(await api.customers.list(q));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 250);
    return () => clearTimeout(t);
  }, [search]);

  const balanceFor = (c: Customer, size: "118" | "454", type: SellType): number => {
    if (type === "legacy") return unclassified(c, size);
    const key = `empty_cylinders_${size}_${type}` as keyof Customer;
    return parseFloat((c[key] as string) || "0");
  };

  // Fleet-wide totals for the summary cards — sums the per-customer
  // Cross/PSO breakdown; "Unclassified" captures customers/stock recorded
  // before typed tracking existed, so nothing is hidden or double-counted.
  const totals = customers.reduce(
    (acc, c) => ({
      cross118: acc.cross118 + balanceFor(c, "118", "cross"),
      pso118: acc.pso118 + balanceFor(c, "118", "pso"),
      cross454: acc.cross454 + balanceFor(c, "454", "cross"),
      pso454: acc.pso454 + balanceFor(c, "454", "pso"),
      unclassified118: acc.unclassified118 + unclassified(c, "118"),
      unclassified454: acc.unclassified454 + unclassified(c, "454"),
    }),
    { cross118: 0, pso118: 0, cross454: 0, pso454: 0, unclassified118: 0, unclassified454: 0 }
  );
  const totalCross = totals.cross118 + totals.cross454;
  const totalPso = totals.pso118 + totals.pso454;
  const totalUnclassified = totals.unclassified118 + totals.unclassified454;

  return (
    <div>
      <PageHeader
        eyebrow="Empty Cylinders"
        title="Customer empty cylinder stock"
        caption="Every customer's available empty cylinder balance — sell it back to record the transaction and post it to their ledger."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-4">
        <Panel className="min-h-[96px]">
          <Eyebrow>Total Cross</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{totalCross}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            11.8 KG: {totals.cross118} · 45.4 KG: {totals.cross454}
          </div>
        </Panel>
        <Panel className="min-h-[96px]">
          <Eyebrow>Total PSO</Eyebrow>
          <div className="font-display font-bold text-2xl text-ink">{totalPso}</div>
          <div className="font-body text-[11px] text-steel mt-1">
            11.8 KG: {totals.pso118} · 45.4 KG: {totals.pso454}
          </div>
        </Panel>
      </div>

      <Panel className="mb-4">
        <Eyebrow>Size Breakdown</Eyebrow>
        <SectionCaption>11.8 KG and 45.4 KG quantities are never mixed — Cross/PSO is a type within each size.</SectionCaption>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 bg-paper rounded-lg border border-hairline">
            <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel mb-2">Cross</div>
            <div className="flex justify-between font-body text-[13px] text-ink"><span>11.8 KG</span><b className="font-mono">{totals.cross118}</b></div>
            <div className="flex justify-between font-body text-[13px] text-ink mt-1"><span>45.4 KG</span><b className="font-mono">{totals.cross454}</b></div>
            <div className="flex justify-between font-body text-[13px] text-teal mt-1.5 pt-1.5 border-t border-hairline"><span>Total</span><b className="font-mono">{totalCross}</b></div>
          </div>
          <div className="p-3 bg-paper rounded-lg border border-hairline">
            <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel mb-2">PSO</div>
            <div className="flex justify-between font-body text-[13px] text-ink"><span>11.8 KG</span><b className="font-mono">{totals.pso118}</b></div>
            <div className="flex justify-between font-body text-[13px] text-ink mt-1"><span>45.4 KG</span><b className="font-mono">{totals.pso454}</b></div>
            <div className="flex justify-between font-body text-[13px] text-teal mt-1.5 pt-1.5 border-t border-hairline"><span>Total</span><b className="font-mono">{totalPso}</b></div>
          </div>
        </div>
        {totalUnclassified > 0 && (
          <div className="mt-3 font-body text-[11.5px] text-steel">
            + {totalUnclassified} unclassified (11.8: {totals.unclassified118} · 45.4: {totals.unclassified454}) — recorded before Cross/PSO tracking, still fully sellable via the legacy option below.
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex justify-between items-center mb-1">
          <Eyebrow>Customers ({customers.length})</Eyebrow>
          <div className="flex items-center gap-1.5 border border-hairline rounded-md px-2.5">
            <Search size={13} className="text-steel" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, mobile, shop, or ID"
              className="border-none outline-none font-body text-xs py-1.5 w-[190px]"
            />
          </div>
        </div>
        <table className="w-full border-collapse mt-2">
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Mobile</Th>
              <Th right>11.8 KG Empty</Th>
              <Th right>45.4 KG Empty</Th>
              <Th right>Action</Th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <Td mono>{c.display_id}</Td>
                <Td bold>
                  {c.name}
                  {c.shop_name ? <span className="text-steel font-normal"> · {c.shop_name}</span> : ""}
                </Td>
                <Td mono>{c.mobile}</Td>
                <Td right mono bold>
                  {c.empty_cylinders_118 || 0}
                </Td>
                <Td right mono bold>
                  {c.empty_cylinders_454 || 0}
                </Td>
                <Td right>
                  <div className="flex justify-end gap-1.5">
                    <Button variant="outline" onClick={() => setAddModal(c)}>
                      Add
                    </Button>
                    <Button
                      variant="teal"
                      onClick={() => setSellModal(c)}
                      disabled={parseFloat(c.empty_cylinders_118 || "0") <= 0 && parseFloat(c.empty_cylinders_454 || "0") <= 0}
                    >
                      Sell Cylinder
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
            {!customers.length && (
              <tr>
                <td colSpan={6} className="text-steel font-body text-[13px] py-3">
                  No customers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <ReturnCylinderModal
        variant="sell"
        isOpen={!!sellModal}
        onClose={() => setSellModal(null)}
        customer={sellModal}
        onSuccess={() => load(search || undefined)}
      />

      <AddEmptyCylinderModal
        isOpen={!!addModal}
        onClose={() => setAddModal(null)}
        customer={addModal}
        onSuccess={() => load(search || undefined)}
      />
    </div>
  );
}

export default function EmptyCylindersPage() {
  return (
    <AuthGate>
      <EmptyCylindersBody />
    </AuthGate>
  );
}
