"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth";
import { Button, inputClass } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const submit = async () => {
    if (!email.trim() || !password) return;
    setSaving(true);
    setError(null);
    const result = await login(email.trim(), password);
    setSaving(false);
    if (result.ok) {
      router.push("/");
    } else {
      // Deliberately the same generic message the backend returns for
      // wrong password / pending / suspended / rejected / nonexistent
      // email alike — never let this page itself leak which case it was.
      setError(result.error || "Invalid email or password.");
    }
  };

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4">
      <div className="w-full max-w-[380px] bg-panel rounded-xl px-6 py-9 sm:px-8 text-center">
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

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={`${inputClass} mb-3 text-center`}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={`${inputClass} mb-4 text-center`}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {error && (
          <div className="font-body text-xs text-brand-red mb-4">{error}</div>
        )}

        <Button variant="teal" onClick={submit} disabled={!email.trim() || !password || saving}>
          <span className="w-full text-center">{saving ? "Signing in…" : "Sign In"}</span>
        </Button>

        <div className="font-body text-[11px] text-steel mt-4">
          New here?{" "}
          <Link href="/register" className="text-teal font-semibold">
            Create an account
          </Link>{" "}
          — an Owner will need to approve it before you can sign in.
        </div>
      </div>
    </div>
  );
}
