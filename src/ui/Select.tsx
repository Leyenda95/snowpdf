import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { controlClass, LABEL_CLASS } from "./fieldStyles";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** Styled native <select>: keeps platform behaviour (keyboard, touch pickers, accessibility). */
export function Select<T extends string>({ value, onChange, options, label, disabled, className, id }: SelectProps<T>) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={selectId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as T)}
          className={cn(controlClass(), "h-9 cursor-pointer appearance-none pl-3 pr-9")}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle"
        />
      </div>
    </div>
  );
}
