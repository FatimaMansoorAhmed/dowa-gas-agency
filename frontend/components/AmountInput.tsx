"use client";
import { useState } from "react";
import { fmtNumber } from "@/lib/format";

/** Comma-formatted amount input (§7 thousands separators) — a drop-in
 * replacement for `<input type="number" value={x} onChange={e =>
 * setX(e.target.value)} />`: `value`/`onChange` still carry a plain
 * numeric string (e.g. "1000000"), so every caller's existing
 * `parseFloat(value)` submit logic is untouched. Shows the raw value
 * while focused (so typing/editing never fights a live-reformatting
 * cursor), and the comma-formatted version once blurred — e.g.
 * "1,000,000". Native `type="number"` inputs can't show commas while
 * being edited at all (a browser limitation), so this is deliberately a
 * text input with manual digit filtering instead. */
export default function AmountInput({
  value, onChange, placeholder, className, disabled, autoFocus, decimals = 0,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  decimals?: number;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused || value === "" ? value : fmtNumber(value, decimals);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(/,/g, "");
        if (raw === "" || /^-?\d*\.?\d*$/.test(raw)) onChange(raw);
      }}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  );
}
