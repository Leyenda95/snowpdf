/** Joins the truthy class names. Tailwind-aware merging is intentionally not needed. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
