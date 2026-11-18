import { useLayoutEffect, useRef, useState } from "react";
import { BRAND_MARK_ARM, cn } from "@/ui";

/** Text drawn at 100 units; the viewBox is fitted to it after layout. */
const FONT_SIZE = 100;
const FONT_FAMILY = '"Bricolage Grotesque Variable", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const FONT_WEIGHT = 800;
/** Tight tracking, as a heavy display face wants. */
const TRACKING = -0.04 * FONT_SIZE;
/** Bricolage Grotesque cap height (the name has no descenders). */
const CAP_HEIGHT = 0.66 * FONT_SIZE;
/** Room for the round letters, which overshoot the cap height and the baseline a little. */
const PAD = 2;
/** The asterisk sits like a footnote sign: after the name, hanging from the cap height. */
const MARK_SIZE = 0.42 * FONT_SIZE;
const MARK_GAP = 0.03 * FONT_SIZE;
/** Advance of "SnowPDF" in the display face, until the real text has been measured. */
const DEFAULT_WIDTH = 3.93 * FONT_SIZE;

export interface WordmarkProps {
  /** Set the height (e.g. `h-16`): it is the cap height of the letters. The width follows. */
  className?: string;
}

/** "SnowPDF" logotype: the name in ink followed by the vermilion asterisk. */
export function Wordmark({ className }: WordmarkProps) {
  const textRef = useRef<SVGTextElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useLayoutEffect(() => {
    let alive = true;
    const fit = () => {
      const length = textRef.current?.getComputedTextLength();
      if (alive && length && length > 0) setWidth(length);
    };
    fit();
    // The display face may still be loading on first paint (the fallback is wider).
    void document.fonts?.load(`${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`, "SnowPDF").then(fit, fit);
    return () => {
      alive = false;
    };
  }, []);

  const markX = width + MARK_GAP;
  // The arms are drawn around (60, 60) and reach 44 units from it: bring that box to MARK_SIZE.
  const markScale = MARK_SIZE / 88;

  return (
    <svg
      role="img"
      aria-label="SnowPDF"
      viewBox={`0 ${-CAP_HEIGHT - PAD} ${markX + MARK_SIZE} ${CAP_HEIGHT + 2 * PAD}`}
      className={cn("block w-auto overflow-visible", className)}
    >
      <text ref={textRef} x="0" y="0" fontFamily={FONT_FAMILY} fontSize={FONT_SIZE} fontWeight={FONT_WEIGHT} letterSpacing={TRACKING} className="fill-fg">
        SnowPDF
      </text>
      <g transform={`translate(${markX} ${-CAP_HEIGHT}) scale(${markScale}) translate(-16 -16)`} className="fill-brand-500">
        <polygon points={BRAND_MARK_ARM} />
        <polygon points={BRAND_MARK_ARM} transform="rotate(60 60 60)" />
        <polygon points={BRAND_MARK_ARM} transform="rotate(120 60 60)" />
      </g>
    </svg>
  );
}
