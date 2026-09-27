# Bundled runtime — IMPLEMENTED (in-process)

The desktop app runs the koris server **inside the Electron main process** — no child
process, no bundled Node runtime. `apps/desktop/server-runtime.ts` sets the path env vars,
`require()`s the compiled server (`dist/core/src/app.js`), and calls its exported
`startServer({ webListen: { host: '127.0.0.1', port: 0 } })`. The dashboard binds an
ephemeral loopback port; the window loads that origin. Quit calls the handle's `stop()`
(web server + channels + heartbeat + skill sync).

## What gets bundled

`scripts/stage-server.mjs` (run by `pnpm desktop:stage`) produces:

- `build-resources/server-node_modules/` — a pruned **production** `node_modules`. Built by
  installing a stripped manifest (`dependencies` only) with `pnpm install --prod
  --ignore-workspace --ignore-scripts --config.node-linker=hoisted`. The **hoisted**
  linker is required: pnpm's default `.pnpm` symlink store points at absolute paths in the
  build tree, which dangle once the app is installed under `/opt` / an AppImage mount /
  `C:\Program Files` — the first `require('winston')` then fails. `stage-server.mjs`
  asserts the copied tree has zero symlinks. `better-sqlite3` v13 ships per-platform
  `prebuilds/*.node` for every OS/arch, resolved purely by `process.platform`/`arch`. They
  are **N-API** binaries — ABI-stable and Electron-compatible — so `require('better-sqlite3')`
  in the Electron main process loads them unmodified, **no `@electron/rebuild`**.
- `build-resources/server-package.json` — that stripped manifest.

`electron-builder.yml` `extraResources` copies these plus `dist/`, `dist-web/`, `plugins/skills/`,
`core/load/`, `heartbeats.default.json`, `koris.example.json` into `resources/server/`,
**outside** `app.asar` (so `.node` files and the plugin loader's dynamic `require()`s work
against real files on disk).

## Relocatable paths — the `core/src/config` split

| | env var | default | holds |
| --- | --- | --- | --- |
| `config.BASE_DIR` | `KORIS_APP_DIR` | `process.cwd()` | read-only: `dist-web/`, `plugins/skills/`, `heartbeats.default.json`, `core/load/` |
| `config.DATA_DIR` | `KORIS_DATA_DIR` | `process.cwd()` | writable: `koris.json`, `memory/`, `logs/` |

Both env vars unset in a normal checkout → everything resolves to the repo root, no
behaviour change, all tests green.

`server-runtime.ts` (before it `require()`s the server module — `core/src/config` and the
logger read these at first import):
- sets `KORIS_APP_DIR = serverAppDir` (`resources/server` when packaged, repo root in dev),
  `KORIS_DATA_DIR = dataDir` (`app.getPath('userData')` when packaged, repo root in dev),
  and `CHANNELS_WHATSAPP_AUTH_FOLDER` under the data dir.
- pre-creates `<dataDir>/memory` and `<dataDir>/logs`.

`main.ts` `seedDataDir()` still copies the bundled `koris.example.json` into the data dir on
each packaged launch.

## Trade-off

The whole server dependency graph (express, next, baileys, winston, better-sqlite3) now
loads in the Electron main process. A fatal server error takes the window down (previously
an isolated child); `bootstrap()` wraps `startServer()` in `try/catch → showError`.

## Channel plugin config

`resolvePluginDir` (`plugins/config/loader.ts`) relocates `plugins/<family>/<name>/config.yml`
to `<KORIS_DATA_DIR>/plugins/<family>/<name>/config.yml` whenever `KORIS_DATA_DIR` is set,
so the setup wizard / admin panel can write channel config (Telegram bot token, WhatsApp
whitelist, …) without hitting the read-only bundle. Unset `KORIS_DATA_DIR` (dev / `pnpm app`
from the repo root) keeps the old behaviour — config next to the plugin sources.

## Known gaps

- `pnpm onboard` / `pnpm validate` (separate CLIs) still use `process.cwd()` — fine, they
  aren't run inside the packaged app.
- `config.GATEWAY_HOST` defaults to `http://localhost:3000`; with the ephemeral port any
  code building absolute self-URLs from it would be off. Not on the dashboard load path;
  set `gateway_host` in `koris.json` if it matters.
- If a future `better-sqlite3` major drops N-API prebuilds, reintroduce a rebuild step
  (`@electron/rebuild`, already transitive via electron-builder) or an `asarUnpack`ed
  Electron-ABI build.
