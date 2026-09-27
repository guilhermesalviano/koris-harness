import { app, BrowserWindow } from 'electron';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, exampleConfig, isDev, isPackaged } from './config';
import { startServer, stopServer } from './server-runtime';
import { applyMenu } from './menu';
import { createWindow, getMainWindow, showApp, showError, showLoading } from './window';

const log = (line: string): void => console.log('[koris-desktop]', line);

let serverStarted = false;
let quitting = false;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (!win) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
  });

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    log(`fatal during startup: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  });
}

function seedDataDir(): void {
  if (!isPackaged) {
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  // Refresh the example template the setup wizard patches from. Harmless if the
  // user is already configured — the "configured" check only looks for koris.json.
  try {
    copyFileSync(exampleConfig, join(dataDir, 'koris.example.json'));
  } catch (error: unknown) {
    log(`could not seed koris.example.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function bootstrap(): Promise<void> {
  applyMenu();
  seedDataDir();
  const win = createWindow();
  await showLoading(win);

  try {
    const server = await startServer(log);
    serverStarted = true;
    await showApp(win, server.origin);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    await showError(win, message);
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootstrap();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (quitting || !serverStarted) {
    return;
  }
  quitting = true;
  serverStarted = false;
  event.preventDefault();
  // Don't let a stuck server shutdown wedge the quit.
  void Promise.race([stopServer(log), delay(5000)]).finally(() => app.quit());
});
