# Plugins Architecture & Usage Guide

`koris` features a pluggable architecture where plugins (**channels**, **tools**, and **skills**) extend the core runtime agent.

---

## 1. Core Architecture: `koris` vs. `koris-hub`

- **`koris` (This Repository): Runtime Engine**
  - Defines the plugin SDK contracts (`plugins/channels/contracts.ts`, `plugins/tools/contracts.ts`).
  - Executes plugins, routes messages, manages database persistence (SQLite), and provides the web dashboard.
  - **Remains strictly plugin-agnostic**: core components and UI screens (such as `ChannelsStep`) never hardcode plugin-specific dependencies (e.g. Baileys, Telegram bot libraries) or hardcoded channel forms.
  - Discovers and loads installed plugins dynamically on disk (`plugins/<family>/<slug>/`).

- **`koris-hub` (Separate Repository: `git@github.com:guilhermesalviano/koris-hub.git`): Canonical Source**
  - Houses the source implementations (`koris-plugins/channels/`, `koris-plugins/tools/`, `koris-plugins/skills/`).
  - Contains marketplace catalog metadata (`content/marketplace/<family>/<slug>.json`).
  - Distributes self-contained, pre-bundled channel artifacts (`index.js`, bundling any third-party dependencies) as assets on its rolling `channels-latest` GitHub release.
  - Any plugin-specific changes (such as new configuration fields, hints, dependencies, or translations) belong in `koris-hub`.

---

## 2. How Channel Configurations Are Loaded from Hub (Bash Walkthrough)

### Step 1: Discovering Remote Channels & Config Schemas

`koris` inspects `koris-hub`'s repository tree to find all available channel definitions under `content/marketplace/channels/*.json`:

```bash
# 1. Discover remote channel catalog entries from koris-hub via GitHub API
curl -s "https://api.github.com/repos/guilhermesalviano/koris-hub/git/trees/main?recursive=1" \
  | jq -r '.tree[] | select(.path | startswith("content/marketplace/channels/")) | .path'
# Output:
# content/marketplace/channels/telegram.json
# content/marketplace/channels/whatsapp.json
```

```bash
# 2. Fetch the metadata, hints, and dynamic configuration fields for a channel
curl -s "https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/content/marketplace/channels/telegram.json" \
  | jq '{ name, summary, hints, configFields }'
```

**Example Output:**
```json
{
  "name": "Telegram",
  "summary": "Talk to the agent from a Telegram bot — text, images, group mentions, approvals.",
  "hints": {
    "uninstalled": "Connect your agent to a Telegram bot with text, photos, and approvals. Click Download to install from Koris Hub.",
    "inactive": "Telegram channel is installed locally. Click Activate above to enable it and configure your bot credentials.",
    "allowUnlisted": "Reply to senders not on the whitelist, as untrusted (no tools or learned skills)."
  },
  "configFields": [
    {
      "name": "bot_token",
      "label": "Bot Token",
      "type": "password",
      "required": true,
      "placeholder": "123456789:AA..."
    },
    {
      "name": "whitelist",
      "label": "Whitelist (comma-separated chat IDs)",
      "type": "text",
      "placeholder": "123456,789012"
    },
    {
      "name": "allow_unlisted_senders",
      "label": "Allow unlisted senders",
      "type": "boolean",
      "description": "Reply to senders not on the whitelist, as untrusted (no tools or learned skills)."
    }
  ]
}
```

---

### Step 2: Querying the Catalog within Koris

In `koris`, [`scripts/hub-sync.ts`](scripts/hub-sync.ts) encapsulates this in `fetchChannelCatalog()`:

```bash
# Run the internal discovery function directly via CLI
pnpm exec tsx -e "
import { fetchChannelCatalog } from './scripts/hub-sync';
fetchChannelCatalog().then(items => console.log(JSON.stringify(items, null, 2)));
"
```

When the dashboard server is running:

```bash
curl -s http://localhost:3000/api/admin/channels/catalog | jq .
```

---

### Step 3: Downloading / Pulling Channel Artifacts

Unlike tools and skills (pulled as source from the `main` branch tree), channels are
pulled as a single self-contained `index.js` from koris-hub's rolling
[`channels-latest`](https://github.com/guilhermesalviano/koris-hub/releases/tag/channels-latest)
GitHub release, where `pnpm bundle:channels` publishes one `<slug>-index.js` asset per
channel. Because the whole channel is that one bundled file, a freshly pulled channel is
picked up by the next `reprimeLiveChannelDescriptors()` (fired automatically after a pull)
without a process restart. Channel config schemas (`configFields`, hints) still come from
the marketplace catalog JSON on the branch — see Steps 1–2.

**The bundle carries everything it needs.** Besides its npm deps (Baileys, the Telegram bot
lib, …), it inlines koris's own channel-plugin SDK — `../contracts`, `../channel-config`,
`../../registry` — which koris-hub's `scripts/build-channels.ts` resolves out of a koris
checkout (`KORIS_DIR`) at build time. Nothing but the downloaded `index.js` has to be on
disk for the channel to load. If a bundle ever regresses to *external* SDK imports, koris
throws `MODULE_NOT_FOUND` loading it, `scanChannelModules` silently skips the channel, and
its settings saved from the web UI land in `koris.json` instead of
`plugins/channels/<slug>/config.yml`. Quick check:

```bash
node -e "require('./plugins/channels/telegram/index.js').liveChannel.name"
```

When you click **Download** in the UI, run `pnpm hub:pull <slug>`, or type `/channels download <slug>` in chat:

```bash
# 1. Resolve the release asset URL for the channel's bundle
curl -s "https://api.github.com/repos/guilhermesalviano/koris-hub/releases/tags/channels-latest" \
  | jq -r '.assets[] | select(.name == "telegram-index.js") | .browser_download_url'
# -> https://github.com/guilhermesalviano/koris-hub/releases/download/channels-latest/telegram-index.js

# 2. Ensure the destination directory exists and download the self-contained bundle
mkdir -p plugins/channels/telegram
curl -sL "https://github.com/guilhermesalviano/koris-hub/releases/download/channels-latest/telegram-index.js" \
  -o plugins/channels/telegram/index.js
```

`config.yml` is written separately — by the setup wizard / admin panel (Step 4), by
`/channels`, or by hand.

---

### Step 4: Writing Local Plugin Configuration (`config.yml`)

When saving settings in the setup wizard or admin panel, `POST /api/admin/settings` writes directly to `plugins/channels/<slug>/config.yml`:

```bash
cat << 'EOF' > plugins/channels/telegram/config.yml
bot_token: "123456789:AAExampleToken"
whitelist: "12345678,98765432"
allow_unlisted_senders: false
EOF
```

The runtime immediately executes `reprimeChannelRuntime('telegram')`, re-reading the active configuration into memory without requiring a server restart.

---

## 3. Managing Channels via Chat Slash Commands

You can manage channels directly from trusted chat sessions using `/channels`:

| Command | Description |
| --- | --- |
| `/channels` | List all installed channels with enabled/running status |
| `/channels remote` | List channels available in `koris-hub` that are not yet installed |
| `/channels download <name> [--force]` | Download a channel bundle from `koris-hub` and auto-enable it |
| `/channels enable <name>` | Enable an installed channel |
| `/channels disable <name>` | Disable an installed channel |

---

## 4. Managing Tools & Skills

- **Tools (`plugins/tools/`)**:
  - Pull remote tools: `pnpm hub:pull <tool-name>` or `/tools download <name>`.
  - Hot-loaded into the running server without restarting via `ToolSyncService`.
- **Skills (`plugins/skills/`)**:
  - Pull remote skills: `pnpm hub:pull <skill-name>` or `/skills download <name>`.
  - Synced into SQLite memory and learned skills automatically.

---

## 5. Building Pre-bundled Channel Artifacts for `koris-hub`

When creating or updating channel plugins:

```bash
# Bundles all channels into standalone CJS artifacts
pnpm bundle:channels
```

If `~/projects/koris-hub` is present locally, the script will automatically copy the updated bundles to `~/projects/koris-hub/koris-plugins/channels/<slug>/index.js`.

koris-hub then publishes those bundles as `<slug>-index.js` assets on its rolling
[`channels-latest`](https://github.com/guilhermesalviano/koris-hub/releases/tag/channels-latest)
release, which is what `koris` downloads from (`pnpm hub:pull`, `/channels download`, the
setup wizard) — see §2 Step 3.

## MCP server plugins

MCP integrations live under `plugins/mcps/<slug>/` and register a server descriptor on the `MCP_SERVERS` extension point. Koris owns the Streamable HTTP client, discovers each enabled server's tools, and exposes them through the normal tool pipeline as `<server>__<tool>` names. Server-specific values such as the endpoint URL and optional bearer token stay in the plugin's gitignored `config.yml`.

A newly downloaded MCP server (`/mcps download`, the Marketplace "Pull", or `pnpm hub:pull` while Koris is running) is enabled automatically when it hot-loads, unless it already has an on/off row — an explicit earlier disable wins. Otherwise MCP servers default to disabled. Use `/mcps`, Configuration → Plugins, or `PATCH /api/admin/plugins/mcps/<name>` to enable or disable one without restarting. A failed connection does not stop Koris and is retried only after an explicit toggle, configuration save, or process restart. Source plugins and marketplace metadata belong in `koris-hub/koris-plugins/mcps` and `koris-hub/content/marketplace/mcps`.
