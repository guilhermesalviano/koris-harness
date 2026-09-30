# /koris

A local-first AI agent with a web dashboard, persistent SQLite memory, scheduled
beats, and pluggable tools, channels, skills, and MCP servers. Models can run
locally through Ollama or use a configured compatible provider.

## Run locally

Requires Node.js 24 or later and pnpm 10.18.3.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm app
```

Open `http://localhost:3000/setup` to configure the provider and personal settings.
Alternatively, copy `koris.example.json` to `koris.json`, replace its example
values, and run `pnpm validate` before starting. A local model server must be
running and have the configured models available; installing this project does
not download model weights.

The dashboard also listens on the local network. The optional `admin_secret`
setting requires a matching `Authorization: Bearer <secret>` header for API
requests. Leave it empty for the default local setup.

## Local data and configuration

- `koris.json`: application and provider settings; environment variables override
  file values, with dotted names mapped to uppercase keys such as `WEB_PORT`.
- `memory/database.db`: conversations, memories, scheduled beats, and plugin state.
- `logs/`: runtime logs.
- `plugins/<family>/<name>/config.yml`: plugin settings.

Set `KORIS_DATA_DIR` to relocate writable settings, memory, logs, and plugin
configuration. Keep the application bundle and build output separate from that
directory. Configuration saves replace complete files atomically. A malformed
existing configuration must be repaired before a partial patch can be saved.

These files are ignored by Git. Back up the data directory independently of the
source checkout. Model requests go to the provider you configure; a local Ollama
provider keeps model inference on your machine.

## Development

Run the backend with `pnpm build && pnpm app` and start the frontend development
server in another terminal with `pnpm dev:client`. Vite serves the UI on port
5173 and proxies API requests to the backend on port 3000.

```sh
pnpm lint          # Backend and plugin TypeScript checks
pnpm lint:client   # Frontend TypeScript checks
pnpm test          # Unit and integration tests, including built-in tools
pnpm test:coverage # Coverage thresholds
pnpm build         # Compile backend and bundle the web dashboard
```

The test suite uses isolated fixtures and a mock model provider. Downloaded
plugin bundles are excluded from the core test suite; tracked built-in tools are
included.

## Project layout

- `core/src/`: agent execution, providers, persistence, and HTTP API.
- `apps/web/src/`: React dashboard and chat UI.
- `plugins/`: extension contracts and installed plugins.
- `scripts/`: plugin scaffolding, hub sync, and optional audio/search sidecars.

Speech recognition, speech synthesis, and search sidecars are optional. Their
setup and run scripts live under `scripts/audio/` and `scripts/search/`.
