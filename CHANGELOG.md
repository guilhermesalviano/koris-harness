# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ⚠ BREAKING

- `sessions` is re-keyed from a single opaque `entry_channel` string to `channel` + `peer_id` + `kind` (`user`|`delegated`), and two new tables (`errands`, `errand_targets`) are added. There is no migration — run `pnpm clear:memory` before starting after this update.

### Added

- **Errands**: `/errand <goal> with <contact> on <channel>` starts a delegated conversation koris runs on your behalf with someone else, negotiating autonomously (via a dedicated negotiator sub-agent, no tools, no memory of your personal facts) and escalating back to you when it needs input, until it resolves. `/errand` lists errands, `/errand approve <id>` sends a staged opener, `/errand close <id>` / `/errand cancel <id>` end one manually. New admin API routes (`GET/POST /api/admin/errands*`) and an Errands tab in the dashboard alongside Sessions.
- Sessions are now addressed by `(channel, peer_id, kind)` instead of an opaque `entry_channel`, so a delegated (errand) conversation and the principal's own session with the same channel/contact are distinct and independently addressable. Delegated sessions never rotate on idle TTL and get a wider history window (`errands.history_limit`, default 100 vs. the normal 15).
- Outbound sends (`OutboundMessageService`) now record what koris said into the target session's own transcript, not just the delivery receipt log — a session no longer goes half-deaf after the first outbound message.
- New `errands.*` config block (`hard_expiry_ms`, `history_limit`, `max_concurrent`); `session.ttl_ms` is now validated by `pnpm validate`.
- Beats: `heartbeat.run_once` column (auto-migrated; existing beats stay recurring) and `isOneTimeCron` in the tool SDK (`plugins/tools/cron.ts`). The admin API exposes `run_once` and accepts `runOnce` on create/update; the Beats page marks one-time beats.

### Fixed

- Errand resume failures no longer forward private principal instructions, and invalid negotiator output cannot leak internal JSON notes to contacts.
- Errand approval/resume now awaits delivery. Failed messages remain pending for manual retry through `/errand retry <id>` or the dashboard; durable per-target receipts prevent resending to successful targets after restart. Existing errand databases automatically gain the nullable `pending_delivery` column.
- Late errand notices stay in their original transcript after session rotation. Stale errands release capacity and eligible queued work before new errands are admitted.
- The Errands page displays staged messages, escalation questions, and delivery failures with a Retry Send action.

- Session metadata/message-count updates now write a sparse patch instead of the whole session row, which previously reopened a just-closed session (`ended_at` resurrected to null) on the next message after `/clear`.
- Ending a session and starting its replacement (`/clear`, `/compact`, idle-TTL rotation) is now atomic — a failed insert can no longer leave a channel with zero open sessions.
- The admin API's session delete/create routes now invalidate the in-process session cache, instead of leaving it holding a stale or deleted session.

### Changed

- `set_beat` (koris-hub) defaults to a one-time beat: without `recurring: true` the cron must pin minute, hour, day-of-month and month (day-of-week `*`), derived from the current date. `recurring: true` (daily/weekly/monthly/yearly) keeps firing every year until deleted. `update_beat` accepts `recurring` too.

### Fixed

- One-time beats no longer re-fire a year later: they are deleted after they fire, and a one-time beat whose time passed while the process was down is removed instead of waiting a year.

### Removed

## [0.1.4] - 2026-09-02

### Added

- Desktop app (`apps/desktop/`): Electron shell that spawns/attaches the server and loads the web dashboard in a native window — tray icon, native menu, native notifications, global shortcut, deep links, and window-state persistence. `pnpm desktop` (build + launch), `pnpm desktop:dev`, `pnpm desktop:package` / `pnpm desktop:package:dir` to build installers.
- Config: `config.DATA_DIR` (writable: `koris.json`, `memory/`, `logs/`) is now tracked separately from `config.BASE_DIR` (read-only: `dist-web/`, `skills/`, bundled assets) — both default to the cwd in a normal checkout, but the packaged desktop app sets `KORIS_APP_DIR`/`KORIS_DATA_DIR` since its app bundle is read-only.
- CI: `.github/workflows/release-desktop.yml` builds and publishes installers for Linux (`.deb`, `.AppImage`), macOS (arm64/x64 `.dmg`), and Windows (`.exe`) on release.

### Changed

- `pnpm-workspace.yaml`: `better-sqlite3` moved to `ignoredBuiltDependencies` (it ships N-API prebuilds, so the implicit `node-gyp rebuild` was unnecessary and broke CI on Windows runners without the MSVC toolchain); `electron` added to `onlyBuiltDependencies`.

### Removed

- macOS 13 from the desktop installer build matrix.
- `.blockmap` files from desktop release artifacts.

## [0.1.3] - 2026-09-02

### Added

- Web: first-run setup wizard (`/setup`) — configure the AI provider, Telegram/WhatsApp channels, web search, allowed domains, and personal info from the browser instead of hand-editing `koris.json`. Launches automatically when no `koris.json` is found.
- Web: `Settings` page is now a live editor (reusing the setup wizard's form) instead of a read-only JSON dump, so configuration can be changed after first run too.
- Server: settings changes made through the wizard/Settings page apply immediately — the AI provider and Telegram/WhatsApp channels reload without restarting the process.
- CLI: on startup, if no `koris.json` is found, prints instructions pointing to the web setup wizard or the `pnpm onboard` CLI flow.
- Agent: when a human asks for documentation, plugins, skills, the marketplace, or the project website, the assistant now points them to https://hub.koaris.com.
- Tools: `search_engine` now uses a self-hosted SearXNG instance (`ai.searxng_url`) as its primary provider — free, no per-query cost. The existing SerpAPI implementation (`ai.search_api_key`) is kept in code as a fallback, currently inactivated.

### Changed

- The public website, plugins marketplace, and documentation moved to a separate `koris-hub` repo; this repo no longer builds or serves a website.

### Removed

## [0.1.1] - 2026-08-19

Web dashboard refresh: light/dark theme toggle, reorganized sidebar, and collapsible navigation.

### Added

- Web frontend: light/dark theme toggle (dark by default), persisted in `localStorage`.
- Web frontend: per-page document titles and meta descriptions; page headers show a short description subtitle.
- Web frontend: favicon switches to an alert variant when an AI response finishes while the tab is unfocused, restored when the page is opened again.

### Changed

- Web frontend: reorganized the admin sidebar — main menu at the top, "New chat" + chat history in the middle, and a bottom Config menu for less-used items (Sessions, Channels, Audit, Usage, Settings).
- Web frontend: mobile menu drawer now mirrors the full sidebar layout.
- Web frontend: header hamburger collapses/expands the desktop sidebar to icon-only mode (state persisted); brand moved to the left and the status pill to the right.

### Fixed

### Removed

## [0.1.0] - 2026-08-18

First public release of Koris Assistant.

### Added

- Autonomous AI agent framework in TypeScript with a main agent, tool-call pipeline, and executor worker loop.
- Pluggable channel system: Telegram, WhatsApp, terminal UI (`--tui`), and web dashboard (port 3000).
- LLM provider support for Ollama, NVIDIA, and Mock, with serial/concurrent queue control via `ai.parallel`.
- Persistent SQLite memory: sessions, short-term messages, long-term memories (summary/fact/lesson/reminder), and learned skills.
- Summarizer sub-agent to condense long conversations into memories.
- Heartbeat sub-agent for scheduled beats with cron expressions; dashboard and `beats/*` tools to manage them.
- Default heartbeat sync from `heartbeats.default.json`, including a daily `__koris_clear_images__` beat that purges the images table without an LLM call.
- Skills system: markdown skill definitions under `skills/` synced into the database at startup and on file changes.
- Tools: `curl_request` (domain allowlist), `search_engine` (SerpAPI), and beat CRUD (`set_beat`, `list_beats`, `update_beat`, `delete_beat`).
- Security gate for outbound URLs and safe child-process execution for shell tools.
- Web frontend (React 19 + Vite + Tailwind): admin dashboard, multi-session chat with SSE streaming, memories, heartbeats, skills, settings, and queue visibility.
- Image support end-to-end: attach images in Telegram, WhatsApp, and web chat; store in a dedicated `images` table; forward to vision-capable providers with analysis instructions; preview and lightbox in the web UI; show a fallback when a stored image was deleted.
- Onboarding CLI (`pnpm onboard`), settings validation (`pnpm validate`), and provider health checks.
- Vitest test suite with optional Stryker mutation testing.

### Changed

- Message gateway accepts `{ text, images? }` payloads instead of plain strings.
- Chat history API returns `images` and `missingImages` per message for dashboard hydration.
- Web chat API accepts up to 10 base64 images per message; JSON body limit raised to 25 MB.

### Removed

- `execute-command` tool.
