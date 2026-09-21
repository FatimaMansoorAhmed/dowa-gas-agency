// Pakistan mobile number -> E.164 (+923001234567). Mirrors
// backend/app/whatsapp.py's normalize_phone_number (the server re-validates
// regardless): Meta matches WhatsApp recipients by exact number, so
// "0300…" and "+92300…" are different recipients to it (error #131030).

export type PhoneResult = { ok: true; e164: string } | { ok: false; empty: boolean };

const PK_MOBILE_E164 = /^\+923\d{9}$/;

export function normalizePkPhone(raw: string): PhoneResult {
  const s = (raw || "").trim();
  if (!s) return { ok: false, empty: true };
  if (/[^\d\s\-().+]/.test(s) || s.slice(1).includes("+")) return { ok: false, empty: false };
  const digits = s.replace(/\D/g, "");
  let rest: string;
  if (s.startsWith("+")) {
    if (!digits.startsWith("92")) return { ok: false, empty: false };
    rest = digits.slice(2);
  } else if (digits.startsWith("0092")) {
    rest = digits.slice(4);
  } else if (digits.startsWith("92") && digits.length >= 12) {
    rest = digits.slice(2);
  } else if (digits.startsWith("0")) {
    rest = digits.slice(1);
  } else {
    rest = digits;
  }
  if (rest.length === 11 && rest.startsWith("0")) rest = rest.slice(1);
  const e164 = "+92" + rest;
  return PK_MOBILE_E164.test(e164) ? { ok: true, e164 } : { ok: false, empty: false };
}

export function isStoredE164(phone: string): boolean {
  return PK_MOBILE_E164.test(phone);
}
