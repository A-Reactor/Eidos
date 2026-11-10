export const SHORTCUT_ACTIONS = ['advance', 'previous', 'focusInput', 'status', 'worldline', 'gallery'] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
export type KeyboardShortcuts = Record<ShortcutAction, string>;
export const DEFAULT_SHORTCUTS: KeyboardShortcuts = { advance: 'z', previous: 'x', focusInput: 'c', status: 'a', worldline: 's', gallery: 'd' };
export const LEGACY_SHORTCUTS: KeyboardShortcuts = { advance: '', previous: '', focusInput: '/', status: 'm', worldline: 'w', gallery: 'g' };
export const HOST_SHORTCUT_EVENT = 'eidos-game-shortcut';

export function isShortcutAction(value: unknown): value is ShortcutAction {
  return SHORTCUT_ACTIONS.includes(value as ShortcutAction);
}
export function validShortcutKey(value: string): boolean {
  return value === '' || /^[a-z0-9/.,;'\[\]\\=\-]$/i.test(value);
}
export function normalizeShortcuts(input: unknown): KeyboardShortcuts {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const used = new Set<string>();
  return Object.fromEntries(SHORTCUT_ACTIONS.map(action => {
    const raw = source[action];
    let key = typeof raw === 'string' && validShortcutKey(raw) ? raw.toLowerCase() : DEFAULT_SHORTCUTS[action];
    if (key && used.has(key)) key = used.has(DEFAULT_SHORTCUTS[action]) ? '' : DEFAULT_SHORTCUTS[action];
    if (key) used.add(key);
    return [action, key];
  })) as KeyboardShortcuts;
}

export function isKeyboardInput(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]'));
}
export function shortcutAction(event: KeyboardEvent, shortcuts: KeyboardShortcuts): ShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  const configured = SHORTCUT_ACTIONS.find(action => shortcuts[action] && shortcuts[action] === key);
  if (configured) return configured;
  if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowRight') return 'advance';
  if (event.key === 'ArrowLeft') return 'previous';
  return null;
}
