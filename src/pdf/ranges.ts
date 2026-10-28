import { t } from "@/i18n";

/**
 * Page-range parsing for the human syntax used by the tools ("1-3, 5, 8-").
 *
 * Humans count pages from 1; every function in this module returns/accepts 0-based indices.
 * No React, no DOM: this runs in Node (tests) as well as in the app.
 */

/** Words that mean "every page" (case-insensitive). */
const ALL_PAGES_WORDS = new Set(["todas", "all", "*"]);

/** Unicode hyphens/dashes (U+2010..U+2015) and the minus sign (U+2212) users type or paste instead of "-". */
const DASHES = /[\u{2010}-\u{2015}\u{2212}]/gu;

function allIndices(pageCount: number): number[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, i) => i);
}

function invalidRange(token: string): RangeError {
  return new RangeError(t('Rango no válido: "{token}"', { token }));
}

/** Parse a run of ASCII digits, keeping the original text for error messages. */
function toPage(digits: string, pageCount: number): number {
  const page = Number.parseInt(digits, 10);
  if (!Number.isFinite(page) || page < 1 || page > pageCount) {
    const shown = digits.replace(/^0+(?=\d)/, "");
    throw new RangeError(t("La página {n} no existe (el documento tiene {total}).", { n: shown, total: pageCount }));
  }
  return page;
}

/** Inclusive run of 0-based indices going from page `from` to page `to` (1-based, either order). */
function run(from: number, to: number): number[] {
  const out: number[] = [];
  if (from <= to) for (let p = from; p <= to; p++) out.push(p - 1);
  else for (let p = from; p >= to; p--) out.push(p - 1);
  return out;
}

function parseToken(token: string, pageCount: number): number[] {
  if (ALL_PAGES_WORDS.has(token.toLowerCase())) return allIndices(pageCount);

  let m = /^(\d+)$/.exec(token);
  if (m) {
    const p = toPage(m[1], pageCount);
    return [p - 1];
  }
  // "5-3" (descending ranges are allowed) and "1-3"
  m = /^(\d+)-(\d+)$/.exec(token);
  if (m) return run(toPage(m[1], pageCount), toPage(m[2], pageCount));
  // "8-": from page 8 to the end
  m = /^(\d+)-$/.exec(token);
  if (m) return run(toPage(m[1], pageCount), pageCount);
  // "-3": from the first page to page 3
  m = /^-(\d+)$/.exec(token);
  if (m) return run(1, toPage(m[1], pageCount));

  throw invalidRange(token);
}

/**
 * Parse "1-3, 5, 8-" into groups of 0-based page indices, one group per range, in the
 * order written. Ranges are separated by commas, semicolons or whitespace; "8-" runs to the
 * last page, "-3" starts at the first one and "5-3" is a descending range ([4, 3, 2]).
 * The words "todas", "all" and "*" stand for every page. Empty input gives [].
 *
 * @throws RangeError (Spanish message) when a token is malformed or points to a page that
 * does not exist.
 */
export function parsePageRanges(input: string, pageCount: number): number[][] {
  // "1 - 3" and "1 -3" read as the range 1-3 rather than as separate tokens.
  const text = input.replace(DASHES, "-").replace(/\s*-\s*/g, "-").trim();
  if (text === "") return [];
  const groups: number[][] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (token === "") continue;
    groups.push(parseToken(token, pageCount));
  }
  return groups;
}

/**
 * Flattened, de-duplicated, ascending 0-based page selection. Empty input (or "todas",
 * "all", "*") selects every page.
 */
export function parsePageSelection(input: string, pageCount: number): number[] {
  const text = input.trim();
  if (text === "" || ALL_PAGES_WORDS.has(text.toLowerCase())) return allIndices(pageCount);
  const picked = new Set<number>();
  for (const group of parsePageRanges(text, pageCount)) for (const i of group) picked.add(i);
  return [...picked].sort((a, b) => a - b);
}

/** 0-based indices -> compact human text: [0, 1, 2, 4] -> "1-3, 5". */
export function formatPageSelection(indices: number[]): string {
  const sorted = [...new Set(indices.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i] + 1}-${sorted[j] + 1}` : `${sorted[i] + 1}`);
    i = j + 1;
  }
  return parts.join(", ");
}
