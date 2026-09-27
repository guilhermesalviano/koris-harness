# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

`koris` is an autonomous AI agent framework written in TypeScript (CommonJS, strict mode). It receives messages through pluggable channels (Telegram, WhatsApp, TUI, web dashboard, and desktop shells), runs them through an LLM, and can execute tools (`curl`, search, beats, issue tracking, sticker learning, learned-skills instructions, and remote MCP servers). It supports voice notes and speech synthesis via a local Whisper/Piper audio sidecar, persistent SQLite memory, session tracking, heartbeat (scheduled) agents, and a summarizer sub-agent.

## Key project peculiarity: Plugins live in `koris-hub` (separate repository)

**Anything needed from plugins (channels, tools, skills, MCP servers, marketplace metadata, and plugin-specific dependencies) belongs in the separate project `koris-hub` (`git@github.com:guilhermesalviano/koris-hub.git`).**

- **`koris` is strictly the runtime engine:** It defines plugin contracts (`plugins/channels/contracts.ts`, `plugins/tools/contracts.ts`, `plugins/mcps/contracts.ts`), executes them, handles database persistence, and serves the UI. It does **not** vendor channel dependencies or hardcode plugin-specific implementations.
- **`koris-hub` is the plugin source of truth:** Plugin implementations (`koris-plugins/channels/`, `koris-plugins/tools/`, `koris-plugins/skills/`, `koris-plugins/mcps/`), pre-bundled channel artifacts (`index.js`), third-party libraries (e.g. `@whiskeysockets/baileys`, `@guilhermesalviano/telegram-bot`), and marketplace metadata (`content/marketplace/`) all live in `koris-hub`.
- **Dynamic discovery & UI agnosticism:** `koris` discovers and loads channels, tools, skills, and MCP servers dynamically on demand (via `hub-sync`, disk discovery, and `/channels`, `/tools`, `/skills`, or `/mcps` commands). The web UI (e.g. `ChannelsStep`, `PluginsStep`), onboarding, and admin APIs must remain **plugin-agnostic**:
  - Do **not** hardcode channel names (like Telegram, WhatsApp), channel-specific tokens, or specific form layouts in core components.
  - If a plugin needs new configuration fields (`configFields`), hints, descriptions, or behavior adjustments, **those changes must be made in `koris-hub`** (or executed via a prompt in `koris-hub`).
  - Pulled plugins land in `plugins/<family>/<slug>/` and remain gitignored in this repository.
- **Detailed guide & bash examples:** See [PLUGINS.md](PLUGINS.md) for how channels, tools, skills, and MCP servers are discovered, downloaded, and configured.

## Tech stack & package manager

- **Package manager:** `pnpm` (`pnpm@10.18.3`, single-package workspace). Never use `npm`/`yarn`.
- **Runtime:** Node >= 24. **Build:** `tsc` → `dist/`. No bundler.
- **Database:** `better-sqlite3` (synchronous, WAL). DB file lives in `memory/database.db`.
- **LLM providers:** Ollama (native), an `openai-compatible` client with presets (`openai`, `deepseek`, `groq`, `openrouter`, `xai`, `mistral`, `together`, `gemini`, `nvidia`), and Mock. `koris.json` keeps every configured provider in `ai.providers[]` (creds + `num_ctx` + a single `model`) and points each role at one via `ai.roles` (`ai.roles.manager` = main agent, `ai.roles.workers` = workers/summarizer/heartbeat) — each role pointer is just `{ provider }`, the model is resolved from the entry. Embeddings have their own pointer `ai.embed` (`{ enabled, provider, model }` — base_url/api_token reused from the matching `ai.providers[]` entry), resolved to `config.AI.EMBED` and routed through `getAIProvider(logger, 'embed')`. See "AI providers" below.
- **MCP client:** `@modelcontextprotocol/client` (Streamable HTTP transport) connects external MCP servers, discovering and exposing remote tools.
- **Audio sidecar:** Local HTTP sidecar on port 6006 providing `sherpa-onnx` (quantized Whisper int8 STT) and Piper neural TTS voices.
- **Desktop shells:** Native Electron shell (`apps/desktop/`, in-process Node server) and Tauri shell (`apps/tauri/`, Rust + native OS webview supervising a Node child process).
- **Testing:** Vitest (globals enabled, `@` alias → `core/src`). Mutation testing via Stryker.
- **Channels:** Pluggable channels downloaded on-demand from `koris-hub` (e.g. WhatsApp, Telegram). Pre-bundled standalone channel artifacts with self-contained dependencies.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm build` | Clean + compile TS → `dist/` and build the web frontend → `dist-web/` (required before `pnpm app`) |
| `pnpm build:client` | Build only the web frontend (`vite build` → `dist-web/`) |
| `pnpm build:desktop` | Compile Electron desktop shell (`apps/desktop/out/`) |
| `pnpm build:tauri` | Compile Tauri Node sidecar (`apps/tauri/sidecar/out/`) |
| `pnpm dev:client` | Vite dev server (port 5173), proxies `/api` and `/health` to `localhost:3000` |
| `pnpm app` | Run agent (web on port 3000). Add `--tui` for TUI |
| `pnpm onboard` | First-time onboarding flow |
| `pnpm validate` | Validate `koris.json` against expected schema |
| `pnpm desktop` | Run the Electron desktop shell |
| `pnpm desktop:dev` | Run the Electron desktop shell in dev mode |
| `pnpm desktop:package` | Package Electron desktop application for distribution |
| `pnpm tauri:dev` | Run the Tauri desktop shell in dev mode |
| `pnpm audio:setup` | Download default speech models (`whisper-small` + Piper voice) |
| `pnpm audio:start` | Run the local audio sidecar (Whisper STT + Piper TTS) via Docker Compose |
| `pnpm hub:list` | List remote plugins in `koris-hub` not yet present locally |
| `pnpm hub:pull <slug>` | Fetch a plugin from `koris-hub` into local `plugins/<family>/<slug>/` |
| `pnpm scaffold:tool` | Scaffold a new tool plugin template under `plugins/tools/<name>/` |
| `pnpm lint` | Type-check server (`tsc --noEmit`) — run this after any change |
| `pnpm lint:client` | Type-check the web frontend (`tsc --noEmit -p apps/web/tsconfig.json`) |
| `pnpm lint:desktop` | Type-check the Electron desktop shell (`tsc --noEmit -p apps/desktop/tsconfig.json`) |
| `pnpm lint:tauri` | Type-check the Tauri sidecar (`tsc --noEmit -p apps/tauri/sidecar/tsconfig.json`) |
| `pnpm test` | Run full Vitest suite (`vitest run`) |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Coverage report |
| `pnpm test:mutation` | Stryker mutation testing |
| `pnpm clear:memory` | Delete SQLite database files under `memory/database.*` |

## Repository layout (quick map)

- `core/src/app.ts` — process entry point: wires DB, SessionManager, MessageGateway, channels, heartbeat, web server, TUI. Mode detection via argv flags.
- `core/src/onboard.ts`, `core/src/validate-settings.ts` — CLI entry points (`pnpm onboard`, `pnpm validate`).
- `core/src/config/` — loads `koris.json` into the typed `config` constant (`config/index.ts`). `config.BASE_DIR` (read-only assets: `dist-web/`, `plugins/skills/`, `heartbeats.default.json`, `core/load/`) is `KORIS_APP_DIR || process.cwd()`; `config.DATA_DIR` (writable: `koris.json`, `memory/`, `logs/`) is `KORIS_DATA_DIR || process.cwd()`. Both equal the cwd in a normal checkout — the split only matters for the packaged desktop app. Read-only; every module imports `config` directly.
- `core/src/constants/` — static prompt/agent text: main agent prompt, sub-agent prompts, thinking, TUI, command help.
- `core/src/entities/` — plain data types: `message`, `session`, `memory`, `heartbeat`.
- `core/src/types/` — TypeScript interfaces/typedefs (agents, chat, tools, workers, memory, etc.). Shared contracts live here.
- `core/src/infrastructure/` — `db-sqlite.ts` (SQLite wrapper + schema + factory) and `logger.ts` (Winston `LoggerFactory`).
- `core/src/repositories/` — data-access layer, one file per table/concern: `session`, `message`, `memory`, `skills`, `learned-skills`, `prompt` (builds LLM prompt payload), `context`, `heartbeat`, `tools`, `pre-prompt`. All return raw rows / typed records; SQL is written here, not in services.
- `core/src/services/` — business logic (see below).
- `core/src/services/mcps/` — `mcp-manager.ts` (McpManager managing Streamable HTTP connections, listing remote tools, mapping to `<server>__<tool>`, and updating `ToolPluginsSingleton`) and `mcp-sync.ts` (hot-loading pulled MCP servers).
- `core/src/services/audio/` — `audio-transcription-service.ts` (STT client calling `http://127.0.0.1:6006/v1/audio/transcriptions`) and `audio-synthesis-service.ts` (TTS client calling `http://127.0.0.1:6006/v1/audio/speech`).
- `core/src/channels/` — the channel runtime: `ChannelsManager`/`ChannelsSingleton`, the generic inbound pipeline (`handler.ts`), and response/utils helpers (`utils.ts`). It implements the channel contract from `plugins/channels/contracts.ts`.
- `core/src/dashboard/` — Express web server (`DashboardServerFactory`), port 3000: serves the built frontend from `dist-web/` and mounts `/api/chat` (SSE) + `/api/admin` (see `admin.ts`).
- `core/src/utils/` — pure helper functions (prompt replacement, curl, dates, telegram escaping, tool-call parsing, sanitize-log-text, etc.).
- `core/load/` — files injected into the agent's context at startup (e.g. `SOUL.md`).
- `memory/` — runtime SQLite database files (gitignored state).
- `core/temp/` — runtime scratch dir for generated files (heartbeat reports, etc.).
- `core/tests/` — Vitest suites: `unit/`, `integration/`, plus `helpers/test-config.ts` and `setup/vitest.setup.ts`.
- `apps/tui/` — terminal UI wrapper (flat module, one file per concern, co-located `*.test.ts`).
- `apps/web/` — the web frontend (React 19 SPA; see "Web frontend" below).
- `apps/desktop/` — Electron shell that runs the koris server **in-process** (`server-runtime.ts` `require()`s `dist/core/src/app.js` and calls its exported `startServer()`; no child process, no bundled Node) on an ephemeral loopback port and loads the web dashboard from that origin in a native window. Own `tsconfig.json` (→ `apps/desktop/out/`) and `package.json` (electron-builder needs it). Packaging: `electron-builder.yml` + `apps/desktop/scripts/` + `.github/workflows/release-desktop.yml`. See `apps/desktop/README.md`.
- `apps/tauri/` — Tauri desktop shell that runs the koris server as a supervised **Node child process** (`apps/tauri/sidecar/bootstrap.ts`) with a native OS webview window (~80–100 MB RAM, WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS), port reporting over stdout, stdin orphan guard, and startup splash screen. See `apps/tauri/README.md`.
- `plugins/registry.ts` — the shared, family-agnostic plugin kernel (`ExtensionPoint`, `PluginRegistry`, `buildRegistry`) used across `plugins/channels/`, `plugins/tools/`, and `plugins/mcps/`.
- `plugins/config/` — shared per-plugin `config.yml` helpers (`definePluginConfig`, loader, writer), parameterized by `family: 'channels' | 'tools' | 'mcps'`.
- `plugins/channels/` — the channel plugin system with inverted dependencies. `contracts.ts` (the dependency-free plugin SDK: `PluginContext`, channel/gateway/logger interfaces, `ADAPTERS`, `splitMessage`) + one folder per channel plugin (`telegram/`, `whatsapp/`), each exposing `create(context)`.
- `plugins/tools/` — the AI-agent tool plugin system, same shape as `plugins/channels/`. `contracts.ts` (the dependency-free SDK: `ToolPluginContext`, `ToolDefinition`, `COMMANDS`). Shared helpers: `runtime.ts` (arg coercion, safe child-process exec), `cron.ts` (cron validation for the beat tools).
- `plugins/mcps/` — the Model Context Protocol (MCP) server plugin system. `contracts.ts` (dependency-free SDK: `McpPluginContext`, `McpServerDefinition`, `MCP_SERVERS`). External servers are configured via per-plugin `config.yml` and hot-loaded by `McpSyncService`.
- `plugins/skills/` — markdown skill definitions, one folder per skill with a `SKILL.md` (front-matter `name`/`description` + body). Synced into the `learned_skills` table at startup and on file changes by `core/src/services/skills/skill-sync.ts`.
- `scripts/` — helper scripts (`init.ts`, `release.ts`, `scaffold-tool.ts` + `scaffold-tool-cli.ts` for `pnpm scaffold:tool`, `hub-sync.ts` + `hub-sync-cli.ts` for `pnpm hub:list`/`pnpm hub:pull`).
- `scripts/audio/` — local speech sidecar running `sherpa-onnx` (quantized Whisper int8 STT) and Piper (neural TTS) via Docker Compose or native Python on port 6006 (`server.py`, `run_audio_sidecar.sh`, `setup.sh`).
- `scripts/search/` — self-hosted SearXNG for the `search_engine` tool: `run_search_engine.sh` (pass `--restart` to force a `down`+`up` recreate instead of the default start-if-not-running, used by the `restart_search_engine` tool), `searxng/` (`docker-compose.yml`, `settings.example.yml`), and `config/settings.yml` (gitignored, generated by the script from the example on first run).
- `dist/` — build output (never edit).
- `dist-web/` — built web frontend (never edit).

## Core message flow (follow this to trace behavior)

1. A channel plugin (`plugins/channels/telegram`, `plugins/channels/whatsapp`, or `apps/tui`) or the web dashboard receives a message, normalizes it into an `InboundChannelMessage`, and delegates to the generic `IChannelHandler` (injected via `PluginContext.channelHandler`, `core/src/channels/handler.ts`). If the inbound payload contains an audio attachment (e.g. voice notes from WhatsApp or audio uploaded in web chat) and `config.AUDIO.STT.ENABLED` is true, it is transcribed via `getAudioTranscriptionService(logger).transcribe(audioBuffer)` into text before processing.
2. `IChannelHandler` applies channel rules (group-mention filter, trust-based tools/learned-skills gating, prompt prefixing, reply splitting) and calls `MessageGateway.handle(message, originId)`. `MessageGateway` resolves the session via `session-context.ts`, checks for commands (`/help`, `/mode`, `/mcps` etc. via `core/src/services/commands/`), else delegates to the **MainAgent**.
3. `core/src/services/agents/main-agent.ts` passes the user message (the Tool Execution Contract lives in the system prompt via `TOOL_EXECUTION_CONTRACT`), calls `ChatService.complete()` (`core/src/services/chat/chat-service.ts`), which builds the full prompt via `PromptRepository.build()` and calls the AI provider.
4. If the LLM returns tool calls, MainAgent hands them to the **ToolCallPipeline** (`core/src/services/agents/tool-call-pipeline.ts`), which sends them to the **ExecutorWorker** (`core/src/services/workers/executor-worker.ts`) which loops tool-call → tool result → next LLM call until a final message. Tools dispatched include both local tools (`plugins/tools/`) and external MCP server tools (`plugins/mcps/`, mapped as `<server>__<tool>`).
5. Once a final response is generated, if the conversation is in voice reply mode (`/mode voice`) and the channel adapter implements `sendAudio` (`reply.sendAudio`), `ChannelHandler` calls `getSpeechSynthesisService(logger).synthesize(text)` and sends the audio clip instead of text.
6. `MessageGateway` (via `background-dispatcher.ts`) fires background jobs: `ConversationWorker` (`core/src/services/workers/conversation-worker.ts`) persists the exchange, and the **Summarizer** sub-agent (`core/src/services/agents/sub-agents/summarizer/`) may condense long context into memories. In `session.summarizer_mode: "manual"` the per-turn summarizer is off, so `MessageGateway` runs a safety valve instead: before a turn, if the estimated session tokens (`core/src/services/agents/context-budget.ts`) exceed `session.compact_threshold` (default 0.9) × the manager's `num_ctx`, it auto-`/compact`s (summarize → rotate to a fresh session seeded with the summary); it also does so reactively on a `context_length` provider error and retries the turn once. Either way it explains itself with a one-line `ProcessOptions.onProgress` notice.
7. Sub-agent execution loop keeps firing until terminal message or max iterations. Abort via `AbortController` passed in `ProcessOptions`.

## AI providers

- `core/src/services/providers/index.ts` — manifest registry + singleton `getAIProvider(logger)`. Each provider folder exports `providerManifest(): ProviderRegistration[]` (`manifest.ts`); `index.ts` combines the manifests it imports into a `Map<name, registration>`. `getSupportedProviders()`, `getProviderDefaultBaseUrl()`, `isOpenAICompatibleProvider()`, `resolveProviderBaseUrl()`, `getProviderCatalog()` all read that map, so onboarding (`core/src/onboard.ts`), the web setup wizard (`GET /api/admin/capabilities`), the **Providers page** (`GET /api/admin/providers` — catalogue with `label`/`apiKeyUrl`/`docsUrl`/`embeddings`/`recommendedModel` + the active per-role config), and `checkAiProviderConnectivity` (`core/src/config/validators.ts`) pick up new providers automatically. Provider display metadata + OpenRouter's `HTTP-Referer`/`X-Title` headers live on the preset rows in `openai-compatible/presets.ts`.
- Implementations: `ollama/index.ts` (native `/api/chat`), `mock/index.ts` (echo; forced under Vitest / unknown-provider fallback), `openai-compatible/index.ts` — one generic OpenAI Chat Completions client parameterised by `openai-compatible/presets.ts` (`openai`, `deepseek`, `groq`, `openrouter`, `xai`, `mistral`, `together`, `gemini`, `nvidia`; `nvidia` keeps the model-namespace 404 hint). All implement `AIProvider` (`core/src/types/chat.ts`).
- Config shape (`core/src/config/ai-config.ts`): `ai.providers[]` entries are `{ provider, base_url, api_token, num_ctx?, model }` (one model per provider — the provider name is the unique entry key); `ai.roles.<role>` is just `{ provider }` pointing at one of them (the model is resolved from the entry); `ai.embed` is a separate pointer `{ enabled, provider, model }` (its base_url/api_token reused from the matching `ai.providers[]` entry, its `model` kept on the pointer since the embed model differs from the provider's chat `model`). `resolveAiRoles` joins pointer→entry (each role's `num_ctx` from its own provider entry, default `DEFAULT_NUM_CTX` = 16384) into `config.AI.MANAGER` / `config.AI.WORKERS`, and `resolveEmbed` builds `config.AI.EMBED`; the OpenAI-compatible client sends the role's `num_ctx` as the request `max_tokens` (Ollama sends it as `options.num_ctx`); the `'embed'` provider role (`getAIProvider(logger, 'embed')`) serves the `.embed()` call sites (summarizer sub-agent, `PromptRepository`). A `base_url` left empty falls back to the provider's shipped `defaultBaseUrl` (`resolveProviderBaseUrl`). This is the only `ai` shape understood — there is no auto-migration from older layouts (regenerate from `koris.example.json` if the file drifts). The web UI's per-role `POST /settings` patch (`{ai:{<role>:…}}`, `{ai:{provider:…}}` for save-only, or `{ai:{embed:…}}`) is translated into an `ai.providers[]` upsert (`applyAiRolePatch` / `applyAiProviderPatch` / `applyAiEmbedPatch`) so switching a role never drops another provider. Provider error strings must keep a `(NNN)` status token or a keyword (`aborted`, `timed out`, `missing content`, …) — `AICompletionService.mapError` parses them for retry / `AIErrorCode` classification (`aborted`, `timeout`, `authentication`, `rate_limited`, `unavailable`, `malformed_response`, `context_length`, `unknown`). A `context_length` error in manual summarizer mode makes `MessageGateway` auto-compact + rotate the session and retry the turn once.
- `core/src/services/provider-health-service.ts` — health checks / timeouts for providers.
- Add an **OpenAI-compatible** service: one row in `openai-compatible/presets.ts`. Add a **native** provider: create `core/src/services/providers/<name>/index.ts` exporting `providerManifest()`, then add its import + array entry in `index.ts` (`PROVIDER_MANIFESTS`). Embeddings: providers without an `/embeddings` endpoint (e.g. `groq`, `xai`) throw from `embed()`; callers in `prompt.ts` / the summarizer catch + warn, so semantic memory silently degrades — point `ai.embed` at an embeddings-capable provider (`{ enabled, provider, model }`).

### Background sub-agent queueing

Two independent flags control how LLM calls are ordered:

- `ai.parallel` — **provider-level** (`core/src/services/providers/serial-queue.ts`). `false` → all LLM calls share one slot: interactive calls (`manager`, executor/learner workers) jump ahead of background (`worker:background` — summarizer, heartbeat), and background waits a grace period after the last interactive call. Queue snapshot labels use the calling agent (`manager`, `executorWorker`, `heartbeat`, `summarizer`, …) via `AIChatOptions.audit.agentName`. `true` (default) → the shared queue is bypassed and calls run concurrently (in-flight activity still tracked for the dashboard `/api/admin/queue`).
- `ai.subagents_parallel` — **sub-agent-level** (`core/src/services/sub-agents-queue/task-queue.ts`), independent of the above. `false` (default) → the `heartbeat` and `summarizer` share `sharedSubAgentQueue` (concurrency 1) so they never run simultaneously. `true` → each keeps its own concurrency-1 queue, so they may run at the same time but never concurrently within themselves.

`heartbeat`/`summarizer` never run their own tasks concurrently (no internal concurrency); the flags only change whether the two sub-agents share a queue or not. Note: when both `ai.parallel` and `ai.subagents_parallel` are `false`, the provider queue already serializes everything, making the sub-agent queue redundant for cross-agent ordering (it still guarantees within-agent ordering). Sub-agent queue state is exposed via `core/src/services/sub-agents-queue/sub-agent-queue-registry.ts` on the dashboard queue page.

## Tools

Tools are plugins under `plugins/tools/` (and connected MCP servers under `plugins/mcps/`) — see "Plugins & skills" below for the full architecture. The pieces on the `core/src/` side are thin seam adapters, not the tool implementations:

- `core/src/services/tools/index.ts` — `AgnosticExecutionTool` dispatches a tool call by name-matching against `ToolPluginsSingleton.getExistingInstance()` (the collected `ToolDefinition[]`, populated at boot and updated dynamically when MCP servers connect or new tools are hot-loaded) and calling its `handler`.
- `core/src/repositories/tools.ts` — `ToolsRepository` turns that same collected `ToolDefinition[]` into the `AIToolDefinition[]` schema array sent to the AI provider, applying each definition's own `enabled(opts)` filter (trust, stickers-enabled, heartbeat-exclusion for beats — see `ToolFilterOptions` in `plugins/tools/contracts.ts`).
- `core/src/services/tools-queue/` — throttling/serialization of tool calls, unaffected by the plugin split.
- Tools: `curl_request`, `search_engine` (SearXNG is the active provider, self-hosted via `ai.searxng_url`), `restart_search_engine` (REQUIRES CONFIRMATION — runs `scripts/search/run_search_engine.sh --restart` to recover from `search_engine` connection/403 failures; `search_engine`'s own description tells the model to offer this when it fails), `issue`, `set_beat`/`list_beats`/`update_beat`/`delete_beat`, `send_message`, `learn_sticker`/`send_sticker`/`unlearn_sticker`, and `create_tool` (scaffolds a new tool plugin from chat — disabled by default, REQUIRES CONFIRMATION, and never usable immediately since the plugin loader only discovers plugins at process startup). Each lives in its own `plugins/tools/<name>/` folder. On/off state is DB-backed (`plugin_settings` table, default `true` except `create_tool`, which defaults `false`) via the admin "Plugins" panel/setup-wizard step — see "Plugins & skills" below — not a `config.yml`. Remote tools from connected MCP servers (`plugins/mcps/`) are registered here dynamically as `<server>__<tool>`.
- `pnpm scaffold:tool <name> --description "..."` (`scripts/scaffold-tool.ts`) generates a new `plugins/tools/<name>/` folder from a template — the same generator function the `create_tool` plugin calls into.

## Security

- `core/src/services/security/gate.ts` — domain allowlist gate for tools. `gateErrorForUrl(input)` returns an error string when a URL's hostname is not in `koris.json` `allowed_domains`, or `null` when permitted; `extractHostname(input)` parses and validates a hostname; `getAllowedDomains()` reads the configured allowlist. The `curl-request` plugin never imports it directly (plugins don't import `core/src/`) — `core/src/app.ts`'s `createToolPluginContext()` injects it as `context.security.gateUrl`.
- `plugins/tools/runtime.ts` — child-process execution helpers with output-size limits and no-shell `spawn`/`execFile` (structural defense against shell injection), shared by tool plugins.

## Workers & sub-agents

- `core/src/services/workers/` — `conversation-worker.ts`, `executor-worker.ts`. All implement the generic `IWorker<TArgs, TResult>` (`core/src/types/workers.ts`).
- `core/src/services/agents/` — `message-gateway.ts` (channel entry facade), `session-context.ts` (session + per-session message/memory services), `background-dispatcher.ts` (fire-and-forget persistence + summarization), `main-agent.ts` (main LLM orchestrator), `tool-call-pipeline.ts` (executor orchestration, shared with heartbeat), `sub-agents/` (`heartbeat/` scheduled beats: `runner.ts` schedules, `sub-agent.ts` runs the beat LLM, `default-beats.ts` syncs `heartbeats.default.json`; `summarizer/`).
- `core/src/services/skills/` — `skill-sync.ts` (`SkillSyncService` + `SkillSyncSingleton`): syncs `plugins/skills/` into `learned_skills` at startup and on file changes (fs.watch + 500ms debounce), pruning rows whose skill folder was removed.

## Plugins, skills & MCP servers (extension mechanisms)

See [PLUGINS.md](PLUGINS.md) for a comprehensive architecture guide and runnable bash examples covering dynamic discovery, artifact downloading, and configuration loading from `koris-hub`.

- **Channel plugins** (`plugins/channels/`): the plugin SDK lives in `plugins/channels/contracts.ts` (dependency-free: `PluginContext`, `ChannelDefinition`, `ADAPTERS`, `ILogger`/`IMessageGateway`, channel-handler types, `splitMessage`), built on the shared kernel in `plugins/registry.ts`. Channels live in `koris-hub` as pre-bundled self-contained artifacts (`index.js` bundling any channel dependencies like `@whiskeysockets/baileys` or `@guilhermesalviano/telegram-bot`) and are pulled on demand via `pnpm hub:pull <slug>`, `/channels download <slug>`, or via the web setup wizard / admin plugins panel into `plugins/channels/<slug>/`. The `/channels` slash command manages channels from chat (`/channels`, `/channels remote`, `/channels pull <name> [--force]`, `/channels activate <name> [key=value ...]`, `/channels disable <name>`; `enable` is an alias of `activate`, `download` of `pull`). A pull installs the channel **inactive** (`registerPulledChannel` writes `enabled = false` rather than trusting the "no row means off" default, so a re-pull can't inherit a stale row). Turning a channel on and configuring it are one command: `/channels activate <name>` writes any `key=value` pairs to `config.yml`, reprimes the runtime, enables the channel and starts it live — but if a variable the hub catalog's `configFields` marks `required` is still unset it changes nothing and replies with which one and how to pass it. Plugins never import from `core/src/` — the app injects concrete services via a `PluginContext` built in `core/src/app.ts` (`createPluginContext`) and passed to `createPlugins({ context })` → each plugin folder's `create(context): Plugin`. koris does not build channel bundles: `koris-hub` owns that (`pnpm build:channels` there), and koris only consumes the published asset.
  - **A channel bundle must be fully self-contained.** koris-hub's `scripts/build-channels.ts` inlines koris's own SDK (`../contracts`, `../channel-config`, `../../registry`, plus the `plugins/config/` helpers they pull in) into each `<slug>-index.js`, resolving them against byte-identical copies vendored in koris-hub at the paths those relative imports point to (`koris-plugins/channels/contracts.ts`, `koris-plugins/registry.ts`, `koris-plugins/config/*`). koris stays the source of truth for their content; `pnpm check:host-sync` there fails on drift. Leaving them external does not work — koris ships them as `.ts`, which Node's CJS resolver will not load, so the channel dies at `require` and `createPlugins` skips it with only a console warning. The build fails on any relative specifier that survives into the output, and `pnpm hub:pull` re-checks by loading the bundle before reporting success.
- **Tool plugins** (`plugins/tools/`): the same architecture applied to the AI agent's tools, on the same shared kernel. SDK in `plugins/tools/contracts.ts` (dependency-free: `ToolPluginContext`, `ToolDefinition`, `ToolHandler`, `ToolFilterOptions`, the `COMMANDS` extension point, and narrow per-concern gateways — `IHeartbeatGateway`, `IChannelsGateway`, `IStickerRulesGateway`, `security.gateUrl`, `config`, `pluginEnablement`). `core/src/app.ts`'s `createToolPluginContext()` adapts concrete core services into that narrow context. Tools live in `koris-hub` and are pulled on demand with `pnpm hub:pull <slug>`, `/tools download <slug>`, or via the web setup wizard / admin plugins panel. A pulled tool is hot-loaded into the running process by `ToolSyncService` (`core/src/services/tools/tool-sync.ts`), which watches `plugins/tools/` for new directories, compiles them with `esbuild`, registers them on the live `PluginRegistry`, and updates `ToolPluginsSingleton`.
- **MCP server plugins** (`plugins/mcps/`): integrates external Model Context Protocol servers over Streamable HTTP. SDK in `plugins/mcps/contracts.ts` (`McpPluginContext`, `McpServerDefinition`, `MCP_SERVERS`). Each server lives under `plugins/mcps/<slug>/` and stores its connection settings (`url`, optional `bearerToken`) in a gitignored `config.yml`.
  - `McpManager` (`core/src/services/mcps/mcp-manager.ts`): connects via `@modelcontextprotocol/client`'s `StreamableHTTPClientTransport`, queries the server's tools, registers them on `COMMANDS` as `<server>__<tool>` (capped to 64 chars for LLM compatibility), and pushes them to `ToolPluginsSingleton`. Listens for `tools/list_changed` notifications to refresh tool definitions dynamically. Unreachable servers do not block startup; connection failures are logged and retried only on explicit toggle, config save, or restart.
  - `McpSyncService` (`core/src/services/mcps/mcp-sync.ts`): watches `plugins/mcps/` and hot-loads newly downloaded MCP server plugins at runtime without server restarts.
  - Chat management via `/mcps` (`/mcps`, `/mcps remote`, `/mcps download <name> [--force]`, `/mcps enable <name>`, `/mcps disable <name>`).
- **Plugin on/off state** (`core/src/services/plugins/plugin-enablement.ts`, `core/src/repositories/plugin-settings.ts`): every tool, channel, and MCP plugin's enabled/disabled state lives in the DB-backed `plugin_settings` table (`CHECK(family IN ('tools', 'channels', 'mcps'))`), not in a per-plugin `config.yml`. MCP servers default to disabled (`false`), but `McpSyncService` seeds `true` for a newly hot-loaded (just downloaded) MCP plugin that has no row yet. Toggling is live via `pluginEnablement.isEnabled(name)` closures — no restart needed.
- **Skills** (`plugins/skills/`): markdown files synced into the `learned_skills` table at startup and on file changes by `SkillSyncService` (`core/src/services/skills/skill-sync.ts`), which wraps each `SKILL.md` body in `SKILL_LEARNING_PROMPT` (with `<GATEWAY_HOST>` resolved to `config.GATEWAY_HOST`) and prunes rows whose folder was removed.
- **Skills ingestion mode** (`koris.json` `skills: { mode, limit }` → `config.SKILLS.MODE` (`auto` | `manual`) / `config.SKILLS.LIMIT`):
  - `auto` (default) — every enabled skill's full body is injected into the system prompt under `# Learned Skills Content`.
  - `manual` — only a one-line index is included under `# Available Skills`; the user pulls one skill into context for a single turn with `/<skill-name> [request]` or `/skill <name> [request]`.
- **Admin surface**: tools, channels, MCP servers, and skills are listed unified under the admin "Plugins" panel (`apps/web/src/components/PluginsList.tsx`), backed by `GET /api/admin/plugins` and `PATCH /api/admin/plugins/:family/:name`. MCP servers expose dedicated config editing via `GET/POST /api/admin/mcps/:name/config`.

## Audio subsystem (STT & TTS)

Koris includes a fully local speech sidecar running in Python/Docker (`scripts/audio/`) on port 6006, backed by `sherpa-onnx` and `Piper`:

- **Speech-to-Text (STT)** (`core/src/services/audio/audio-transcription-service.ts`):
  - Calls `POST /v1/audio/transcriptions` via `multipart/form-data`.
  - Converts incoming audio (OGG/Opus from WhatsApp, WebM from Web, MP3, WAV) to 16kHz mono 16-bit PCM using `ffmpeg` and `pydub` with dynamic gain volume normalization.
  - Runs quantized int8 Whisper models (`whisper-small` recommended for multilingual and Portuguese accuracy, `whisper-base`, `whisper-tiny`).
  - Serialized via `p-limit(1)` to bound CPU and thermal usage.
- **Text-to-Speech (TTS)** (`core/src/services/audio/audio-synthesis-service.ts`):
  - Calls `POST /v1/audio/speech` (OpenAI-compatible) and returns `audio/wav` bytes synthesized using Piper ONNX neural voices (`en_US-lessac-medium` default).
  - Serialized via `p-limit(1)`.
- **Interaction & Modes**:
  - Inbound voice notes in WhatsApp or Web are automatically transcribed into user messages.
  - Per-conversation reply mode is toggled with `/mode [text|voice]`. When in `voice` mode and the channel supports `sendAudio`, text responses are synthesized into speech audio notes.

## Desktop shells (Electron vs. Tauri)

Koris provides two alternative native desktop wrappers for the server and web UI:

- **Electron Shell (`apps/desktop/`)**:
  - Runs the koris server **in-process** via `apps/desktop/server-runtime.ts` (`require()`s `dist/core/src/app.js` and calls `startServer()`).
  - Single Node process hosting the Express API and loading the web UI into a native Chromium window.
  - Packaging via `electron-builder` (`pnpm desktop:package`).
- **Tauri Shell (`apps/tauri/`)**:
  - Rust host application rendering the UI in the platform's native OS webview (WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS).
  - Significantly smaller footprint: ~80–100 MB RAM and ~50% smaller installer size compared to Electron.
  - Runs the koris server as a supervised **Node child process** via `apps/tauri/sidecar/bootstrap.ts`.
  - Supervised with stdout port negotiation, stdin EOF orphan guard (ensuring the Node backend terminates immediately if the GUI window is killed), and startup splash/error views.

## Database schema (`core/src/infrastructure/db-sqlite.ts`)

Tables: `heartbeat`, `sessions`, `memories` (long-term; `type` in summary/fact/lesson/reminder), `messages` (short-term, `role` in user/assistant/system), `images`, `learned_skills`, `plugin_settings` (`family`/`name`/`enabled`, PK `(family, name)` with `CHECK(family IN ('tools', 'channels', 'mcps'))` — DB-backed live toggle state for every tool, channel, and MCP plugin). Foreign keys cascade on `session_id`. Database file lives in `memory/database.db`. Access **only** through `core/src/repositories/*`. `DatabaseServiceFactory.create()` is safe to call many times (multiple instances share one DB file; init is reported once).

## Default heartbeats (`core/heartbeats.default.json`)

`core/heartbeats.default.json` defines the beats seeded into the `heartbeat` table on every startup by `seedDefaultBeats()` (`core/src/services/agents/sub-agents/heartbeat/default-beats.ts`, called from `app.ts`). Entries are `{ beat, type, cron_expression, channel?, target? }`. Config-owned beats are marked `managed=1` and fully synced (updated, or pruned when removed from the file); beats created via the `set_beat` tool or dashboard are never touched. Beats with `run_once=1` (the `set_beat` default unless `recurring: true`) must pin an exact date (`isOneTimeCron`) and are deleted by the sub-agent after firing; the runner also drops any whose only occurrence was missed (`isOneTimeBeatExpired`), since a year-less cron would otherwise fire again next year. The reserved `__koris_clear_images__` beat is handled natively by the heartbeat sub-agent (no LLM call) — it empties the `images` table. `images` holds base64 attachments by uuid id; `messages.image_ids` stores the ids.

## Web frontend

- Configuration is a single modal (`apps/web/src/pages/admin/ConfigModal.tsx`), including Plugins → Installed / Marketplace (`PluginsPage.tsx`). `ConfigSaveProvider` in `App` owns in-memory drafts and the serial `SaveCoordinator`; text edits debounce for 600 ms, discrete edits save immediately, and navigation/close flush pending work. Use partial patches for provider edits because roles share provider entries. The setup wizard retains its explicit submit flow. A supplied `personal_information` map in `POST /settings` replaces the previous map, including `{}` to clear it.

- The browser UI is a React 19 SPA (Vite, React Router, Tailwind v4) in `apps/web/`; the server side is the Express dashboard in `core/src/dashboard/`. `core/src/dashboard/index.ts` serves the built bundle from `dist-web/` and ends with an SPA fallback that returns `index.html` for any unmatched GET so React Router owns routing.
- Trace path: `apps/web/index.html` (`#root`) → `apps/web/src/main.tsx` (BrowserRouter) → `apps/web/src/App.tsx` (`/` redirects to `/admin`) → `apps/web/src/pages/admin/AdminLayout.tsx` (sidebar + nested routes) → per-page components in `apps/web/src/pages/admin/`. Shared UI lives in `apps/web/src/components/AdminUI.tsx`.
- Sidebar = agent roster, not a session list. `GET /api/admin/agents` returns the static list in `core/src/constants/agents.ts` (Orchestrator with Negotiator and Watcher (Heartbeat) nested via `parentId`; the Summarizer has no screen — its memories are listed with the `/memories [type] [count]` chat command, `core/src/services/commands/memories.ts`); `lib/agents.ts` `buildAgentTree` + `components/sidebar/AgentTree.tsx` render it. Each agent has a route `/admin/agents/<id>` with its page in `apps/web/src/pages/admin/agents/`. Only the Orchestrator is `messageable`; `/admin`, `/admin/chat*` and unknown agent ids redirect to it.
  - `OrchestratorPage.tsx` — the web chat as one continuous thread across every `web`/`web`/`user` session, paged upward from `GET /agents/orchestrator/timeline?before=<cursor>&limit=` (messages carry `sessionId`; the page lists its sessions with `startReason`/`compactSummary`, plus `activeSessionId` and `nextCursor`). `lib/timeline.ts` `buildThread` places dividers: the hour/day `DateSeparator`, and an accent one at each session start labelled from `sessions.metadata.startReason` (`idle` / `clear` / `compact`, written by `SessionService.forceRotate(reason, …)` and `SessionManager`). The "New session" button calls `POST /agents/orchestrator/new-session` (rotates like `/clear`; reuses an empty open session; 409 while a reply runs).
  - `NegotiatorPanel.tsx` — main area is the negotiation center (`GET /agents/negotiator/notices`: every errand's negotiation session — channel `negotiator`, peer = errand id, opened when the opener is sent — with the Negotiator's notices and the principal's answers; the same response lists the questions still waiting on the principal, which drive the composer. The page polls it every 4s while visible (and right away when the tab becomes visible again) and refreshes the errand list only when the response's `errandsVersion` fingerprint, notices or pending questions change; errand transcripts are refetched only when an errand's state, progress or message counts change); the right aside holds the steps header (Approval → Contacted → Confirm → Done) and the errands (list, transcript, approve/answer/resolve/retry/close/cancel). A `resolved` Negotiator verdict does not close the errand: it moves to `awaiting_confirmation`, holding the closing message (`errands.closing_reply`) until the principal confirms (`POST /errands/:id/confirm`, `resolve_errand`, `/errand resolve`) or adds a requirement (the answer/reply flow). Notices never land in the Orchestrator session; a WhatsApp/Telegram principal still receives them in that chat. `WatcherPanel.tsx` — beats from `GET /heartbeats` plus recent runs from `GET /audit?agentName=heartbeat`; beats are still managed in Configuration → Beats.
- `apps/web/src/lib/api.ts` — `streamChat()` consumes the `/api/chat` SSE stream (`progress` status, `content_block_delta` text, `session` rotation id, `error`); `apiRequest()` calls `/api/admin/*`; `checkHealth()` polls `/health`. `apps/web/src/lib/markdown.ts` + `types.ts` handle rendering and response types.
- `apps/web/src/lib/chat-context.tsx` — `ChatProvider`/`useChat` hold the Orchestrator thread (messages, `threadSessions`, `activeSessionId`, older-page cursor via `loadOlder`, `startNewSession`), load and poll the newest timeline page, stream replies, and poll server health every 5s. Supports voice audio recording via microphone and audio note playback in the chat window.
- Admin API: `core/src/dashboard/admin.ts` (`AdminRouterFactory`, mounted at `/api/admin`) — overview, agents (roster, Orchestrator timeline/new-session, Negotiator notices), sessions, memories, errands, `GET /chat/context`, heartbeats, skills, plugins (list, toggle, and MCP endpoint/token configuration), settings, `GET /providers` + `POST /ai/test-connection`. Settings are deep-masked for secrets (`BOT_TOKEN`, `API_TOKEN`).
- Build `pnpm build:client` → `dist-web/` (root/outDir in `vite.config.mts`); dev `pnpm dev:client` on port 5173 proxies `/api` and `/health` to `localhost:3000`; type-check via `pnpm lint:client` (`apps/web/tsconfig.json`).

## Website & Ecosystem (koris-hub)

The public marketing website, the plugins marketplace, and the docs site now live in a **separate independent repo**, `koris-hub` (`git@github.com:guilhermesalviano/koris-hub.git`) — a standalone Next.js App-Router app (`output: 'export'`, `basePath: '/koris-hub'`) with its own `package.json`, deployed to GitHub Pages (`https://guilhermesalviano.github.io/koris-hub`) by its own `.github/workflows/deploy.yml`. The marketplace catalog is static JSON under `content/marketplace/` (one `<family>/<slug>.json` per entry, `family` is `tool`/`channel`/`skill`/`mcp`). This repo no longer builds or deploys any website. Plugins retired from active use here move to `koris-hub` as their new canonical source (`koris-plugins/<family>/<slug>/`) rather than staying vendored/duplicated in both places — `.gitignore` here allowlists only the plugins still actively tracked, so anything moved out (or newly pulled) doesn't get re-committed by accident. `pnpm hub:list` (`scripts/hub-sync.ts`) diffs koris-hub's tree against what's tracked locally; `pnpm hub:pull <slug>` (or `--all`) fetches a plugin's files back into `plugins/<family>/<slug>/` for local use — it stays gitignored there unless you explicitly allowlist it.

## Conventions to follow

- **Plugins belong in `koris-hub`**: Never add plugin-specific external dependencies (e.g. Baileys, Telegram bot libraries) or hardcoded plugin implementations/names into `koris`. If a feature or fix requires changes inside a plugin or its schema, that work belongs in `koris-hub`.
- **Interfaces prefixed `I`** (`IMessageGateway`, `ILogger`, `IChatService`); implementations are classes; creation is via `XxxFactory.create()` and singletons via `XxxSingleton.getInstance()`.
- **Dependency inversion for plugins**: a plugin imports **only** from its own family's SDK (`plugins/channels/contracts.ts`, `plugins/tools/contracts.ts`, or `plugins/mcps/contracts.ts`) and the shared `plugins/registry.ts` — never from `core/src/`, and never from another family's `contracts.ts`. Core depends on the SDKs too (via re-export shims like `core/src/infrastructure/logger.ts` and `core/src/channels/`), and injects concrete services through `PluginContext`/`ToolPluginContext`/`McpPluginContext` at the composition root (`core/src/app.ts`). The one documented exception is `plugins/tools/create-tool/`, which reaches into `scripts/scaffold-tool.ts` to scaffold new tool plugins — noted in that file's own top comment.
- **No code comments** in source files unless asked. Code should be self-explanatory.
- **Relative imports only** (the `@` alias exists only in Vitest config, not tsconfig — tests can use `@/`, source should not).
- Config values come from the `config` object, never hard-coded secrets or paths.
- Logging via `LoggerFactory.create()` / `ILogger` (Winston). Note `app.ts` sets `LOG_SILENCE_CONSOLE` before importing anything when `--tui` is used — keep that ordering when touching logging.
- Strict TS: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` are on. `pnpm lint` must pass.
- Use `pnpm build` before `pnpm app`; `dist/` is gitignored build output.

## Testing

- Unit tests: `core/tests/unit/**`, mirroring `core/src/` structure. Integration: `core/tests/integration/`. Everything under `plugins/` (`plugins/channels/`, `plugins/tools/`, `plugins/mcps/`) instead colocates each `*.test.ts` next to the file it tests (e.g. `plugins/tools/curl-request/index.test.ts`, `plugins/mcps/index.test.ts`) — don't look for those under `core/tests/`.
- Run `pnpm test` and `pnpm lint` before considering a change done. Vitest suppresses `console.log` output (see `vitest.config.ts`).
- `core/tests/helpers/test-config.ts` provides a test settings fixture; `core/tests/setup/vitest.setup.ts` runs globally.
- Mutation testing config in `stryker.config.json`.
