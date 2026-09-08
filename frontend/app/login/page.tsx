"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { Button, inputClass } from "@/components/ui";

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      setError(result.error || t("auth.invalidCredentials"));
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
          placeholder={t("auth.emailPlaceholder")}
          className={`${inputClass} mb-3 text-center`}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            className={`${inputClass} pr-9 text-center`}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-steel hover:text-ink"
            tabIndex={-1}
            aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {error && (
          <div className="font-body text-xs text-brand-red mb-4">{error}</div>
        )}

        <Button variant="teal" onClick={submit} disabled={!email.trim() || !password || saving}>
          <span className="w-full text-center">{saving ? t("auth.signingIn") : t("auth.signIn")}</span>
        </Button>

        <div className="font-body text-[11px] text-steel mt-4">
          {t("auth.newHerePrefix")}{" "}
          <Link href="/register" className="text-teal font-semibold">
            {t("auth.createAnAccount")}
          </Link>{" "}
          {t("auth.newHereSuffix")}
        </div>
      </div>
    </div>
  );
}
