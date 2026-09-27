import 'dotenv/config';
import { deepGet, getConfigValue, loadConfigFile } from './helpers';
import { resolveAiRoles } from './ai-config';

let fileConfig = loadConfigFile({
  onParseError: (message) => console.warn(message),
});

function get(path: string, fallback: string): string {
  return getConfigValue(path, fallback, fileConfig);
}

/**
 * Like `get`, but only consults the env-var override for `path` (via toEnvKey)
 * and otherwise returns `value` unchanged. Used for the AI role fields, which
 * are resolved from `ai.providers[]` / `ai.roles` rather than a fixed path.
 */
function envOr(path: string, value: string): string {
  return getConfigValue(path, value, {});
}

function getPersonalInformation(): Record<string, string> {
  const raw = deepGet(fileConfig, 'personal_information');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  return Object.entries(raw).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = String(value);
    }
    return acc;
  }, {});
}

export type SummarizerMode = 'auto' | 'manual';
export type SkillsMode = 'auto' | 'manual';

export interface AppConfig {
  LOG_LEVEL: string;
  TIMEZONE: string;
  ENVIRONMENT: string;
  WEB_PORT: number;
  /** Read-only application root (bundled code, dist-web/, skills/). */
  BASE_DIR: string;
  /** Writable data root (koris.json, memory/, logs/). Same as BASE_DIR unless KORIS_DATA_DIR is set. */
  DATA_DIR: string;
  GATEWAY_HOST: string;
  ADMIN_SECRET: string;
  ALLOWED_DOMAINS: string[];
  SKILLS: {
    /**
     * 'auto': every enabled skill's full body is injected into the system
     * prompt on every turn.
     * 'manual': skills stay out of the prompt (only a one-line index remains) —
     * the `/<skill-name>` command is the sole way one gets loaded, for that turn.
     */
    MODE: SkillsMode;
    /** Maximum number of enabled skills surfaced to the LLM. */
    LIMIT: number;
  };
  SESSION: {
    /** Sessions auto-rotate once idle past this long, regardless of mode. */
    TTL_MS: number;
    /**
     * 'auto': the per-turn summarizer runs after every reply, distilling
     * each exchange into a memory as it happens.
     * 'manual': the per-turn summarizer is off — the `/compact` command is
     * the sole way a session gets summarized (and rotated on demand).
     */
    SUMMARIZER_MODE: SummarizerMode;
    /**
     * Manual-mode safety valve: fraction (0.1–1) of the manager provider's
     * context window (`ai.manager` num_ctx) at which a session is auto-compacted
     * — summarized into memory and rotated — before the next turn, so a
     * manual-mode session can't grow until it overflows the model. Ignored when
     * SUMMARIZER_MODE is 'auto' (the per-turn summarizer already condenses).
     */
    COMPACT_THRESHOLD: number;
  };
  ERRANDS: {
    /** An in-flight errand with no progress this long is lazily flipped to `expired` on next read. */
    HARD_EXPIRY_MS: number;
    /** History window given to the negotiator for a delegated session, replacing the normal 15-message cap. */
    HISTORY_LIMIT: number;
    /** Cap on simultaneously non-terminal errands, across all origins. */
    MAX_CONCURRENT: number;
  };
  HEARTBEAT: boolean;
  AI: {
    PARALLEL: boolean;
    SUBAGENTS_PARALLEL: boolean;
    BACKGROUND_GRACE_MS: number;
    MANAGER: {
      PROVIDER: string;
      BASE_URL: string;
      API_TOKEN: string;
      MODEL: string;
      NUM_CTX: number;
    };
    WORKERS: {
      PROVIDER: string;
      BASE_URL: string;
      API_TOKEN: string;
      MODEL: string;
      NUM_CTX: number;
    };
    EMBED: {
      ENABLED: boolean;
      PROVIDER: string;
      BASE_URL: string;
      API_TOKEN: string;
      MODEL: string;
    };
    SEARXNG_URL: string;
    TIMEOUTS: {
      IDLE_MS: number;
      HARD_MS: number;
      HEALTH_MS: number;
    };
    PROMPT_SANITIZER: boolean;
  };
  AUDIO: {
    STT: {
      ENABLED: boolean;
      ENDPOINT: string;
      LANGUAGE?: string;
      TIMEOUT_MS: number;
    };
    TTS: {
      ENABLED: boolean;
      ENDPOINT: string;
      VOICE: string;
      SPEED: number;
      MAX_INPUT_CHARS: number;
      TIMEOUT_MS: number;
    };
  };
  GITHUB: {
    TOKEN: string;
    OWNER: string;
  };
  PERSONAL_INFORMATION: Record<string, string>;
}

function buildConfig(): AppConfig {
  return {
  LOG_LEVEL:   get('log_level', 'info'),
  TIMEZONE:    get('timezone', 'America/Sao_Paulo'),
  ENVIRONMENT: get('environment', 'development'),
  WEB_PORT:    Number(get('web_port', '3000')),
  BASE_DIR:    process.env.KORIS_APP_DIR || process.cwd(),
  DATA_DIR:    process.env.KORIS_DATA_DIR || process.cwd(),
  GATEWAY_HOST: get('gateway_host', 'http://localhost:3000'),
  ADMIN_SECRET: get('admin_secret', ''),
  ALLOWED_DOMAINS: get('allowed_domains', '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
  SKILLS: {
    MODE: get('skills.mode', 'auto') === 'manual' ? 'manual' : 'auto',
    LIMIT: (() => {
      const raw = Number(get('skills.limit', get('learned_skills_limit', '10')));
      return Number.isInteger(raw) && raw > 0 ? raw : 10;
    })(),
  },
  SESSION: {
    TTL_MS: Number(get('session.ttl_ms', String(3 * 60 * 60 * 1000))),
    SUMMARIZER_MODE: get('session.summarizer_mode', 'auto') === 'manual' ? 'manual' : 'auto',
    COMPACT_THRESHOLD: (() => {
      const raw = Number(get('session.compact_threshold', '0.9'));
      return Number.isFinite(raw) ? Math.min(1, Math.max(0.1, raw)) : 0.9;
    })(),
  },
  ERRANDS: {
    HARD_EXPIRY_MS: Number(get('errands.hard_expiry_ms', String(7 * 24 * 60 * 60 * 1000))),
    HISTORY_LIMIT: (() => {
      const raw = Number(get('errands.history_limit', '100'));
      return Number.isInteger(raw) && raw > 0 ? raw : 100;
    })(),
    MAX_CONCURRENT: (() => {
      const raw = Number(get('errands.max_concurrent', '10'));
      return Number.isInteger(raw) && raw > 0 ? raw : 10;
    })(),
  },
  HEARTBEAT: get('heartbeat', 'true') === 'true',
  AI: (() => {
    // Resolve manager/workers/embed from the `ai.providers[]` + `ai.roles` +
    // `ai.embed` shape, then layer the documented env-var overrides on top of
    // each field.
    const roles = resolveAiRoles(deepGet(fileConfig, 'ai') ?? {});
    return {
    PARALLEL: get('ai.parallel', 'true') === 'true',
    SUBAGENTS_PARALLEL: get('ai.subagents_parallel', 'false') === 'true',
    BACKGROUND_GRACE_MS: Number(get('ai.background_grace_ms', '5000')),
    MANAGER: {
      PROVIDER: process.env.VITEST === 'true' ? 'mock' : envOr('ai.manager.provider', roles.MANAGER.PROVIDER),
      BASE_URL: envOr('ai.manager.base_url', roles.MANAGER.BASE_URL),
      API_TOKEN: envOr('ai.manager.api_token', roles.MANAGER.API_TOKEN),
      MODEL:   envOr('ai.manager.model', roles.MANAGER.MODEL),
      // num_ctx is resolved from the manager provider entry. Env overrides apply.
      NUM_CTX: Number(envOr('ai.manager.num_ctx', String(roles.MANAGER.NUM_CTX))),
    },
    WORKERS: {
      PROVIDER: process.env.VITEST === 'true' ? 'mock' : envOr('ai.workers.provider', roles.WORKERS.PROVIDER),
      BASE_URL: envOr('ai.workers.base_url', roles.WORKERS.BASE_URL),
      API_TOKEN: envOr('ai.workers.api_token', roles.WORKERS.API_TOKEN),
      MODEL:   envOr('ai.workers.model', roles.WORKERS.MODEL),
      // num_ctx is resolved from the workers provider entry. Env overrides apply.
      NUM_CTX: Number(envOr('ai.workers.num_ctx', String(roles.WORKERS.NUM_CTX))),
    },
    EMBED: {
      // Embeddings have their own pointer (`ai.embed`), resolved to
      // base_url/api_token from the matching ai.providers[] entry.
      ENABLED: envOr('ai.embed.enabled', String(roles.EMBED.ENABLED)) === 'true',
      PROVIDER: process.env.VITEST === 'true' ? 'mock' : envOr('ai.embed.provider', roles.EMBED.PROVIDER),
      BASE_URL: envOr('ai.embed.base_url', roles.EMBED.BASE_URL),
      API_TOKEN: envOr('ai.embed.api_token', roles.EMBED.API_TOKEN),
      MODEL: envOr('ai.embed.model', roles.EMBED.MODEL),
    },
    SEARXNG_URL: get('ai.searxng_url', ''),
    TIMEOUTS: {
      IDLE_MS:   Number(get('ai.timeouts.idle_ms', String(6 * 60_000))),
      HARD_MS:   Number(get('ai.timeouts.hard_ms', String(20 * 60_000))),
      HEALTH_MS: Number(get('ai.timeouts.health_ms', String(5_000))),
    },
    PROMPT_SANITIZER: get('ai.prompt_sanitizer', 'false') === 'true',
    };
  })(),
  AUDIO: {
    STT: {
      ENABLED: get('audio.stt.enabled', 'false') === 'true',
      ENDPOINT: get('audio.stt.endpoint', 'http://127.0.0.1:6006/v1/audio/transcriptions'),
      LANGUAGE: get('audio.stt.language', 'auto'),
      TIMEOUT_MS: (() => {
        const raw = Number(get('audio.stt.timeout_ms', '30000'));
        return Number.isFinite(raw) && raw > 0 ? raw : 30000;
      })(),
    },
    TTS: {
      ENABLED: get('audio.tts.enabled', 'false') === 'true',
      ENDPOINT: get('audio.tts.endpoint', 'http://127.0.0.1:6006/v1/audio/speech'),
      VOICE: get('audio.tts.voice', 'en_US-lessac-medium'),
      SPEED: (() => {
        const raw = Number(get('audio.tts.speed', '1.0'));
        return Number.isFinite(raw) && raw > 0 ? raw : 1.0;
      })(),
      MAX_INPUT_CHARS: (() => {
        const raw = Number(get('audio.tts.max_input_chars', '5000'));
        return Number.isInteger(raw) && raw > 0 ? raw : 5000;
      })(),
      TIMEOUT_MS: (() => {
        const raw = Number(get('audio.tts.timeout_ms', '30000'));
        return Number.isFinite(raw) && raw > 0 ? raw : 30000;
      })(),
    },
  },
  GITHUB: {
    TOKEN: get('github.token', ''),
    OWNER: get('github.owner', ''),
  },
  PERSONAL_INFORMATION: getPersonalInformation(),
  };
}

export const config: AppConfig = buildConfig();

/**
 * Re-reads koris.json (and env vars) and applies the new values onto the
 * existing `config` object in place, so already-imported references stay
 * valid. Note this is a shallow merge: nested objects (config.AI,
 * config.SESSION, ...) are replaced wholesale with new references — code
 * must not cache a nested object across a reload.
 */
export function reloadConfig(options?: { cwd?: string; dirname?: string }): void {
  fileConfig = loadConfigFile({
    cwd: options?.cwd,
    dirname: options?.dirname,
    onParseError: (message) => console.warn(message),
  });
  Object.assign(config, buildConfig());
}
