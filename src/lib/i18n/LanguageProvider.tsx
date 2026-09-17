"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type TranslationKey } from "./en";
import { es } from "./es";

export type Language = "en" | "es";

const STORAGE_KEY = "standup-language";
const CHANGE_EVENT = "standup:language-changed";
const DICTIONARIES = { en, es };

export function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(STORAGE_KEY) === "es" ? "es" : "en";
}

// Mirrors src/lib/theme.ts's setTheme/onThemeChange pattern — a plain
// localStorage value plus a same-tab custom event, so any component (not
// just ones inside a React tree update) can react to a language change
// immediately, the same way the theme toggle does.
export function setStoredLanguage(language: Language) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.setAttribute("lang", language);
  window.dispatchEvent(new CustomEvent<Language>(CHANGE_EVENT, { detail: language }));
}

export function onLanguageChange(handler: (language: Language) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<Language>).detail);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Starts "en" for the server-rendered/first-paint markup (matches the
  // <html lang="en"> default in layout.tsx), then syncs to the real stored
  // value on mount — same hydration-safe pattern used for theme.
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    setLanguageState(getStoredLanguage());
    return onLanguageChange((l) => setLanguageState(l));
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    setStoredLanguage(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey) => DICTIONARIES[language][key] ?? DICTIONARIES.en[key] ?? key,
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
