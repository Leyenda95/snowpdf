import { useCallback, useState } from "react";
import { Button, Checkbox, Modal, SegmentedControl, Tabs, toast } from "@/ui";
import { DrawCanvas } from "./drawCanvas";
import { DEFAULT_INK } from "./InkPicker";
import { ImageSignature } from "./imageSignature";
import { SavedStrip } from "./SavedStrip";
import {
  addSavedSignature,
  bytesToDataUrl,
  dataUrlToBytes,
  loadSavedSignatures,
  removeSavedSignature,
  type SavedSignature,
} from "./storage";
import { trimToSignature } from "./trim";
import { TypeSignature } from "./typeSignature";
import type { SignatureKind, SignatureResult, SignatureSource } from "./types";
import { t, type Msg } from "@/i18n";

export type { SignatureResult } from "./types";

type Mode = "dibujar" | "escribir" | "imagen";

export interface SignatureDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sig: SignatureResult) => void;
  initialKind?: SignatureKind;
}

const KIND_OPTIONS = [
  { value: "firma", label: "Firma" },
  { value: "iniciales", label: "Iniciales" },
] as const satisfies readonly { value: SignatureKind; label: Msg }[];

const MODE_TABS = [
  { value: "dibujar", label: "Dibujar" },
  { value: "escribir", label: "Escribir" },
  { value: "imagen", label: "Imagen" },
] as const satisfies readonly { value: Mode; label: Msg }[];

export function SignatureDialog({ open, onClose, onSelect, initialKind = "firma" }: SignatureDialogProps) {
  // Mount the content only while open so every opening starts from a clean slate.
  if (!open) return <></>;
  return <SignatureDialogContent onClose={onClose} onSelect={onSelect} initialKind={initialKind} />;
}

function SignatureDialogContent({ onClose, onSelect, initialKind }: Omit<SignatureDialogProps, "open"> & { initialKind: SignatureKind }) {
  const [kind, setKind] = useState<SignatureKind>(initialKind);
  const [mode, setMode] = useState<Mode>("dibujar");
  const [ink, setInk] = useState<string>(DEFAULT_INK);
  const [saveForLater, setSaveForLater] = useState(true);
  const [saved, setSaved] = useState<SavedSignature[]>(loadSavedSignatures);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Record<Mode, SignatureSource | null>>({
    dibujar: null,
    escribir: null,
    imagen: null,
  });

  // Stable per-mode callbacks (children publish from effects).
  const setDrawSource = useCallback((s: SignatureSource | null) => setSources((p) => ({ ...p, dibujar: s })), []);
  const setTypeSource = useCallback((s: SignatureSource | null) => setSources((p) => ({ ...p, escribir: s })), []);
  const setImageSource = useCallback((s: SignatureSource | null) => setSources((p) => ({ ...p, imagen: s })), []);

  const activeSource = sources[mode];

  const pickSaved = (item: SavedSignature) => {
    try {
      onSelect({ bytes: dataUrlToBytes(item.dataUrl), width: item.width, height: item.height });
      onClose();
    } catch {
      toast.error(t("No se pudo cargar la firma guardada."));
    }
  };

  const removeSaved = (item: SavedSignature) => setSaved(removeSavedSignature(item.id));

  const use = async () => {
    if (!activeSource || busy) return;
    setBusy(true);
    try {
      const result = await trimToSignature(await activeSource());
      if (!result) {
        toast.error(kind === "firma" ? t("No hay nada que usar todavía: crea tu firma primero.") : t("No hay nada que usar todavía: crea tus iniciales primero."));
        return;
      }
      if (saveForLater) {
        const next = addSavedSignature({ kind, dataUrl: bytesToDataUrl(result.bytes), width: result.width, height: result.height });
        if (next) setSaved(next);
        else toast.warning(t("No se pudo guardar para la próxima vez, pero se usará igualmente."));
      }
      onSelect(result);
      onClose();
    } catch {
      toast.error(kind === "firma" ? t("No se pudo crear la firma. Inténtalo de nuevo.") : t("No se pudieron crear las iniciales. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t("Añadir firma")}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <Checkbox checked={saveForLater} onChange={setSaveForLater} label={t("Guardar para la próxima vez")} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("Cancelar")}
            </Button>
            <Button variant="primary" disabled={!activeSource} loading={busy} onClick={use}>
              {kind === "firma" ? t("Usar firma") : t("Usar iniciales")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl value={kind} onChange={setKind} options={KIND_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} label={t("Tipo")} />
        <SavedStrip items={saved} onPick={pickSaved} onRemove={removeSaved} />
        <Tabs value={mode} onChange={setMode} tabs={MODE_TABS.map((o) => ({ ...o, label: t(o.label) }))} />
        {/* All panels stay mounted so switching tabs never loses work. */}
        <div hidden={mode !== "dibujar"}>
          <DrawCanvas kind={kind} color={ink} onColorChange={setInk} onSourceChange={setDrawSource} />
        </div>
        <div hidden={mode !== "escribir"}>
          <TypeSignature kind={kind} color={ink} onColorChange={setInk} onSourceChange={setTypeSource} />
        </div>
        <div hidden={mode !== "imagen"}>
          <ImageSignature onSourceChange={setImageSource} />
        </div>
      </div>
    </Modal>
  );
}
