import { app } from 'electron';
import * as path from 'node:path';

// The server runs in-process (see server-runtime.ts). It binds an ephemeral
// loopback port by default; set KORIS_DESKTOP_PORT to pin one (e.g. to attach a
// browser during development).
export const desktopPort = Number(process.env.KORIS_DESKTOP_PORT || '0');
export const desktopHost = '127.0.0.1';

export const isPackaged = app.isPackaged;
export const isDev = !isPackaged || process.env.KORIS_DESKTOP_DEV === '1';

// Dev: this module is compiled to <repoRoot>/apps/desktop/out/config.js, so the
// repo root is three directories up. Packaged: the server tree is shipped under
// the app's resources dir (see electron-builder.yml).
const devRepoRoot = path.resolve(__dirname, '..', '..', '..');

/** Read-only root holding the compiled server, dist-web/, plugins/skills/, core/load/. */
export const serverAppDir = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : devRepoRoot;

/** Writable root for koris.json, memory/, logs/. Passed as KORIS_DATA_DIR. */
export const dataDir = isPackaged ? app.getPath('userData') : devRepoRoot;

/** The compiled server module, `require()`d and started in-process. */
export const serverModule = path.join(serverAppDir, 'dist', 'core', 'src', 'app.js');
export const exampleConfig = path.join(serverAppDir, 'koris.example.json');

export const loadingHtml = path.join(__dirname, 'loading.html');
export const preloadScript = path.join(__dirname, 'preload.js');
