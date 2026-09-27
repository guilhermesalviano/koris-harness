import type { BrowserWindow } from 'electron';

const NOT_IMPLEMENTED =
  '[koris-desktop] native-notifications not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Bridge in-app events to OS notifications.
 *
 * Main side (here):
 *  - `ipcMain.on('koris:notify', (_e, { title, body, sessionId }) => new Notification({ title, body }).show())`
 *  - on notification `click`, focus the window and navigate it to
 *    `/admin/chat/<sessionId>`.
 *
 * Preload side (`apps/desktop/preload.ts`): expose
 *  `koris.notify = (payload) => ipcRenderer.send('koris:notify', payload)`.
 *
 * Renderer side (small change in `apps/web`, NOT done yet): when a streamed
 * assistant reply finishes while `document.hidden`, call
 * `window.koris?.notify({...})`. The web app already swaps the favicon for a
 * background reply (`apps/web/src/lib/response-alert.ts`) — that's the hook point.
 */
export function setupNativeNotifications(_win: BrowserWindow): void {
  console.warn(NOT_IMPLEMENTED);
}
