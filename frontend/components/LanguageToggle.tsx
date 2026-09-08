"use client";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LanguageToggle({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();

  const isLight = variant === "light";

  return (
    <div
      role="group"
      aria-label={t("shell.languageToggleLabel")}
      className={`flex items-center gap-0.5 p-0.5 ${
        isLight ? "rounded-full bg-paper border border-hairline" : "rounded-md bg-white/5"
      }`}
    >
      {(["en", "ur"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          aria-pressed={language === lang}
          className={`px-2 py-1 rounded-full text-[11px] font-mono transition-colors ${
            language === lang
              ? "bg-teal text-white"
              : isLight
              ? "text-slate-600 hover:text-slate-900"
              : "text-[#8A98A3] hover:text-white"
          }`}
        >
          {lang === "en" ? "EN" : "اردو"}
        </button>
      ))}
    </div>
  );
}
