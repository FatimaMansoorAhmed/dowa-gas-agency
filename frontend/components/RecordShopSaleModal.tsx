
"use client";

import { useEffect, useState } from "react";
import {
  X,
  Check,
  ShoppingCart,
  CreditCard,
  Banknote,
  UserRound,
  FileText,
} from "lucide-react";

import { Field, inputClass, Button } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayLocalInput, pkr } from "@/lib/format";

import type {
  Product,
  ShopSupplyCustomer,
  PaymentAccount,
  ShopProductStockSummary,
} from "@/lib/types";

/**
 * Record Shop Sale
 *
 * Large, spacious form for recording a shop's retail sale.
 *
 * Pricing remains server-authoritative.
 *
 * The live amount shown in this form is only a preview based on the
 * already-computed stockProducts pricing. The server remains the
 * final authority when the transaction is saved.
 */
export default function RecordShopSaleModal({
  shopId,
  stockProducts,
  onClose,
  onSaved,
}: {
  shopId: string;
  stockProducts: ShopProductStockSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<ShopSupplyCustomer[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

  const [productId, setProductId] = useState("");
  const [date, setDate] = useState(todayLocalInput());

  const [unit, setUnit] = useState<"cylinder" | "kg">("cylinder");
  const [quantity, setQuantity] = useState("");

  const [paymentType, setPaymentType] =
    useState<"cash" | "credit">("cash");

  const [supplyCustomerId, setSupplyCustomerId] = useState("");

  const [receivePayment, setReceivePayment] = useState(false);
  const [amountReceived, setAmountReceived] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");

  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* -------------------------------------------------------------
     LOAD DATA
  ------------------------------------------------------------- */

  useEffect(() => {
    api.products.list().then((p) => {
      setProducts(
        p.filter((x) => x.active === "active")
      );
    });
  }, []);

  useEffect(() => {
    api.shops.customers.list(shopId).then(setCustomers);
  }, [shopId]);

  useEffect(() => {
    api.paymentAccounts.list().then((a) => {
      setAccounts(
        a.filter((x) => x.active === "active")
      );
    });
  }, []);

  /* -------------------------------------------------------------
     SELECTED PRODUCT
  ------------------------------------------------------------- */

  const selectedProduct = products.find(
    (p) => p.id === productId
  );

  /* -------------------------------------------------------------
     PRICE CALCULATION
  ------------------------------------------------------------- */

  const priceRow = stockProducts.find(
    (p) => p.product_id === productId
  );

  const qty = parseFloat(quantity);

  const perUnitRate = priceRow
    ? unit === "kg"
      ? priceRow.board_rate_per_kg
      : priceRow.sale_rate_per_cylinder
    : null;

  const saleAmount =
    perUnitRate != null &&
    qty > 0
      ? qty * parseFloat(perUnitRate)
      : null;

  const amountReceivedNum =
    parseFloat(amountReceived);

  const balanceDue =
    saleAmount != null &&
    paymentType === "credit" &&
    receivePayment &&
    amountReceivedNum >= 0
      ? saleAmount - amountReceivedNum
      : null;

  /* -------------------------------------------------------------
     VALIDATION
  ------------------------------------------------------------- */

  const canSubmit =
    !!productId &&
    !!date &&
    parseFloat(quantity) > 0 &&
    (paymentType === "cash" ||
      !!supplyCustomerId) &&
    (paymentType === "cash" ||
      !receivePayment ||
      parseFloat(amountReceived) > 0);

  /* -------------------------------------------------------------
     SUBMIT
  ------------------------------------------------------------- */

  const submit = async () => {
    if (!canSubmit || !user) return;

    setSaving(true);
    setError(null);

    try {
      const now = new Date();

      const hh = String(
        now.getHours()
      ).padStart(2, "0");

      const mm = String(
        now.getMinutes()
      ).padStart(2, "0");

      const ss = String(
        now.getSeconds()
      ).padStart(2, "0");

      const isoDate = new Date(
        `${date}T${hh}:${mm}:${ss}`
      ).toISOString();

      await api.shops.createSale(shopId, {
        date: isoDate,
        product_id: productId,
        quantity: parseFloat(quantity),
        unit,
        payment_type: paymentType,
        supply_customer_id:
          supplyCustomerId || undefined,

        amount_received:
          paymentType === "credit" &&
          receivePayment
            ? parseFloat(amountReceived)
            : undefined,

        destination_account_id:
          paymentType === "credit" &&
          receivePayment
            ? destinationAccountId || undefined
            : undefined,

        notes: notes || undefined,
        entered_by: user.name,
      });

      onSaved();
    } catch (e: any) {
      setError(
        e?.message?.includes("Insufficient")
          ? "Not enough stock for this quantity."
          : e?.message?.includes("amount_received")
          ? "Amount received can't exceed the sale total."
          : "Could not save the sale — check the fields and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  /* -------------------------------------------------------------
     UI
  ------------------------------------------------------------- */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,33,56,0.58)] p-4 sm:p-6">

      <div
        className="
          flex
          w-full
          max-w-4xl
          max-h-[94vh]
          flex-col
          overflow-hidden
          rounded-2xl
          bg-white
          shadow-2xl
        "
      >

        {/* =====================================================
            HEADER
        ====================================================== */}

        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5 sm:px-8">

          <div className="flex items-center gap-4">

            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal/10 text-teal">
              <ShoppingCart size={20} />
            </div>

            <div>
              <h2 className="font-display text-xl font-bold text-ink">
                Record Shop Sale
              </h2>

              <p className="mt-1 font-body text-xs text-slate-500">
                Record a retail sale from the shop's available inventory.
              </p>
            </div>

          </div>

          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="
              flex
              h-10
              w-10
              items-center
              justify-center
              rounded-lg
              border
              border-transparent
              text-steel
              transition-colors
              hover:border-slate-200
              hover:bg-slate-50
              hover:text-ink
              disabled:opacity-40
              cursor-pointer
            "
          >
            <X size={19} />
          </button>

        </div>

        {/* =====================================================
            FORM BODY
        ====================================================== */}

        <div className="overflow-y-auto px-7 py-7 sm:px-8">

          <div className="space-y-8">

            {/* =================================================
                SALE DETAILS
            ================================================== */}

            <section>

              <div className="mb-5">

                <h3 className="font-display text-base font-bold text-slate-800">
                  Sale Details
                </h3>

                <p className="mt-1 font-body text-xs text-slate-500">
                  Select the product, date, unit and quantity being sold.
                </p>

              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

                <Field label="Product">

                  <select
                    value={productId}
                    onChange={(e) =>
                      setProductId(e.target.value)
                    }
                    className={`${inputClass} h-12`}
                  >
                    <option value="">
                      Select product
                    </option>

                    {products.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                      >
                        {p.name}
                      </option>
                    ))}
                  </select>

                </Field>

                <Field label="Sale Date">

                  <input
                    type="date"
                    value={date}
                    onChange={(e) =>
                      setDate(e.target.value)
                    }
                    className={`${inputClass} h-12`}
                  />

                </Field>

              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">

                <Field label="Unit">

                  <select
                    value={unit}
                    onChange={(e) =>
                      setUnit(
                        e.target.value as
                          | "cylinder"
                          | "kg"
                      )
                    }
                    className={`${inputClass} h-12`}
                  >
                    <option value="cylinder">
                      Full Cylinder(s)
                    </option>

                    <option value="kg">
                      KG
                    </option>
                  </select>

                </Field>

                <Field
                  label={
                    unit === "kg"
                      ? "Quantity (KG)"
                      : "Quantity (Cylinders)"
                  }
                >

                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(
                        e.target.value
                      )
                    }
                    placeholder={
                      unit === "kg"
                        ? "Enter kilograms"
                        : "Enter number of cylinders"
                    }
                    className={`${inputClass} h-12`}
                  />

                </Field>

              </div>

            </section>

            {/* =================================================
                SALE AMOUNT — LARGE / PROMINENT
            ================================================== */}

            {productId && (

              <section
                className="
                  overflow-hidden
                  rounded-2xl
                  border
                  border-teal/20
                  bg-teal/5
                "
              >

                <div className="flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">

                  <div>

                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-teal">
                      Sale Amount
                    </p>

                    <p className="mt-1.5 font-display text-lg font-bold text-slate-800">
                      {selectedProduct?.name ||
                        "Selected Product"}
                    </p>

                    {qty > 0 && (
                      <p className="mt-1.5 font-body text-sm text-slate-500">
                        {qty}{" "}
                        {unit === "kg"
                          ? "KG"
                          : "cylinder(s)"}

                        {perUnitRate != null && (
                          <>
                            {" "}
                            ×{" "}
                            {pkr(perUnitRate)}
                          </>
                        )}
                      </p>
                    )}

                  </div>

                  <div className="sm:text-right">

                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Total
                    </p>

                    <p className="mt-1 font-display text-3xl font-bold text-brand-green sm:text-4xl">
                      {saleAmount != null
                        ? pkr(saleAmount)
                        : "—"}
                    </p>

                  </div>

                </div>

                <div className="grid grid-cols-2 gap-px bg-teal/10 sm:grid-cols-4">

                  <div className="bg-white px-5 py-4">

                    <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Quantity
                    </p>

                    <p className="mt-1 font-body text-sm font-semibold text-slate-800">
                      {qty > 0 ? qty : "—"}
                    </p>

                  </div>

                  <div className="bg-white px-5 py-4">

                    <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Unit
                    </p>

                    <p className="mt-1 font-body text-sm font-semibold text-slate-800">
                      {unit === "kg"
                        ? "KG"
                        : "Cylinder(s)"}
                    </p>

                  </div>

                  <div className="bg-white px-5 py-4">

                    <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Rate
                    </p>

                    <p className="mt-1 font-body text-sm font-semibold text-slate-800">
                      {perUnitRate != null
                        ? pkr(perUnitRate)
                        : "—"}
                    </p>

                  </div>

                  <div className="bg-white px-5 py-4">

                    <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Payment
                    </p>

                    <p
                      className={`mt-1 font-body text-sm font-semibold ${
                        paymentType === "cash"
                          ? "text-brand-green"
                          : "text-brand-red"
                      }`}
                    >
                      {paymentType === "cash"
                        ? "Cash"
                        : "Credit"}
                    </p>

                  </div>

                </div>

                {qty > 0 &&
                  saleAmount == null && (

                    <div className="border-t border-amber-200 bg-amber-50 px-6 py-4">

                      <p className="font-body text-xs leading-relaxed text-amber-800">
                        Board Rate is not set for this
                        product/date, so the sale amount
                        cannot currently be calculated.
                      </p>

                    </div>
                  )}

                <div className="border-t border-teal/10 px-6 py-4">

                  <p className="font-body text-[11px] leading-relaxed text-slate-500">
                    Price is calculated automatically from
                    the Board Rate and the product's saleable
                    weight. The server remains the final
                    authority when the sale is saved.
                  </p>

                </div>

              </section>
            )}

            {/* =================================================
                PAYMENT
            ================================================== */}

            <section>

              <div className="mb-5">

                <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-800">

                  <CreditCard
                    size={17}
                    className="text-teal"
                  />

                  Payment

                </h3>

                <p className="mt-1 font-body text-xs text-slate-500">
                  Choose how this sale is being paid.
                </p>

              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

                <Field label="Payment Type">

                  <select
                    value={paymentType}
                    onChange={(e) =>
                      setPaymentType(
                        e.target.value as
                          | "cash"
                          | "credit"
                      )
                    }
                    className={`${inputClass} h-12`}
                  >
                    <option value="cash">
                      Cash
                    </option>

                    <option value="credit">
                      Credit
                    </option>
                  </select>

                </Field>

                <Field
                  label={
                    paymentType === "credit"
                      ? "Supply Customer"
                      : "Supply Customer (optional)"
                  }
                >

                  <select
                    value={supplyCustomerId}
                    onChange={(e) =>
                      setSupplyCustomerId(
                        e.target.value
                      )
                    }
                    className={`${inputClass} h-12`}
                  >

                    <option value="">
                      {paymentType === "credit"
                        ? "Select customer"
                        : "Walk-in / public"}
                    </option>

                    {customers.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                      >
                        {c.name}
                      </option>
                    ))}

                  </select>

                </Field>

              </div>

            </section>

            {/* =================================================
                CREDIT SETTLEMENT
            ================================================== */}

            {paymentType === "credit" && (

              <section className="overflow-hidden rounded-xl border border-slate-200">

                <div className="border-b border-slate-100 px-6 py-5">

                  <div className="flex items-center gap-2">

                    <Banknote
                      size={17}
                      className="text-teal"
                    />

                    <h3 className="font-display text-base font-bold text-slate-800">
                      Payment Received Now
                    </h3>

                  </div>

                  <p className="mt-1 font-body text-xs text-slate-500">
                    Optionally collect part or all of the
                    credit sale immediately.
                  </p>

                </div>

                <div className="space-y-5 p-6">

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100">

                    <input
                      type="checkbox"
                      checked={receivePayment}
                      onChange={(e) =>
                        setReceivePayment(
                          e.target.checked
                        )
                      }
                      className="mt-0.5 h-4 w-4 cursor-pointer"
                    />

                    <div>

                      <div className="font-body text-sm font-semibold text-slate-800">
                        Received payment now
                      </div>

                      <div className="mt-1 font-body text-xs text-slate-500">
                        Record a payment together with
                        this credit sale.
                      </div>

                    </div>

                  </label>

                  {receivePayment && (

                    <>

                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

                        <Field label="Amount Received">

                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={amountReceived}
                            onChange={(e) =>
                              setAmountReceived(
                                e.target.value
                              )
                            }
                            placeholder="e.g. 20000"
                            className={`${inputClass} h-12`}
                          />

                        </Field>

                        <Field label="Destination Account">

                          <select
                            value={destinationAccountId}
                            onChange={(e) =>
                              setDestinationAccountId(
                                e.target.value
                              )
                            }
                            className={`${inputClass} h-12`}
                          >

                            <option value="">
                              Shop Cash (default)
                            </option>

                            {accounts.map((a) => (
                              <option
                                key={a.id}
                                value={a.id}
                              >
                                {a.name}
                              </option>
                            ))}

                          </select>

                        </Field>

                      </div>

                      {balanceDue != null && (

                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">

                          <div>

                            <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                              Remaining Balance
                            </p>

                            <p className="mt-1 font-body text-sm font-medium text-slate-600">
                              Outstanding after payment
                            </p>

                          </div>

                          <span
                            className={`font-mono text-lg font-bold ${
                              balanceDue > 0
                                ? "text-brand-red"
                                : "text-brand-green"
                            }`}
                          >
                            {pkr(balanceDue)}
                          </span>

                        </div>
                      )}

                      <p className="font-body text-[11px] leading-relaxed text-slate-500">
                        The remainder of the sale stays as
                        the customer's outstanding balance
                        with the shop.
                      </p>

                    </>
                  )}

                </div>

              </section>
            )}

            {/* =================================================
                NOTES
            ================================================== */}

            <section>

              <div className="mb-5">

                <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-800">

                  <FileText
                    size={17}
                    className="text-teal"
                  />

                  Additional Information

                </h3>

                <p className="mt-1 font-body text-xs text-slate-500">
                  Add an optional note about this transaction.
                </p>

              </div>

              <Field label="Notes (optional)">

                <textarea
                  value={notes}
                  onChange={(e) =>
                    setNotes(e.target.value)
                  }
                  placeholder="Add any notes about this sale..."
                  rows={4}
                  className={`${inputClass} min-h-[110px] resize-y py-3`}
                />

              </Field>

            </section>

            {/* =================================================
                CREDIT INFORMATION
            ================================================== */}

            {paymentType === "credit" && (

              <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-5 py-4">

                <UserRound
                  size={17}
                  className="mt-0.5 shrink-0 text-blue-600"
                />

                <p className="font-body text-xs leading-relaxed text-blue-800">
                  This credit sale will be added to the
                  selected customer's outstanding balance
                  with the shop. It does not increase the
                  amount owed to Dowa.
                </p>

              </div>
            )}

            {/* =================================================
                ERROR
            ================================================== */}

            {error && (

              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">

                <p className="font-body text-sm text-brand-red">
                  {error}
                </p>

              </div>
            )}

          </div>

        </div>

        {/* =====================================================
            FOOTER
        ====================================================== */}

        <div className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50/80 px-7 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">

          <div>

            {saleAmount != null ? (

              <>
                <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  Sale Total
                </p>

                <p className="mt-0.5 font-display text-lg font-bold text-slate-800">
                  {pkr(saleAmount)}
                </p>
              </>

            ) : (

              <p className="font-body text-xs text-slate-500">
                Complete the sale details to continue.
              </p>

            )}

          </div>

          <div className="flex w-full items-center gap-3 sm:w-auto">

            <button
              onClick={onClose}
              disabled={saving}
              className="
                flex-1
                rounded-lg
                border
                border-slate-300
                bg-white
                px-6
                py-3
                font-body
                text-sm
                font-medium
                text-slate-700
                transition-colors
                hover:bg-slate-50
                disabled:opacity-50
                cursor-pointer
                sm:flex-none
              "
            >
              Cancel
            </button>

            <Button
              variant="primary"
              onClick={submit}
              disabled={!canSubmit || saving}
            >
              <Check size={15} />

              {saving
                ? "Saving…"
                : "Save Sale"}
            </Button>

          </div>

        </div>

      </div>
    </div>
  );
}
