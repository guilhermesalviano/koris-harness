import { describe, it, expect, vi } from 'vitest';
import { seedDefaultBeats, DEFAULT_HEARTBEATS_FILENAME } from '../../../../../../src/services/agents/sub-agents/heartbeat/default-beats';
import { HeartbeatRepositoryFactory } from '../../../../../../src/repositories/heartbeat';

vi.mock('../../../../../../src/repositories/heartbeat', () => ({
  HeartbeatRepositoryFactory: { create: vi.fn() },
}));

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function writeConfig(content: unknown): string {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const filepath = path.join(require('os').tmpdir(), `heartbeats-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(filepath, JSON.stringify(content));
  return filepath;
}

function cleanup(filepath: string): void {
  const fs = require('fs') as typeof import('fs');
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}

function makeBeatRow(overrides: Partial<{ id: string; beat: string; type: string; cron_expression: string; managed: number; created_at: string }> = {}) {
  return {
    id: 'h1',
    beat: '__koris_clear_images__',
    type: 'scheduled_beat',
    cron_expression: '0 0 * * *',
    managed: 0,
    created_at: '2025-12-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('seedDefaultBeats', () => {
  const validConfig = [
    {
      beat: '__koris_clear_images__',
      type: 'scheduled_beat',
      cron_expression: '0 0 * * *',
    },
  ];

  it('creates default beats that do not exist yet', () => {
    const filepath = writeConfig(validConfig);
    const repo = { getAll: vi.fn().mockReturnValue([]), save: vi.fn(), update: vi.fn(), deleteById: vi.fn() };
    (HeartbeatRepositoryFactory.create as ReturnType<typeof vi.fn>).mockReturnValue(repo);
    const logger = makeLogger();

    seedDefaultBeats({} as never, logger as never, filepath);

    expect(repo.save).toHaveBeenCalledTimes(1);
    const [heartbeat] = repo.save.mock.calls[0];
    expect(heartbeat.beat).toBe('__koris_clear_images__');
    expect(heartbeat.type).toBe('scheduled_beat');
    expect(heartbeat.cronExpression).toBe('0 0 * * *');
    expect(heartbeat.managed).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.deleteById).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('1 created, 0 updated, 0 pruned'));
    cleanup(filepath);
  });

  it('updates matching beats and flags them managed', () => {
    const filepath = writeConfig([{ ...validConfig[0], cron_expression: '0 3 * * *' }]);
    const repo = {
      getAll: vi.fn().mockReturnValue([makeBeatRow({ id: 'h1', managed: 0 })]),
      save: vi.fn(),
      update: vi.fn(),
      deleteById: vi.fn(),
    };
    (HeartbeatRepositoryFactory.create as ReturnType<typeof vi.fn>).mockReturnValue(repo);
    const logger = makeLogger();

    seedDefaultBeats({} as never, logger as never, filepath);

    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('h1', {
      type: 'scheduled_beat',
      cronExpression: '0 3 * * *',
      channel: null,
      target: null,
      managed: true,
    });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('0 created, 1 updated, 0 pruned'));
    cleanup(filepath);
  });

  it('prunes managed beats absent from the config but keeps user beats', () => {
    const filepath = writeConfig([]);
    const repo = {
      getAll: vi.fn().mockReturnValue([
        makeBeatRow({ id: 'managed-1', beat: '__koris_clear_images__', managed: 1 }),
        makeBeatRow({ id: 'user-1', beat: 'send report', managed: 0 }),
      ]),
      save: vi.fn(),
      update: vi.fn(),
      deleteById: vi.fn(),
    };
    (HeartbeatRepositoryFactory.create as ReturnType<typeof vi.fn>).mockReturnValue(repo);
    const logger = makeLogger();

    seedDefaultBeats({} as never, logger as never, filepath);

    expect(repo.deleteById).toHaveBeenCalledTimes(1);
    expect(repo.deleteById).toHaveBeenCalledWith('managed-1');
    expect(repo.deleteById).not.toHaveBeenCalledWith('user-1');
    cleanup(filepath);
  });

  it('skips invalid entries with a warning', () => {
    const filepath = writeConfig([
      { beat: 'missing-cron', type: 'scheduled_beat' },
      { beat: '__koris_clear_images__', type: 'scheduled_beat', cron_expression: '0 0 * * *' },
      { beat: 'bad-type', type: 'nope', cron_expression: '0 0 * * *' },
    ]);
    const repo = { getAll: vi.fn().mockReturnValue([]), save: vi.fn(), update: vi.fn(), deleteById: vi.fn() };
    (HeartbeatRepositoryFactory.create as ReturnType<typeof vi.fn>).mockReturnValue(repo);
    const logger = makeLogger();

    seedDefaultBeats({} as never, logger as never, filepath);

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save.mock.calls[0][0].beat).toBe('__koris_clear_images__');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('2 invalid'));
    cleanup(filepath);
  });

  it('warns and does nothing when the config file is missing', () => {
    const repo = { getAll: vi.fn().mockReturnValue([]), save: vi.fn(), update: vi.fn(), deleteById: vi.fn() };
    (HeartbeatRepositoryFactory.create as ReturnType<typeof vi.fn>).mockReturnValue(repo);
    const logger = makeLogger();
    const missing = `/tmp/nonexistent-${DEFAULT_HEARTBEATS_FILENAME}`;

    seedDefaultBeats({} as never, logger as never, missing);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping default beat sync'));
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.deleteById).not.toHaveBeenCalled();
  });
});