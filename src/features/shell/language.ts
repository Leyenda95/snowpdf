import { useEffect, useLayoutEffect } from "react";
import { useI18n, type Locale } from "@/i18n";

/**
 * Keeps <html lang> in step with the UI language and, with "system", follows the OS language
 * live. Returns the language in use: key the app content on it so every text is re-rendered
 * (module-level and memoised texts included). Mount once, at the top of <App />.
 */
export function useLanguageEffect(): Locale {
  const language = useI18n((s) => s.language);
  const locale = useI18n((s) => s.locale);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (language !== "system") return;
    const refresh = () => useI18n.getState().refreshSystem();
    window.addEventListener("languagechange", refresh);
    return () => window.removeEventListener("languagechange", refresh);
  }, [language]);

  return locale;
}
