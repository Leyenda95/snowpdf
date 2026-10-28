import { useId, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";
import { TextField } from "./TextField";
import { t } from "@/i18n";

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Default "Aceptar". */
  confirmLabel?: string;
  /** Default "Cancelar". */
  cancelLabel?: string;
  /** Styles the confirm button as destructive and focuses "Cancelar" first. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  type?: "text" | "password";
  /** Default "Aceptar". */
  confirmLabel?: string;
  /** Default "Cancelar". */
  cancelLabel?: string;
  /** Return an error message to block submitting, or null when the value is fine. */
  validate?: (value: string) => string | null;
}

type Request =
  | { id: number; kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: number; kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

interface DialogState {
  queue: Request[];
}

const useDialogStore = create<DialogState>(() => ({ queue: [] }));

let nextId = 0;

function enqueue(request: Request): void {
  useDialogStore.setState((state) => ({ queue: [...state.queue, request] }));
}

/** Resolves true when the user confirms, false when they cancel or dismiss. Needs <DialogHost /> mounted. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => enqueue({ id: ++nextId, kind: "confirm", options, resolve }));
}

/** Resolves with the entered text, or null when cancelled. Needs <DialogHost /> mounted. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ id: ++nextId, kind: "prompt", options, resolve }));
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** Removes the request from the queue (once) and hands the answer to its caller. */
function settle(request: Request, value: boolean | string | null): void {
  const pending = useDialogStore.getState().queue.some((r) => r.id === request.id);
  if (!pending) return;
  useDialogStore.setState((state) => ({ queue: state.queue.filter((r) => r.id !== request.id) }));
  if (request.kind === "confirm") request.resolve(value === true);
  else request.resolve(typeof value === "string" ? value : null);
}

function ConfirmView({ request }: { request: Extract<Request, { kind: "confirm" }> }) {
  const { title, message, confirmLabel = t("Aceptar"), cancelLabel = t("Cancelar"), danger } = request.options;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      open
      size="sm"
      title={title}
      description={message}
      onClose={() => settle(request, false)}
      initialFocusRef={danger ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={() => settle(request, false)}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={danger ? "danger" : "primary"} onClick={() => settle(request, true)}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

function PromptView({ request }: { request: Extract<Request, { kind: "prompt" }> }) {
  const {
    title,
    message,
    label,
    defaultValue = "",
    placeholder,
    type = "text",
    confirmLabel = t("Aceptar"),
    cancelLabel = t("Cancelar"),
    validate,
  } = request.options;

  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    settle(request, value);
  };

  return (
    <Modal
      open
      size="sm"
      title={title}
      description={message}
      // A half-typed answer should not vanish because of a stray click outside.
      closeOnBackdrop={false}
      onClose={() => settle(request, null)}
      initialFocusRef={inputRef}
      footer={
        <>
          <Button onClick={() => settle(request, null)}>{cancelLabel}</Button>
          <Button type="submit" form={formId} variant="primary">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <TextField
          ref={inputRef}
          label={label}
          type={isPassword && !revealed ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          error={error ?? undefined}
          autoComplete="off"
          spellCheck={false}
          aria-label={label ? undefined : title}
          onChange={(e) => {
            setValue(e.target.value);
            // Once an error was shown, keep it in sync while the user fixes the value.
            if (error) setError(validate?.(e.target.value) ?? null);
          }}
          trailing={
            isPassword ? (
              <IconButton
                icon={revealed ? EyeOff : Eye}
                label={revealed ? t("Ocultar contraseña") : t("Mostrar contraseña")}
                size="sm"
                tooltipSide="top"
                // Keep the caret in the field while toggling.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRevealed((r) => !r)}
              />
            ) : undefined
          }
        />
      </form>
    </Modal>
  );
}

/** Renders the pending confirm/prompt dialogs, one at a time. Mount once near the root. */
export function DialogHost() {
  const current = useDialogStore((state) => state.queue[0]);
  if (!current) return null;
  return current.kind === "confirm" ? (
    <ConfirmView key={current.id} request={current} />
  ) : (
    <PromptView key={current.id} request={current} />
  );
}
