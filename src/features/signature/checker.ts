import type { CSSProperties } from "react";

/** Light checkerboard that makes transparency visible (kept light in dark mode on purpose: ink is dark). */
export const CHECKER_STYLE: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage: "conic-gradient(#e2e8f0 25%, #ffffff 0 50%, #e2e8f0 0 75%, #ffffff 0)",
  backgroundSize: "14px 14px",
};
