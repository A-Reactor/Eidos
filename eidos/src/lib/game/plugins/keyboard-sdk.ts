import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from '../keyboard-shortcuts';

export const KEYBOARD_SDK = `
 const keyboardBindings = () => context?.keyboardShortcuts ?? ${JSON.stringify(DEFAULT_SHORTCUTS)};
 const keyboardBlocked = event => event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
   event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]') ||
   document.activeElement?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]');
 const keyboardApi = Object.freeze({
   matches(event, action) {
     if (keyboardBlocked(event) || event.repeat) return false;
     return Boolean(keyboardBindings()[action] && keyboardBindings()[action] === event.key.toLowerCase()) || action === 'advance' && [' ', 'Enter'].includes(event.key);
   }
 });
 addEventListener('keydown', event => {
   if (!context || context.surface?.active === false || context.reading?.paused || context.reading?.inputBlocked || keyboardBlocked(event)) return;
   const action = ${JSON.stringify(SHORTCUT_ACTIONS)}.find(action => keyboardBindings()[action] && keyboardBindings()[action] === event.key.toLowerCase());
   // Confirmation belongs to the author surface (for example, talking to a nearby NPC).
   if (!action || action === 'advance') return;
   event.preventDefault();
   event.stopImmediatePropagation();
   if (!event.repeat) send('shortcut', { action });
 }, true);
`;
