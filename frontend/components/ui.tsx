"use client";
import { ReactNode } from "react";
import { pkr } from "@/lib/format";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] tracking-widest uppercase text-steel mb-1.5">
      {children}
    </div>
  );
}

export function SectionCaption({ children }: { children: ReactNode }) {
  return <p className="font-body text-[12.5px] text-steel mt-0.5 mb-3.5 max-w-xl">{children}</p>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-panel border border-hairline rounded-[10px] px-[22px] py-5 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow, title, caption, action,
}: { eyebrow: string; title: string; caption: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex justify-between items-end gap-4 flex-wrap">
      <div>
        <div className="font-mono text-[11.5px] tracking-widest uppercase text-teal mb-1">{eyebrow}</div>
        <h1 className="font-display font-bold text-[27px] text-ink m-0">{title}</h1>
        <p className="font-body text-[13.5px] text-steel mt-1.5 max-w-xl">{caption}</p>
      </div>
      {action}
    </div>
  );
}

export function Th({ children, right = false, center = false }: { children: ReactNode; right?: boolean; center?: boolean }) {
  return (
    <th className={`font-mono text-[10.5px] tracking-wide uppercase text-steel px-2.5 py-2 border-b border-hairline font-medium whitespace-nowrap ${center ? "text-center" : right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

export function Td({
  children, right = false, center = false, mono = false, color, bold = false, colSpan,
}: { children: ReactNode; right?: boolean; center?: boolean; mono?: boolean; color?: string; bold?: boolean; colSpan?: number }) {
  return (
    <td
      colSpan={colSpan}
      className={`text-[13px] px-2.5 py-2.5 border-b border-hairline whitespace-nowrap ${mono ? "font-mono" : "font-body"} ${center ? "text-center" : right ? "text-right" : "text-left"} ${bold ? "font-semibold" : "font-normal"}`}
      style={{ color: color || "#0B2138" }}
    >
      {children}
    </td>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10.5px] tracking-wide uppercase text-steel">{label}</label>
      {children}
    </div>
  );
}

export const inputClass =
  "font-body text-[13.5px] px-2.5 py-2 rounded-md border border-hairline outline-none text-ink bg-white w-full focus:border-teal";

export function Button({
  children, onClick, variant = "primary", disabled, type = "button",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "outline" | "teal";
  disabled?: boolean; type?: "button" | "submit";
}) {
  const variants: Record<string, string> = {
    primary: "bg-ink text-white border-none",
    outline: "bg-transparent text-ink border border-hairline",
    teal: "bg-teal text-white border-none",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 font-body text-[13px] font-medium px-4 py-2.5 rounded-md ${variants[variant]} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {children}
    </button>
  );
}

export function BalanceTag({ amount }: { amount: number | string }) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  const isAdvance = n < 0;
  return (
    <span className={`font-mono text-[12.5px] font-semibold ${isAdvance ? "text-teal" : "text-ink"}`}>
      {pkr(Math.abs(n))}
      {isAdvance && (
        <span className="ml-1.5 text-[10px] px-2 py-0.5 rounded-full bg-[#E4F3F3] text-tealdeep tracking-wide">
          ADVANCE
        </span>
      )}
    </span>
  );
}

export function CylinderStripe() {
  return (
    <div
      className="h-1.5 w-full opacity-85"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, #D98E04 0px, #D98E04 10px, #0B2138 10px, #0B2138 20px)",
      }}
    />
  );
}