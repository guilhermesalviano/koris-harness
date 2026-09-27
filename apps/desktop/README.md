# `apps/desktop` — koris desktop app (Electron)

A thin Electron shell around the existing product. It does **not** reimplement the UI:
the Electron main process **runs the koris agent server in-process** (no child process, no
bundled Node) and loads the existing web dashboard (`apps/web`, served by
`core/src/dashboard`) from `http://127.0.0.1:<random-port>` in a native window. Chat
streaming (SSE), the setup wizard, and every admin page work exactly as they do in the
browser.

Unlike `apps/web` / `apps/tui`, this folder has its **own `package.json`** — not to add
dependencies (those stay in the repo root), but because `electron-builder` reads the
manifest of the dir it runs in and rejects the repo-root package name (`"/koris"`). It is
not a pnpm workspace package; `pnpm install` at the root ignores it.

## Run it (dev)

```bash
pnpm install
pnpm desktop          # pnpm build + pnpm build:desktop + launch Electron
```

On launch the app shows a splash, `require()`s the compiled server
(`dist/core/src/app.js`), calls its exported `startServer()` — which binds the dashboard to
an ephemeral `127.0.0.1` port — then loads that origin in the window. Quitting calls the
runtime's `stop()` (web server + channels + heartbeat + skill sync). A separate
`pnpm app` on :3000 is irrelevant — the desktop app always runs its own in-process server
on its own port. Set `KORIS_DESKTOP_PORT` to pin the port (e.g. to attach a browser).

Other scripts: `pnpm build:desktop` (compile the shell → `apps/desktop/out/`),
`pnpm desktop:dev` (skip the full `pnpm build`), `pnpm lint:desktop` (type-check).

### Linux sandbox note

The `desktop` scripts pass `--no-sandbox` because Electron's Chromium sandbox needs
`node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox` to be
`root:root` mode `4755`, which a plain `pnpm install` can't set. To run *with* the
sandbox, fix that file once (`sudo chown root:root <path> && sudo chmod 4755 <path>`)
and drop the flag. The app only ever loads trusted `http://localhost` content.

## Packaging & releases

`electron-builder.yml` (repo root) + the scripts under `scripts/` produce installers with
the koris server tree bundled in, so the app runs with no system Node — the Electron
runtime executes it.

```bash
pnpm desktop:package        # installers for the host OS  -> dist-desktop-out/
pnpm desktop:package:dir     # unpacked app (fast, no installer)
```

`desktop:package` runs, in order:

1. `pnpm build` + `pnpm build:desktop`
2. `pnpm desktop:stage` → `scripts/stage-server.mjs`: a pruned production `node_modules`
   (with `better-sqlite3`'s N-API prebuilds) into `build-resources/server-node_modules/`.
3. `pnpm desktop:icons` → `scripts/make-icons.mjs`.
4. `scripts/package-desktop.mjs`: runs `electron-builder` from `apps/desktop/` with the
   app version injected from the repo-root `package.json` and the exact installed Electron
   version.

**Packaged layout:** the Electron main bundle is in `app.asar`; the server tree
(`dist/`, `dist-web/`, `plugins/skills/`, `core/load/`, `heartbeats.default.json`,
`koris.example.json`, `node_modules/`) sits at `resources/server/`. At runtime `config.ts`
resolves `serverAppDir` to `resources/server` (→ `KORIS_APP_DIR`) and `KORIS_DATA_DIR` to
the OS per-user data dir, so `koris.json`, `memory/` and `logs/` are written there (the
bundle stays read-only). `require('better-sqlite3')` in the Electron main process loads the
matching `prebuilds/<platform>-<arch>.node` (N-API — ABI-stable, no rebuild needed).

**GitHub releases:** `.github/workflows/release-desktop.yml` builds the matrix
(Linux / Windows / macOS x64 / macOS arm64) when a GitHub Release is **published**. It
takes the version from the release **tag** (`v0.1.4-pre` → `0.1.4-pre`, passed as
`KORIS_RELEASE_VERSION`) so the artifact names line up, builds with `--publish never`, then
attaches the installers to the triggering release with `gh release upload <tag> --clobber`.
Release flow: `pnpm release <bump>` → review → commit → `git tag vX.Y.Z` →
`git push --follow-tags` → publish the Release for that tag.

**Not done yet:** code signing / notarization (`identity: null`, unsigned) — see
`features/packaging.md`. App icons are a placeholder upscale (`build/icon.png`).

## Environment overrides

| Var | Default | Purpose |
| --- | --- | --- |
| `KORIS_DESKTOP_PORT` | `0` (ephemeral) | pin the in-process server's loopback port |
| `KORIS_DESKTOP_DEV` | — | `1` forces devtools + dev behaviour |

The server itself reads `KORIS_APP_DIR` (read-only root) and `KORIS_DATA_DIR` (writable
root) — `server-runtime.ts` sets both before `require()`ing the server module; in dev they
both equal the repo root, so behaviour is unchanged.

## Layout

| Path | Role |
| --- | --- |
| `main.ts` | Electron entry: single-instance lock, `bootstrap()`, quit/cleanup, data-dir seeding |
| `config.ts` | dev vs packaged path resolution, loopback host/port |
| `server-runtime.ts` | set env, `require()` the server module, `startServer()` in-process, stop on quit |
| `window.ts` | `BrowserWindow`, splash, external-link handling |
| `menu.ts` | minimal role-only window menu |
| `preload.ts` | tiny `window.koris` bridge |
| `loading.html` | splash shown while the server starts |
| `package.json` | the Electron app manifest (electron-builder reads this) |
| `scripts/` | `stage-server.mjs`, `make-icons.mjs`, `package-desktop.mjs` |
| `build/` | electron-builder build resources (`icon.png`, `entitlements.mac.plist`) |
| `features/` | deferred features — each a stub with notes (see `features/README.md`) |
