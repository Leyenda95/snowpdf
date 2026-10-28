import { afterEach, describe, expect, it } from "vitest";
import { getLocale, keyLabel, t, tDynamic, useI18n } from "@/i18n";
import { en } from "@/i18n/en";
import { parsePageSelection } from "@/pdf/ranges";

afterEach(() => useI18n.getState().setLanguage("es"));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("is Spanish in Node, so engine messages stay in the source language", () => {
    useI18n.getState().setLanguage("system");
    expect(getLocale()).toBe("es");
    expect(t("Página {n} de {total}", { n: 2, total: 5 })).toBe("Página 2 de 5");
  });

  it("switches every text to English", () => {
    useI18n.getState().setLanguage("en");
    expect(t("Página {n} de {total}", { n: 2, total: 5 })).toBe("Page 2 of 5");
    expect(() => parsePageSelection("7", 3)).toThrow("Page 7 doesn't exist (the document has 3).");
  });

  it("leaves placeholders without a value untouched (page number templates)", () => {
    useI18n.getState().setLanguage("en");
    expect(t("Página {n}")).toBe("Page {n}");
  });

  it("translates runtime text only when it is in the dictionary", () => {
    useI18n.getState().setLanguage("en");
    expect(tDynamic("La contraseña no es correcta.")).toBe("The password is incorrect.");
    expect(tDynamic("Algo desconocido")).toBe("Algo desconocido");
  });

  it("names shortcut keys in the current language", () => {
    expect(keyLabel("Ctrl+Mayús+S")).toBe("Ctrl+Mayús+S");
    useI18n.getState().setLanguage("en");
    expect(keyLabel("Ctrl+Mayús+S")).toBe("Ctrl+Shift+S");
    expect(keyLabel("Supr")).toBe("Del");
  });

  it("keeps the same placeholders in every translation", () => {
    for (const [es, english] of Object.entries(en)) expect(placeholders(english), es).toEqual(placeholders(es));
  });
});
