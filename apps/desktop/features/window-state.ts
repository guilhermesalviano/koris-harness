import type { BrowserWindowConstructorOptions } from 'electron';

const NOT_IMPLEMENTED =
  '[koris-desktop] window-state not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Persist and restore window geometry.
 *  - read `bounds` + `isMaximized` + `isFullScreen` from a JSON file under
 *    `app.getPath('userData')` (or use `electron-store`)
 *  - merge saved bounds into the `BrowserWindow` options in
 *    `apps/desktop/window.ts` `createWindow()`
 *  - on `close`, write the current bounds back (debounced on `resize`/`move`)
 *  - optionally also remember the last SPA route and re-navigate to it
 */
export function restoreWindowBounds(): Partial<BrowserWindowConstructorOptions> {
  console.warn(NOT_IMPLEMENTED);
  return {};
}

export function persistWindowBounds(): void {
  console.warn(NOT_IMPLEMENTED);
}
