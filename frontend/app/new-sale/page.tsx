"use client";
import { useEffect, useState } from "react";
import { PlusCircle, Check, X, AlertCircle } from "lucide-react";
import AuthGate from "@/components/AuthGate";
import { PageHeader, Panel, Eyebrow, SectionCaption, Field, inputClass, Button, Th, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr, fmtTime, todayLocalInput } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Company, Customer, Product, PaymentAccount, RateEntry, Sale } from "@/lib/types";

const RATIO = 45.4 / 11.8;

function NewSaleBody() {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);

  // Header fields
  const [date, setDate] = useState(todayLocalInput());
  const [gatePass, setGatePass] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");

  // Account creation inline
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");

  // Product Override IDs
  const [overrideProduct118, setOverrideProduct118] = useState("");
  const [overrideProduct454, setOverrideProduct454] = useState("");

  // Quantities & Rates
  const [qty118, setQty118] = useState("");
  const [rate118, setRate118] = useState("");
  const [qty454, setQty454] = useState("");
  const [rate454, setRate454] = useState("");

  // Empty cylinders received back at delivery time
  const [returned118, setReturned118] = useState("");
  const [returned454, setReturned454] = useState("");

  // Payment
  const [recordPayment, setRecordPayment] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");
  const [payAccountId, setPayAccountId] = useState("");
  const [payAmount, setPayAmount] = useState("");

  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      let accList: PaymentAccount[] = [];
      try {
        if (api.paymentAccounts?.list) {
          accList = await api.paymentAccounts.list();
        }
      } catch (err) {
        console.warn("Could not fetch payment accounts:", err);
      }

      const [c, cu, p, r, s] = await Promise.all([
        api.companies.list().catch(() => []),
        api.customers.list().catch(() => []),
        api.products.list().catch(() => []),
        api.rates.latest ? api.rates.latest().catch(() => []) : api.rates.list().catch(() => []),
        api.sales.list().catch(() => []),
      ]);

      setCompanies(c || []);
      setCustomers(cu || []);
      setProducts(p || []);
      setRates(r || []);

      const sortedSales = (s || []).sort((a, b) => {
        const dateA = new Date(a.date || (a as any).created_at || 0).getTime();
        const dateB = new Date(b.date || (b as any).created_at || 0).getTime();

        if (dateB === dateA) {
          return String(b.display_id || b.id || "").localeCompare(String(a.display_id || a.id || ""));
        }
        return dateB - dateA;
      });

      setRecentSales(sortedSales.slice(0, 8));
      setAccounts(accList || []);
      if (accList && accList.length > 0) {
        setPayAccountId(String(accList[0].id));
      }
    } catch (err) {
      console.error("Data load error:", err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const getOrCreateProductId = async (weight: number, overrideId?: string) => {
    if (overrideId) return overrideId;

    let match = products.find(
      (p) =>
        Number(p.weight_kg) === weight ||
        String(p.weight_kg) === String(weight) ||
        String(p.name || "").includes(String(weight))
    );
    if (match?.id) return match.id;

    if (products.length > 0 && products[0].id) {
      return products[0].id;
    }

    throw new Error(`Database mein koi bhi Product nahi mila. Pehle Product Setup kar lein.`);
  };

  const filteredCustomers = customers.filter(
    (c) =>
      !customerSearch.trim() ||
      c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.mobile?.includes(customerSearch) ||
      c.display_id?.toLowerCase().includes(customerSearch.toLowerCase())
  );
  const selectedCustomer = customers.find((c) => String(c.id) === String(customerId));

  useEffect(() => {
    if (!companyId || rates.length === 0) return;

    const matchingRates = rates
      .filter((r) => {
        const companyMatch = String(r.company_id) === String(companyId);
        const partyMatch = customerId ? String((r as any).party_id) === String(customerId) : true;
        return companyMatch && partyMatch;
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp || (b as any).created_at || 0).getTime() -
          new Date(a.timestamp || (a as any).created_at || 0).getTime()
      );

    const latest = matchingRates[0] || rates.find((r) => String(r.company_id) === String(companyId));

    if (latest) {
      const r118Val = parseFloat(String(latest.rate_118)) || 0;
      setRate118(r118Val ? String(r118Val) : "");

      if (latest.rate_454) {
        setRate454(String(latest.rate_454));
      } else if (r118Val > 0) {
        setRate454(String(Math.round(r118Val * RATIO * 100) / 100));
      }
    }
  }, [companyId, customerId, rates]);

  const handleRate118Change = (val: string) => {
    setRate118(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setRate454(String(Math.round(num * RATIO * 100) / 100));
    } else {
      setRate454("");
    }
  };

  const total118 = (parseFloat(qty118) || 0) * (parseFloat(rate118) || 0);
  const total454 = (parseFloat(qty454) || 0) * (parseFloat(rate454) || 0);
  const grandTotal = total118 + total454;

  const projectedBalance = selectedCustomer
    ? parseFloat(selectedCustomer.current_balance || "0") + grandTotal - (recordPayment ? parseFloat(payAmount) || 0 : 0)
    : null;

  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return;
    try {
      const c = await api.companies.create({ name: newCompanyName.trim() });
      setCompanies((prev) => [...prev, c]);
      setCompanyId(c.id);
      setNewCompanyName("");
      setAddingCompany(false);
    } catch (err) {
      alert("Failed to add company.");
    }
  };

  const handleAddAccount = async () => {
    if (!newAccountName.trim()) return;
    try {
      const acc = await api.paymentAccounts.create(
        newAccountName.trim(),
        payMethod === "cash" ? "cash" : "bank",
        0
      );
      setAccounts((prev) => [...prev, acc]);
      setPayAccountId(String(acc.id));
      setNewAccountName("");
      setAddingAccount(false);
    } catch (err) {
      alert("Failed to create account.");
    }
  };

  const handleSubmit = async () => {
    setToast(null);

    if (!customerId) {
      setToast({ type: "error", msg: "Please select a Customer first." });
      return;
    }

    const q118 = parseFloat(qty118) || 0;
    const r118 = parseFloat(rate118) || 0;
    const q454 = parseFloat(qty454) || 0;
    const r454 = parseFloat(rate454) || 0;

    if (q118 <= 0 && q454 <= 0) {
      setToast({ type: "error", msg: "Please enter Quantity (Qty) for at least one cylinder size." });
      return;
    }

    if (recordPayment && parseFloat(payAmount) > 0 && !payAccountId) {
      setToast({ type: "error", msg: "No Payment Account selected. Please add an account using the '+ Add' button." });
      return;
    }

    setSaving(true);
    try {
      const now = new Date();
      const timePart = now.toTimeString().split(" ")[0];
      const isoDate = new Date(`${date}T${timePart}`).toISOString();

      let createdSalesCount = 0;
      let lastSaleId: string | undefined;

      const genDisplayId = () => `SALE-${Math.floor(100000 + Math.random() * 900000)}`;

      if (q118 > 0) {
        const prodId118 = await getOrCreateProductId(11.8, overrideProduct118);
        const payload118 = {
          display_id: genDisplayId(),
          date: isoDate,
          customer_id: customerId,
          product_id: prodId118,
          company_id: companyId || undefined,
          quantity: q118,
          weight_per_cylinder: 11.8,
          total_kg: Number((q118 * 11.8).toFixed(2)),
          rate_per_kg: Number((r118 / 11.8).toFixed(2)),
          rate_per_cylinder: r118,
          total_amount: Number((q118 * r118).toFixed(2)),
          gate_pass_no: gatePass || undefined,
          vehicle_no: vehicleNo || undefined,
          entered_by: user?.name || "fatima",
          status: "active",
          cylinders_returned: Math.min(parseFloat(returned118) || 0, q118),
        };

        const res118 = await api.sales.create(payload118);
        if (res118) {
          createdSalesCount++;
          lastSaleId = res118.id;
        }
      }

      if (q454 > 0) {
        const prodId454 = await getOrCreateProductId(45.4, overrideProduct454);
        const payload454 = {
          display_id: genDisplayId(),
          date: isoDate,
          customer_id: customerId,
          product_id: prodId454,
          company_id: companyId || undefined,
          quantity: q454,
          weight_per_cylinder: 45.4,
          total_kg: Number((q454 * 45.4).toFixed(2)),
          rate_per_kg: Number((r454 / 45.4).toFixed(2)),
          rate_per_cylinder: r454,
          total_amount: Number((q454 * r454).toFixed(2)),
          gate_pass_no: gatePass || undefined,
          vehicle_no: vehicleNo || undefined,
          entered_by: user?.name || "fatima",
          status: "active",
          cylinders_returned: Math.min(parseFloat(returned454) || 0, q454),
        };

        const res454 = await api.sales.create(payload454);
        if (res454) {
          createdSalesCount++;
          lastSaleId = res454.id || lastSaleId;
        }
      }

      if (recordPayment && parseFloat(payAmount) > 0) {
        await api.payments.create({
          date: isoDate,
          customer_id: customerId,
          sale_id: lastSaleId,
          amount: parseFloat(payAmount),
          method: payMethod,
          account_id: payAccountId,
          entered_by: user?.name || "fatima",
        });
      }

      if (createdSalesCount > 0) {
        setToast({ type: "success", msg: "Sale saved successfully!" });
        setQty118("");
        setQty454("");
        setReturned118("");
        setReturned454("");
        setGatePass("");
        setRecordPayment(false);
        setPayAmount("");
        await load();
      }
    } catch (err: any) {
      console.error("Sale Submit Error:", err);
      const detail = err?.response?.data?.detail;
      let errorMsg = "Failed to save sale.";
      if (Array.isArray(detail)) {
        errorMsg = detail.map((d: any) => `${d.loc?.join("->")}: ${d.msg}`).join(" | ");
      } else if (typeof detail === "string") {
        errorMsg = detail;
      } else if (err?.message) {
        errorMsg = err.message;
      }
      setToast({ type: "error", msg: errorMsg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="New Sale"
        title="Record a sale"
        caption="One entry can cover both cylinder sizes and an optional payment — everything posts to the customer ledger automatically."
      />

      <div className="grid grid-cols-[1.15fr_1fr] gap-4">
        <Panel>
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Gate Pass (optional)">
                <input value={gatePass} onChange={(e) => setGatePass(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Vehicle No">
                <input
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  placeholder="KW-7517"
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Customer">
              <div className="relative">
                <input
                  value={
                    selectedCustomer
                      ? `${selectedCustomer.name} · ${selectedCustomer.display_id || ""}`
                      : customerSearch
                  }
                  onChange={(e) => {
                    setCustomerId("");
                    setCustomerSearch(e.target.value);
                  }}
                  placeholder="Search by name, mobile, or customer ID"
                  className={inputClass}
                />
                {!customerId && customerSearch.trim() && (
                  <div className="absolute z-10 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-52 overflow-y-auto shadow-lg">
                    {filteredCustomers.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerSearch("");
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px]"
                      >
                        <span className="font-semibold text-ink">{c.name}</span>{" "}
                        <span className="text-steel">
                          · {c.display_id} · {c.mobile}
                        </span>
                      </button>
                    ))}
                    {!filteredCustomers.length && (
                      <div className="px-3 py-2 font-body text-[13px] text-steel">No match.</div>
                    )}
                  </div>
                )}
              </div>
            </Field>

            <Field label="Plant / Company">
              {!addingCompany ? (
                <div className="flex gap-1.5">
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className={`${inputClass} flex-1`}
                  >
                    <option value="">Select company</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" onClick={() => setAddingCompany(true)}>
                    <PlusCircle size={14} /> Add
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="New company name"
                    className={`${inputClass} flex-1`}
                  />
                  <Button variant="teal" onClick={handleAddCompany}>
                    <Check size={14} /> Save
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAddingCompany(false);
                      setNewCompanyName("");
                    }}
                  >
                    <X size={14} /> Cancel
                  </Button>
                </div>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3 p-3 bg-paper rounded-lg border border-hairline">
              <div className="flex flex-col gap-2">
                <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel">11.8 KG</div>
                <input
                  type="number"
                  min="0"
                  value={qty118}
                  onChange={(e) => setQty118(e.target.value)}
                  placeholder="Qty"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={rate118}
                  onChange={(e) => handleRate118Change(e.target.value)}
                  placeholder="Rate / cylinder"
                  className={inputClass}
                />
                {products.length > 0 && (
                  <select
                    value={overrideProduct118}
                    onChange={(e) => setOverrideProduct118(e.target.value)}
                    className="text-xs p-1 border rounded bg-white"
                  >
                    <option value="">Auto DB Product (11.8 KG)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.weight_kg}kg)
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min="0"
                  value={returned118}
                  onChange={(e) => setReturned118(e.target.value)}
                  placeholder="Empties returned"
                  className={`${inputClass} border-dashed`}
                  title="Empty 11.8kg cylinders received back at delivery"
                />
                <div className="font-mono text-xs text-teal font-semibold">{total118 ? pkr(total118) : "—"}</div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="font-mono text-[10.5px] tracking-wide uppercase text-steel">45.4 KG</div>
                <input
                  type="number"
                  min="0"
                  value={qty454}
                  onChange={(e) => setQty454(e.target.value)}
                  placeholder="Qty"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={rate454}
                  onChange={(e) => setRate454(e.target.value)}
                  placeholder="Rate / cylinder"
                  className={inputClass}
                />
                {products.length > 0 && (
                  <select
                    value={overrideProduct454}
                    onChange={(e) => setOverrideProduct454(e.target.value)}
                    className="text-xs p-1 border rounded bg-white"
                  >
                    <option value="">Auto DB Product (45.4 KG)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.weight_kg}kg)
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min="0"
                  value={returned454}
                  onChange={(e) => setReturned454(e.target.value)}
                  placeholder="Empties returned"
                  className={`${inputClass} border-dashed`}
                  title="Empty 45.4kg cylinders received back at delivery"
                />
                <div className="font-mono text-xs text-teal font-semibold">{total454 ? pkr(total454) : "—"}</div>
              </div>
            </div>

            <div className="flex justify-between items-center px-3 py-2.5 bg-ink rounded-lg">
              <span className="font-mono text-[11px] text-[#9FD8D8] tracking-wide">TOTAL SALE AMOUNT</span>
              <span className="font-display font-bold text-lg text-white">{pkr(grandTotal)}</span>
            </div>

            <div className="border-t border-hairline pt-3.5">
              <button
                type="button"
                onClick={() => setRecordPayment((v) => !v)}
                className="font-body text-[13px] font-semibold text-teal bg-transparent border-none cursor-pointer p-0 mb-3"
              >
                {recordPayment ? "− Remove payment from this entry" : "+ Record a payment now"}
              </button>

              {recordPayment && (
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <Field label="Method">
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                      className={inputClass}
                    >
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="online">Online Payment</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>

                  <Field label="Pay To (Account) *">
                    {!addingAccount ? (
                      <div className="flex gap-1">
                        <select
                          value={payAccountId}
                          onChange={(e) => setPayAccountId(e.target.value)}
                          className={`${inputClass} flex-1`}
                        >
                          {accounts.length === 0 ? (
                            <option value="">No accounts found</option>
                          ) : (
                            accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name || (a as any).title || `Account #${a.id}`}
                              </option>
                            ))
                          )}
                        </select>
                        <Button variant="outline" onClick={() => setAddingAccount(true)}>
                          + Add
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={newAccountName}
                          onChange={(e) => setNewAccountName(e.target.value)}
                          placeholder="e.g. Main Cash / Bank"
                          className={`${inputClass} flex-1`}
                        />
                        <Button variant="teal" onClick={handleAddAccount}>
                          <Check size={14} />
                        </Button>
                        <Button variant="outline" onClick={() => setAddingAccount(false)}>
                          <X size={14} />
                        </Button>
                      </div>
                    )}
                  </Field>

                  <Field label="Amount">
                    <input
                      type="number"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                </div>
              )}
            </div>

            {selectedCustomer && (
              <div className="font-body text-xs text-steel py-1 block w-full">
                Current balance {pkr(selectedCustomer.current_balance)} → after this entry:{" "}
                <b className="text-ink">{pkr(projectedBalance!)}</b>
              </div>
            )}

            <Field label="Entered by">
              <input value={user?.name || "fatima"} disabled className={`${inputClass} bg-paper text-steel`} />
            </Field>

            <Button variant="primary" onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving…" : "Save Sale"}
            </Button>

            {toast && (
              <div
                className={`font-body text-[13px] p-2.5 rounded border flex items-center gap-2 ${
                  toast.type === "success"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-red-50 text-red-600 border-red-200"
                }`}
              >
                {toast.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                <span>{toast.msg}</span>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <Eyebrow>Recent Sales</Eyebrow>
          <SectionCaption>Last 8 entries, most recent first.</SectionCaption>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>Customer</Th>
                <Th right>11.8 KG</Th>
                <Th right>45.4 KG</Th>
                <Th right>Amount</Th>
                <Th right>Date</Th>
              </tr>
            </thead>
            <tbody>
              {recentSales.map((s, idx) => {
                const c = customers.find((x) => String(x.id) === String(s.customer_id));
                const weight = Number((s as any).product?.weight_kg || s.weight_per_cylinder || 0);
                const q118 = weight === 11.8 ? s.quantity : 0;
                const q454 = weight === 45.4 ? s.quantity : 0;

                return (
                  <tr key={s.id || idx}>
                    <Td mono>{s.display_id || `SALE-${idx + 1}`}</Td>
                    <Td bold>{c?.name || "Customer"}</Td>
                    <Td right mono>{q118 || "—"}</Td>
                    <Td right mono>{q454 || "—"}</Td>
                    <Td right mono color="#0F8B8D">
                      {pkr(s.total_amount)}
                    </Td>
                    <Td right mono>
                      {fmtTime(s.date || (s as any).created_at)}
                    </Td>
                  </tr>
                );
              })}
              {!recentSales.length && (
                <tr>
                  <td colSpan={6} className="text-steel font-body text-[13px] py-3 text-center">
                    No sales recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

export default function NewSalePage() {
  return (
    <AuthGate>
      <NewSaleBody />
    </AuthGate>
  );
}