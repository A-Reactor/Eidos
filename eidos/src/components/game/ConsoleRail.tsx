"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState, type CSSProperties, type ReactNode } from "react";

import type { ArchiveConsoleTab } from "./archive-console-model";

export interface ConsoleRailTab {
  id: ArchiveConsoleTab;
  label: string;
  shortcut: string;
  count?: number;
}

interface ConsoleRailProps {
  children?: ReactNode;
  tabs: ConsoleRailTab[];
  onOpenTab: (tab: ArchiveConsoleTab) => void;
}

export function ConsoleRail({ tabs, onOpenTab, children }: ConsoleRailProps) {
  const ui = useInterfaceText();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const cursorStyle = { "--rail-index": String(hoverIndex ?? 0) } as CSSProperties;

  return (
    <aside className="absolute left-[19px] top-[210px] z-20 hidden w-[46px] flex-col items-center gap-3 md:flex">
    <nav
      aria-label={ui("档案快捷栏")}
      className="eidos-tool-rail grid"
      onMouseLeave={() => setHoverIndex(null)}
    >
      <span
        aria-hidden="true"
        className="eidos-tool-rail__cursor"
        data-active={hoverIndex !== null}
        data-testid="console-rail-cursor"
        style={cursorStyle}
      />
      {tabs.map((tab, index) => {
        const countLabel = typeof tab.count === "number" ? String(tab.count) : "";

        return (
          <button
            key={tab.id}
            type="button"
            aria-label={[ui("打开") + tab.label, countLabel].filter(Boolean).join(" ")}
            title={`${tab.label} (${tab.shortcut})${countLabel ? ` · ${countLabel}` : ""}`}
            onMouseEnter={() => setHoverIndex(index)}
            onFocus={() => setHoverIndex(index)}
            onBlur={() => setHoverIndex(null)}
            onClick={() => onOpenTab(tab.id)}
          >
            <span>{tab.shortcut}</span>
            {typeof tab.count === "number" && tab.count > 0 ? (
              <small>{tab.count > 99 ? "99+" : tab.count}</small>
            ) : null}
          </button>
        );
      })}
    </nav>
    {children}
    </aside>
  );
}
