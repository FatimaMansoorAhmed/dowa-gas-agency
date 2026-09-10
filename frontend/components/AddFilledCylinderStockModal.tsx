"use client";
import { useEffect, useState } from "react";
import { X, PackagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field, inputClass, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Product } from "@/lib/types";

/** Add Filled Cylinder Stock (§ Shop Management) — manually adds an
 * existing batch of filled cylinders to a shop's FIFO stock, e.g.
 * onboarding a shop that already has physical stock on-site, or a manual
 * correction. Mirrors AddEmptyCylinderModal's shape (a pure count
 * increase, no money, no date field — the server timestamps it "now"
 * unless told otherwise) but posts a ShopStockBatch instead of a
 * CylinderReturn: see routers/shops.py's create_manual_stock_batch. */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  shopId: string;
}

export default function AddFilledCylinderStockModal({ isOpen, onClose, onSuccess, shopId }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    api.products.list().then((p) => setProducts(p.filter((x) => x.active === "active")));
    setProductId("");
    setQuantity("");
    setNotes("");
    setError(null);
  }, [isOpen, shopId]);

  if (!isOpen) return null;

  const qtyNum = parseInt(quantity, 10);
  const canSubmit = !!productId && Number.isInteger(qtyNum) && qtyNum > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    try {
      await api.shops.addStockBatch(shopId, {
        product_id: productId,
        quantity: qtyNum,
        notes: notes || undefined,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals.failedAddStock"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8 overflow-hidden border border-hairline">
        <div className="flex justify-between items-center px-5 py-4 border-b border-hairline bg-paper">
          <div className="flex items-center gap-2">
            <PackagePlus className="text-teal" size={20} />
            <h3 className="font-display font-semibold text-lg text-ink">{t("modals.addFilledStockTitle")}</h3>
          </div>
          <button onClick={onClose} className="text-steel hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <Field label={t("modals.cylinderTypeSize")}>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
              <option value="">{t("modals.selectCylinderType")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <Field label={t("modals.quantityLabel")}>
            <input
              type="number"
              min="1"
              step="1"
              autoFocus
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label={t("modals.reasonNotes")}>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("modals.addFilledStockNotesPlaceholder")}
              className={inputClass}
            />
          </Field>

          {error && <div className="text-xs text-brand-red font-medium">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-hairline bg-paper">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("unifiedSale.cancel")}
          </Button>
          <Button variant="teal" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? t("unifiedSale.saving") : t("modals.addStock")}
          </Button>
        </div>
      </div>
    </div>
  );
}
