const NOT_IMPLEMENTED =
  '[koris-desktop] auto-update not implemented — see apps/desktop/features/README.md';

/**
 * DEFERRED. Wire `electron-updater` (add it to the root package.json when
 * picking this up):
 *  - configure the publish/feed target (GitHub Releases is the natural fit —
 *    repo is github.com/guilhermesalviano/koris)
 *  - `autoUpdater.checkForUpdatesAndNotify()` on launch, then on an interval
 *  - surface `update-available` / `download-progress` / `update-downloaded`
 *    to the user (menu item state, or a renderer toast via IPC)
 *  - `autoUpdater.quitAndInstall()` on user confirm
 *
 * Only meaningful once `features/packaging.md` produces signed installers.
 */
export function setupAutoUpdate(): void {
  console.warn(NOT_IMPLEMENTED);
}
