import { usePrefs } from "@/model/prefs";
import { getSource } from "@/model/registry";
import type { PageRef } from "@/model/types";
import { fontStyleFlags, familyName, pdfjsFont, resolveSourceFont } from "@/render/sourceFonts";
import { closestFace, findSystemFamily, loadSystemFace } from "@/render/systemFonts";
import { getTextRuns, groupLines, type TextRun } from "@/render/textContent";
import type { ToolStyles } from "./editorStore";
import { guessFont } from "./overlay/editText";

/**
 * Each opened document starts its new texts from its own typography: the font and size of
 * its body text (the font covering most characters on the first pages). The same family
 * installed on this computer is preferred, since a document font usually lacks letters.
 */

/** Enough pages to find the body text without reading a whole book. */
const SAMPLE_PAGES = 3;
/** pdf.js sends fonts when the page renders, shortly after the document opens. */
const FONT_WAIT_MS = 8000;

export async function documentTextStyle(pages: PageRef[]): Promise<Partial<ToolStyles["text"]> | null> {
  const sample = pages.filter((p) => p.sourceId).slice(0, SAMPLE_PAGES);
  const runs: { run: TextRun; page: PageRef }[] = [];
  for (const page of sample) {
    try {
      for (const run of await getTextRuns(page.sourceId!, page.sourceIndex)) runs.push({ run, page });
    } catch {
      // Unreadable page: skip it.
    }
  }
  if (!runs.length) return null;

  // Body text = the font with the most characters; its typical size is the size of new texts.
  const chars = new Map<string, number>();
  for (const { run } of runs) chars.set(run.fontName, (chars.get(run.fontName) ?? 0) + run.str.replace(/\s/g, "").length);
  const fontName = [...chars].sort((a, b) => b[1] - a[1])[0][0];
  const body = runs.filter((r) => r.run.fontName === fontName);
  const sizes = body.flatMap(({ run }) => Array<number>(Math.max(1, run.str.length)).fill(run.size)).sort((a, b) => a - b);
  const size = Math.min(400, Math.max(4, Math.round(sizes[Math.floor(sizes.length / 2)] * 2) / 2));

  // The longest line in that font is the sample the font checks run on.
  const { page } = body[0];
  const line = groupLines(body.filter((r) => r.page === page).map((r) => r.run)).sort((a, b) => b.text.length - a.text.length)[0];
  const style: Partial<ToolStyles["text"]> = { size, systemFamily: null, systemFont: null };
  if (!line) return style;

  const font = await pdfjsFont(await getSource(page.sourceId!).pdf.getPage(page.sourceIndex + 1), fontName, FONT_WAIT_MS).catch(() => null);
  style.font = guessFont(line, font).font;
  if (!font || !usePrefs.getState().useSourceFont) return style;

  const name = fontStyleFlags(font).name;
  const installed = name ? await findSystemFamily(familyName(name)) : null;
  if (installed) {
    const asset = await loadSystemFace(installed.family, closestFace(installed, 400, false)).catch(() => null);
    if (asset) return { ...style, systemFamily: installed.family, systemFont: asset.id };
  }
  const asset = await resolveSourceFont(page.sourceId!, line, font);
  return asset ? { ...style, systemFamily: asset.family, systemFont: asset.id } : style;
}
