import type { ReactNode } from "react";

export function Panel({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="flex items-baseline justify-between gap-3 border-b border-bench-600 px-4 py-3">
        <h2 className="rule-label text-bench-300">{title}</h2>
        {hint ? <span className="font-mono text-[10px] text-bench-400">{hint}</span> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stepper({
  value,
  onAdd,
  onRemove,
  addLabel,
  removeLabel,
  addDisabled = false,
}: {
  value: number;
  onAdd: () => void;
  onRemove: () => void;
  addLabel: string;
  removeLabel: string;
  addDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onRemove}
        disabled={value === 0}
        aria-label={removeLabel}
        className="h-7 w-7 rounded border border-bench-500 text-bench-200 transition-colors hover:border-bench-400 hover:bg-bench-600 disabled:cursor-not-allowed disabled:border-bench-600 disabled:text-bench-500"
      >
        &minus;
      </button>
      <span
        className={`w-6 text-center font-mono text-xs tabular-nums ${
          value > 0 ? "text-bench-100" : "text-bench-500"
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onAdd}
        disabled={addDisabled}
        aria-label={addLabel}
        className="h-7 w-7 rounded border border-kraft-deep bg-kraft/10 text-kraft-soft transition-colors hover:bg-kraft/25 disabled:cursor-not-allowed disabled:border-bench-600 disabled:bg-transparent disabled:text-bench-500"
      >
        +
      </button>
    </div>
  );
}

/** A choice chip. Used for wrap styles, materials and ribbons. */
export function Choice({
  selected,
  onSelect,
  children,
  swatch,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  swatch?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors ${
        selected
          ? "border-kraft bg-kraft/15 text-bench-100"
          : "border-bench-600 text-bench-300 hover:border-bench-500 hover:text-bench-200"
      }`}
    >
      {swatch}
      <span>{children}</span>
    </button>
  );
}

export function ActionButton({
  onClick,
  children,
  variant = "quiet",
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "quiet" | "primary";
  disabled?: boolean;
}) {
  const styles =
    variant === "primary"
      ? "border-kraft-deep bg-kraft text-bench-900 hover:bg-kraft-soft"
      : "border-bench-500 text-bench-200 hover:border-bench-400 hover:bg-bench-600";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:border-bench-600 disabled:bg-transparent disabled:text-bench-500 ${styles}`}
    >
      {children}
    </button>
  );
}
