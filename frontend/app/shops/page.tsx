"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle, Store } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Th, Td, BalanceTag, Button } from "@/components/ui";
import AddShopModal from "@/components/AddShopModal";
import { api } from "@/lib/api";
import { pkr, fmtTime } from "@/lib/format";
import type { ShopListRow } from "@/lib/types";

/** Shops list (§4/§5) — every Customer row with customer_type="shop",
 * live stock/today activity/payable, computed on demand server-side
 * (GET /shops), never a stored running total. */
function ShopsBody() {
  const router = useRouter();
  const [rows, setRows] = useState<ShopListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setLoading(true);
    api.shops.list().then(setRows).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Shops"
        title="Shop inventory & board-rate sales"
        caption="Each shop's current stock, today's load/sales/returns, and payable — a Load is entered once, in the ordinary Sale flow, and the shop's stock updates automatically."
        action={
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            <PlusCircle size={14} /> Add Shop
          </Button>
        }
      />

      {loading ? (
        <Panel><div className="font-body text-steel py-6">Loading…</div></Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <div className="font-body text-[13px] text-steel py-10 text-center">
            No shops yet — click "Add Shop" to create one.
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {rows.map((r) => (
            <Panel key={r.customer.id} className="cursor-pointer" >
              <div onClick={() => router.push(`/shops/${r.customer.id}`)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Store size={16} className="text-teal" />
                    <span className="font-display font-bold text-[16px] text-ink">{r.customer.name}</span>
                  </div>
                  <BalanceTag amount={r.current_balance} />
                </div>
                <div className="font-mono text-[11px] text-steel mb-3">
                  {r.customer.display_id} · {r.customer.mobile}
                  {r.last_activity ? ` · last activity ${fmtTime(r.last_activity)}` : ""}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Current Stock</div>
                    <div className="font-mono font-semibold text-[15px] text-ink">{r.current_stock}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Today's Load</div>
                    <div className="font-mono font-semibold text-[15px] text-brand-green">+{r.today_load}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Today's Sales</div>
                    <div className="font-mono font-semibold text-[15px] text-ink">-{r.today_sales}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">Today's Returns</div>
                    <div className="font-mono font-semibold text-[15px] text-ink">{r.today_returns}</div>
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {showAdd && (
        <AddShopModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

export default function ShopsPage() {
  return (
    <AuthGate>
      <ShopsBody />
    </AuthGate>
  );
}
