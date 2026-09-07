"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n, { AppLanguage, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from "./config";

type LanguageCtx = {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
};
const Ctx = createContext<LanguageCtx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to English.
    }
    const initial = SUPPORTED_LANGUAGES.includes(saved as AppLanguage) ? (saved as AppLanguage) : "en";
    if (initial !== language) {
      i18n.changeLanguage(initial);
      setLanguageState(initial);
    }
    document.documentElement.lang = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = (lang: AppLanguage) => {
    i18n.changeLanguage(lang);
    setLanguageState(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // Non-fatal — the toggle still works for the rest of this session.
    }
  };

  return (
    <I18nextProvider i18n={i18n}>
      <Ctx.Provider value={{ language, setLanguage }}>{children}</Ctx.Provider>
    </I18nextProvider>
  );
}

export function useLanguage() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
