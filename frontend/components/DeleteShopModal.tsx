"use client";
import { useEffect, useState } from "react";
import { X, AlertTriangle, Trash2, KeyRound } from "lucide-react";
import { Field, inputClass, Button } from "./ui";
import { api, apiErrorMessage } from "@/lib/api";

export default function DeleteShopModal({
  shopId, shopName, onClose, onDeleted,
}: { shopId: string; shopName: string; onClose: () => void; onDeleted: () => void }) {
  const [isSet, setIsSet] = useState<boolean | null>(null);

  // Delete mode state
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");

  // Set-password mode state
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.shops.deletePasswordStatus().then((r) => setIsSet(r.is_set)).catch(() => setIsSet(false));
  }, []);

  const canSetPassword = newPassword.length >= 4 && newPassword === confirmNewPassword;
  const canDelete = password.trim().length > 0 && confirmText === shopName;

  const submitSetPassword = async () => {
    if (!canSetPassword) return;
    setSaving(true);
    setError(null);
    try {
      await api.shops.setDeletePassword({ new_password: newPassword });
      setIsSet(true);
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not set password"));
    } finally {
      setSaving(false);
    }
  };

  const submitDelete = async () => {
    if (!canDelete) return;
    setSaving(true);
    setError(null);
    try {
      await api.shops.deleteShop(shopId, password);
      onDeleted();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not delete shop"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[rgba(11,33,56,0.6)] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl px-6 py-6 w-full max-w-[420px]">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2 font-display font-bold text-[17px] text-brand-red">
            <AlertTriangle size={18} /> Delete Shop
          </div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer"><X size={16} className="text-steel" /></button>
        </div>

        {isSet === null && <div className="font-body text-xs text-steel py-4">Loading...</div>}

        {isSet === false && (
          <>
            <div className="flex items-center gap-2 mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <KeyRound size={15} className="text-amber-700 flex-shrink-0" />
              <p className="font-body text-xs text-amber-800">
                No Shop Deletion password exists yet. Set one now — you'll only need to do this once.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="New deletion password">
                <input type="password" autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Confirm password">
                <input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} className={inputClass} />
              </Field>
            </div>
            {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
            <div className="mt-4">
              <Button variant="primary" onClick={submitSetPassword} disabled={!canSetPassword || saving}>
                <KeyRound size={14} /> {saving ? "Saving..." : "Set Password"}
              </Button>
            </div>
          </>
        )}

        {isSet === true && (
          <>
            <p className="font-body text-xs text-steel mb-4">
              This permanently deletes <b>{shopName}</b> and ALL its data — stock, sales, supply customers, payments, expenses. This cannot be undone.
            </p>
            <div className="flex flex-col gap-3">
              <Field label="Deletion password">
                <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </Field>
              <Field label={`Type "${shopName}" to confirm`}>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputClass} />
              </Field>
            </div>
            {error && <div className="font-body text-xs text-brand-red mt-2">{error}</div>}
            <div className="mt-4">
              <Button variant="primary" onClick={submitDelete} disabled={!canDelete || saving}>
                <Trash2 size={14} /> {saving ? "Deleting..." : "Permanently Delete"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}