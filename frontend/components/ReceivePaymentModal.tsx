"use client";
import { useEffect, useState } from "react";
import { X, Check, AlertCircle, Wallet } from "lucide-react";
import { Field, inputClass, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { pkr } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { Customer, PaymentAccount } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultCustomerId?: string;
}

export default function ReceivePaymentModal({
  isOpen,
  onClose,
  onSuccess,
  defaultCustomerId,
}: Props) {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState(defaultCustomerId || "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque" | "online" | "other">("cash");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      try {
        const [cList, accList] = await Promise.all([
          api.customers.list().catch(() => []),
          api.paymentAccounts?.list ? api.paymentAccounts.list().catch(() => []) : [],
        ]);
        setCustomers(cList || []);
        setAccounts(accList || []);
        if (accList && accList.length > 0 && !accountId) {
          setAccountId(String(accList[0].id));
        }
      } catch (err) {
        console.error("Data load error:", err);
      }
    };

    loadData();
    if (defaultCustomerId) {
      setCustomerId(defaultCustomerId);
    }
  }, [isOpen, defaultCustomerId]);

  if (!isOpen) return null;

  const selectedCustomer = customers.find((c) => String(c.id) === String(customerId));
  const filteredCustomers = customers.filter(
    (c) =>
      !customerSearch.trim() ||
      c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.mobile?.includes(customerSearch) ||
      c.display_id?.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const currentBal = selectedCustomer ? parseFloat(selectedCustomer.current_balance || "0") : 0;
  const payAmt = parseFloat(amount) || 0;
  const projectedBal = currentBal - payAmt;

  const handleSubmit = async () => {
    setToast(null);

    if (!customerId) {
      setToast({ type: "error", msg: "Please select a customer." });
      return;
    }
    if (payAmt <= 0) {
      setToast({ type: "error", msg: "Please enter a valid payment amount." });
      return;
    }
    if (!accountId) {
      setToast({ type: "error", msg: "Please select a Payment Account." });
      return;
    }

    setSaving(true);
    try {
      const now = new Date();
      const timePart = now.toTimeString().split(" ")[0];
      const isoDate = new Date(`${date}T${timePart}`).toISOString();

      await api.payments.create({
        date: isoDate,
        customer_id: customerId,
        amount: payAmt,
        method: method,
        account_id: accountId,
        notes: notes || undefined,
        entered_by: user?.name || "fatima",
      });

      setToast({ type: "success", msg: "Payment recorded successfully!" });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 800);
    } catch (err: any) {
      setToast({ type: "error", msg: err?.message || "Failed to record payment." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-hairline">
        
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-hairline bg-paper">
          <div className="flex items-center gap-2">
            <Wallet className="text-teal" size={20} />
            <h3 className="font-display font-semibold text-lg text-ink">Receive Payment</h3>
          </div>
          <button onClick={onClose} className="text-steel hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>

            <Field label="Payment Method">
              <select value={method} onChange={(e) => setMethod(e.target.value as any)} className={inputClass}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="online">Online Payment</option>
                <option value="other">Other</option>
              </select>
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
                placeholder="Search customer by name or phone..."
                className={inputClass}
              />
              {!customerId && customerSearch.trim() && (
                <div className="absolute z-10 top-full left-0 right-0 bg-white border border-hairline rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCustomerId(c.id);
                        setCustomerSearch("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-paper font-body text-[13px] border-b border-hairline last:border-none"
                    >
                      <span className="font-semibold text-ink">{c.name}</span>{" "}
                      <span className="text-steel">· {c.mobile}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Deposit To Account">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || (a as any).title || `Account #${a.id}`}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Amount Received (PKR)">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Notes / Reference (Optional)">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cheque # / Online Ref / Remarks"
              className={inputClass}
            />
          </Field>

          {/* Balance Preview Card */}
          {selectedCustomer && (
            <div className="p-3 bg-paper rounded-lg border border-hairline flex justify-between items-center text-xs font-body">
              <div>
                <span className="text-steel">Current Balance:</span>{" "}
                <b className="text-ink">{pkr(currentBal)}</b>
              </div>
              <div>
                <span className="text-steel">New Balance:</span>{" "}
                <b className={projectedBal < 0 ? "text-emerald-600 font-bold" : "text-ink font-bold"}>
                  {pkr(projectedBal)} {projectedBal < 0 && "(Advance)"}
                </b>
              </div>
            </div>
          )}

          {toast && (
            <div
              className={`font-body text-xs p-2.5 rounded border flex items-center gap-2 ${
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

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-hairline bg-paper">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : "Record Payment"}
          </Button>
        </div>

      </div>
    </div>
  );
}