import { cn } from "./cn";

/** One arm of the mark: a bar with pointed ends, drawn three times (0°, 60°, 120°). */
export const BRAND_MARK_ARM = "51,21.2 60,16 69,21.2 69,98.8 60,104 51,98.8";
/** The arms are drawn around (60, 60); this box crops the mark tight. */
export const BRAND_MARK_VIEWBOX = "12 12 96 96";

export interface BrandMarkProps {
  /** Size and colour (e.g. `size-4 text-brand-500`); it is filled with the text colour. */
  className?: string;
}

/** SnowPDF's mark: a six-pointed asterisk (a snowflake and a footnote sign). Decorative. */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg aria-hidden viewBox={BRAND_MARK_VIEWBOX} fill="currentColor" className={cn("shrink-0", className)}>
      <polygon points={BRAND_MARK_ARM} />
      <polygon points={BRAND_MARK_ARM} transform="rotate(60 60 60)" />
      <polygon points={BRAND_MARK_ARM} transform="rotate(120 60 60)" />
    </svg>
  );
}
