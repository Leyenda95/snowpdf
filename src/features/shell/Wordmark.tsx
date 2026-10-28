import { useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/ui/cn";

/** Text drawn at 100 units; the viewBox is fitted to it after layout. */
const FONT_SIZE = 100;
/** Same-colour stroke with round joins: heavier letters with soft corners. */
const STROKE = 7;
/** Segoe UI cap height (the name has no descenders). */
const CAP_HEIGHT = 0.71 * FONT_SIZE;
const PAD = STROKE / 2 + 2;

export interface WordmarkProps {
  /** Set the height (e.g. `h-16`); the width follows. */
  className?: string;
}

/** "SnowPDF" logotype: navy "Snow", "PDF" with the gradient of the app icon. */
export function Wordmark({ className }: WordmarkProps) {
  const gradientId = `wordmark-${useId().replace(/[^\w-]/g, "")}`;
  const textRef = useRef<SVGTextElement>(null);
  const [width, setWidth] = useState(4.2 * FONT_SIZE);

  useLayoutEffect(() => {
    let alive = true;
    const fit = () => {
      const box = textRef.current?.getBBox();
      if (alive && box && box.width > 0) setWidth(box.width);
    };
    fit();
    // The system font may still be loading on first paint.
    void document.fonts?.ready.then(fit);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <svg
      role="img"
      aria-label="SnowPDF"
      viewBox={`${-PAD} ${-CAP_HEIGHT - PAD} ${width + 2 * PAD} ${CAP_HEIGHT + 2 * PAD}`}
      className={cn("block w-auto overflow-visible", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4CB9FD" />
          <stop offset="0.55" stopColor="#2397FD" />
          <stop offset="1" stopColor="#0E7FFD" />
        </linearGradient>
      </defs>
      <text
        ref={textRef}
        x="0"
        y="0"
        fontFamily='"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
        fontSize={FONT_SIZE}
        fontWeight={700}
        letterSpacing={STROKE}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        <tspan className="fill-brand-950 stroke-brand-950 dark:fill-white dark:stroke-white">Snow</tspan>
        <tspan dx={FONT_SIZE * 0.08} fill={`url(#${gradientId})`} stroke={`url(#${gradientId})`}>
          PDF
        </tspan>
      </text>
    </svg>
  );
}
