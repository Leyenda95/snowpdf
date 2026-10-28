import { intlLocale, t } from "@/i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Relative time: "ahora mismo", "hace 5 min", "hace 2 h", "ayer", or a short date. */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 45_000) return t("ahora mismo");
  if (elapsed < HOUR) return t("hace {n} min", { n: Math.max(1, Math.floor(elapsed / MINUTE)) });
  if (elapsed < DAY) return t("hace {n} h", { n: Math.floor(elapsed / HOUR) });

  const calendarDays = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY);
  if (calendarDays === 1) return t("ayer");

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(intlLocale(), { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
