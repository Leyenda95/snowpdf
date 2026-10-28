import type { Msg } from "@/i18n";
import { getFont, putFont } from "@/model/registry";
import type { FontAsset } from "@/model/types";
import { platform } from "@/platform";
import { parseFontProgram } from "@/pdf/fontProgram";

/**
 * Fonts installed on this computer (desktop), grouped by family with their weights, so text
 * can use Light, Semibold, Black... and not only the regular/bold of the PDF standard fonts.
 * Files are read and registered only when a face is actually chosen.
 */

export interface SystemFace {
  path: string;
  /** Registry name without the "(TrueType)" suffix, e.g. "Segoe UI Semibold Italic". */
  name: string;
  weight: number;
  italic: boolean;
}

export interface SystemFamily {
  family: string;
  faces: SystemFace[];
}

/** Style words at the end of a face name, with the weight they mean (null = not a weight). */
const STYLE_WORDS: [RegExp, number | null][] = [
  [/^(thin|hairline)$/i, 100],
  [/^(extralight|ultralight|extra light|ultra light)$/i, 200],
  [/^light$/i, 300],
  [/^semilight$/i, 350],
  [/^(regular|normal|book|roman)$/i, 400],
  [/^medium$/i, 500],
  [/^(semibold|demibold|semi bold|demi bold|demi)$/i, 600],
  [/^bold$/i, 700],
  [/^(extrabold|ultrabold|extra bold|ultra bold)$/i, 800],
  [/^(black|heavy)$/i, 900],
  [/^(italic|oblique)$/i, null],
];

/** Weight names shown in the UI (Spanish source: translate with `t()`). */
export const WEIGHT_LABELS: Record<number, Msg> = {
  100: "Fina",
  200: "Extrafina",
  300: "Ligera",
  350: "Semiligera",
  400: "Normal",
  500: "Media",
  600: "Seminegrita",
  700: "Negrita",
  800: "Extranegrita",
  900: "Black",
};

/** "Segoe UI Semibold Italic" -> family "Segoe UI", weight 600, italic. */
export function parseFaceName(name: string): { family: string; weight: number; italic: boolean } {
  const words = name.split(/\s+/);
  let weight = 400;
  let italic = false;
  // Peel style words off the end; two-word styles ("Extra Bold") are tried first.
  while (words.length > 1) {
    const two = words.length > 2 ? `${words[words.length - 2]} ${words[words.length - 1]}` : null;
    const matchTwo = two ? STYLE_WORDS.find(([re]) => re.test(two)) : undefined;
    const match = matchTwo ?? STYLE_WORDS.find(([re]) => re.test(words[words.length - 1]));
    if (!match) break;
    words.splice(matchTwo ? -2 : -1);
    if (match[1] === null) italic = true;
    else weight = match[1];
  }
  return { family: words.join(" "), weight, italic };
}

let families: Promise<SystemFamily[]> | null = null;

/** Installed families with at least one plain TrueType/OpenType face, sorted by name. */
export function listSystemFamilies(): Promise<SystemFamily[]> {
  families ??= platform.listSystemFonts().then((fonts) => {
    const byFamily = new Map<string, SystemFace[]>();
    for (const f of fonts) {
      // Collections (.ttc) hold several faces per file: skipped to keep embedding simple.
      if (!/\.(ttf|otf)$/i.test(f.path)) continue;
      const name = f.name.replace(/\s*\((TrueType|OpenType)\)\s*$/i, "").trim();
      if (!name || name.includes("&")) continue;
      const { family, weight, italic } = parseFaceName(name);
      const faces = byFamily.get(family) ?? [];
      if (!faces.some((x) => x.weight === weight && x.italic === italic)) faces.push({ path: f.path, name, weight, italic });
      byFamily.set(family, faces);
    }
    return [...byFamily]
      .map(([family, faces]) => ({ family, faces: faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)) }))
      .sort((a, b) => a.family.localeCompare(b.family, "es"));
  });
  return families;
}

export async function findSystemFamily(family: string): Promise<SystemFamily | null> {
  const want = family.toLowerCase().replace(/\s+/g, "");
  return (await listSystemFamilies()).find((f) => f.family.toLowerCase().replace(/\s+/g, "") === want) ?? null;
}

/** Face of `family` closest to the requested weight, preferring the requested slant. */
export function closestFace(family: SystemFamily, weight: number, italic: boolean): SystemFace {
  const score = (f: SystemFace) => Math.abs(f.weight - weight) + (f.italic === italic ? 0 : 1000);
  return [...family.faces].sort((a, b) => score(a) - score(b))[0];
}

const loaded = new Map<string, Promise<FontAsset>>();

/** Read, parse and register a system face (once per file while the font stays registered). */
export function loadSystemFace(family: string, face: SystemFace): Promise<FontAsset> {
  const hit = loaded.get(face.path);
  if (hit) {
    return hit.then((asset) => (getFont(asset.id) ? asset : (loaded.delete(face.path), loadSystemFace(family, face))));
  }
  const pending = (async () => {
    const { bytes } = await platform.readFile(face.path);
    const program = await parseFontProgram(bytes);
    const name = face.name.replace(/\s+/g, "");
    const weight = program.weight ?? face.weight;
    return putFont({ name, family, bytes, weight, bold: weight >= 600, italic: face.italic, origin: "system" }, program);
  })();
  pending.catch(() => loaded.delete(face.path));
  loaded.set(face.path, pending);
  return pending;
}
