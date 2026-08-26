"use client";
import { useEffect, useState } from "react";
import { X, Check, PlusCircle } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import NewPlantModal from "./NewPlantModal";
import { api } from "@/lib/api";
import { pkr, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Company, Product, PaymentAccount, RateEntry } from "@/lib/types";

const MULTIPLIER_454 = 45.4 / 11.8;

export default function AddPurchaseModal({
  onClose, onSaved, initialCompanyId,
}: { onClose: () => void; onSaved: () => void; initialCompanyId?: string }) {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [showNewPlant, setShowNewPlant] = useState(false);

  const [date, setDate] = useState(todayLocalInput());
  const [gatePass, setGatePass] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [companyId, setCompanyId] = useState(initialCompanyId || "");

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
      const [c, p, acc, r] = await Promise.all([
        api.companies.list(), api.products.list(), api.paymentAccounts.list(), api.rates.latest(),
      ]);
      setCompanies(c); setProducts(p); setAccounts(acc); setRates(r);
    })();
  }, []);

  const product118 = products.find((p) => Number(p.weight_kg) === 11.8 || p.name?.includes("11.8"));
  const product454 = products.find((p) => Number(p.weight_kg) === 45.4 || p.name?.includes("45.4"));
  const selectedCompany = companies.find((c) => c.id === companyId);

  useEffect(() => {
    if (!companyId) { setRate118(""); setRate454(""); return; }
    const latestForCompany = rates
      .filter((r) => String(r.company_id) === String(companyId))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    if (latestForCompany) {
      setRate118(latestForCompany.rate_118 ? String(latestForCompany.rate_118) : "");
      setRate454(latestForCompany.rate_454 ? String(latestForCompany.rate_454) : "");
    }
  }, [companyId, rates]);

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
      setError("Could not save purchase — check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.5)] flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-xl px-6 py-6 w-[560px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="font-display font-bold text-[17px] text-ink">Add New Purchase</div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>

        <div className="flex flex-col gap-3.5">
          <Field label="Plant / Party Name">
            <div className="flex gap-1.5">
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`${inputClass} flex-1`}>
                <option value="">Select plant</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="outline" onClick={() => setShowNewPlant(true)}><PlusCircle size={14} /></Button>
            </div>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Gate Pass (optional)">
              <input value={gatePass} onChange={(e) => setGatePass(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Vehicle No">
              <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="KP-7517" className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Driver Name (optional)">
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Driver Contact (optional)">
              <input value={driverContact} onChange={(e) => setDriverContact(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 bg-paper rounded-lg border border-hairline">
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel">11.8 KG</div>
              <input type="number" value={qty118} onChange={(e) => setQty118(e.target.value)} placeholder="Qty" className={inputClass} />
              <input type="number" value={rate118} onChange={(e) => handleRate118Change(e.target.value)} placeholder="Rate / cylinder" className={inputClass} />
              <div className="font-mono text-xs text-teal font-semibold">{cylinderTotal118 > 0 ? pkr(cylinderTotal118) : "—"}</div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel">45.4 KG</div>
              <input type="number" value={qty454} onChange={(e) => setQty454(e.target.value)} placeholder="Qty" className={inputClass} />
              <input type="number" value={rate454} onChange={(e) => setRate454(e.target.value)} placeholder="Rate / cylinder" className={inputClass} />
              <div className="font-mono text-xs text-teal font-semibold">{cylinderTotal454 > 0 ? pkr(cylinderTotal454) : "—"}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Additional Charges"><input type="number" value={additionalCharges} onChange={(e) => setAdditionalCharges(e.target.value)} placeholder="0" className={inputClass} /></Field>
            <Field label="Transport Charges"><input type="number" value={transportCharges} onChange={(e) => setTransportCharges(e.target.value)} placeholder="0" className={inputClass} /></Field>
            <Field label="Other Charges"><input type="number" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} placeholder="0" className={inputClass} /></Field>
          </div>

          <div className="flex justify-between items-center px-3 py-2.5 bg-ink rounded-lg">
            <span className="font-mono text-[11px] text-[#9FD8D8] tracking-wide">TOTAL PURCHASE AMOUNT</span>
            <span className="font-display font-bold text-lg text-white">{pkr(grandTotal)}</span>
          </div>

          <div className="border-t border-hairline pt-3.5">
            <button
              onClick={() => setRecordPayment((v) => !v)}
              className="font-body text-[13px] font-semibold text-teal bg-transparent border-none cursor-pointer p-0 mb-3"
            >
              {recordPayment ? "− Remove payment from this entry" : "+ Pay the plant now"}
            </button>

            {recordPayment && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Method">
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)} className={inputClass}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="online">Online Payment</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Pay From (Account)">
                  <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} className={inputClass}>
                    <option value="">Select account</option>
                    {accounts.filter((a) => a.active === "active").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
                <Field label="Amount">
                  <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputClass} />
                </Field>
              </div>
            )}
          </div>

          {selectedCompany && (
            <div className="font-body text-xs text-steel">
              Current payable {pkr(selectedCompany.current_balance)} → after this entry: <b className="text-ink">{pkr(projectedBalance!)}</b>
            </div>
          )}

          {error && <div className="font-body text-xs text-brand-red">{error}</div>}

          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving}>
            <Check size={14} /> {saving ? "Saving…" : "Save Purchase"}
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
