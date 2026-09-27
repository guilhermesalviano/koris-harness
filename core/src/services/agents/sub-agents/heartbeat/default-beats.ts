import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../../../../config';
import { IDatabaseService } from '../../../../infrastructure/db-sqlite';
import { ILogger } from '../../../../infrastructure/logger';
import { HeartbeatRepositoryFactory } from '../../../../repositories/heartbeat';
import { Heartbeat } from '../../../../entities/heartbeat';
import { BEAT_TYPES, BeatType } from '../../../../types/beat';
import { isValidCronExpression } from '../../../../utils/heartbeat';
import { CHANNEL_TYPES } from '../../../../entities/channel';

export const DEFAULT_HEARTBEATS_FILENAME = 'heartbeats.default.json';

interface DefaultBeatConfig {
  beat?: string;
  type?: string;
  cron_expression?: string;
  channel?: string | null;
  target?: string | null;
}

function loadDefaultBeats(filepath: string): DefaultBeatConfig[] | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filepath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isValidEntry(entry: DefaultBeatConfig): entry is DefaultBeatConfig & {
  beat: string;
  type: BeatType;
  cron_expression: string;
} {
  if (typeof entry.beat !== 'string' || !entry.beat.trim()) return false;
  if (typeof entry.type !== 'string' || !BEAT_TYPES.includes(entry.type as BeatType)) return false;
  if (typeof entry.cron_expression !== 'string' || !isValidCronExpression(entry.cron_expression)) return false;

  if (entry.channel !== undefined && entry.channel !== null && typeof entry.channel !== 'string') return false;
  if (entry.target !== undefined && entry.target !== null && typeof entry.target !== 'string') return false;
  if (entry.channel && !CHANNEL_TYPES.includes(entry.channel as (typeof CHANNEL_TYPES)[number])) return false;
  if ((entry.channel && !entry.target) || (!entry.channel && entry.target)) return false;

  return true;
}

/**
 * Seeds and reconciles the heartbeat table against heartbeats.default.json.
 * Config-owned beats are flagged `managed=1` and fully synced (updated or
 * pruned). Beats created by the user (set_beat tool / dashboard) are never
 * modified or removed.
 */
export function seedDefaultBeats(db: IDatabaseService, logger: ILogger, filepath?: string): void {
  const path = filepath ?? join(config.BASE_DIR, DEFAULT_HEARTBEATS_FILENAME);

  if (!existsSync(path)) {
    logger.warn(`[beat] No ${DEFAULT_HEARTBEATS_FILENAME} found — skipping default beat sync.`);
    return;
  }

  const defaults = loadDefaultBeats(path);
  if (defaults === null) {
    logger.warn(`[beat] Failed to parse ${DEFAULT_HEARTBEATS_FILENAME} — skipping default beat sync.`);
    return;
  }

  const repository = HeartbeatRepositoryFactory.create(db);
  const existing = repository.getAll();

  const valid = defaults.filter(isValidEntry);
  const invalidCount = defaults.length - valid.length;
  if (invalidCount > 0) {
    logger.warn(`[beat] Skipped ${invalidCount} invalid default beat entry(ies).`);
  }

  const configTexts = new Set(valid.map((entry) => entry.beat.trim()));
  const existingByText = new Map(existing.map((beat) => [beat.beat, beat]));

  let created = 0;
  let updated = 0;

  for (const entry of valid) {
    const beatText = entry.beat.trim();
    const current = existingByText.get(beatText);

    if (current) {
      repository.update(current.id, {
        type: entry.type,
        cronExpression: entry.cron_expression.trim(),
        channel: entry.channel ?? null,
        target: entry.target ?? null,
        managed: true,
      });
      updated++;
    } else {
      repository.save(new Heartbeat({
        beat: beatText,
        type: entry.type,
        cronExpression: entry.cron_expression.trim(),
        channel: entry.channel ?? undefined,
        target: entry.target ?? undefined,
        managed: true,
      }));
      created++;
    }
  }

  let pruned = 0;
  for (const beat of existing) {
    if (beat.managed && !configTexts.has(beat.beat)) {
      repository.deleteById(beat.id);
      pruned++;
    }
  }

  logger.info(`[beat] Synced ${valid.length} default beat(s) from ${path} (${created} created, ${updated} updated, ${pruned} pruned).`);
}