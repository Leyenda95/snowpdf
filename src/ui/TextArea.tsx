import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";
import { controlClass, LABEL_CLASS } from "./fieldStyles";
import { joinIds } from "./hooks";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Classes for the <textarea> itself; `className` styles the whole field wrapper. */
  inputClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, className, inputClassName, id, rows = 4, "aria-describedby": describedBy, ...rest },
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
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={joinIds(describedBy, hasMessage && messageId)}
        className={cn(controlClass(Boolean(error)), "min-h-20 resize-y px-3 py-2 leading-relaxed", inputClassName)}
        {...rest}
      />
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
