import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { controlClass, LABEL_CLASS } from "./fieldStyles";
import { joinIds } from "./hooks";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Icon shown inside the field, on the left. */
  icon?: LucideIcon;
  /** Element shown inside the field, on the right (e.g. a clear or reveal button). */
  trailing?: ReactNode;
  /** Classes for the <input> itself; `className` styles the whole field wrapper. */
  inputClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, icon: Icon, trailing, className, inputClassName, id, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const hasMessage = Boolean(error || hint);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={joinIds(describedBy, hasMessage && messageId)}
          className={cn(controlClass(Boolean(error)), "h-9 px-3", Icon && "pl-9", Boolean(trailing) && "pr-10", inputClassName)}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? (
        <p id={messageId} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
