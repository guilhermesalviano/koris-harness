import type { BrowserWindow } from 'electron';

const NOT_IMPLEMENTED =
  '[koris-desktop] deep-links not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Register the custom `koris://` protocol and route incoming URLs.
 *  - `app.setAsDefaultProtocolClient('koris')` (dev needs the exec path + argv)
 *  - macOS: handle the `open-url` event
 *  - Windows/Linux: the URL arrives in `argv`; forward it through the
 *    existing `second-instance` handler in `apps/desktop/main.ts`
 *  - map `koris://session/<id>` → navigate SPA to `/admin/chat/<id>`,
 *    `koris://setup` → `/setup`, etc.
 */
export function setupDeepLinks(_win: BrowserWindow): void {
  console.warn(NOT_IMPLEMENTED);
}
