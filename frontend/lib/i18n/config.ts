import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./resources/en.json";
import ur from "./resources/ur.json";

export type AppLanguage = "en" | "ur";
export const SUPPORTED_LANGUAGES: AppLanguage[] = ["en", "ur"];
export const LANGUAGE_STORAGE_KEY = "dowa.language";

// Layout stays LTR in both languages (see glossary sign-off) — only text
// content and per-field `dir="rtl"` on Urdu script switch, never the
// document direction itself.
if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    resources: {
      en: { common: en },
      ur: { common: ur },
    },
    lng: "en",
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export default i18next;
