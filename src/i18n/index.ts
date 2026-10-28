import { create } from "zustand";
import { en } from "./en";

/**
 * Minimal gettext-style i18n. Spanish is the source language: UI code writes the Spanish
 * text, `t()` returns it as is in Spanish or looks it up in `en` in English. `Msg` is typed
 * from the `en` dictionary, so a Spanish text with no English translation fails typecheck.
 *
 * No React or DOM dependency: `src/pdf/**` may use it too (it runs in Node tests, where the
 * locale is always Spanish).
 */

export type Locale = "es" | "en";
export type LanguageSetting = "system" | Locale;
export type Msg = keyof typeof en;
export type MsgVars = Record<string, string | number>;

const LANGUAGE_KEY = "snowpdf.language";

/** First of the OS languages we support; English for any other language. */
export function systemLocale(): Locale {
  if (typeof document === "undefined") return "es";
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = tag.toLowerCase().split("-")[0];
    if (lang === "es" || lang === "en") return lang;
  }
  return "en";
}

function loadSetting(): LanguageSetting {
  try {
    const raw = localStorage.getItem(LANGUAGE_KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : "system";
    return value === "es" || value === "en" ? value : "system";
  } catch {
    return "system";
  }
}

const resolve = (setting: LanguageSetting): Locale => (setting === "system" ? systemLocale() : setting);

interface I18nState {
  language: LanguageSetting;
  /** Language in use (`language` with "system" resolved). */
  locale: Locale;
  setLanguage(language: LanguageSetting): void;
  /** Re-read the OS language (it changed while following the system). */
  refreshSystem(): void;
}

export const useI18n = create<I18nState>((set, get) => {
  const language = loadSetting();
  return {
    language,
    locale: resolve(language),
    setLanguage: (language) => {
      try {
        localStorage.setItem(LANGUAGE_KEY, JSON.stringify(language));
      } catch {
        // Storage unavailable: the setting simply won't persist.
      }
      set({ language, locale: resolve(language) });
    },
    refreshSystem: () => {
      if (get().language === "system") set({ locale: systemLocale() });
    },
  };
});

export function getLocale(): Locale {
  return useI18n.getState().locale;
}

/** BCP 47 tag for `Intl` / `toLocale*` formatting in the current language. */
export function intlLocale(): string {
  return getLocale() === "en" ? "en-US" : "es-ES";
}

function interpolate(text: string, vars?: MsgVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Translate a Spanish UI text. `{name}` placeholders are filled from `vars`. */
export function t(msg: Msg, vars?: MsgVars): string {
  return interpolate(getLocale() === "en" ? en[msg] : msg, vars);
}

const EN_KEYS: Record<string, string> = { Mayús: "Shift", Supr: "Del", Inicio: "Home", Fin: "End", Retroceso: "Backspace" };

/** Keyboard shortcut as shown to the user ("Ctrl+Mayús+S" -> "Ctrl+Shift+S" in English). */
export function keyLabel(shortcut: string): string {
  return getLocale() === "en" ? shortcut.replace(/\p{L}+/gu, (key) => EN_KEYS[key] ?? key) : shortcut;
}

/** Like `t` for text only known at runtime (e.g. an error message from the MuPDF worker). */
export function tDynamic(text: string, vars?: MsgVars): string {
  return text in en ? t(text as Msg, vars) : interpolate(text, vars);
}
