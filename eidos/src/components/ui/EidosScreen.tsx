"use client";

import type { ReactNode } from "react";

interface EidosScreenProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  maxWidth?: "md" | "lg" | "xl";
}

const maxWidthClass: Record<NonNullable<EidosScreenProps["maxWidth"]>, string> = {
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function EidosScreen({
  eyebrow,
  title,
  subtitle,
  action,
  children,
  maxWidth = "lg",
}: EidosScreenProps) {
  return (
    <div className="eidos-dossier-screen flex flex-col h-full">
      <header className="eidos-dossier-header shrink-0 px-6 py-4">
        <div className="flex items-start justify-between gap-5">
          <div>
            {eyebrow && (
              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.36em] text-[color:var(--eidos-accent)]">
                {eyebrow}
              </div>
            )}
            <h1 className="text-2xl font-semibold leading-none tracking-[-.06em] text-[color:var(--eidos-ink)]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 max-w-2xl font-mono text-[10px] uppercase leading-5 tracking-[.16em] text-black/46">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className={`mx-auto w-full ${maxWidthClass[maxWidth]} space-y-6`}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function EidosSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="eidos-dossier-card eidos-diagonal-cut p-5" data-tone="violet">
      <div className="eidos-dossier-section-title relative mb-4 border-b pb-3">
        <h2 className="text-sm font-medium tracking-[0.12em] text-zinc-200">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-[11px] leading-5 text-zinc-600">
            {subtitle}
          </p>
        )}
      </div>
      <div className="relative space-y-4">{children}</div>
    </section>
  );
}

export function EidosField({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {id ? (
          <label htmlFor={id} className="text-xs text-zinc-400">
            {label}
          </label>
        ) : (
          <span className="text-xs text-zinc-400">{label}</span>
        )}
        {hint && <span className="text-[10px] leading-4 text-zinc-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function EidosButton({
  children,
  active,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
}) {
  return (
    <button
      {...props}
      data-active={active ? "true" : undefined}
      className={`eidos-dossier-action eidos-focus px-4 py-2 text-xs ${className}`}
    >
      {children}
    </button>
  );
}
