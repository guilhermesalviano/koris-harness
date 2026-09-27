# `apps/desktop/features/` — deferred desktop features

The Electron app (`apps/desktop/`) is a thin shell: the main process runs the koris server
in-process on a random loopback port and loads the existing web dashboard from that origin
in a native window. Packaging to signed-less installers + GitHub Releases is wired up (see
`packaging.md`, `bundled-runtime.md`). The `.ts` files below are still **not implemented** —
each compiles and exports a named no-op that logs a warning if called.

| File | Status | Summary |
| --- | --- | --- |
| `native-menu.ts` | stub (no-op) | Full application menu: New chat, open session, Settings/Providers/Skills/Heartbeats, docs & repo links, Check for updates. Replaces the minimal role-only menu in `apps/desktop/menu.ts`. |
| `tray.ts` | stub (no-op) | System-tray icon + quick actions (show/hide, new chat, quit); optional "close to tray". |
| `native-notifications.ts` | stub (no-op) | IPC channel `koris:notify`; renderer posts assistant-reply / heartbeat-output events, main raises an OS `Notification`; click focuses the window and routes to the session. Needs a small emitter added in `apps/web` (see note in the file). |
| `auto-update.ts` | stub (no-op) | `electron-updater` wiring: feed URL, check on launch + periodic, download / notify / quit-and-install. |
| `window-state.ts` | stub (no-op) | Persist window bounds + maximized/fullscreen + last route to `app.getPath('userData')` (e.g. `electron-store`), restore on launch. |
| `global-shortcut.ts` | stub (no-op) | Global hotkey to summon the window / a quick-ask popover. |
| `deep-links.ts` | stub (no-op) | Register the `koris://` protocol and route `koris://session/<id>`, `koris://setup`, etc. |
| `bundled-runtime.md` | **done** | Server runs in the Electron main process (no bundled Node); server tree + pruned `node_modules` are bundled; `KORIS_APP_DIR` / `KORIS_DATA_DIR` split the read-only bundle from the writable per-user data dir. |
| `packaging.md` | **mostly done** | `electron-builder.yml` + `scripts/` produce Linux/Windows/macOS installers, wired to GitHub Releases via `.github/workflows/release-desktop.yml`. Still TODO: code signing / notarization. |
| `api-base-url-seam.md` | design note | Still unnecessary — the window loads an `http://127.0.0.1:<port>` origin, so relative `fetch` + `BrowserRouter` keep working. Only needed for a `file://` / `app://` mode. |

## How to pick one up

1. Implement the exported function (keep the same name/signature).
2. Call it from `apps/desktop/main.ts` `bootstrap()` (or the relevant lifecycle hook).
3. Add any new dependency to the **root** `package.json` (`apps/desktop`'s own manifest
   carries no dependencies, matching `apps/web` and `apps/tui`).
4. `pnpm lint:desktop` must stay green.
