# `apps/tauri` — koris desktop app (Tauri)

A second desktop shell, alongside the Electron one in `apps/desktop/`. Both wrap the same
product: the koris agent server on a loopback port, with the existing web dashboard
(`apps/web`, served by `core/src/dashboard`) loaded in a native window. Neither
reimplements any UI.

This app exists for the bundle-size and memory win — Tauri uses the OS webview instead of
bundling Chromium (~200 MB → ~80–100 MB, roughly 100–150 MB less idle RSS).

**Nothing outside this directory is modified.** `apps/desktop/`, `apps/web/`, `apps/tui/`
and `core/` are untouched; the root `package.json` gains three scripts and the
`@tauri-apps/cli` devDependency, and `.gitignore` gains this app's build output.

## The one real difference from Electron

Electron *is* a Node runtime, so `apps/desktop/server-runtime.ts` simply
`require()`s the compiled server and calls `startServer()` in its own process. Tauri's
backend is Rust and cannot do that, and `core/` is pinned to Node by `better-sqlite3`
(N-API addon) and `esbuild`. So here the server runs as a **Node child process** that Rust
spawns and supervises.

`sidecar/bootstrap.ts` is the Node side of that seam. It does exactly what
`server-runtime.ts` does — set `KORIS_APP_DIR` / `KORIS_DATA_DIR`, require
`dist/core/src/app.js`, call `startServer()` on an ephemeral loopback port — and then
reports the bound port on stdout. It lives here rather than in `core/` because the CLI
path in `core/src/app.ts` hardcodes its listen options and never reports its port, and
patching that would make this app non-additive.

```
stdout   KORIS_PORT=<n>       dashboard is listening; load http://127.0.0.1:<n>
         KORIS_ERROR=<msg>    startup failed; process exits non-zero
         (anything else)      server log output, forwarded to the Tauri log
stdin    shutdown\n           stop the server, then exit 0
         EOF                  the shell died — stop and exit, never outlive the parent
```

That EOF rule is the orphan guard. Electron never needed one because the server shared its
process; here, a hard-killed shell would otherwise leave the server running.

## Run it (dev)

Prerequisites: Rust (1.77+), Node 24+, and on Linux the WebKitGTK dev headers:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

```bash
pnpm tauri:dev      # pnpm build + pnpm build:tauri, then `tauri dev`
```

A splash paints immediately; the server starts on a background thread and the window
navigates to it once the port arrives. Startup failures land on `splash/error.html` with
the last 20 lines of the server's stderr.

Other scripts: `pnpm build:tauri` (compile the sidecar → `sidecar/out/`),
`pnpm lint:tauri` (type-check it). The Rust side is checked with `cargo clippy` from
`src-tauri/`.

### Linux webview note

Chat streaming reads SSE through `res.body.getReader()` (`apps/web/src/lib/api.ts:45`).
Fetch response-body streaming landed in **WebKitGTK 2.40**; older webviews give no usable
`res.body` and the dashboard throws "Empty response body". Electron pins its own Chromium
and is immune, so this is a Tauri-only constraint: **WebKitGTK 2.40+ required**
(Ubuntu 23.04+ / Debian 13+). Verified working on 2.52.6 / Ubuntu 24.04.

## Environment overrides

| Var | Default | Purpose |
| --- | --- | --- |
| `KORIS_DESKTOP_PORT` | `0` (ephemeral) | pin the server's loopback port |
| `KORIS_DESKTOP_DEV` | — | `1` forces devtools + dev behaviour (shared with `apps/desktop`) |
| `KORIS_NODE` | `node` | the Node binary used to run the sidecar |

## Layout

| Path | Role |
| --- | --- |
| `sidecar/bootstrap.ts` | Node side: starts the server, reports the port, handles shutdown |
| `splash/index.html` | shown while the server starts |
| `splash/error.html` | startup-failure page; reads the message from `?message=` |
| `src-tauri/src/main.rs` | entry: plugins, single instance, window + background boot, menu events |
| `src-tauri/src/config.rs` | dev/packaged path resolution (port of `apps/desktop/config.ts`) |
| `src-tauri/src/sidecar.rs` | spawn, port handshake, log plumbing, graceful shutdown |
| `src-tauri/src/window.rs` | window, navigation guard, external links, splash→app→error |
| `src-tauri/src/menu.rs` | application menu (port of `apps/desktop/menu.ts`) |

## Security note

The dashboard is loaded from a remote `http://127.0.0.1:<port>` origin.
`capabilities/default.json` deliberately grants it **nothing** — it uses no Tauri JS APIs,
and every plugin (opener, window-state, single-instance) is driven from Rust. Adding a
`remote` key to that capability would hand the server-rendered page IPC access; don't.

## Not implemented

Out of scope for this app, by decision rather than oversight:

- **Packaging, installers, signing, auto-update, CI/release.** `bundle.active` is `false`
  and `pnpm tauri:dev` is the deliverable. `src-tauri/src/config.rs` keeps the
  dev-vs-packaged branch so wiring a bundle later is configuration, not a rewrite.
- **Native notifications.** Needs an event emitter added to `apps/web`, which this app's
  additive scope rules out. Same blocker as `apps/desktop/features/native-notifications.ts`.
- **Tray, global shortcut, deep links.** Tauri v2 has a plugin for each; none is needed to
  use the app, and deep links (`koris://`) require OS registration, i.e. packaging.
