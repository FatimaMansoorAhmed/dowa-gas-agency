"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth";
import { Button, inputClass } from "@/components/ui";

export default function LoginPage() {
  const [role, setRole] = useState<"CEO" | "Staff" | null>(null);
  const [name, setName] = useState("");
  const { login } = useAuth();
  const router = useRouter();

  const submit = () => {
    if (!role || !name.trim()) return;
    login({ role, name: name.trim() });
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center">
      <div className="w-[380px] bg-panel rounded-xl px-8 py-9 text-center">
        {/* Header section with integrated Logo */}
        <div className="flex flex-col items-center justify-center mb-6">
  <Image
    src="/logo.png"
    alt="Dowa Gas Agency Logo"
    width={152}
    height={152}
    className="h-34 w-34 object-contain mb-3"
    priority
  />
  <div className="font-display font-bold text-xl text-ink">DOWA GAS AGENCY</div>
  <div className="font-mono text-[10.5px] text-steel tracking-widest mt-1">
    RATE &amp; CUSTOMER MODULE
  </div>
  </div>

        <div className="flex gap-2.5 mb-4">
          {(["CEO", "Staff"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`flex-1 py-3 rounded-lg font-body font-semibold text-[13.5px] text-ink ${
                role === r ? "border-2 border-teal bg-[#EAF6F6]" : "border border-hairline bg-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (for audit trail)"
          className={`${inputClass} mb-4 text-center`}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <Button variant="teal" onClick={submit} disabled={!role || !name.trim()}>
          <span className="w-full text-center">Continue</span>
        </Button>

        <div className="font-body text-[11px] text-steel mt-4">
          Both roles have full access — this just tags who entered what.
        </div>
      </div>
    </div>
  );
}