<p align="center">
  <img src="apps/web/public/logo.png" width="120" alt="Koris Assistant logo" />
</p>

<h1 align="center">Koris Assistant</h1>

<p align="center">
  An autonomous AI agent framework with pluggable channels, tools, skills, MCP servers, persistent memory, voice support, and desktop/web interfaces.
</p>

<p align="center">
  <a href="https://github.com/guilhermesalviano/koris/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/guilhermesalviano/koris/ci.yml?branch=main&label=ci" alt="CI"></a>
  <a href="https://github.com/guilhermesalviano/koris/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/guilhermesalviano/koris/codeql.yml?label=codeql" alt="CodeQL"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white" alt="Node >= 24">
  <img src="https://img.shields.io/badge/package%20manager-pnpm-F69220?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/license-ISC-blue" alt="License: ISC">
</p>

---

## Key Features

- **Modular Architecture & Dynamic Plugins** — Extend capabilities across 4 plugin families: channels (`plugins/channels/`), tools (`plugins/tools/`), skills (`plugins/skills/`), and MCP servers (`plugins/mcps/`), dynamically downloaded on demand from [`koris-hub`](https://github.com/guilhermesalviano/koris-hub) and hot-loaded without restarting.
- **Pluggable Channels** — Telegram, WhatsApp, an interactive Terminal UI (TUI), and a web dashboard, all driven by the unified message gateway and session manager.
- **Model Context Protocol (MCP)** — Connect external MCP servers over Streamable HTTP; remote tools are dynamically discovered, namespaced as `<server>__<tool>`, and made available in the LLM tool execution pipeline.
- **Voice & Speech Support (STT & TTS)** — Local speech-to-text (Whisper via `sherpa-onnx`) and text-to-speech (Piper neural voices) running in a lightweight local sidecar. Supports voice note transcription in WhatsApp/Web and per-conversation voice reply mode (`/mode voice`).
- **Persistent SQLite Memory & Sessions** — Long-term memories (facts, lessons, summaries), semantic memory embeddings, session tracking, and conversation history in SQLite.
- **Multi-Provider AI & Role Mapping** — Ollama, OpenAI-compatible presets (`openai`, `deepseek`, `groq`, `openrouter`, `xai`, `mistral`, `together`, `gemini`, `nvidia`), and Mock. Assign different providers/models per role (Main Agent manager vs. background workers vs. embeddings).
- **Multiple Client Shells** — React 19 web dashboard, interactive TUI, native Tauri desktop app (lightweight OS webview, ~80–100 MB RAM), and native Electron desktop shell.
- **Heartbeat Agents** — Scheduled cron-driven background sub-agents ("beats") for autonomous routines, maintenance, and notifications.
- **Safe Tool Execution** — Sandboxed execution for HTTP curl (domain-gated), self-hosted web search (SearXNG), issue tracking, beat management, stickers, and custom plugins.
- **Type-Safe & Tested** — Built end-to-end in strict TypeScript (100% strict type check), comprehensive Vitest test suites, and Stryker mutation testing.

## Prerequisites

- **Node.js** >= 24.0.0
- **pnpm** >= 10.18.3
- **AI Provider**: Local Ollama or an API key for any supported provider (OpenAI, Gemini, Groq, OpenRouter, DeepSeek, etc.)
- *(Optional)* **Docker & Docker Compose**: For running self-hosted SearXNG (web search) or the local audio sidecar (Whisper/Piper).
- *(Optional)* **Rust & Cargo**: Only required if building or developing the Tauri desktop shell (`apps/tauri`).

## Setup & Configuration

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure settings:**
   Copy the example settings file to `koris.json` and adjust as necessary:
   ```bash
   cp koris.example.json koris.json
   ```
   *Or run the interactive onboarding wizard:*
   ```bash
   pnpm onboard
   ```

3. **Validate configuration:**
   ```bash
   pnpm validate
   ```

4. **Build the project:**
   ```bash
   pnpm build
   ```

## Running the Agent

### Web Dashboard
Start the agent as a web service with the dashboard and any installed channels:
```bash
pnpm app
```
Once running, the dashboard is available at: `http://localhost:3000`

Open **Configuration** to manage providers, channels, plugins, skills, sessions, and personal context. **Plugins → Installed / Marketplace** contains plugin toggles, MCP settings, and downloads. Text edits save after a short pause; toggles and provider selections apply immediately. Save errors remain visible with a retry action, and pending edits continue saving when the modal closes. The initial setup wizard still finishes with an explicit submission.

### Terminal User Interface (TUI)
```bash
pnpm app --tui
```

### Desktop Applications
Koris provides two native desktop shells that wrap the local server and web dashboard:
- **Tauri Desktop Shell** (Recommended — lightweight native OS webview, ~80–100 MB RAM):
  ```bash
  pnpm tauri:dev
  ```
- **Electron Desktop Shell** (Runs the server in-process):
  ```bash
  pnpm desktop
  # Dev mode:
  pnpm desktop:dev
  ```

## Errands: Delegated Conversations

An errand asks Koris to pursue a goal with a contact while keeping the requesting user (the principal) informed. Every errand creates a fresh `kind: delegated` child session per distinct target, even when an earlier errand used the same contact. The invoking `originSessionId` remains the parent; creating a child does not rotate or close it. Both sessions remain open while the errand runs. The service supports multiple targets; the chat command currently creates one.

Each child's SQLite `metadata` persists `parentSessionId`, `errandId`, and `instructions` containing the full **Speaking To Someone Else On The Human's Behalf** block. Follow-up and resume prompts read this saved instruction text after restarts. Older sessions without it retain the runtime default. In Configuration → Sessions, select a child to inspect its instructions or open its parent session.

```text
Principal: web / TUI / channel
  |
  | /errand <goal> with <contact> on <channel>
  v
MessageGateway -> command handler -> Negotiator.composeOpener()
  |                                  (worker LLM; fallback: raw goal)
  v
ErrandService.create() -- SQLite transaction ---------------------+
  |                                                             |
  +-> errands: goal, origin_session_id, pending_message, state    |
  +-> fresh child session: parent ID + saved instructions        |
  +-> errand_targets: links errand to its own child session      |
  |                                                             |
  +-> target busy? queued -- after blocker closes --> draft      |
  +-> target free? draft                                        |
                     |                                          |
                     | /errand approve <id> or admin Approve     |
                     v                                          |
               awaiting_peer                                    |
                     |                                          |
                     +-> OutboundMessageService -> contact       |
                                                                |
Contact replies through its channel                             |
  |                                                             |
  v                                                             |
ChannelHandler -> MessageGateway                                |
  | approved errand lookup (trusted or untrusted contact)       |
  v                                                             |
Negotiator.run(goal + notes + delegated transcript)              |
  | tools, learned skills and memory retrieval disabled         |
  |                                                             |
  +-> continue -> awaiting_peer -> reply to contact              |
  +-> escalate -> awaiting_principal -> question to principal ---+
  +-> resolved -> deliver thank-you -> result to principal ------+
  +-> failed -> terminal -> result to principal -----------------+
                                                                |
Principal: /errand reply <id> <answer> or admin Reply             |
  |                                                             |
  v                                                             |
composeResume() -> send to contact -> awaiting_peer              |
  +-> resume notice to principal -------------------------------+
                                                                |
                  How principal notices return today <----------+
                                |
                    lookup originSessionId
                                |
              +-----------------+------------------+
              |                                    |
       supported channel                        web / TUI
              |                                    |
       outbound service                  save assistant message
       -> channel adapter                in exact origin transcript
       -> principal                                |
                                         web: poll session detail
                                         -> merge by saved message ID
```

Creation stages the opener for approval. When the negotiator achieves the goal, it sends a brief thank-you in the contact's language and waits for delivery before resolving the errand and notifying the parent session. An empty model reply uses a default thank-you; failed delivery leaves the errand open. Closing an errand as `resolved`, `failed`, or `cancelled` can promote the oldest eligible queued errand to `draft`; it still needs approval. Cancellation sends no notice. Reading a stale `open`, `awaiting_peer`, or `awaiting_principal` errand lazily marks it `expired`; expiry releases eligible queued work but does not send a principal notice. Capacity and contention checks also expire stale work before admitting a new errand. `open` is accepted by the model, but the normal approval path goes directly from `draft` to `awaiting_peer`.

Use `/errand` to list errands from the current session, `/errand approve <id>` to approve, `/errand reply <id> <answer>` (or `answer`) to respond to a question, `/errand retry <id>` to retry a prepared message, `/errand close <id>` to resolve manually, and `/errand cancel <id>` to cancel. The admin Errands page shows the exact draft or pending question, delivery failures, contact transcripts, and these actions. An ordinary chat answer is not automatically routed back to a waiting errand.

The opener uses `ERRAND_OPENER_INSTRUCTIONS`. Following turns use `NEGOTIATOR_INSTRUCTIONS` plus a goal-specific `ERRAND_FOLLOWUP_CONTEXT` built from the goal, cumulative notes, current state, and last sent message. This prompt replaces the general chat policy and excludes global personal context. It tells the negotiator to remember rejected options, collect concrete alternatives, and request principal approval before accepting a change outside the goal's authorization. For example: "10 is unavailable" leads to asking which hours are available; "11 or 14" leads to a concrete choice in the parent session once essential details are known. After approval, `ERRAND_RESUME_INSTRUCTIONS` receives the pending question, answer, notes, and contact transcript, and continues toward contact confirmation.

Contact replies use the exact child session matched by the active errand, including when the inbound peer address uses a different spelling. Routing and queue checks match the contact across errand sessions, so a newer queued child cannot steal replies from an active one. Openers and resumed replies also write to the exact child, keeping other errands' histories separate. Delegated sessions survive idle TTL when reopened from storage. Gateways and approval/resume/retry operations share a per-errand queue. Contact replies arriving during delivery wait for that operation; approved drafts with pending delivery remain associated with their child session. The prompt honors `errands.history_limit` (default 100), rather than truncating it again to the general chat limit of 20. While awaiting principal approval, further contact messages are recorded without advancing the negotiation; trusted slash commands still use the contact's own user session.

Implementation entry points:

| Concern | Source |
| --- | --- |
| Creation and principal commands | [`core/src/services/commands/errands.ts`](core/src/services/commands/errands.ts) |
| State transitions, origin notices, queue promotion | [`core/src/services/errands/index.ts`](core/src/services/errands/index.ts) |
| Errand records and target links | [`core/src/repositories/errand.ts`](core/src/repositories/errand.ts) |
| Peer routing and conversation persistence | [`core/src/services/agents/message-gateway.ts`](core/src/services/agents/message-gateway.ts) |
| Opener, peer verdict, and resumed reply | [`core/src/services/agents/sub-agents/negotiator/sub-agent.ts`](core/src/services/agents/sub-agents/negotiator/sub-agent.ts) |
| Channel delivery and outbound status | [`core/src/services/outbound/message-service.ts`](core/src/services/outbound/message-service.ts) |
| Web transcript loading and polling | [`apps/web/src/lib/chat-context.tsx`](apps/web/src/lib/chat-context.tsx), [`apps/web/src/lib/chat-history.ts`](apps/web/src/lib/chat-history.ts), [`core/src/dashboard/admin.ts`](core/src/dashboard/admin.ts) |

### Web Replies: Fix and Remaining Limitations

The web synchronization fix is covered by regression tests for saved-message reconciliation and delayed polling responses. Live channel-account delivery has not been exercised by those tests.

- **Saving is separate from displaying.** `pushToSession()` saves web/TUI notices directly in the origin transcript. The web `/api/chat` SSE connection ends after each request, so it cannot carry a later contact reply. The current web client polls `/api/admin/sessions/:id` every 3.5 seconds while idle.
- **Fixed: new messages no longer depend on the history count growing.** The client retains database message IDs and merges unseen records, including when the latest-200 window stays the same size. Matching saved copies acquire the optimistic message's UI identity; pending replies and local request failures remain visible. Older loaded messages are retained. The API still returns only 200 records, so more than 200 arrivals between successful polls require the cursor-based replay planned below.
- **Fixed: polling cannot overwrite another chat after navigation.** Requests and queued UI updates check the session and view/turn generation; overlapping requests within a poller are skipped and disposed pollers ignore delayed responses. Polling pauses only for work in the viewed session and catches up immediately after streaming or background processing finishes.
- **Notices belong to the original chat.** Errand notices use the exact originating session across transports, even after `/clear`, `/compact`, or navigation to another chat. Only the active web chat is polled; there is no errand notice notification for other chats.
- **Approval/resume awaits delivery.** A durable `pending_delivery` batch stores the prepared message, original principal answer, and per-target outcomes before sending. Failure keeps the draft or pending question in place. `/errand retry <id>` and the dashboard Retry Send action reuse the saved message and skip successful targets, including after restart. Retry is also available through `POST /api/admin/errands/:id/retry`; errand API responses include a delivery summary with type, sent/total counts, and latest error. The database adds the nullable column automatically for existing errand schemas. Failed attempts remain in the outbound log; ordinary assistant transcript entries are written only after successful delivery. Parent channel notices still use best-effort delivery.
- **Private instructions stay local on failure.** Resume composition errors or empty responses leave the errand awaiting principal input and send nothing. Negotiation requires valid structured verdicts: malformed JSON, plain text, invalid fields/actions, and tool-call responses are skipped without forwarding raw output or changing state. Channel handlers do not send empty replies.
- **Retries are manual.** Overlapping operations are rejected, cancellation stops remaining targets, and terminal errands cannot retry. External delivery can remain ambiguous if a process crashes after an adapter sends but before the success receipt is persisted; exactly-once delivery requires adapter support.

### Plan: Reliable Replies to the Invoking Channel

The web reconciliation portion of step 1 is implemented. The remaining work below extends delivery and recovery beyond the polling fix. Preserve `originSessionId` as attribution and deliver questions/results through a shared runtime service; the negotiator should return its verdict, with the runtime choosing the destination.

1. **Web reconciliation implemented; cursor replay next.** Saved IDs, optimistic-message reconciliation, stale-response guards, and catch-up polling are implemented in `chat-history.ts` and `chat-context.tsx`. Add a paginated message endpoint with an opaque monotonic cursor so reconnects can fetch every missed notice beyond the 200-message window. Keep SQL in the repository layer.

2. **Make origin delivery explicit.** Introduce a shared session-notification service used by `escalate`, `resolve`, `fail`, and resume acknowledgements. Persist a notification ID, errand ID, event type, origin session, content, and delivery state. Keep the original transcript as the durable record, including when closed; do not silently redirect it to whichever web chat is newest. Expose unread notices linking back to that chat. Resolve channel/peer/kind from the origin session, and preserve available thread/reply context for channel plugins that support it. Missing sessions or unavailable transports must produce visible delivery errors.

3. **Add live delivery independently of chat requests.** Publish a session-message event only after persistence. Add a long-lived dashboard event stream that observes existing dashboard access rules, supports reconnect/cursor replay, and cleans up disconnected subscribers. Web and desktop clients merge events by persisted ID, show the notice immediately in the matching chat, and show an unread indicator elsewhere. TUI can subscribe to the same runtime notification events. Keep cursor polling as a fallback.

4. **Extend delivery recovery to notices.** Durable opener/resume batches, awaited outcomes, manual retries, and per-target receipts are implemented. Extend that recovery to principal notifications. External delivery may remain ambiguous after a crash unless the adapter supports idempotency. Outbound persistence now accepts an exact session ID, which errands use for their child transcripts and parent notices. Discover adapter capabilities dynamically instead of extending the current hardcoded `CHANNEL_TYPES`; plugin-specific normalization and thread handling belong in `koris-hub`.

5. **Connect the principal's answer to the pending question.** Give escalation notices structured errand metadata and an inline Reply action that calls the existing `/api/admin/errands/:id/reply` route. Preserve `/errand reply` for every interface. If ordinary-text replies are supported later, bind them to an explicitly selected pending errand; ask which one when ambiguous. Validate caller authority, errand ownership, and `awaiting_principal` state before sending. Reuse the persisted resume notice for acknowledgement so the command response and background event do not appear twice.

6. **Finish lifecycle and multiple-target handling.** Exact delegated-session routing, trusted-contact negotiation, draft/paused guards, shared errand operation serialization, and state rechecks after LLM work are implemented. Expiry releases queued work and shared serialization coordinates gateways. Remaining work: notify the origin on expiry and when queued work becomes ready for approval. For multiple targets, retain which contact asked the pending question; resume currently composes from the first target's history and sends the same answer to all targets.

Acceptance checks for the implementation:

- Start in web chat A, approve, receive a contact question, answer from A, and receive the final result there without reload. Repeat from a channel origin and verify the same peer/thread receives the notice.
- Exercise 200+ messages, a notice during streaming, equal-length history windows, fast A/B switching, and an active run in another chat; no notice is lost or shown in the wrong chat.
- Disconnect/reload and reconnect after more than 200 new messages; replay each notice once. After `/clear` or `/compact`, show an unread link to the original chat and preserve its transcript.
- Simulate adapter failure/recovery, duplicate events, concurrent principal/peer replies, cancellation during LLM work, and process restart with pending deliveries. Verify accurate status and no duplicate local records.
- Verify expiry/queue promotion, peer normalization, trusted-contact behavior, multiple waiting errands, multiple targets, and caller authorization with repository/service/API tests. Add browser coverage for reconciliation and reconnect behavior.

## Voice & Audio Sidecar (STT & TTS)

Koris supports fully local speech-to-text (Whisper) and neural text-to-speech (Piper) via a lightweight HTTP sidecar running on port `6006`.

1. **Setup models:**
   ```bash
   pnpm audio:setup         # Default: whisper-small (~480MB, recommended for Portuguese & multilingual)
   # Or select a specific model size:
   pnpm audio:setup:tiny    # Ultra-lightweight (~70MB)
   pnpm audio:setup:base    # Fast baseline (~140MB)
   pnpm audio:setup:tts     # Piper TTS voices
   ```

2. **Start the audio sidecar (Docker):**
   ```bash
   pnpm audio:start
   ```

3. **Enable audio in `koris.json`:**
   ```json
   "audio": {
     "stt": {
       "enabled": true,
       "endpoint": "http://127.0.0.1:6006/v1/audio/transcriptions",
       "language": "auto"
     },
     "tts": {
       "enabled": true,
       "endpoint": "http://127.0.0.1:6006/v1/audio/speech",
       "voice": "en_US-lessac-medium"
     }
   }
   ```

In chat or channels, use `/mode voice` to have the agent reply with audio voice notes instead of text. Voice notes sent in WhatsApp or via the web UI are automatically transcribed.

## Web Search (SearXNG)

The `search_engine` tool uses a self-hosted [SearXNG](https://docs.searxng.org/) instance — free, privacy-friendly, no per-query cost, no API key.

1. **Start SearXNG:**
   ```bash
   bash scripts/search/run_search_engine.sh
   ```
   *(To force a restart / container recreate: `bash scripts/search/run_search_engine.sh --restart`)*

2. **Configure in `koris.json`:**
   ```json
   "ai": {
     "searxng_url": "http://localhost:8080"
   }
   ```

## Plugins & Hub Ecosystem

Koris separates the runtime engine from plugin implementations. Channels, tools, skills, and MCP servers live in [`koris-hub`](https://github.com/guilhermesalviano/koris-hub) and are installed dynamically:

- **List available plugins:**
  ```bash
  pnpm hub:list
  ```
- **Pull/install a plugin:**
  ```bash
  pnpm hub:pull <slug>
  ```
- **From chat (slash commands):**
  - `/channels` — Manage installed and remote channel plugins (e.g. `/channels download telegram`)
  - `/tools` — Manage and download agent tools (e.g. `/tools download curl-request`)
  - `/skills` — Manage and download prompt skills (e.g. `/skills download coder`)
  - `/mcps` — Manage, toggle, and download MCP server plugins (e.g. `/mcps enable github`)

Pulled tools and MCP servers are hot-loaded into the running process without a restart. For detailed architectural information and configuration guides, see [`PLUGINS.md`](./PLUGINS.md).

## Slash Commands

Available in trusted sessions across all interfaces (Web, TUI, WhatsApp, Telegram):

| Command | Description |
| --- | --- |
| `/help [command]` | Display command help or details on a specific command |
| `/status` | View connection state, AI provider, model, and active session modes |
| `/usage [today\|days]` | Token usage and LLM execution audit report |
| `/whoami` | View your identity, channel, and trust level |
| `/mode [text\|voice]` | Switch conversation reply mode between text and voice notes |
| `/memory` | Inspect context summarised into the active session |
| `/compact` | Summarise the current session into memory and rotate to a fresh session |
| `/clear` | Reset and start a fresh empty session (without carrying summary forward) |
| `/channels` | List, download (`/channels download <name>`), or toggle channels |
| `/tools` | List, discover (`/tools remote`), or download (`/tools download <name>`) agent tools |
| `/skills` | List, discover, or download skills; execute one-turn skills via `/<skill-name>` |
| `/mcps` | List, discover (`/mcps remote`), download, enable, or disable MCP server plugins |
| `/allow <domain>` | Dynamically allow an outbound domain for HTTP tools |

## Available Scripts

All commands are run via `pnpm <script>`.

### Runtime & Desktop
| Script | Description |
| --- | --- |
| `pnpm app` | Runs the agent server (Web dashboard on port 3000 + installed channels). Pass `--tui` for Terminal UI. |
| `pnpm onboard` | Runs the interactive onboarding flow. |
| `pnpm validate` | Validates `koris.json` against the schema. |
| `pnpm tauri:dev` | Runs the Tauri desktop app in dev mode (spawns supervised Node backend). |
| `pnpm desktop` | Runs the Electron desktop shell (in-process server). |
| `pnpm desktop:dev` | Runs Electron desktop in dev mode. |
| `pnpm desktop:package` | Builds platform distribution packages for Electron. |

### Audio Sidecar
| Script | Description |
| --- | --- |
| `pnpm audio:start` | Builds and starts the local audio sidecar (Whisper + Piper) via Docker. |
| `pnpm audio:setup` | Downloads default models (`whisper-small` + Piper voice). |
| `pnpm audio:setup:small` | Downloads Whisper small model (~480MB). |
| `pnpm audio:setup:base` | Downloads Whisper base model (~140MB). |
| `pnpm audio:setup:tiny` | Downloads Whisper tiny model (~70MB). |
| `pnpm audio:setup:tts` | Downloads Piper neural TTS voices. |

### Plugins & Hub
| Script | Description |
| --- | --- |
| `pnpm hub:list` | Lists plugins available in `koris-hub` that are not yet installed locally. |
| `pnpm hub:pull` | Downloads a plugin from `koris-hub` (e.g. `pnpm hub:pull <slug>`). |
| `pnpm scaffold:tool` | Scaffolds a new tool plugin folder template under `plugins/tools/`. |
| `pnpm bundle:channels` | Bundles channels into self-contained standalone CJS artifacts for publishing. |

### Build, Lint & Test
| Script | Description |
| --- | --- |
| `pnpm build` | Compiles TypeScript into `dist/` and builds the web client into `dist-web/`. |
| `pnpm build:client` | Builds only the web frontend (`vite build` → `dist-web/`). |
| `pnpm build:desktop` | Compiles Electron desktop files (`apps/desktop/out/`). |
| `pnpm build:tauri` | Compiles Tauri Node sidecar (`apps/tauri/sidecar/out/`). |
| `pnpm dev:client` | Runs Vite dev server (port 5173, proxies `/api` and `/health` to 3000). |
| `pnpm lint` | Type-checks server code (`tsc --noEmit`). |
| `pnpm lint:client` | Type-checks web frontend code. |
| `pnpm lint:desktop` | Type-checks Electron desktop code. |
| `pnpm lint:tauri` | Type-checks Tauri sidecar code. |
| `pnpm clean` | Removes `dist/` and `dist-web/` build output. |
| `pnpm clear:memory` | Deletes SQLite database files under `memory/database.*`. |
| `pnpm test` | Runs the full Vitest test suite (`vitest run`). |
| `pnpm test:watch` | Runs Vitest in watch mode. |
| `pnpm test:ui` | Opens the Vitest interactive web UI. |
| `pnpm test:coverage` | Runs Vitest with v8 code coverage reporting. |
| `pnpm test:mutation` | Runs Stryker mutation testing. |

## Learn More

- Architecture and internals guide: [`AGENTS.md`](./AGENTS.md)
- Dynamic plugins, marketplace, and bash guide: [`PLUGINS.md`](./PLUGINS.md)
- Plugins repository and docs marketplace: [`koris-hub`](https://github.com/guilhermesalviano/koris-hub)

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev workflow and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for community guidelines. Found a security issue? See [`SECURITY.md`](./SECURITY.md).

## License

[ISC](./LICENSE)
