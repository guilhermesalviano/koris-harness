import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatSingleton } from '../../../../../../src/services/agents/sub-agents/heartbeat/runner';
import { HeartbeatFactory } from '../../../../../../src/services/agents/sub-agents/heartbeat/sub-agent';
import { nextCronFire } from '../../../../../../src/utils/heartbeat';
import type { ILogger } from '../../../../../../src/infrastructure/logger';

// Mock everything
vi.mock('../../../../../../src/utils/heartbeat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../src/utils/heartbeat')>();
  return {
    ...actual,
    matchesCron: vi.fn(),
    isCronDue: vi.fn().mockReturnValue(true),
    nextCronFire: vi.fn(),
  };
});

const handlerMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../../../src/services/agents/sub-agents/heartbeat/sub-agent', () => ({
  HeartbeatFactory: {
    create: vi.fn(() => ({ handler: handlerMock })),
  },
}));

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

describe('Heartbeat Lifecycle Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (HeartbeatSingleton as any).instance = undefined;
  });

  it('completes a full lifecycle: schedule -> fire -> reschedule', async () => {
    const logger = makeLogger();
    const tasks = [{ id: 't1', cronExpression: '*/5 * * * *', lastRun: undefined, createdAt: new Date() }];
    const repo = { getAll: vi.fn().mockReturnValue(tasks), updateLastRun: vi.fn() };
    const runRepo = { recordRun: vi.fn(), getLastRun: vi.fn() };
    handlerMock.mockImplementation(async (date) => {
      repo.updateLastRun(tasks[0].id, date);
    });

    // 1. Initial Schedule (at time 0)
    console.log('nextCronFire is:', nextCronFire);
    (nextCronFire as any).mockReturnValue(new Date(Date.now() + 5000));
    const runner = HeartbeatSingleton.getInstance(logger, repo as any, runRepo as any);
    runner.start();

    expect(nextCronFire).toHaveBeenCalledTimes(1);

    // 2. Fire (at time 5000)
    await vi.advanceTimersByTimeAsync(5000);
    expect(HeartbeatFactory.create).toHaveBeenCalledTimes(1);
    expect(repo.updateLastRun).toHaveBeenCalled();
    expect(runRepo.recordRun).toHaveBeenCalledTimes(1);

    // 3. Reschedule (after fire, should call nextCronFire again)
    (nextCronFire as any).mockReturnValue(new Date(Date.now() + 5000));
    await vi.advanceTimersByTimeAsync(0); // Process finally block
    expect(nextCronFire).toHaveBeenCalledTimes(2);
  });
});
