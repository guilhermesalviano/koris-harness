# Deferred: API base-URL seam in `apps/web`

**Status:** not implemented, and **not needed** for the current desktop design.

The desktop app now runs the server in-process (see `bundled-runtime.md`) but still on an
HTTP listener — `http://127.0.0.1:<random-port>`, the exact origin the koris server serves
the SPA from. So every relative call in `apps/web/src/lib/api.ts` (`/api/chat`,
`/api/admin/*`, `/health`) and `BrowserRouter` still just work, unchanged: the ephemeral
port is transparent because the window origin *is* the server origin.

This note only matters if a future desktop mode stops using an HTTP origin — e.g. loading
the bundle from `file://` or a custom `app://` protocol while the server routes over IPC or
a Unix socket.

## What it would take

1. `apps/web/src/lib/api.ts`: introduce `const API_BASE = (window as any).koris?.apiBaseUrl ?? ''`
   and prefix `fetch` targets with it (`\`${API_BASE}/api/chat\``, etc.). `''` keeps today's
   same-origin behaviour.
2. `apps/desktop/preload.ts`: add `apiBaseUrl` to the exposed `koris` object.
3. Router: swap `BrowserRouter` → `HashRouter` in `apps/web/src/main.tsx` when served from a
   non-HTTP origin (or gate on `window.koris?.isDesktop`), because `file://`/`app://` have no
   server-side SPA fallback.
4. SSE: `fetch` streaming already works cross-origin; the server would need permissive CORS
   for the non-HTTP origin, or route everything through the preload via IPC.

Prefer keeping the `http://localhost` origin (this file staying unused) unless there's a
hard reason to move off it.
