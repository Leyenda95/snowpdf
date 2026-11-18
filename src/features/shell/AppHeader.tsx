import type { ReactNode } from "react";
import { Settings, type LucideIcon } from "lucide-react";
import { openSettings } from "@/features/settings/SettingsPage";
import { useAppStore, type ThemeSetting } from "@/model/appStore";
import { IconButton, Menu, ThemeDarkIcon, ThemeLightIcon, ThemeSystemIcon, cn, useIsMobile, type MenuEntry } from "@/ui";
import { TabBar } from "./TabBar";
import { Wordmark } from "./Wordmark";
import { t, type Msg } from "@/i18n";

const THEMES: { value: ThemeSetting; label: Msg; icon: LucideIcon }[] = [
  { value: "system", label: "Sistema", icon: ThemeSystemIcon },
  { value: "light", label: "Claro", icon: ThemeLightIcon },
  { value: "dark", label: "Oscuro", icon: ThemeDarkIcon },
];

function ThemeMenu() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const current = THEMES.find((th) => th.value === theme) ?? THEMES[0];

  const items: MenuEntry[] = [
    { type: "label", label: t("Tema") },
    ...THEMES.map((th) => ({
      id: th.value,
      label: t(th.label),
      icon: th.icon,
      checked: th.value === theme,
      onSelect: () => setTheme(th.value),
    })),
  ];

  return <Menu align="end" items={items} trigger={<IconButton icon={current.icon} label={t("Tema: {theme}", { theme: t(current.label) })} />} />;
}

function Logo() {
  return (
    <button
      type="button"
      aria-label={t("SnowPDF, ir al inicio")}
      onClick={() => useAppStore.getState().navigate({ name: "home" })}
      className="flex h-9 shrink-0 items-center rounded-lg px-2 outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <Wordmark className="h-4 md:h-[15px]" />
    </button>
  );
}

export interface AppHeaderProps {
  /** Middle area (document title, view switcher...). */
  center?: ReactNode;
  /** Actions shown before the theme menu. */
  right?: ReactNode;
  /** Phone, inside a document: shown at the start instead of the logo (e.g. a back button). */
  phoneLeading?: ReactNode;
  /** Phone: the page moved Preferencias into its own overflow menu. */
  phoneHideSettings?: boolean;
}

export function AppHeader({ center, right, phoneLeading, phoneHideSettings = false }: AppHeaderProps) {
  const mobile = useIsMobile();
  // On phones the logo gives way to the document switcher while a document is open (home lives in its sheet).
  const inDocument = useAppStore((state) => state.view.name === "editor" || state.view.name === "organize");
  // Phone: no "Preferencias" button while already in them.
  const inSettings = useAppStore((state) => state.view.name === "settings");
  return (
    <header
      className={cn(
        "flex h-12 max-md:[@media(max-height:480px)]:h-10 shrink-0 items-center gap-1 border-b border-rule bg-surface px-2 md:gap-3 md:px-3",
        // Phone outside a document: an app bar that blends with the page (no window-like border).
        !inDocument && "max-md:h-14 max-md:border-transparent max-md:bg-app max-md:px-3",
      )}
    >
      {mobile && inDocument ? phoneLeading : <Logo />}
      <div className="flex min-w-0 flex-1 items-center gap-2">{center ?? <TabBar />}</div>
      <div className="flex shrink-0 items-center gap-1">
        {right}
        <div className="hidden md:flex">
          <ThemeMenu />
        </div>
        {!(mobile && (phoneHideSettings || inSettings)) && <IconButton icon={Settings} label={t("Preferencias")} shortcut="Ctrl+," onClick={openSettings} />}
      </div>
    </header>
  );
}
