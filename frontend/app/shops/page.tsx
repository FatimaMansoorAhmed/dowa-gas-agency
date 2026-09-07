"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle, Store, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, Th, Td, BalanceTag, Button } from "@/components/ui";
import AddShopModal from "@/components/AddShopModal";
import BoardRateModal from "@/components/BoardRateModal";
import { api } from "@/lib/api";
import { pkr, fmtTime } from "@/lib/format";
import type { ShopListRow } from "@/lib/types";

/** Shops list (§4/§5) — every Customer row with customer_type="shop",
 * live stock/today activity/payable, computed on demand server-side
 * (GET /shops), never a stored running total. */
function ShopsBody() {
  const { t } = useTranslation();
  const router = useRouter();
  const [rows, setRows] = useState<ShopListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBoardRate, setShowBoardRate] = useState(false);

  const load = () => {
    setLoading(true);
    api.shops.list().then(setRows).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.shops")}
        title={t("shops.title")}
        caption={t("shops.caption")}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowBoardRate(true)}>
              <Gauge size={14} /> {t("shops.boardRate")}
            </Button>
            <Button variant="primary" onClick={() => setShowAdd(true)}>
              <PlusCircle size={14} /> {t("shops.addShop")}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Panel><div className="font-body text-steel py-6">{t("common.loading")}</div></Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <div className="font-body text-[13px] text-steel py-10 text-center">
            {t("shops.noShopsYet")}
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div className="font-mono text-[11px] text-steel mb-3 flex items-center justify-between">
                  <span>
                    {r.customer.display_id} · {r.customer.mobile}
                    {r.last_activity ? t("shops.lastActivity", { time: fmtTime(r.last_activity) }) : ""}
                  </span>
                  <span>{t("shops.shopCash")}: <span className="font-semibold text-ink">{pkr(r.shop_cash_balance)}</span></span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">{t("shops.currentStock")}</div>
                    <div className="font-mono font-semibold text-[15px] text-ink">{r.current_stock}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">{t("shops.todaysLoad")}</div>
                    <div className="font-mono font-semibold text-[15px] text-brand-green">+{r.today_load}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-steel">{t("shops.todaysSales")}</div>
                    <div className="font-mono font-semibold text-[15px] text-ink">-{r.today_sales}</div>
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

      {showBoardRate && (
        <BoardRateModal onClose={() => setShowBoardRate(false)} />
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
