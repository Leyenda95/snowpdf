import { createLucideIcon, type LucideIcon } from "lucide-react";

/**
 * SnowPDF's own icons for the theme setting, drawn on lucide's 24 px grid so they fit wherever
 * a `LucideIcon` goes. They share one idea: ink is darkness. Light is hollow, dark is solid
 * and "system" is a screen inked halfway. The shapes come from the mark: bars with pointed
 * ends set 60° apart.
 */

const SOLID = { fill: "currentColor", stroke: "none" } as const;

/** One ray of the sun, pointing up from the centre (12, 12): the arm of the mark, small. */
const RAY = "12,1 13,1.58 13,5.22 12,5.8 11,5.22 11,1.58";
/** One arm of the small asterisk next to the moon, centred on (17.6, 6.4). */
const STAR_ARM = "17.6,2.5 18.55,3.05 18.55,9.75 17.6,10.3 16.65,9.75 16.65,3.05";

/** Light theme: a six-sided crystal with six rays (a sun built like the snowflake). */
export const ThemeLightIcon: LucideIcon = createLucideIcon("theme-light", [
  ["polygon", { points: "15.7,12 13.85,8.8 10.15,8.8 8.3,12 10.15,15.2 13.85,15.2", key: "core" }],
  ...[0, 60, 120, 180, 240, 300].map(
    (angle) => ["polygon", { points: RAY, transform: `rotate(${angle} 12 12)`, ...SOLID, key: `ray${angle}` }] as [string, Record<string, string>],
  ),
]);

/** Dark theme: an inked moon (a disc of radius 8.5 minus one of 7.4) with the asterisk as its star. */
export const ThemeDarkIcon: LucideIcon = createLucideIcon("theme-dark", [
  ["path", { d: "M18.82 15.26A8.5 8.5 0 1 1 8.74 5.18A7.4 7.4 0 0 0 18.82 15.26Z", ...SOLID, key: "moon" }],
  ...[0, 60, 120].map(
    (angle) => ["polygon", { points: STAR_ARM, transform: `rotate(${angle} 17.6 6.4)`, ...SOLID, key: `arm${angle}` }] as [string, Record<string, string>],
  ),
]);

/** Theme that follows the device: a screen inked on one side of a 60° line. */
export const ThemeSystemIcon: LucideIcon = createLucideIcon("theme-system", [
  ["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2", key: "screen" }],
  ["path", { d: "M8 21h8M12 17v4", key: "stand" }],
  ["path", { d: "M16.04 3H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7.96Z", ...SOLID, key: "ink" }],
]);
