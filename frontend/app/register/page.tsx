"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button, inputClass } from "@/components/ui";
import { API_BASE } from "@/lib/api";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit = !!name.trim() && !!email.trim() && password.length >= 8 && password === confirmPassword;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Could not create the account — check the fields and try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server — check your connection and try again.");
    } finally {
      setSaving(false);
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

        {done ? (
          <>
            <div className="font-display font-bold text-[15px] text-ink mb-2">
              Waiting for Owner Approval
            </div>
            <div className="font-body text-[12.5px] text-steel mb-5">
              Your account has been created. An Owner needs to approve it before you can sign in —
              check back shortly.
            </div>
            <Link href="/login">
              <Button variant="outline">
                <span className="w-full text-center">Back to Sign In</span>
              </Button>
            </Link>
          </>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={`${inputClass} mb-3 text-center`}
              autoFocus
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className={`${inputClass} mb-3 text-center`}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min. 8 characters)"
              className={`${inputClass} mb-3 text-center`}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className={`${inputClass} mb-4 text-center`}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />

            {password && confirmPassword && password !== confirmPassword && (
              <div className="font-body text-xs text-brand-red mb-3">Passwords don't match.</div>
            )}
            {error && <div className="font-body text-xs text-brand-red mb-4">{error}</div>}

            <Button variant="teal" onClick={submit} disabled={!canSubmit || saving}>
              <span className="w-full text-center">{saving ? "Creating account…" : "Create Account"}</span>
            </Button>

            <div className="font-body text-[11px] text-steel mt-4">
              Already have an account?{" "}
              <Link href="/login" className="text-teal font-semibold">
                Sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
