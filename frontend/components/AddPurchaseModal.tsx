"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Check, PlusCircle, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "./ui";
import AmountInput from "./AmountInput";
import NewPlantModal from "./NewPlantModal";
import { api } from "@/lib/api";
import { pkr, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { resolveRate, NO_PARTY_VALUE } from "@/lib/rates";
import type { Company, Product, PaymentAccount, RateEntry, Party } from "@/lib/types";

const MULTIPLIER_454 = 45.4 / 11.8;

export default function AddPurchaseModal({
  onClose, onSaved, initialCompanyId,
}: { onClose: () => void; onSaved: () => void; initialCompanyId?: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [showNewPlant, setShowNewPlant] = useState(false);

  const [date, setDate] = useState(todayLocalInput());
  const [gatePass, setGatePass] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [companyId, setCompanyId] = useState(initialCompanyId || "");
  // "" means "not yet resolved" — only reachable when the selected plant
  // has >1 party and the user hasn't picked one yet (see lib/rates.ts).
  const [partyId, setPartyId] = useState("");

  const [qty118, setQty118] = useState("");
  const [rate118, setRate118] = useState("");
  const [qty454, setQty454] = useState("");
  const [rate454, setRate454] = useState("");

  const [additionalCharges, setAdditionalCharges] = useState("");
  const [transportCharges, setTransportCharges] = useState("");
  const [otherCharges, setOtherCharges] = useState("");

  const [recordPayment, setRecordPayment] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");
  const [payAccountId, setPayAccountId] = useState("");
  const [payAmount, setPayAmount] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, p, acc, r, parties] = await Promise.all([
        api.companies.list(), api.products.list(), api.paymentAccounts.list(), api.rates.latest(),
        api.parties.list(),
      ]);
      // Active-only — see RecordShopSaleModal/unified-sale for why a
      // duplicate product row must never resolve product118/product454.
      setCompanies(c); setProducts(p.filter((x: Product) => x.active === "active")); setAccounts(acc); setRates(r);
      setParties(parties);
    })();
  }, []);

  const product118 = products.find((p) => Number(p.weight_kg) === 11.8 || p.name?.includes("11.8"));
  const product454 = products.find((p) => Number(p.weight_kg) === 45.4 || p.name?.includes("45.4"));
  const selectedCompany = companies.find((c) => c.id === companyId);

  // A Company can have multiple Parties, each with its own separately-
  // entered, genuinely different rate — see lib/rates.ts. Auto-select the
  // common case (0 or 1 party) so most purchases need no extra click.
  const companyParties = useMemo(
    () => parties.filter((p) => p.company_id === companyId),
    [parties, companyId]
  );

  useEffect(() => {
    if (!companyId) { setPartyId(""); return; }
    if (companyParties.length === 0) { setPartyId(NO_PARTY_VALUE); return; }
    if (companyParties.length === 1) { setPartyId(companyParties[0].id); return; }
    setPartyId((prev) =>
      prev === NO_PARTY_VALUE || companyParties.some((p) => p.id === prev) ? prev : ""
    );
  }, [companyId, companyParties]);

  // Resolves against the exact (company, party) pair — never "whichever
  // rate for this company was entered most recently," which silently picks
  // the wrong party's rate whenever a plant has more than one.
  const resolvedRate = resolveRate(rates, companyId, partyId);

  useEffect(() => {
    if (!companyId) { setRate118(""); setRate454(""); return; }
    if (!partyId || !resolvedRate) return;
    setRate118(resolvedRate.rate_118 ? String(resolvedRate.rate_118) : "");
    setRate454(resolvedRate.rate_454 ? String(resolvedRate.rate_454) : "");
  }, [companyId, partyId, resolvedRate]);

  const handleRate118Change = (val: string) => {
    setRate118(val);
    const num = parseFloat(val);
    setRate454(!isNaN(num) && num > 0 ? String(Math.round(num * MULTIPLIER_454)) : "");
  };

  const numQty118 = parseFloat(qty118) || 0;
  const numRate118 = parseFloat(rate118) || 0;
  const cylinderTotal118 = numQty118 * numRate118;

  const numQty454 = parseFloat(qty454) || 0;
  const numRate454 = parseFloat(rate454) || 0;
  const cylinderTotal454 = numQty454 * numRate454;

  const charges = (parseFloat(additionalCharges) || 0) + (parseFloat(transportCharges) || 0) + (parseFloat(otherCharges) || 0);
  const grandTotal = cylinderTotal118 + cylinderTotal454 + charges;

  const projectedBalance = selectedCompany
    ? parseFloat(selectedCompany.current_balance) + grandTotal - (recordPayment ? parseFloat(payAmount) || 0 : 0)
    : null;

  const canSubmit =
    companyId && date && ((numQty118 > 0 && numRate118 > 0) || (numQty454 > 0 && numRate454 > 0)) &&
    (!recordPayment || (payAccountId && parseFloat(payAmount) > 0));

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    try {
     // Current real time ke saath date combine karne ka logic
const now = new Date();
const [year, month, day] = date.split("-").map(Number);
const fullDateTime = new Date(
  year,
  month - 1,
  day,
  now.getHours(),
  now.getMinutes(),
  now.getSeconds()
);

const isoDate = fullDateTime.toISOString();
      let lastPurchaseId: string | undefined;
      const has118 = numQty118 > 0 && product118;
      const has454 = numQty454 > 0 && product454;
      const chargesGoOn454 = has454;

      if (has118) {
        const purchase = await api.purchases.create({
          date: isoDate, company_id: companyId, product_id: product118!.id,
          quantity: numQty118, rate_per_cylinder: numRate118,
          additional_charges: chargesGoOn454 ? undefined : (parseFloat(additionalCharges) || undefined),
          transport_charges: chargesGoOn454 ? undefined : (parseFloat(transportCharges) || undefined),
          other_charges: chargesGoOn454 ? undefined : (parseFloat(otherCharges) || undefined),
          gate_pass_no: gatePass || undefined, vehicle_no: vehicleNo || undefined,
          driver_name: driverName || undefined, driver_contact: driverContact || undefined,
          entered_by: user.name,
        });
        lastPurchaseId = purchase.id;
      }
      if (has454) {
        const purchase = await api.purchases.create({
          date: isoDate, company_id: companyId, product_id: product454!.id,
          quantity: numQty454, rate_per_cylinder: numRate454,
          additional_charges: parseFloat(additionalCharges) || undefined,
          transport_charges: parseFloat(transportCharges) || undefined,
          other_charges: parseFloat(otherCharges) || undefined,
          gate_pass_no: gatePass || undefined, vehicle_no: vehicleNo || undefined,
          driver_name: driverName || undefined, driver_contact: driverContact || undefined,
          entered_by: user.name,
        });
        lastPurchaseId = purchase.id;
      }

      if (recordPayment && parseFloat(payAmount) > 0) {
        await api.companyPayments.create({
          date: isoDate, company_id: companyId, purchase_id: lastPurchaseId,
          amount: parseFloat(payAmount), method: payMethod, account_id: payAccountId,
          entered_by: user.name,
        });
      }

      onSaved();
    } catch (e) {
      setError(t("modals.couldNotSavePurchase"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-[560px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">{t("modals.addNewPurchase")}</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label={t("modals.plantPartyName")}>
            <div className="flex gap-1.5">
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`${inputClass} flex-1`}>
                <option value="">{t("ownerCapital.selectPlant")}</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="outline" onClick={() => setShowNewPlant(true)}><PlusCircle size={14} /></Button>
            </div>
          </Field>

          {/* Party — only shown when the selected plant genuinely has more
              than one (auto-selected silently for 0 or 1). */}
          {companyId && companyParties.length > 1 && (
            <Field label={t("rateDashboard.party")}>
              <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
                <option value="">{t("rateDashboard.selectParty")}</option>
                <option value={NO_PARTY_VALUE}>{t("rateDashboard.noPartyOption")}</option>
                {companyParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}

          {companyId && partyId && !resolvedRate && (
            <div className="px-3 py-2.5 rounded-lg border flex items-center gap-2 bg-[#FBEAEA] border-[#EFC3C3]">
              <AlertTriangle size={15} className="text-brand-red flex-shrink-0" />
              <span className="font-body text-xs">
                {t("rateDashboard.noRateForPair", {
                  company: selectedCompany?.name || "",
                  party: partyId === NO_PARTY_VALUE
                    ? t("rateDashboard.noPartyOption")
                    : companyParties.find((p) => p.id === partyId)?.name || "",
                })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label={t("unifiedSale.date")}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("modals.gatePassOptional")}>
              <input value={gatePass} onChange={(e) => setGatePass(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("modals.vehicleNo")}>
              <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="KP-7517" className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("modals.driverNameOptional")}>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("modals.driverContactOptional")}>
              <input value={driverContact} onChange={(e) => setDriverContact(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 bg-paper rounded-lg border border-hairline">
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel">{t("unifiedSale.col118")}</div>
              <input type="number" value={qty118} onChange={(e) => setQty118(e.target.value)} placeholder={t("unifiedSale.qtyPlaceholder")} className={inputClass} />
              <AmountInput value={rate118} onChange={handleRate118Change} placeholder={t("modals.ratePerCylinder")} className={inputClass} />
              <div className="font-mono text-xs text-teal font-semibold">{cylinderTotal118 > 0 ? pkr(cylinderTotal118) : "—"}</div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel">{t("unifiedSale.col454")}</div>
              <input type="number" value={qty454} onChange={(e) => setQty454(e.target.value)} placeholder={t("unifiedSale.qtyPlaceholder")} className={inputClass} />
              <AmountInput value={rate454} onChange={setRate454} placeholder={t("modals.ratePerCylinder")} className={inputClass} />
              <div className="font-mono text-xs text-teal font-semibold">{cylinderTotal454 > 0 ? pkr(cylinderTotal454) : "—"}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t("modals.additionalCharges")}><AmountInput value={additionalCharges} onChange={setAdditionalCharges} placeholder="0" className={inputClass} /></Field>
            <Field label={t("modals.transportCharges")}><AmountInput value={transportCharges} onChange={setTransportCharges} placeholder="0" className={inputClass} /></Field>
            <Field label={t("modals.otherCharges")}><AmountInput value={otherCharges} onChange={setOtherCharges} placeholder="0" className={inputClass} /></Field>
          </div>

          <div className="flex justify-between items-center px-3 py-2.5 bg-ink rounded-lg">
            <span className="font-mono text-[11px] text-[#9FD8D8] tracking-wide">{t("modals.totalPurchaseAmount")}</span>
            <span className="font-display font-bold text-lg text-white">{pkr(grandTotal)}</span>
          </div>

          <div className="border-t border-hairline pt-3.5">
            <button
              onClick={() => setRecordPayment((v) => !v)}
              className="font-body text-[13px] font-semibold text-teal bg-transparent border-none cursor-pointer p-0 mb-3"
            >
              {recordPayment ? t("modals.removePaymentFromEntry") : t("modals.payThePlantNow")}
            </button>

            {recordPayment && (
              <div className="grid grid-cols-3 gap-3">
                <Field label={t("expenses.paymentMethod")}>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} className={inputClass}>
                    <option value="cash">{t("unifiedSale.methodCash")}</option>
                    <option value="bank_transfer">{t("expenses.methodBankTransfer")}</option>
                    <option value="cheque">{t("unifiedSale.methodCheque")}</option>
                    <option value="online">{t("expenses.methodOnlinePayment")}</option>
                    <option value="other">{t("expenses.methodOther")}</option>
                  </select>
                </Field>
                <Field label={t("modals.payFromAccount")}>
                  <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} className={inputClass}>
                    <option value="">{t("expenses.selectAccount")}</option>
                    {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
                <Field label={t("modals.amountField")}>
                  <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputClass} />
                </Field>
              </div>
            )}
          </div>

          {selectedCompany && (
            <div className="font-body text-xs text-steel">
              {t("modals.currentPayableAfterEntry", { before: pkr(selectedCompany.current_balance), after: "" })}<b className="text-ink">{pkr(projectedBalance!)}</b>
            </div>
          )}

          {error && <div className="font-body text-xs text-brand-red">{error}</div>}

          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? t("unifiedSale.saving") : t("modals.savePurchase")}
          </Button>
        </div>
      </div>

      {showNewPlant && (
        <NewPlantModal
          onClose={() => setShowNewPlant(false)}
          onCreated={(c) => { setCompanies((prev) => [...prev, c]); setCompanyId(c.id); setShowNewPlant(false); }}
        />
      )}
    </div>
  );
}
