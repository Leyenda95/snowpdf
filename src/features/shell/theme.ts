import { useLayoutEffect } from "react";
import { useAppStore } from "@/model/appStore";

/**
 * Applies the theme setting to <html>: toggles the `dark` class that the design tokens in
 * styles.css key off. With "system" it follows the OS preference live.
 * Mount once, at the top of <App />.
 */
export function useThemeEffect(): void {
  const theme = useAppStore((state) => state.theme);

  // Layout effect: the class is set before the first paint, avoiding a flash of the wrong theme.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark.matches));

    apply();
    if (theme !== "system") return;
    prefersDark.addEventListener("change", apply);
    return () => prefersDark.removeEventListener("change", apply);
  }, [theme]);
}
