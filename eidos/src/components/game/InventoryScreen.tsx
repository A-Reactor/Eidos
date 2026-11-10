"use client";
import { BackButton } from "@/components/ui/BackButton";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useGameStore } from "@/store/game-store";
import type { InventoryItem } from "@/lib/game/types";
import { ArchiveScreen } from "@/components/ui/ArchiveScreen";
import { ResponsiveSidebar } from "@/components/ui/ResponsiveSidebar";
import { useI18n } from "@/components/shell/LocaleProvider";

const CATEGORY_ORDER: InventoryItem["category"][] = [
  "key",
  "document",
  "tool",
  "weapon",
  "consumable",
  "misc",
];

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9一-鿿_-]/g, "_").slice(0, 50);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getCategoryMessageKey(category: InventoryItem["category"]) {
  switch (category) {
    case "weapon":
      return "inventory.category.weapon";
    case "tool":
      return "inventory.category.tool";
    case "consumable":
      return "inventory.category.consumable";
    case "key":
      return "inventory.category.key";
    case "document":
      return "inventory.category.document";
    case "misc":
      return "inventory.category.misc";
    default:
      return "inventory.category.misc";
  }
}

export function InventoryScreen() {
  const { inventory, currentWorld } = useGameStore();
  const { t, locale } = useI18n();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(inventory[0]?.id ?? null);

  // ============================================================
  // 图标懒加载
  // ============================================================
  const [inventoryImageCache, setInventoryImageCache] = useState<
    Record<string, string>
  >({});
  const loadingQueue = useRef<Set<string>>(new Set());

  const loadInventoryIcon = useCallback(
    async (item: InventoryItem) => {
      const cacheKey = `inv_${item.id}`;
      if (item.imageUrl) {
        setInventoryImageCache((prev) =>
          prev[cacheKey] ? prev : { ...prev, [cacheKey]: item.imageUrl ?? "" },
        );
        return;
      }
      if (inventoryImageCache[cacheKey] || loadingQueue.current.has(cacheKey))
        return;
      const worldId = currentWorld?.id;
      if (!worldId) return;

      loadingQueue.current.add(cacheKey);

      // 1. HEAD 检查缓存
      const expectedUrl = `/generated/${worldId}/details/icon_inventory_${sanitizeFilename(item.name)}.png`;
      try {
        const headRes = await fetch(expectedUrl, { method: "HEAD" });
        if (headRes.ok) {
          setInventoryImageCache((prev) => ({
            ...prev,
            [cacheKey]: expectedUrl,
          }));
          loadingQueue.current.delete(cacheKey);
          return;
        }
      } catch (e: unknown) { console.warn("[InventoryScreen] icon load failed:", readErrorMessage(e)); }

      loadingQueue.current.delete(cacheKey);
    },
    [currentWorld?.id, inventoryImageCache]
  );

  // 触发可见物品的图标加载
  useEffect(() => {
    let cancelled = false;
    const items = inventory.slice();
    let i = 0;

    const loadNext = async () => {
      while (i < items.length && !cancelled) {
        const item = items[i++];
        await loadInventoryIcon(item);
      }
    };

    Promise.all([loadNext(), loadNext(), loadNext()])
      .catch((err: unknown) => console.warn("[InventoryScreen] batch icon load failed:", readErrorMessage(err)));

    return () => {
      cancelled = true;
    };
  }, [inventory, loadInventoryIcon]);

  const categoryCounts = useMemo(() => (
    CATEGORY_ORDER
      .map((category) => ({
        category,
        label: t(getCategoryMessageKey(category)),
        count: inventory.filter((item) => item.category === category).length,
      }))
      .filter((entry) => entry.count > 0)
  ), [inventory, t]);

  const itemSummary = inventory.length === 0
    ? t("inventory.subtitle.empty")
    : t("inventory.subtitle.count", { count: inventory.length });
  const selectedItem = inventory.find((item) => item.id === selectedItemId) ?? inventory[0] ?? null;

  return <ArchiveScreen directoryFirst className="eidos-inventory-screen" title={t("inventory.title")} subtitle={itemSummary} onBack={() => useGameStore.getState().goBack()}
    action={<BackButton onClick={() => useGameStore.getState().goBack()} label={t("inventory.back")} />}>
    <div className="eidos-inventory-layout">
      <ResponsiveSidebar className="eidos-inventory-index" label={t("inventory.index")} current={selectedItem?.name} closeLabel={locale === 'en' ? 'Close menu' : '收起菜单'}>
        <div className="eidos-inventory-index-head"><h2>{t("inventory.index")}</h2><p>{categoryCounts.map(entry => `${entry.label} ${entry.count}`).join(' · ')}</p></div>
        <div data-testid="inventory-item-list" className="eidos-inventory-list">
          {inventory.map(item => <button key={item.id} type="button" onClick={() => setSelectedItemId(item.id)} aria-pressed={selectedItem?.id === item.id} className="eidos-focus eidos-inventory-list-item">
            <InventoryIcon iconUrl={item.imageUrl ?? inventoryImageCache[`inv_${item.id}`]} />
            <span className="eidos-inventory-list-label"><b>{item.name}</b><small>{t(getCategoryMessageKey(item.category))}</small></span>
            <span className="eidos-inventory-list-quantity" aria-label={`${t("inventory.quantity")} ${item.quantity}`}>{item.quantity}</span>
          </button>)}
        </div>
      </ResponsiveSidebar>
      <main className="eidos-inventory-main">
        {selectedItem ? <InventoryDetailPanel key={selectedItem.id} item={selectedItem}
          iconUrl={selectedItem.imageUrl ?? inventoryImageCache[`inv_${selectedItem.id}`]}
          categoryLabel={t(getCategoryMessageKey(selectedItem.category))} quantityLabel={t("inventory.quantity")}
          consumableLabel={t("inventory.consumable")} acquiredLabel={t("inventory.acquiredAt", { day: selectedItem.acquiredAt.day, source: selectedItem.acquiredFrom })}
          valueLabel={selectedItem.value > 0 ? t("inventory.value", { value: selectedItem.value }) : null} />
          : <div className="eidos-archive-empty"><h2>{t("inventory.emptyTitle")}</h2><p>{t("inventory.emptyBody")}</p></div>}
      </main>
    </div>
  </ArchiveScreen>;
}

function InventoryDetailPanel({ item, iconUrl, categoryLabel, quantityLabel, consumableLabel, acquiredLabel, valueLabel }: {
  item: InventoryItem;
  iconUrl?: string;
  categoryLabel: string;
  quantityLabel: string;
  consumableLabel: string;
  acquiredLabel: string;
  valueLabel: string | null;
}) {
  return <article className="eidos-inventory-card" data-testid="inventory-dossier-card">
    <div className="eidos-inventory-detail-heading">
      <div><p className="eidos-archive-eyebrow">{categoryLabel}{item.consumable && ` · ${consumableLabel}`}</p><h2>{item.name}</h2></div>
      {iconUrl && <InventoryIcon iconUrl={iconUrl} large />}
    </div>
    <div data-testid="inventory-detail-panel" className="eidos-inventory-description"><p>{item.description}</p></div>
    <dl className="eidos-inventory-metadata">
      <div><dt>{quantityLabel}</dt><dd>×{item.quantity}</dd></div>
      <div><dt>{acquiredLabel}</dt>{valueLabel && <dd>{valueLabel}</dd>}</div>
    </dl>
  </article>;
}

function InventoryIcon({ iconUrl, large = false }: { iconUrl?: string; large?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={`eidos-inventory-symbol ${large ? 'eidos-inventory-symbol--large' : ''}`} aria-hidden="true">
    {iconUrl && failed !== iconUrl ? (
      // Runtime-generated pixel assets retain their original sampling.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={iconUrl} alt="" onError={() => setFailed(iconUrl)} style={{ imageRendering: 'pixelated' }} />
    ) : <svg viewBox="0 0 24 28" fill="none"><path d="M4 2h11l5 5v19H4zM15 2v6h5M8 13h8M8 18h8" stroke="currentColor" strokeWidth="1.2" /></svg>}
  </span>;
}
