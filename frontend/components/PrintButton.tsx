"use client";
import { Printer } from "lucide-react";
import { Button } from "./ui";

/** Triggers the browser print dialog against whatever the page has marked
 * .print-area (see app/globals.css) — used by Customer Ledger, the Plant
 * Ledger panel, and Daily Activity (§3). Give it the "no-print" class
 * wrapper so the button itself never shows up on paper. */
export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer size={14} /> {label}
    </Button>
  );
}
