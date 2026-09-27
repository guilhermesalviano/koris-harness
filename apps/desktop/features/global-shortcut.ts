import type { BrowserWindow } from 'electron';

const NOT_IMPLEMENTED =
  '[koris-desktop] global-shortcut not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Register a global accelerator (e.g. `CommandOrControl+Shift+Space`)
 * with `globalShortcut.register` that shows/focuses the window — and later a
 * lightweight "quick ask" popover that posts to `/api/chat` and then opens the
 * full window on the resulting session.
 *
 * Remember to `globalShortcut.unregisterAll()` on `will-quit`.
 * Returns a disposer.
 */
export function registerGlobalShortcut(_win: BrowserWindow): () => void {
  console.warn(NOT_IMPLEMENTED);
  return () => {};
}
