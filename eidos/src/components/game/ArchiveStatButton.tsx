"use client";

interface ArchiveStatButtonProps {
  value: string | number;
  label: string;
  hint?: string;
  tone?: "neutral" | "accent" | "dark" | "muted";
  disabled?: boolean;
  shape?: "cut" | "parallelogram";
  accessibleName?: string;
  onClick?: () => void;
}

export function ArchiveStatButton({
  value,
  label,
  hint,
  tone = "neutral",
  disabled = false,
  shape = "cut",
  accessibleName: name,
  onClick,
}: ArchiveStatButtonProps) {
  const accessibleName = name ?? [label, String(value), hint].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      aria-label={accessibleName}
      disabled={disabled || !onClick}
      onClick={onClick}
      className={`eidos-focus eidos-archive-stat is-${tone}${shape === "parallelogram" ? " eidos-archive-stat--parallel" : ""}`}
    >
      <b>{value}</b>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </button>
  );
}
