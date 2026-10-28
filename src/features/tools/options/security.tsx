import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ALL_PERMISSIONS, protectPdf, type Permissions } from "@/pdf/protect";
import { Checkbox, IconButton, TextField } from "@/ui";
import type { OptionsProps, ToolModule } from "../types";
import { baseOf, pluralize, processFiles } from "../utils";
import { GroupLabel, Note, OptionStack } from "./common";
import { t } from "@/i18n";

interface ProtectToolOptions {
  password: string;
  repeat: string;
  owner: string;
  permissions: Permissions;
}

function PasswordField({
  label,
  value,
  onChange,
  disabled,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      label={label}
      type={shown ? "text" : "password"}
      value={value}
      error={error}
      hint={hint}
      disabled={disabled}
      inputClassName="[&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
      autoComplete="new-password"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      trailing={<IconButton icon={shown ? EyeOff : Eye} label={shown ? t("Ocultar contraseña") : t("Mostrar contraseña")} size="sm" onClick={() => setShown(!shown)} />}
    />
  );
}

function mismatch(o: ProtectToolOptions): boolean {
  return o.repeat !== "" && o.password !== o.repeat;
}

function ProtectOptions({ options, onChange, disabled }: OptionsProps<ProtectToolOptions>) {
  const set = (patch: Partial<ProtectToolOptions>) => onChange({ ...options, ...patch });
  const perms = options.permissions;
  const setPerm = (patch: Partial<Permissions>) => set({ permissions: { ...perms, ...patch } });
  return (
    <OptionStack>
      <PasswordField label={t("Contraseña para abrir el PDF")} value={options.password} disabled={disabled} onChange={(password) => set({ password })} />
      <PasswordField
        label={t("Repite la contraseña")}
        value={options.repeat}
        disabled={disabled}
        error={mismatch(options) ? t("Las contraseñas no coinciden.") : undefined}
        onChange={(repeat) => set({ repeat })}
      />
      <PasswordField
        label={t("Contraseña de propietario (opcional)")}
        value={options.owner}
        disabled={disabled}
        hint={t("Para cambiar los permisos. Si la dejas vacía se usa la misma.")}
        onChange={(owner) => set({ owner })}
      />
      <div className="flex flex-col gap-2.5">
        <GroupLabel>{t("Qué se permite hacer")}</GroupLabel>
        <Checkbox label={t("Imprimir")} checked={perms.printing !== "none"} disabled={disabled} onChange={(v) => setPerm({ printing: v ? "high" : "none" })} />
        <Checkbox label={t("Copiar texto")} checked={perms.copying} disabled={disabled} onChange={(copying) => setPerm({ copying })} />
        <Checkbox label={t("Modificar")} checked={perms.modifying} disabled={disabled} onChange={(modifying) => setPerm({ modifying })} />
        <Checkbox label={t("Comentar")} checked={perms.annotating} disabled={disabled} onChange={(annotating) => setPerm({ annotating })} />
        <Checkbox label={t("Rellenar formularios")} checked={perms.fillingForms} disabled={disabled} onChange={(fillingForms) => setPerm({ fillingForms })} />
        <Checkbox label={t("Organizar páginas")} checked={perms.assembling} disabled={disabled} onChange={(assembling) => setPerm({ assembling })} />
      </div>
      <Note>{t("Cifrado AES-256. Si olvidas la contraseña no hay forma de recuperar el documento.")}</Note>
    </OptionStack>
  );
}

export const protectTool: ToolModule<ProtectToolOptions> = {
  actionLabel: "Proteger PDF",
  defaultOptions: () => ({ password: "", repeat: "", owner: "", permissions: { ...ALL_PERMISSIONS } }),
  Options: ProtectOptions,
  validate(_files, options) {
    if (options.password === "") return t("Escribe una contraseña.");
    if (options.password !== options.repeat) return t("Las contraseñas no coinciden.");
    return null;
  },
  async run(files, options, ctx) {
    const { results, warnings } = await processFiles(files, ctx, t("Protegiendo"), (file) =>
      protectPdf(file.bytes, {
        userPassword: options.password,
        ownerPassword: options.owner || undefined,
        permissions: options.permissions,
      }),
    );
    return {
      summary: t("{files} con contraseña", { files: pluralize(results.length, t("archivo protegido"), t("archivos protegidos")) }),
      outputs: results.map(({ file, value }) => ({ name: `${baseOf(file.name)}${t("_protegido")}.pdf`, bytes: value, kind: "pdf" as const })),
      zipName: t("pdf_protegidos.zip"),
      warnings,
    };
  },
};
