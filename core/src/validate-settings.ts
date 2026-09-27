/**
 * Settings validation script.
 *
 * Checks koris.json (and env vars) for correctness before starting the app.
 *
 * Usage:
 *   pnpm validate
 *   tsx src/validate-settings.ts
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import { config } from './config';
import { resolveConfigPaths, loadConfigFile, deepGet } from './config/helpers';
import { listLiveChannels } from '../../plugins/channels';
import {
  VALID_LOG_LEVELS,
  isValidUrl,
  isValidLogLevel,
  isSupportedProvider,
  checkAiProviderConnectivity,
} from './config/validators';
import { resolveProviderBaseUrl } from './services/providers';

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function pass(label: string, detail = '') {
  console.log(`  ${c.green}✔${c.reset} ${label}${detail ? c.gray + '  ' + detail + c.reset : ''}`);
}

function fail(label: string, hint = '') {
  console.log(`  ${c.red}✖${c.reset} ${c.bold}${label}${c.reset}${hint ? '\n    ' + c.yellow + hint + c.reset : ''}`);
}

function warn(label: string, hint = '') {
  console.log(`  ${c.yellow}⚠${c.reset} ${label}${hint ? c.gray + '  (' + hint + ')' + c.reset : ''}`);
}

function section(title: string) {
  console.log(`\n${c.cyan}${c.bold}▸ ${title}${c.reset}`);
}

// ── Validation counters ───────────────────────────────────────────────────────
let errors = 0;
let warnings = 0;

function check(ok: boolean, label: string, errorHint: string, detail = '') {
  if (ok) { pass(label, detail); } else { fail(label, errorHint); errors++; }
}

function advisory(ok: boolean, label: string, hint = '', detail = '') {
  if (ok) { pass(label, detail); } else { warn(label, hint); warnings++; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}koris — settings validation${c.reset}`);

  // ── 1. koris.json file ────────────────────────────────────────────────
  section('koris.json');
  const candidatePaths = resolveConfigPaths(process.cwd(), __dirname);
  const foundPath = candidatePaths.find(existsSync);

  if (foundPath) {
    pass('File found', foundPath);
    // Validate JSON parseable
    const parsed = loadConfigFile({ cwd: process.cwd(), dirname: __dirname, onParseError: (msg) => { fail('JSON parse error', msg); errors++; } });
    if (Object.keys(parsed).length > 0 || foundPath) {
      pass('Valid JSON');
    }
  } else {
    warn('koris.json not found — using defaults and env vars only', 'create apps/client/koris.json to configure the app');
    warnings++;
  }

  // ── 2. General settings ──────────────────────────────────────────────────
  section('General');

  check(
    Number.isInteger(config.WEB_PORT) && config.WEB_PORT > 0 && config.WEB_PORT <= 65535,
    'web_port is a valid port number',
    `Got: ${config.WEB_PORT}. Must be an integer between 1 and 65535.`,
    String(config.WEB_PORT),
  );

  advisory(
    isValidUrl(config.GATEWAY_HOST),
    'gateway_host is a valid URL',
    'Set gateway_host in koris.json to the public URL of this server',
    config.GATEWAY_HOST,
  );

  advisory(
    config.ALLOWED_DOMAINS.length > 0,
    'allowed_domains is configured',
    'Add allowed_domains to koris.json to permit curl_request (default-deny)',
    config.ALLOWED_DOMAINS.join(', '),
  );

  check(
    isValidLogLevel(config.LOG_LEVEL),
    'log_level is valid',
    `Got: "${config.LOG_LEVEL}". Must be one of: ${VALID_LOG_LEVELS.join(', ')}.`,
    config.LOG_LEVEL,
  );

  // `config.SKILLS` coerces anything unrecognised to a safe default, so the raw
  // file value is what tells the user they typo'd a mode.
  const rawSettings = loadConfigFile({ cwd: process.cwd(), dirname: __dirname, onParseError: () => {} });
  const rawSkillsMode = deepGet(rawSettings, 'skills.mode');
  const rawSkillsLimit = deepGet(rawSettings, 'skills.limit') ?? deepGet(rawSettings, 'learned_skills_limit');

  check(
    rawSkillsMode === undefined || rawSkillsMode === 'auto' || rawSkillsMode === 'manual',
    'skills.mode is valid',
    `Got: ${JSON.stringify(rawSkillsMode)}. Must be "auto" (inject every skill body every turn) or "manual" (load one on demand via /<skill>).`,
    config.SKILLS.MODE,
  );

  check(
    rawSkillsLimit === undefined || (Number.isInteger(Number(rawSkillsLimit)) && Number(rawSkillsLimit) > 0),
    'skills.limit is a positive integer',
    `Got: ${JSON.stringify(rawSkillsLimit)}. Must be a positive integer.`,
    String(config.SKILLS.LIMIT),
  );

  check(
    Number.isFinite(config.SESSION.COMPACT_THRESHOLD)
      && config.SESSION.COMPACT_THRESHOLD >= 0.1
      && config.SESSION.COMPACT_THRESHOLD <= 1,
    'session.compact_threshold is a valid fraction',
    `Got: ${config.SESSION.COMPACT_THRESHOLD}. Expected a number between 0.1 and 1.`,
    `${Math.round(config.SESSION.COMPACT_THRESHOLD * 100)}% of manager num_ctx`,
  );

  check(
    Number.isFinite(config.SESSION.TTL_MS) && config.SESSION.TTL_MS > 0,
    'session.ttl_ms is a positive number',
    // A garbage value coerces to NaN, and `now - x > NaN` is always false — sessions never expire.
    `Got: ${JSON.stringify(deepGet(rawSettings, 'session.ttl_ms'))}. Expected a positive number of milliseconds; an invalid value makes sessions never expire.`,
    `${config.SESSION.TTL_MS}ms`,
  );

  check(
    Number.isFinite(config.ERRANDS.HARD_EXPIRY_MS) && config.ERRANDS.HARD_EXPIRY_MS > 0,
    'errands.hard_expiry_ms is a positive number',
    `Got: ${JSON.stringify(deepGet(rawSettings, 'errands.hard_expiry_ms'))}. Expected a positive number of milliseconds.`,
    `${config.ERRANDS.HARD_EXPIRY_MS}ms`,
  );

  check(
    Number.isInteger(config.ERRANDS.HISTORY_LIMIT) && config.ERRANDS.HISTORY_LIMIT > 0,
    'errands.history_limit is a positive integer',
    `Got: ${JSON.stringify(deepGet(rawSettings, 'errands.history_limit'))}. Expected a positive integer.`,
    String(config.ERRANDS.HISTORY_LIMIT),
  );

  check(
    Number.isInteger(config.ERRANDS.MAX_CONCURRENT) && config.ERRANDS.MAX_CONCURRENT > 0,
    'errands.max_concurrent is a positive integer',
    `Got: ${JSON.stringify(deepGet(rawSettings, 'errands.max_concurrent'))}. Expected a positive integer.`,
    String(config.ERRANDS.MAX_CONCURRENT),
  );

  const channelsAllowingUnlisted = listLiveChannels()
    .filter((channel) => channel.loadConfig().allowUnlistedSenders === true)
    .map((channel) => channel.name);

  advisory(
    channelsAllowingUnlisted.length === 0,
    'channel unlisted-sender access is valid',
    `but allow_unlisted_senders is on for: ${channelsAllowingUnlisted.join(', ') || 'a channel'} — senders not on that channel whitelist reach the agent (as untrusted)`,
  );

  // ── 3. AI Provider ───────────────────────────────────────────────────────
  section('AI Provider');

  check(
    typeof config.AI.PARALLEL === 'boolean',
    'ai.parallel is valid',
    'Set ai.parallel to true or false in koris.json',
    String(config.AI.PARALLEL),
  );

  check(
    typeof config.AI.SUBAGENTS_PARALLEL === 'boolean',
    'ai.subagents_parallel is valid',
    'Set ai.subagents_parallel to true or false in koris.json',
    String(config.AI.SUBAGENTS_PARALLEL),
  );

  check(
    Number.isInteger(config.AI.BACKGROUND_GRACE_MS) && config.AI.BACKGROUND_GRACE_MS >= 0,
    'ai.background_grace_ms is valid',
    'Set ai.background_grace_ms to a non-negative integer in koris.json',
    String(config.AI.BACKGROUND_GRACE_MS),
  );

  const supportedProvidersLabel = 'Supported providers depend on the current build';

  check(
    isSupportedProvider(config.AI.MANAGER.PROVIDER),
    'ai.manager.provider is supported',
    `Got: "${config.AI.MANAGER.PROVIDER}". ${supportedProvidersLabel}.`,
    config.AI.MANAGER.PROVIDER,
  );

  const managerBaseUrl = resolveProviderBaseUrl(config.AI.MANAGER.PROVIDER, config.AI.MANAGER.BASE_URL);
  check(
    isValidUrl(managerBaseUrl),
    'ai.manager.base_url is a valid URL',
    `Got: "${managerBaseUrl}" (set ai.manager.base_url, or use a provider with a built-in default)`,
    managerBaseUrl,
  );

  check(
    config.AI.MANAGER.MODEL.trim().length > 0,
    'ai.manager.model is not empty',
    'Set ai.manager.model in koris.json',
    config.AI.MANAGER.MODEL,
  );

  check(
    Number.isInteger(config.AI.MANAGER.NUM_CTX) && config.AI.MANAGER.NUM_CTX >= 512 && config.AI.MANAGER.NUM_CTX <= 131072,
    'ai.manager.num_ctx is a valid context size',
    `Got: ${config.AI.MANAGER.NUM_CTX}. Expected an integer between 512 and 131072.`,
    `${config.AI.MANAGER.NUM_CTX} tokens`,
  );

  check(
    isSupportedProvider(config.AI.WORKERS.PROVIDER),
    'ai.workers.provider is supported',
    `Got: "${config.AI.WORKERS.PROVIDER}". ${supportedProvidersLabel}.`,
    config.AI.WORKERS.PROVIDER,
  );

  const workersBaseUrl = resolveProviderBaseUrl(config.AI.WORKERS.PROVIDER, config.AI.WORKERS.BASE_URL);
  check(
    isValidUrl(workersBaseUrl),
    'ai.workers.base_url is a valid URL',
    `Got: "${workersBaseUrl}" (set ai.workers.base_url, or use a provider with a built-in default)`,
    workersBaseUrl,
  );

  check(
    config.AI.WORKERS.MODEL.trim().length > 0,
    'ai.workers.model is not empty',
    'Set ai.workers.model in koris.json',
    config.AI.WORKERS.MODEL,
  );

  check(
    Number.isInteger(config.AI.WORKERS.NUM_CTX) && config.AI.WORKERS.NUM_CTX >= 512 && config.AI.WORKERS.NUM_CTX <= 131072,
    'ai.workers.num_ctx is a valid context size',
    `Got: ${config.AI.WORKERS.NUM_CTX}. Expected an integer between 512 and 131072.`,
    `${config.AI.WORKERS.NUM_CTX} tokens`,
  );

  check(
    config.AI.TIMEOUTS.IDLE_MS > 0,
    'ai.timeouts.idle_ms is positive',
    `Got: ${config.AI.TIMEOUTS.IDLE_MS}`,
    `${config.AI.TIMEOUTS.IDLE_MS} ms`,
  );

  check(
    config.AI.TIMEOUTS.HARD_MS > config.AI.TIMEOUTS.IDLE_MS,
    'ai.timeouts.hard_ms > idle_ms',
    `hard_ms (${config.AI.TIMEOUTS.HARD_MS}) must be greater than idle_ms (${config.AI.TIMEOUTS.IDLE_MS})`,
  );

  advisory(
    config.AI.SEARXNG_URL.trim().length > 0,
    'ai.searxng_url is set',
    'Required for web search tool',
  );

  // ── Structural check: ai.providers[] + ai.roles ────────────────────────
  const rawAi = ((): Record<string, unknown> => {
    const parsed = loadConfigFile({ cwd: process.cwd(), dirname: __dirname });
    const ai = parsed.ai;
    return ai && typeof ai === 'object' && !Array.isArray(ai) ? (ai as Record<string, unknown>) : {};
  })();

  const asObj = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  if (Array.isArray(rawAi.providers)) {
    const providers = (rawAi.providers as unknown[]).map(asObj);
    check(
      providers.some((p) => typeof p.provider === 'string' && p.provider.trim()),
      'ai.providers has at least one entry',
      'Add at least one provider to ai.providers[] in koris.json',
    );

    const providerNames = new Set<string>();
    providers.forEach((entry, i) => {
      const name = typeof entry.provider === 'string' ? entry.provider : '';
      providerNames.add(name);
      check(
        isSupportedProvider(name),
        `ai.providers[${i}].provider is supported`,
        `Got: "${name}". ${supportedProvidersLabel}.`,
        name,
      );
      const baseUrl = resolveProviderBaseUrl(name, typeof entry.base_url === 'string' ? entry.base_url : '');
      check(
        isValidUrl(baseUrl),
        `ai.providers[${i}].base_url is a valid URL`,
        `Got: "${baseUrl}" for provider "${name}"`,
        baseUrl,
      );
      advisory(
        typeof entry.model === 'string' && entry.model.trim().length > 0,
        `ai.providers[${i}].model is set`,
        `provider "${name}" has no model set`,
      );
      if (entry.num_ctx !== undefined) {
        const numCtx = Number(entry.num_ctx);
        check(
          Number.isInteger(numCtx) && numCtx >= 512 && numCtx <= 131072,
          `ai.providers[${i}].num_ctx is a valid context size`,
          `Got: ${entry.num_ctx} for provider "${name}". Expected an integer between 512 and 131072.`,
          `${numCtx} tokens`,
        );
      }
    });

    const roles = asObj(rawAi.roles);
    for (const role of ['manager', 'workers'] as const) {
      const ptr = asObj(roles[role]);
      const ptrProvider = typeof ptr.provider === 'string' ? ptr.provider : '';
      check(
        providerNames.has(ptrProvider),
        `ai.roles.${role}.provider is configured in ai.providers[]`,
        `Got: "${ptrProvider}" — add it to ai.providers[] or point the role at an existing provider`,
        ptrProvider,
      );
      const entry = providers.find((p) => p.provider === ptrProvider);
      const roleModel = entry && typeof entry.model === 'string' ? entry.model : '';
      check(
        roleModel.trim().length > 0,
        `ai.roles.${role} resolves to a provider with a model`,
        `provider "${ptrProvider}" for role ${role} has no model set in ai.providers[]`,
        roleModel,
      );
    }

    const embed = asObj(rawAi.embed);
    if (rawAi.embed !== undefined) {
      const embedProvider = typeof embed.provider === 'string' ? embed.provider : '';
      check(
        isSupportedProvider(embedProvider),
        'ai.embed.provider is supported',
        `Got: "${embedProvider}". ${supportedProvidersLabel}.`,
        embedProvider,
      );
      advisory(
        providerNames.has(embedProvider),
        'ai.embed.provider is configured in ai.providers[]',
        `"${embedProvider}" is not in ai.providers[]`,
      );
      const embedEnabled = embed.enabled === true || String(embed.enabled) === 'true';
      if (embedEnabled) {
        advisory(
          typeof embed.model === 'string' && embed.model.trim().length > 0,
          'ai.embed.model is set',
          'ai.embed.enabled is true but ai.embed.model is empty',
        );
      }
    }
  } else {
    warn('ai.providers[] is missing', 'AI role config will fall back to built-in defaults');
    warnings++;
  }

  // Connectivity check (skipped for mock)
  const profiles = [
    { label: 'manager', provider: config.AI.MANAGER.PROVIDER, baseUrl: config.AI.MANAGER.BASE_URL, apiToken: config.AI.MANAGER.API_TOKEN },
    { label: 'workers', provider: config.AI.WORKERS.PROVIDER, baseUrl: config.AI.WORKERS.BASE_URL, apiToken: config.AI.WORKERS.API_TOKEN },
  ];

  for (const profile of profiles) {
    if (profile.provider === 'mock') {
      pass(`AI provider connectivity check (${profile.label})`, 'skipped (provider=mock)');
      continue;
    }

    process.stdout.write(`  ${c.gray}⟳ Checking ${profile.label} AI provider connectivity …${c.reset}\r`);
    const result = await checkAiProviderConnectivity(
      { label: profile.label, provider: profile.provider, baseUrl: profile.baseUrl, apiToken: profile.apiToken },
      config.AI.TIMEOUTS.HEALTH_MS,
    );

    if (result.ok) {
      pass(`AI provider reachable (${profile.label})`, result.detail ? `v${result.detail}` : result.healthUrl);
    } else if (result.authFailed) {
      fail(`AI provider auth failed (${profile.label})`, `HTTP ${result.status} — check ai.${profile.label}.api_token in koris.json`);
      errors++;
    } else if (result.error) {
      warn(`AI provider unreachable (${profile.label})`, result.error);
      warnings++;
    } else {
      warn(`AI provider unreachable (${profile.label})`, `HTTP ${result.status} from ${result.healthUrl}`);
      warnings++;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  if (errors === 0 && warnings === 0) {
    console.log(`${c.green}${c.bold}✔ All checks passed.${c.reset}\n`);
    process.exit(0);
  } else if (errors === 0) {
    console.log(`${c.yellow}${c.bold}⚠ Passed with ${warnings} warning(s).${c.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${c.red}${c.bold}✖ ${errors} error(s), ${warnings} warning(s). Fix the issues above before starting the app.${c.reset}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${c.red}Unexpected error during validation:${c.reset}`, err);
  process.exit(1);
});
