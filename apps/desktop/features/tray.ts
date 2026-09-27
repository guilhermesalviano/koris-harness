import type { BrowserWindow } from 'electron';

const NOT_IMPLEMENTED =
  '[koris-desktop] tray not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Create a `Tray` with an icon and a context menu:
 *  - Show / Hide koris
 *  - New Chat
 *  - Open Dashboard
 *  - Quit
 *
 * Optional "close to tray": intercept the window `close` event, hide instead
 * of destroy, and only really quit from the tray menu or Cmd/Ctrl-Q.
 * Needs a tray-sized icon asset (see features/packaging.md for the icon set).
 *
 * Returns a disposer so `main.ts` can tear the tray down on quit.
 */
export function setupTray(_win: BrowserWindow): () => void {
  console.warn(NOT_IMPLEMENTED);
  return () => {};
}
