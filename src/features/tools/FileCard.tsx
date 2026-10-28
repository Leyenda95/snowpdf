import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { FileText, GripVertical, Lock, X } from "lucide-react";
import { Badge, IconButton, cn } from "@/ui";
import type { CardExtras, ToolFile } from "./types";
import { formatSize, pluralize } from "./utils";
import { t } from "@/i18n";

export type CardSize = "md" | "lg";

/** Pixel box available for the thumbnail of each card size. */
const BOX: Record<CardSize, { width: number; height: number }> = {
  md: { width: 172, height: 208 },
  lg: { width: 264, height: 340 },
};

export interface FileCardProps {
  file: ToolFile;
  /** 1-based position shown in the corner (omit for single-file tools). */
  index?: number;
  size: CardSize;
  extras?: CardExtras;
  draggable?: boolean;
  dragging?: boolean;
  disabled?: boolean;
  onRemove: () => void;
  rootRef?: Ref<HTMLDivElement>;
  rootStyle?: CSSProperties;
  rootProps?: HTMLAttributes<HTMLDivElement>;
}

/** Thumbnail, optionally turned by `rotation` degrees, with the preview overlay of the tool on top. */
function Thumb({ file, size, extras }: { file: ToolFile; size: CardSize; extras?: CardExtras }) {
  const box = BOX[size];
  const rotation = (((extras?.rotation ?? 0) % 360) + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const page = file.pageSize ?? { width: 595, height: 842 };
  const ratio = turned ? page.height / page.width : page.width / page.height;
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  width = Math.round(width);
  height = Math.round(height);

  if (!file.thumbUrl) {
    return (
      <div
        className="grid place-items-center rounded-md border border-line bg-surface-2 text-subtle"
        style={{ width: box.width * 0.7, height: box.height * 0.7 }}
      >
        <FileText size={size === "lg" ? 48 : 36} aria-hidden strokeWidth={1.25} />
      </div>
    );
  }

  // The image is laid out unrotated (swapped box for quarter turns) and turned around its centre.
  const imgW = turned ? height : width;
  const imgH = turned ? width : height;
  return (
    <div
      className="relative overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-black/5 transition-[width,height] duration-200"
      style={{ width, height, containerType: "inline-size" }}
    >
      <img
        src={file.thumbUrl}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none transition-transform duration-200"
        style={{
          width: imgW,
          height: imgH,
          left: (width - imgW) / 2,
          top: (height - imgH) / 2,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }}
      />
      {extras?.overlay}
    </div>
  );
}

export function FileCard({
  file,
  index,
  size,
  extras,
  draggable,
  dragging,
  disabled,
  onRemove,
  rootRef,
  rootStyle,
  rootProps,
}: FileCardProps) {
  const box = BOX[size];
  const pages = file.kind === "pdf" ? (file.pageCount === null ? null : pluralize(file.pageCount, t("página"), t("páginas"))) : null;

  return (
    <div
      ref={rootRef}
      style={{ width: box.width + 24, ...rootStyle }}
      {...rootProps}
      className={cn(
        "group relative flex flex-col items-center gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-sm transition-shadow",
        draggable && !disabled && "cursor-grab touch-none hover:border-line-strong hover:shadow-md active:cursor-grabbing",
        dragging && "z-10 opacity-40",
      )}
    >
      <div className="flex items-center justify-center rounded-lg bg-canvas" style={{ width: box.width, height: box.height }}>
        <Thumb file={file} size={size} extras={extras} />
      </div>

      {index !== undefined && (
        <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold tabular-nums text-white shadow-sm">
          {index}
        </span>
      )}
      <div className="absolute right-1.5 top-1.5" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton
          icon={X}
          label={t("Quitar archivo")}
          size="sm"
          variant="subtle"
          disabled={disabled}
          onClick={onRemove}
          className="bg-surface/90 opacity-0 shadow-sm backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>

      <div className="flex w-full min-w-0 flex-col items-center gap-1 text-center">
        <span className="flex w-full min-w-0 items-center justify-center gap-1 text-[13px] font-medium text-fg">
          {draggable && <GripVertical size={14} aria-hidden className="shrink-0 text-subtle" />}
          <span className="truncate" title={file.name}>
            {file.name}
          </span>
        </span>
        <span className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-muted">
          <span>{formatSize(file.size)}</span>
          {pages && <span aria-hidden>·</span>}
          {pages && <span>{pages}</span>}
          {file.kind === "image" && file.pageSize && (
            <>
              <span aria-hidden>·</span>
              <span>
                {file.pageSize.width} × {file.pageSize.height} px
              </span>
            </>
          )}
        </span>
        {(file.wasEncrypted || file.unreadable) && (
          <span className="mt-0.5 flex gap-1">
            {file.wasEncrypted && (
              <Badge tone="warning">
                <Lock size={11} aria-hidden /> {t("Protegido")}
              </Badge>
            )}
            {file.unreadable && <Badge tone="danger">{t("No se puede leer")}</Badge>}
          </span>
        )}
      </div>
    </div>
  );
}
