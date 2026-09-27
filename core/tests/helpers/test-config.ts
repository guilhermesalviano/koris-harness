import { config, SummarizerMode } from '../../src/config';

export interface TestConfigPatch {
  heartbeatEnabled?: boolean;
  summarizerMode?: SummarizerMode;
  subagentsParallel?: boolean;
  audioSttEnabled?: boolean;
  audioTtsEnabled?: boolean;
  sessionTtlMs?: number;
  errandsHardExpiryMs?: number;
  errandsHistoryLimit?: number;
  errandsMaxConcurrent?: number;
}

const DEFAULTS: Required<TestConfigPatch> = {
  heartbeatEnabled: true,
  summarizerMode: 'auto',
  subagentsParallel: false,
  audioSttEnabled: false,
  audioTtsEnabled: false,
  // Pinned rather than left at the real 3h default: expiry tests must not
  // silently depend on production config.
  sessionTtlMs: 3 * 60 * 60 * 1000,
  errandsHardExpiryMs: 7 * 24 * 60 * 60 * 1000,
  errandsHistoryLimit: 100,
  errandsMaxConcurrent: 10,
};

export function applyTestConfigDefaults(patch: TestConfigPatch = {}): void {
  const values = { ...DEFAULTS, ...patch };

  Object.defineProperty(config, 'HEARTBEAT', {
    value: values.heartbeatEnabled,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(config.SESSION, 'SUMMARIZER_MODE', {
    value: values.summarizerMode,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(config.AI, 'SUBAGENTS_PARALLEL', {
    value: values.subagentsParallel,
    configurable: true,
    writable: true,
  });

  if (config.AUDIO?.STT) {
    Object.defineProperty(config.AUDIO.STT, 'ENABLED', {
      value: values.audioSttEnabled,
      configurable: true,
      writable: true,
    });
  }

  if (config.AUDIO?.TTS) {
    Object.defineProperty(config.AUDIO.TTS, 'ENABLED', {
      value: values.audioTtsEnabled,
      configurable: true,
      writable: true,
    });
  }

  Object.defineProperty(config.SESSION, 'TTL_MS', {
    value: values.sessionTtlMs,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(config, 'ERRANDS', {
    value: {
      HARD_EXPIRY_MS: values.errandsHardExpiryMs,
      HISTORY_LIMIT: values.errandsHistoryLimit,
      MAX_CONCURRENT: values.errandsMaxConcurrent,
    },
    configurable: true,
    writable: true,
  });
}
