"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Home, Landmark, ArrowRightLeft, Building2, Send, X, Calendar, Banknote, ArrowDownRight, Layers, Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthGate from "@/components/AuthGate";
import { Panel, Eyebrow, Field, inputClass, Th, Td, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput, toKarachiDateString } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { BUCKET_ACCOUNTS, findBucketAccount, type BucketType } from "@/lib/accounts";
import type { PaymentAccount, Company, OwnerDrawing, OwnerCapital, UnifiedSaleBatch, Customer } from "@/lib/types";

type DateFilter = "all" | "today" | "monthly" | "yearly" | "custom";

const BUCKET_ICONS: Record<BucketType, typeof Wallet> = {
  office_cash: Wallet,
  owner_home: Home,
  dowa_account: Landmark,
};

function CashManagementBody() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const enteredBy = user?.name || "System";
  const bucketLabel = (type: BucketType) =>
    type === "office_cash" ? t("payments.officeCash") : type === "owner_home" ? t("payments.ownerHome") : t("payments.dowaAccount");

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ownerDrawings, setOwnerDrawings] = useState<OwnerDrawing[]>([]);
  const [ownerCapital, setOwnerCapital] = useState<OwnerCapital[]>([]);
  const [unifiedSales, setUnifiedSales] = useState<UnifiedSaleBatch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Time filter state for Owner Drawings
  const [drawingFilter, setDrawingFilter] = useState<DateFilter>("all");
  const [customDate, setCustomDate] = useState<string>("");

  // Modal visibility states
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isPlantPaymentOpen, setIsPlantPaymentOpen] = useState(false);

  // Transfer Money form state — value is either a BucketType key
  // ("office_cash" etc.) or a raw shop-account UUID (§ Shop Cash Money
  // Routing: a shop's own Shop Cash is a selectable Transfer endpoint too,
  // named explicitly — "Shop Cash — Dowa Shop Test" — never an ambiguous
  // shared "Shop Cash").
  const [transferFrom, setTransferFrom] = useState<string>("office_cash");
  const [transferTo, setTransferTo] = useState<string>("dowa_account");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Pay Plant form state
  const [plantSource, setPlantSource] = useState<Extract<BucketType, "office_cash" | "dowa_account">>("office_cash");
  const [plantId, setPlantId] = useState("");
  const [plantAmount, setPlantAmount] = useState("");
  const [plantSaving, setPlantSaving] = useState(false);
  const [plantError, setPlantError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      let [accList, compList, drawList, capList, usList, custList] = await Promise.all([
        api.paymentAccounts.list(),
        api.companies.list(),
        api.ownerDrawings.list(),
        api.ownerCapital.list({ destination_type: "account" }),
        api.unifiedSale.list(),
        api.customers.list(),
      ]);

      const missing = BUCKET_ACCOUNTS.filter((b) => !findBucketAccount(accList, b.type));
      if (missing.length > 0) {
        for (const b of missing) {
          try {
            await api.paymentAccounts.create(b.label, "cash", 0, b.type);
          } catch {
            // Ignore race conditions
          }
        }
        accList = await api.paymentAccounts.list();
      }

      drawList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setAccounts(accList);
      setCompanies(compList);
      setOwnerDrawings(drawList);
      setOwnerCapital(capList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setUnifiedSales(usList);
      setCustomers(custList);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("cashBook.failedLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const balanceOf = (type: BucketType) => {
    const acc = findBucketAccount(accounts, type);
    return acc ? parseFloat(acc.current_balance) : 0;
  };

  // Shop Cash Money Routing — each shop's own account, distinct from the 3
  // global buckets. Never summed into a single shared balance at storage
  // level; this is a display-only aggregate.
  const shopAccounts = useMemo(() => accounts.filter((a) => a.account_type === "shop_cash"), [accounts]);
  const totalShopCash = useMemo(() => shopAccounts.reduce((sum, a) => sum + parseFloat(a.current_balance), 0), [shopAccounts]);

  // Resolves a Transfer From/To <select> value — either a BucketType key
  // or a raw shop-account UUID — to the real PaymentAccount row.
  const resolveTransferAccount = (value: string): PaymentAccount | undefined =>
    (["office_cash", "owner_home", "dowa_account"] as BucketType[]).includes(value as BucketType)
      ? findBucketAccount(accounts, value as BucketType)
      : accounts.find((a) => a.id === value);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);

    if (transferFrom === transferTo) {
      setTransferError(t("cashBook.sourceDestDifferent"));
      return;
    }
    const amt = Number(transferAmount);
    if (!transferAmount || !(amt > 0)) {
      setTransferError(t("cashBook.enterPositiveAmount"));
      return;
    }
    const fromAccount = resolveTransferAccount(transferFrom);
    const toAccount = resolveTransferAccount(transferTo);
    if (!fromAccount || !toAccount) {
      setTransferError(t("cashBook.accountsBeingSetUp"));
      return;
    }
    if (amt > parseFloat(fromAccount.current_balance)) {
      setTransferError(t("cashBook.amountExceedsBalance"));
      return;
    }

    setTransferSaving(true);
    try {
      await api.paymentAccounts.transfer({
        from_account_id: fromAccount.id,
        to_account_id: toAccount.id,
        amount: amt,
        notes: "Cash Management — internal transfer",
        entered_by: enteredBy,
      });
      setTransferAmount("");
      setIsTransferOpen(false);
      await loadData();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : t("cashBook.transferFailed"));
    } finally {
      setTransferSaving(false);
    }
  };

  const handlePlantPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlantError(null);

    if (!plantId) {
      setPlantError(t("cashBook.selectAPlant"));
      return;
    }
    const amt = Number(plantAmount);
    if (!plantAmount || !(amt > 0)) {
      setPlantError(t("cashBook.enterPositiveAmount"));
      return;
    }
    const sourceAccount = findBucketAccount(accounts, plantSource);
    if (!sourceAccount) {
      setPlantError(t("cashBook.accountsBeingSetUp"));
      return;
    }
    if (amt > parseFloat(sourceAccount.current_balance)) {
      setPlantError(t("cashBook.amountExceedsBalance"));
      return;
    }

    setPlantSaving(true);
    try {
      await api.companyPayments.create({
        date: new Date().toISOString(),
        company_id: plantId,
        amount: amt,
        method: "cash",
        account_id: sourceAccount.id,
        notes: "Cash Management — plant payment",
        entered_by: enteredBy,
      });
      setPlantAmount("");
      setIsPlantPaymentOpen(false);
      await loadData();
    } catch (err) {
      setPlantError(err instanceof Error ? err.message : t("cashBook.paymentFailed"));
    } finally {
      setPlantSaving(false);
    }
  };

  const filteredOwnerDrawings = useMemo(() => {
    const today = todayLocalInput();
    return ownerDrawings
      .filter((d) => {
        const day = toKarachiDateString(d.date);
        if (!day) return false;

        if (drawingFilter === "today") return day === today;
        if (drawingFilter === "monthly") return day.slice(0, 7) === today.slice(0, 7);
        if (drawingFilter === "yearly") return day.slice(0, 4) === today.slice(0, 4);
        if (drawingFilter === "custom" && customDate) return day === customDate;
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [ownerDrawings, drawingFilter, customDate]);

  const totalOwnerDrawings = useMemo(
    () => filteredOwnerDrawings.reduce((sum, d) => sum + parseFloat(d.amount || "0"), 0),
    [filteredOwnerDrawings]
  );

  const drawingRows = useMemo(() => {
    return filteredOwnerDrawings
      // Any traceable-origin drawing — a Unified Sale batch OR a Payment
      // Receipt/Cylinder Return "cash" mode (source_payment_id, § Cash
      // Management — Owner Drawings Audit Ledger visibility). Previously
      // scoped to unified_sale_id only, which silently hid every Payment
      // Receipt/Cylinder Return-sourced row from this table even though
      // the Total Drawings KPI card above already counted it.
      .filter((d) => d.unified_sale_id || d.source_payment_id)
      .map((d) => {
        const batch = d.unified_sale_id ? unifiedSales.find((b) => b.id === d.unified_sale_id) : undefined;
        const customer = batch ? customers.find((c) => c.id === batch.customer_id) : undefined;
        return {
          id: d.id,
          customerName: customer?.name || d.customer_name || "—",
          saleId: batch?.display_id || d.source_payment_display_id || d.display_id,
          date: d.date,
          sourceAccount: d.account_id
            ? accounts.find((a) => a.id === d.account_id)?.name || "—"
            : t("cashBook.customerPaymentDirect"),
          amount: parseFloat(d.amount || "0"),
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOwnerDrawings, unifiedSales, customers, accounts, i18n.language]);

  // Dashboard P&L / Shop Expense integration (§ Dashboard) — dual-written
  // from a Shop's own Record Expense form (an owner_withdrawal line).
  // Additive, own section: the Audit Ledger table above is deliberately
  // scoped to unified_sale-sourced drawings only (pre-existing, untouched)
  // so this stays separate rather than broadening that table's own filter.
  const shopDrawingRows = useMemo(() => {
    return filteredOwnerDrawings
      .filter((d) => d.shop_id)
      .map((d) => ({
        id: d.id,
        displayId: d.display_id,
        shopName: d.shop_name || "—",
        // § Shop Expense/Withdrawal Attribution — the supply customer /
        // sale this was entered alongside, when the source form had that
        // context; both blank for a standalone Record Expense withdrawal.
        customerName: d.customer_name,
        saleRef: d.shop_sale_display_id,
        date: d.date,
        sourceAccount: d.account_id ? accounts.find((a) => a.id === d.account_id)?.name || "—" : "—",
        amount: parseFloat(d.amount || "0"),
        notes: d.notes,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredOwnerDrawings, accounts]);

  return (
    <div className="space-y-5">
      {/* HEADER CARD WITH DARK NAVY (#0b2138) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0b2138] text-white p-5 rounded-lg shadow-sm">
        <div>
          <span className="text-[10px] font-mono tracking-widest uppercase text-blue-200">{t("cashBook.eyebrowSmall")}</span>
          <h1 className="text-2xl font-display font-bold mt-0.5">{t("cashBook.title")}</h1>
          <p className="text-xs text-blue-100/80 mt-1 max-w-xl">
            {t("cashBook.caption")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsTransferOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-white/15 hover:bg-white/25 text-white rounded border border-white/20 transition-all text-xs font-semibold cursor-pointer"
          >
            <ArrowRightLeft size={14} /> {t("cashBook.transfer")}
          </button>
          <button
            type="button"
            onClick={() => setIsPlantPaymentOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#061423] hover:bg-[#040c17] text-white rounded border border-blue-400/30 transition-all text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Building2 size={14} /> {t("cashBook.payPlant")}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-red-600 text-xs font-body">
          {loadError}
        </div>
      )}

      {/* TOP GRID: LIQUIDITY ACCOUNTS & SUMMARY KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {BUCKET_ACCOUNTS.map(({ type, label }) => {
          const Icon = BUCKET_ICONS[type];
          return (
            <div key={type} className="bg-white border border-hairline rounded-lg p-4 flex flex-col justify-between shadow-xs">
              <div className="flex items-center justify-between border-b border-hairline/60 pb-2 mb-3">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-steel">{bucketLabel(type)}</span>
                <div className="p-1.5 rounded bg-[#e8eef4] text-[#0b2138]">
                  <Icon size={14} />
                </div>
              </div>
              <div className="font-display font-bold text-2xl text-ink">
                {loading ? "—" : pkr(balanceOf(type))}
              </div>
            </div>
          );
        })}

        {/* SUMMARY CARD: TOTAL SHOP CASH — § Shop Cash Money Routing. Each
            shop's own PaymentAccount is a distinct, real, stored balance;
            this is a display-only sum, never a shared storage-level total. */}
        <div className="bg-white border border-teal-200 rounded-lg p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between border-b border-hairline/60 pb-2 mb-3">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#0b2138]">{t("cashBook.totalShopCash")}</span>
            <div className="p-1.5 rounded bg-teal-100 text-teal-800">
              <Wallet size={14} />
            </div>
          </div>
          <div>
            <div className="font-display font-bold text-2xl text-ink">
              {loading ? "—" : pkr(totalShopCash)}
            </div>
            <div className="text-[11px] text-steel font-mono mt-1">
              {t("cashBook.acrossShops", { count: shopAccounts.length })}
            </div>
          </div>
        </div>

        {/* SUMMARY CARD: TOTAL DRAWINGS */}
        <div className="bg-white border border-blue-200 rounded-lg p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between border-b border-hairline/60 pb-2 mb-3">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#0b2138]">{t("cashBook.totalDrawings")}</span>
            <div className="p-1.5 rounded bg-amber-100 text-amber-800">
              <ArrowDownRight size={14} />
            </div>
          </div>
          <div>
            <div className="font-display font-bold text-2xl text-ink">
              {loading ? "—" : pkr(totalOwnerDrawings)}
            </div>
            <div className="text-[11px] text-steel font-mono mt-1 capitalize">
              {t("cashBook.scopeLabel", { scope: drawingFilter === "custom" && customDate ? customDate : t(`cashBook.filter${drawingFilter.charAt(0).toUpperCase()}${drawingFilter.slice(1)}`) })}
            </div>
          </div>
        </div>
      </div>

      {/* SHOP CASH BREAKDOWN — the per-shop rows the Total Shop Cash card
          above sums; each is its own real PaymentAccount (§1: "list each
          shop's Shop Cash as its own row"). */}
      {shopAccounts.length > 0 && (
        <Panel>
          <div className="flex items-center gap-2 border-b border-hairline pb-3 mb-3">
            <Wallet size={16} className="text-[#0b2138]" />
            <Eyebrow>{t("cashBook.shopCashByShop")}</Eyebrow>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>{t("cashBook.colShop")}</Th>
                  <Th right>{t("customerLedger.colBalance")}</Th>
                </tr>
              </thead>
              <tbody>
                {shopAccounts.map((a) => (
                  <tr key={a.id}>
                    <Td bold>{a.name}</Td>
                    <Td right mono bold color="#0b2138">{pkr(a.current_balance)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* AUDIT SECTION */}
      <Panel>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-hairline pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-[#0b2138]" />
            <Eyebrow>{t("cashBook.ownerDrawingsAuditLedger")}</Eyebrow>
          </div>

          {/* Timeframe & Calendar Picker Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-0.5 bg-[#F4F1EA] rounded border border-hairline text-xs font-medium">
              {(["today", "monthly", "yearly", "all"] as DateFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setDrawingFilter(f);
                    setCustomDate("");
                  }}
                  className={`px-3 py-1 rounded capitalize transition-all cursor-pointer font-body ${
                    drawingFilter === f
                      ? "bg-[#0b2138] text-white font-bold"
                      : "text-steel hover:text-ink"
                  }`}
                >
                  {t(`cashBook.filter${f.charAt(0).toUpperCase()}${f.slice(1)}`)}
                </button>
              ))}
            </div>

            <div className="relative flex items-center">
              <Calendar size={13} className="absolute left-2.5 text-steel pointer-events-none" />
              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setDrawingFilter(e.target.value ? "custom" : "all");
                }}
                className={`${inputClass} pl-8 py-1 text-xs w-[140px]`}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>{t("cashBook.colCustomerName")}</Th>
                <Th>{t("cashBook.colSaleId")}</Th>
                <Th>{t("customerLedger.colDate")}</Th>
                <Th>{t("cashBook.colSourceAccount")}</Th>
                <Th right>{t("cashBook.colAmountDrawn")}</Th>
              </tr>
            </thead>
            <tbody>
              {drawingRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-steel font-body text-[13px] py-6 text-center">
                    {loading ? t("common.loading") : t("cashBook.noDrawingsForFilter")}
                  </td>
                </tr>
              ) : (
                drawingRows.map((row) => (
                  <tr key={row.id}>
                    <Td bold>{row.customerName}</Td>
                    <Td mono bold color="#0b2138">{row.saleId}</Td>
                    <Td mono color="#2D3748">{fmtTime(row.date)}</Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#F4F1EA] text-ink border border-hairline">
                        {row.sourceAccount}
                      </span>
                    </Td>
                    <Td right mono bold color="#0b2138">{pkr(row.amount)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* SHOP OWNER WITHDRAWALS (§ Dashboard P&L / Shop Expense integration) */}
      <Panel>
        <div className="flex items-center gap-2 border-b border-hairline pb-3 mb-4">
          <Store size={16} className="text-[#0b2138]" />
          <Eyebrow>{t("cashBook.shopOwnerWithdrawals")}</Eyebrow>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>{t("customerLedger.colId")}</Th>
                <Th>{t("cashBook.colShop")}</Th>
                <Th>{t("cashBook.colCustomerSale")}</Th>
                <Th>{t("customerLedger.colDate")}</Th>
                <Th>{t("unifiedSale.colAccount")}</Th>
                <Th right>{t("unifiedSale.colAmount")}</Th>
              </tr>
            </thead>
            <tbody>
              {shopDrawingRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-steel font-body text-[13px] py-6 text-center">
                    {loading ? t("common.loading") : t("cashBook.noShopWithdrawals")}
                  </td>
                </tr>
              ) : (
                shopDrawingRows.map((row) => (
                  <tr key={row.id}>
                    <Td mono color="#2D3748">{row.displayId}</Td>
                    <Td bold>{row.shopName}</Td>
                    <Td>
                      {row.customerName || row.saleRef ? (
                        <span className="font-body text-[12px] text-ink">
                          {row.customerName || "—"}
                          {row.saleRef && (
                            <span className="ml-1 font-mono text-[10px] text-steel">{t("cashBook.saleRefInline", { id: row.saleRef })}</span>
                          )}
                        </span>
                      ) : (
                        <span className="font-body text-[12px] text-steel">—</span>
                      )}
                    </Td>
                    <Td mono color="#2D3748">{fmtTime(row.date)}</Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#F4F1EA] text-ink border border-hairline">
                        {row.sourceAccount}
                      </span>
                    </Td>
                    <Td right mono bold color="#0b2138">{pkr(row.amount)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* CAPITAL RE-INVESTMENT AUDIT SECTION */}
      <Panel>
        <div className="flex items-center gap-2 border-b border-hairline pb-3 mb-3">
          <Banknote size={16} className="text-[#0b2138]" />
          <Eyebrow>{t("cashBook.ownerCapitalInflowLedger")}</Eyebrow>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>{t("customerLedger.colId")}</Th>
                <Th>{t("customerLedger.colDate")}</Th>
                <Th>{t("unifiedSale.colAccount")}</Th>
                <Th>{t("cashBook.colSource")}</Th>
                <Th right>{t("unifiedSale.colAmount")}</Th>
              </tr>
            </thead>
            <tbody>
              {ownerCapital.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-steel font-body text-[13px] py-6 text-center">
                    {loading ? t("common.loading") : t("cashBook.noOwnerCapitalDeposits")}
                  </td>
                </tr>
              ) : (
                ownerCapital.map((c) => (
                  <tr key={c.id}>
                    <Td mono bold color="#0b2138">{c.display_id}</Td>
                    <Td mono color="#2D3748">{fmtTime(c.date)}</Td>
                    <Td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#F4F1EA] text-ink border border-hairline">
                        {accounts.find((a) => a.id === c.account_id)?.name || "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[#e8eef4] text-[#0b2138] border border-blue-200">
                        <Banknote size={11} /> {t("cashBook.ownerCapitalInflow")}
                      </span>
                    </Td>
                    <Td right mono bold color="#0b2138">{pkr(c.amount)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* MODAL 1: TRANSFER MONEY */}
      {isTransferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white border border-hairline rounded-lg shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-hairline pb-3">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#0b2138] font-display">
                <ArrowRightLeft size={16} /> {t("cashBook.internalMoneyTransfer")}
              </span>
              <button
                type="button"
                onClick={() => setIsTransferOpen(false)}
                className="text-steel hover:text-ink transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleTransfer} className="space-y-3.5">
              <Field label={t("cashBook.fromAccount")}>
                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value)}
                  className={inputClass}
                >
                  {BUCKET_ACCOUNTS.map((b) => (
                    <option key={b.type} value={b.type}>
                      {bucketLabel(b.type)}
                    </option>
                  ))}
                  {shopAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("cashBook.toAccount")}>
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className={inputClass}
                >
                  {BUCKET_ACCOUNTS.map((b) => (
                    <option key={b.type} value={b.type}>
                      {bucketLabel(b.type)}
                    </option>
                  ))}
                  {shopAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("ownerCapital.amountPkr")}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder={t("cashBook.amountPlaceholder50000")}
                  className={inputClass}
                />
              </Field>

              {transferError && (
                <div className="text-xs font-body text-red-600 bg-red-50 p-2 rounded border border-red-200">
                  {transferError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
                <Button variant="outline" onClick={() => setIsTransferOpen(false)}>{t("unifiedSale.cancel")}</Button>
                <Button variant="primary" type="submit" disabled={transferSaving || loading}>
                  <Send size={14} />
                  {transferSaving ? t("cashBook.transferring") : t("cashBook.executeTransfer")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: PAY PLANT */}
      {isPlantPaymentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white border border-hairline rounded-lg shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-hairline pb-3">
              <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#0b2138] font-display">
                <Building2 size={16} /> {t("cashBook.plantSupplierPayment")}
              </span>
              <button
                type="button"
                onClick={() => setIsPlantPaymentOpen(false)}
                className="text-steel hover:text-ink transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePlantPayment} className="space-y-3.5">
              <Field label={t("cashBook.sourceAccount")}>
                <select
                  value={plantSource}
                  onChange={(e) =>
                    setPlantSource(e.target.value as Extract<BucketType, "office_cash" | "dowa_account">)
                  }
                  className={inputClass}
                >
                  <option value="office_cash">{t("payments.officeCash")}</option>
                  <option value="dowa_account">{t("payments.dowaAccount")}</option>
                </select>
              </Field>

              <Field label={t("cashBook.plant")}>
                <select value={plantId} onChange={(e) => setPlantId(e.target.value)} className={inputClass}>
                  <option value="">{t("ownerCapital.selectPlant")}</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("ownerCapital.amountPkr")}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={plantAmount}
                  onChange={(e) => setPlantAmount(e.target.value)}
                  placeholder={t("cashBook.amountPlaceholder100000")}
                  className={inputClass}
                />
              </Field>

              {plantError && (
                <div className="text-xs font-body text-red-600 bg-red-50 p-2 rounded border border-red-200">
                  {plantError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
                <Button variant="outline" onClick={() => setIsPlantPaymentOpen(false)}>{t("unifiedSale.cancel")}</Button>
                <Button variant="primary" type="submit" disabled={plantSaving || loading}>
                  <Send size={14} />
                  {plantSaving ? t("cashBook.paying") : t("cashBook.payPlant")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CashManagementPage() {
  return (
    <AuthGate>
      <CashManagementBody />
    </AuthGate>
  );
}