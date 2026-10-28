import type { ReactNode } from "react";
import { Monitor, Moon, Settings, Sun, type LucideIcon } from "lucide-react";
import { openSettings } from "@/features/settings/SettingsPage";
import { useAppStore, type ThemeSetting } from "@/model/appStore";
import { IconButton, Menu, type MenuEntry } from "@/ui";
import { TabBar } from "./TabBar";
import { Wordmark } from "./Wordmark";
import { t, type Msg } from "@/i18n";

const THEMES: { value: ThemeSetting; label: Msg; icon: LucideIcon }[] = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
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
      className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pl-1 pr-2.5 outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <img src="/snowpdf.svg" alt="" aria-hidden className="size-8 shrink-0 drop-shadow-sm" draggable={false} />
      <Wordmark className="h-[15px]" />
    </button>
  );
}

export interface AppHeaderProps {
  /** Middle area (document title, view switcher...). */
  center?: ReactNode;
  /** Actions shown before the theme menu. */
  right?: ReactNode;
}

export function AppHeader({ center, right }: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <Logo />
      <div className="flex min-w-0 flex-1 items-center gap-2">{center ?? <TabBar />}</div>
      <div className="flex shrink-0 items-center gap-1">
        {right}
        <ThemeMenu />
        <IconButton icon={Settings} label={t("Preferencias")} shortcut="Ctrl+," onClick={openSettings} />
      </div>
    </header>
  );
}
