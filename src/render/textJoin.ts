export interface SelectedLine {
  text: string;
  /** Reading-frame geometry in CSS px: inline axis = reading direction, block axis = line progression. */
  inlineStart: number;
  inlineEnd: number;
  blockStart: number;
  blockEnd: number;
  /** Lines from different pages/text layers get different group ids. */
  group: number;
}

const HYPHEN_END = /\p{L}[-\u00AD\u2010]$/u;
const SENTENCE_END = /[.:!?…]["”»'’)\]]*$/;
const LOWER_START = /^\p{Ll}/u;

/** Joins the lines of a text selection so wrapped paragraphs copy as continuous text. */
export function joinSelectedLines(lines: SelectedLine[]): string {
  const kept = lines.filter((l) => l.text.trim() !== "");
  if (kept.length === 0) return "";

  const maxEnd = new Map<number, number>();
  for (const l of kept) maxEnd.set(l.group, Math.max(maxEnd.get(l.group) ?? -Infinity, l.inlineEnd));

  let out = kept[0].text.trimStart();
  for (let i = 0; i < kept.length - 1; i++) {
    const cur = kept[i];
    const next = kept[i + 1];
    const curText = cur.text.trimEnd();
    const nextText = next.text.trimStart();
    out = out.trimEnd();

    const hyphenated = HYPHEN_END.test(curText);
    if (hyphenated && LOWER_START.test(nextText)) {
      out = out.slice(0, -1) + nextText;
      continue;
    }

    const h = cur.blockEnd - cur.blockStart;
    const hNext = next.blockEnd - next.blockStart;
    let paragraph = false;
    if (h > 0) {
      if (cur.group === next.group && next.blockStart - cur.blockEnd > 0.7 * h) paragraph = true;
      if (hNext > 0 && Math.max(h, hNext) / Math.min(h, hNext) > 1.3) paragraph = true;
      if (SENTENCE_END.test(curText) && (maxEnd.get(cur.group) ?? cur.inlineEnd) - cur.inlineEnd > 2 * h) paragraph = true;
    }

    out += (paragraph ? "\n" : hyphenated ? "" : " ") + nextText;
  }
  return out.trimEnd().replace(/\u00AD/g, "");
}
