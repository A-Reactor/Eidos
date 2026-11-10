// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, normalizeShortcuts, shortcutAction, isKeyboardInput } from '@/lib/game/keyboard-shortcuts';
import { normalizeSettings } from '@/lib/game/settings';

it('migrates old settings and keeps valid custom keys without duplicate bindings', () => {
  expect(normalizeSettings({}).keyboardShortcuts).toEqual(DEFAULT_SHORTCUTS);
  const bindings = normalizeShortcuts({ advance: 'Q', previous: 'q', focusInput: '', status: 'Control+a', worldline: 7 });
  expect(bindings.advance).toBe('q'); expect(bindings.previous).toBe('x');
  expect(bindings.focusInput).toBe(''); expect(bindings.status).toBe('a'); expect(bindings.worldline).toBe('s');
  const assigned = Object.values(bindings).filter(Boolean);
  expect(new Set(assigned).size).toBe(assigned.length);
});

it('resolves saved keys and reading aliases without stealing modified or composing keys', () => {
  const custom = { ...DEFAULT_SHORTCUTS, advance: 'q' };
  expect(shortcutAction(new KeyboardEvent('keydown', { key: 'Q' }), custom)).toBe('advance');
  expect(shortcutAction(new KeyboardEvent('keydown', { key: 'z' }), custom)).toBeNull();
  expect(shortcutAction(new KeyboardEvent('keydown', { key: 'ArrowLeft' }), custom)).toBe('previous');
  expect(shortcutAction(new KeyboardEvent('keydown', { key: ' ' }), custom)).toBe('advance');
  for (const flags of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
    expect(shortcutAction(new KeyboardEvent('keydown', { key: 'q', ...flags }), custom)).toBeNull();
  }
});

it('recognizes nested editable and dialog targets', () => {
  const parent = document.createElement('div'), child = document.createElement('span');
  parent.contentEditable = 'true'; parent.setAttribute('contenteditable', 'true'); parent.append(child);
  expect(isKeyboardInput(child)).toBe(true);
  parent.removeAttribute('contenteditable'); parent.setAttribute('role', 'dialog');
  expect(isKeyboardInput(child)).toBe(true);
  expect(isKeyboardInput(document.createElement('input'))).toBe(true);
  expect(isKeyboardInput(document.createElement('div'))).toBe(false);
});
