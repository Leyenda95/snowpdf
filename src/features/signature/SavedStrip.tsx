import { X } from "lucide-react";
import { IconButton } from "@/ui";
import { CHECKER_STYLE } from "./checker";
import type { SavedSignature } from "./storage";
import { t } from "@/i18n";

export interface SavedStripProps {
  items: SavedSignature[];
  onPick: (item: SavedSignature) => void;
  onRemove: (item: SavedSignature) => void;
}

/** Row of previously saved signatures. Click selects, the small X (on hover / focus) deletes. */
export function SavedStrip({ items, onPick, onRemove }: SavedStripProps) {
  if (items.length === 0) return null;
  return (
    <section aria-label={t("Guardadas")} className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Guardadas")}</h3>
      <ul className="flex gap-2.5 overflow-x-auto pb-1">
        {[...items].reverse().map((item) => {
          const label = item.kind === "firma" ? t("Firma guardada") : t("Iniciales guardadas");
          return (
            <li key={item.id} className="group relative shrink-0">
              <button
                type="button"
                title={t("{label}: usar", { label })}
                aria-label={t("{label}: usar", { label })}
                onClick={() => onPick(item)}
                className="grid h-16 w-32 place-items-center overflow-hidden rounded-lg border border-line-strong p-1.5 outline-none transition-colors hover:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/60"
                style={CHECKER_STYLE}
              >
                <img src={item.dataUrl} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
              </button>
              <IconButton
                icon={X}
                label={t("Eliminar")}
                size="sm"
                variant="subtle"
                tooltipSide="top"
                onClick={() => onRemove(item)}
                className="absolute -right-1.5 -top-1.5 size-5 opacity-0 shadow transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [&>svg]:size-3"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
