import { useState } from "react";
import { Save } from "lucide-react";
import type { CompressLevel } from "@/pdf/mupdf/ops";
import { ALL_PERMISSIONS, type Permissions } from "@/pdf/protect";
import { Button, Checkbox, Modal, SegmentedControl, Switch, TextField } from "@/ui";
import { usePrefs } from "@/model/prefs";
import { useExportPrefs } from "./exportPrefs";
import { saveWorkspace } from "./save";
import { t } from "@/i18n";

/** "Guardar como…" with Acrobat-style options: flatten, compress and password protection. */
export function SaveDialog({ open, onClose, hasForm }: { open: boolean; onClose: () => void; hasForm: boolean }) {
  const flatten = useExportPrefs((p) => p.flattenForms);
  const [compress, setCompress] = useState<CompressLevel | "none">(() => usePrefs.getState().compress);
  const [protect, setProtect] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [owner, setOwner] = useState("");
  const [perms, setPerms] = useState<Permissions>(ALL_PERMISSIONS);
  const [saving, setSaving] = useState(false);

  const pwError = protect && pw !== pw2 ? t("Las contraseñas no coinciden") : protect && !pw && !owner ? t("Escribe una contraseña") : null;

  const save = async () => {
    setSaving(true);
    const ok = await saveWorkspace(
      {
        flattenForms: flatten,
        compress: compress === "none" ? null : compress,
        protect: protect ? { userPassword: pw, ownerPassword: owner || undefined, permissions: perms } : null,
      },
      true,
    );
    setSaving(false);
    if (ok) onClose();
  };

  const perm = (key: keyof Permissions, label: string) => (
    <Checkbox label={label} checked={perms[key] !== false && perms[key] !== "none"} onChange={(v) => setPerms({ ...perms, [key]: key === "printing" ? (v ? "high" : "none") : v })} />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Guardar como")}
      description={t("Elige cómo quieres el PDF final. Todo se procesa en tu equipo.")}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancelar")}</Button>
          <Button variant="primary" icon={Save} loading={saving} disabled={!!pwError} onClick={save}>
            {t("Guardar…")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {hasForm && (
          <Switch
            label={t("Aplanar formulario")}
            description={t("Los campos rellenados pasan a ser texto fijo.")}
            checked={flatten}
            onChange={(v) => useExportPrefs.getState().set({ flattenForms: v })}
          />
        )}
        <SegmentedControl<CompressLevel | "none">
          label={t("Comprimir")}
          fullWidth
          value={compress}
          onChange={setCompress}
          options={[
            { value: "none", label: t("No") },
            { value: "low", label: t("Poco") },
            { value: "medium", label: t("Recomendado") },
            { value: "high", label: t("Máximo") },
          ]}
        />
        <div className="space-y-3">
          <Switch label={t("Proteger con contraseña")} description={t("Cifrado AES de 256 bits.")} checked={protect} onChange={setProtect} />
          {protect && (
            <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField label={t("Contraseña para abrir")} type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <TextField label={t("Repetir")} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw && pw !== pw2 ? t("No coincide") : undefined} />
              </div>
              <TextField
                label={t("Contraseña de permisos (opcional)")}
                type="password"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                hint={t("Necesaria para cambiar las restricciones de abajo.")}
              />
              <div className="grid grid-cols-2 gap-2">
                {perm("printing", t("Imprimir"))}
                {perm("copying", t("Copiar texto"))}
                {perm("modifying", t("Modificar"))}
                {perm("annotating", t("Comentar"))}
                {perm("fillingForms", t("Rellenar formularios"))}
                {perm("assembling", t("Organizar páginas"))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
