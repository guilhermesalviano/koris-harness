import type { BrowserWindow } from 'electron';

const NOT_IMPLEMENTED =
  '[koris-desktop] native-menu not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Build the full application menu and install it via
 * `Menu.setApplicationMenu`, replacing the minimal role-only menu in
 * `apps/desktop/menu.ts`.
 *
 * Planned items:
 *  - App:    About koris, Check for Updates… (features/auto-update.ts), Preferences (→ /admin, opens ConfigModal), Quit
 *  - Chat:   New Chat (POST /api/admin/sessions then navigate), Open Session…, Compact Session (/compact)
 *  - Go:     Overview, Memories, Heartbeats, Skills, Queue, Audit  (navigate the loaded SPA route)
 *  - View:   Reload, Toggle DevTools, Zoom, Full Screen
 *  - Help:   Documentation (koris-hub site), GitHub repo, Report an Issue
 *
 * Navigation is done by executing `location.assign('/admin/...')` in the
 * window's webContents, since the renderer is the existing React Router SPA.
 */
export function applyNativeMenu(_win: BrowserWindow): void {
  console.warn(NOT_IMPLEMENTED);
}
