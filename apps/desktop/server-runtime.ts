import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import {
  dataDir,
  desktopHost,
  desktopPort,
  serverAppDir,
  serverModule,
} from './config';

type Logger = (line: string) => void;

interface ServerHandle {
  port: number;
  stop(): Promise<void>;
}

interface KorisServerModule {
  startServer(options?: {
    modes?: { tui?: boolean; web?: boolean };
    webListen?: { host?: string; port?: number };
  }): Promise<ServerHandle>;
}

export interface RunningServer {
  /** e.g. `http://127.0.0.1:53124` — the origin to load in the window. */
  origin: string;
  stop(): Promise<void>;
}

let running: ServerHandle | null = null;

/**
 * Start the koris server in this (the Electron main) process. No child process,
 * no bundled Node runtime — the compiled server module is `require()`d directly
 * and its dashboard binds an ephemeral loopback port.
 */
export async function startServer(log: Logger): Promise<RunningServer> {
  for (const dir of ['memory', 'logs']) {
    mkdirSync(path.join(dataDir, dir), { recursive: true });
  }

  // Must be set before the server module is require()d: core/src/config reads
  // these at first import, and creating a logger touches <DATA_DIR>/logs.
  process.env.KORIS_APP_DIR = serverAppDir;
  process.env.KORIS_DATA_DIR = dataDir;
  process.env.CHANNELS_WHATSAPP_AUTH_FOLDER =
    process.env.CHANNELS_WHATSAPP_AUTH_FOLDER || path.join(dataDir, '.whatsapp_auth');

  log(`Starting koris server in-process from ${serverModule}`);
  // Loaded lazily (not import) so the env vars above land before core/src/config
  // and the logger read them at first evaluation.
  const mod = require(serverModule) as KorisServerModule;
  const handle = await mod.startServer({
    modes: { web: true, tui: false },
    webListen: { host: desktopHost, port: desktopPort },
  });
  running = handle;

  const origin = `http://${desktopHost}:${handle.port}`;
  log(`koris server ready at ${origin}`);
  return {
    origin,
    stop: () => stopServer(log),
  };
}

export async function stopServer(log: Logger): Promise<void> {
  const handle = running;
  running = null;
  if (!handle) {
    return;
  }
  log('Stopping koris server...');
  await handle.stop();
}
