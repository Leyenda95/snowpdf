import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useDocStore } from "@/model/docStore";
import { cn } from "@/ui";
import { useEditorStore } from "./editorStore";
import { t } from "@/i18n";

/** Floating page indicator; tapping it opens the page list. It only shows while the document moves (and briefly on open or when the bars toggle), so it never covers text for long. */
function PagePill() {
  const current = useEditorStore((s) => s.currentPage);
  const immersive = useEditorStore((s) => s.immersive);
  const scroll = useEditorStore((s) => s.scroll);
  const total = useDocStore((s) => s.doc.pages.length);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    setScrolling(true);
    const timer = setTimeout(() => setScrolling(false), 1500);
    return () => clearTimeout(timer);
  }, [scroll.top, current, immersive]);

  const shown = scrolling;
  return (
    <button
      type="button"
      aria-label={t("Página {n} de {total}", { n: current + 1, total })}
      tabIndex={shown ? 0 : -1}
      onClick={() => useEditorStore.getState().setThumbnails(true)}
      className={cn(
        "absolute left-1/2 z-10 -translate-x-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 bg-surface/90 px-3 py-1 text-xs font-medium tabular-nums text-fg shadow-pop backdrop-blur",
        "transition-[top,opacity] duration-200 motion-reduce:transition-none",
        immersive ? "top-[calc(env(safe-area-inset-top)+8px)]" : "top-[calc(3rem+6px)] [@media(max-height:480px)]:top-[calc(2.5rem+6px)]",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {current + 1} / {total}
    </button>
  );
}

/** Phone-only controls floating over the viewer: page pill, placing hint and the properties button. */
export function PhoneViewerOverlays() {
  const tool = useEditorStore((s) => s.tool);
  const placing = useEditorStore((s) => s.placing);
  const immersive = useEditorStore((s) => s.immersive);
  const showProps = useEditorStore((s) => s.showProps);
  const hasSelection = useEditorStore((s) => s.selection.length > 0);
  const showPropsButton = !immersive && (hasSelection || (tool !== "select" && tool !== "hand"));

  return (
    <>
      <PagePill />
      {placing && (
        <div className="pointer-events-none absolute left-1/2 top-[calc(3rem+44px)] [@media(max-height:480px)]:top-[calc(2.5rem+40px)] z-10 max-w-[90%] -translate-x-1/2 truncate rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary shadow-pop">
          {t("Toca la página para colocar")}
        </div>
      )}
      {showPropsButton && (
        <button
          type="button"
          aria-label={t("Propiedades")}
          aria-pressed={showProps}
          onClick={() => useEditorStore.getState().toggleProps()}
          className={cn(
            "absolute right-3 bottom-[calc(3.5rem+12px+env(safe-area-inset-bottom))] [@media(max-height:480px)]:bottom-[calc(3rem+12px+env(safe-area-inset-bottom))] z-10 grid size-12 place-items-center rounded-full border shadow-pop",
            showProps
              ? "border-brand-500 bg-fg text-surface"
              : "border-line bg-surface text-fg",
          )}
        >
          <SlidersHorizontal size={22} aria-hidden />
        </button>
      )}
    </>
  );
}
