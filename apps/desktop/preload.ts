import { contextBridge } from 'electron';

/**
 * Tiny, deliberately read-only bridge. The web dashboard does not depend on
 * it today; it exists as the seam that native-notifications, deep-links and
 * window-state (see features/) will grow their IPC on.
 */
contextBridge.exposeInMainWorld('koris', {
  isDesktop: true,
  platform: process.platform,
  electron: process.versions.electron,
});
