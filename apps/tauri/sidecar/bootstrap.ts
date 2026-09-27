/**
 * Node side of the Tauri desktop app.
 *
 * The Rust shell can't `require()` the koris server the way the Electron main
 * process does (`apps/desktop/server-runtime.ts`), so this script is spawned as
 * a child process instead. It performs the same steps — set the env vars,
 * require the compiled server, start it on an ephemeral loopback port — and then
 * reports the bound port back to Rust on stdout.
 *
 * Deliberately lives here rather than in `core/`: the CLI path in
 * `core/src/app.ts` (`require.main === module`) hardcodes the default listen
 * options and never reports its port, and this app is additive by design.
 *
 * stdout protocol (line-based):
 *   `KORIS_PORT=<n>`    the dashboard is listening; load `http://127.0.0.1:<n>`
 *   `KORIS_ERROR=<msg>` startup failed; the process then exits non-zero
 * Any other line is server log output for the shell to forward to its own log.
 *
 * stdin protocol:
 *   `shutdown\n`  stop the server, then exit 0
 *   EOF           the shell died or crashed — stop and exit, so this process
 *                 never outlives its parent
 */
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

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

const HOST = '127.0.0.1';
/** Matches the quit race in `apps/desktop/main.ts` — a stuck stop must not wedge the exit. */
const SHUTDOWN_TIMEOUT_MS = 5000;

// Compiled to <repoRoot>/apps/tauri/sidecar/out/bootstrap.js, so the repo root
// is four directories up. The shell normally passes both dirs explicitly; the
// fallbacks keep `node apps/tauri/sidecar/out/bootstrap.js` runnable on its own.
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const appDir = process.env.KORIS_APP_DIR || repoRoot;
const dataDir = process.env.KORIS_DATA_DIR || repoRoot;
const requestedPort = Number(process.env.KORIS_DESKTOP_PORT || '0');

let running: ServerHandle | null = null;
let stopping = false;

async function main(): Promise<void> {
  for (const dir of ['memory', 'logs']) {
    mkdirSync(path.join(dataDir, dir), { recursive: true });
  }

  // Must land before the server module is required: core/src/config reads these
  // at first import, and creating a logger touches <DATA_DIR>/logs.
  process.env.KORIS_APP_DIR = appDir;
  process.env.KORIS_DATA_DIR = dataDir;
  process.env.CHANNELS_WHATSAPP_AUTH_FOLDER =
    process.env.CHANNELS_WHATSAPP_AUTH_FOLDER || path.join(dataDir, '.whatsapp_auth');

  const serverModule = path.join(appDir, 'dist', 'core', 'src', 'app.js');
  // Required lazily (not imported) so the env vars above are set first.
  const mod = require(serverModule) as KorisServerModule;
  const handle = await mod.startServer({
    modes: { web: true, tui: false },
    webListen: { host: HOST, port: requestedPort },
  });

  running = handle;
  process.stdout.write(`KORIS_PORT=${handle.port}\n`);
}

async function shutdown(code: number): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;

  const handle = running;
  running = null;
  if (handle) {
    await Promise.race([
      handle.stop(),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
  }
  process.exit(code);
}

const stdin = readline.createInterface({ input: process.stdin });
stdin.on('line', (line) => {
  if (line.trim() === 'shutdown') {
    void shutdown(0);
  }
});
// EOF on stdin means the shell is gone. This is the orphan guard the Electron
// app never needed, because there the server ran inside the shell's own process.
stdin.on('close', () => {
  void shutdown(0);
});

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  // Collapsed to one line so the shell's line-based reader sees the whole thing.
  process.stdout.write(`KORIS_ERROR=${message.replace(/\r?\n/g, ' | ')}\n`);
  void shutdown(1);
});
