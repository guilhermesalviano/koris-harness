import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Heartbeat } from '../../../../../../src/services/agents/sub-agents/heartbeat/sub-agent';
import { config } from '../../../../../../src/config';
import type { ILogger } from '../../../../../../src/infrastructure/logger';
import { sharedSubAgentQueue } from '../../../../../../src/services/agents/sub-agents/queue/task-queue';
import { SYSTEM_BEAT_CLEAR_IMAGES } from '../../../../../../src/constants';

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeHeartbeat(overrides: Partial<{
  beats: Array<{ id: string; beat: string; cronExpression: string; type: string; channel?: string; target?: string; lastRun?: Date; runOnce?: boolean }>;
  completionResponse: unknown;
  pipelineResult: string;
}> = {}) {
  const logger = makeLogger();
  const heartbeatRepository = {
    getAll: vi.fn().mockReturnValue(overrides.beats ?? []),
    updateLastRun: vi.fn(),
    deleteById: vi.fn().mockReturnValue(true),
  };
  const promptRepository = {
    build: vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'prompt' }] }),
  };
  const completionService = {
    complete: vi.fn().mockResolvedValue(
      overrides.completionResponse ?? { kind: 'message', text: 'beat done' },
    ),
  };
  const pipeline = {
    execute: vi.fn().mockResolvedValue(overrides.pipelineResult ?? 'executed'),
  };
  const imageRepository = {
    deleteAll: vi.fn().mockReturnValue(3),
  };
  const beatRunRepository = {
    save: vi.fn(),
  };

  const heartbeat = new Heartbeat(
    logger,
    promptRepository as never,
    heartbeatRepository as never,
    { enqueue: vi.fn() } as never,
    completionService as never,
    pipeline as never,
    imageRepository as never,
    beatRunRepository as never,
  );

  return {
    heartbeat,
    logger,
    heartbeatRepository,
    promptRepository,
    completionService,
    pipeline,
    imageRepository,
    beatRunRepository,
  };
}

function localDate(hours: number, minutes = 0): Date {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

describe('Heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handler', () => {
    it('logs when there are no scheduled beats', async () => {
      const { heartbeat, logger } = makeHeartbeat({ beats: [] });

      await heartbeat.handler(localDate(12));

      expect(logger.info).toHaveBeenCalledWith('Heartbeat: No scheduled beats found.');
    });

    it('skips beats that are not due yet', async () => {
      const now = localDate(12, 5);
      const lastRun = localDate(12, 0);
      const { heartbeat, logger, completionService } = makeHeartbeat({
        beats: [{
          id: 'hourly',
          beat: 'sync data',
          cronExpression: '0 13 * * *',
          type: 'sync',
          lastRun,
        }],
      });

      await heartbeat.handler(now);

      expect(completionService.complete).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('not due yet'));
    });

    it('executes due beats and stores the result without messaging a channel', async () => {
      const now = localDate(9, 0);
      const { heartbeat, completionService, beatRunRepository, heartbeatRepository, logger } = makeHeartbeat({
        beats: [{
          id: 'morning',
          beat: 'send status',
          cronExpression: '0 9 * * *',
          type: 'report',
        }],
        completionResponse: { kind: 'message', text: 'status ok' },
      });

      await heartbeat.handler(now);

      expect(completionService.complete).toHaveBeenCalled();
      expect(beatRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({ beatId: 'morning', status: 'success', result: 'status ok' }));
      expect(heartbeatRepository.updateLastRun).toHaveBeenCalledWith('morning', now);
      expect(logger.info).toHaveBeenCalledWith('Heartbeat: Beat "morning" completed successfully.');
    });

    it('removes a one-time beat after it fires', async () => {
      const now = localDate(9, 30);
      const { heartbeat, beatRunRepository, heartbeatRepository, logger } = makeHeartbeat({
        beats: [{
          id: 'once',
          beat: 'call mom',
          cronExpression: `30 9 ${now.getDate()} ${now.getMonth() + 1} *`,
          type: 'reminder',
          runOnce: true,
        }],
        completionResponse: { kind: 'message', text: 'call mom' },
      });

      await heartbeat.handler(now);

      expect(beatRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({ beatId: 'once', status: 'success', result: 'call mom' }));
      expect(heartbeatRepository.deleteById).toHaveBeenCalledWith('once');
      expect(logger.info).toHaveBeenCalledWith('Heartbeat: One-time beat "once" fired and was removed.');
    });

    it('removes a one-time beat even when its execution fails', async () => {
      const now = localDate(9, 30);
      const { heartbeat, heartbeatRepository, completionService } = makeHeartbeat({
        beats: [{
          id: 'once',
          beat: 'call mom',
          cronExpression: `30 9 ${now.getDate()} ${now.getMonth() + 1} *`,
          type: 'reminder',
          runOnce: true,
        }],
      });
      completionService.complete.mockRejectedValueOnce(new Error('provider down'));

      await heartbeat.handler(now);

      expect(heartbeatRepository.deleteById).toHaveBeenCalledWith('once');
    });

    it('keeps recurring beats after they fire', async () => {
      const now = localDate(9, 0);
      const { heartbeat, heartbeatRepository } = makeHeartbeat({
        beats: [{ id: 'daily', beat: 'send status', cronExpression: '0 9 * * *', type: 'reminder' }],
      });

      await heartbeat.handler(now);

      expect(heartbeatRepository.updateLastRun).toHaveBeenCalledWith('daily', now);
      expect(heartbeatRepository.deleteById).not.toHaveBeenCalled();
    });

    it('routes tool-call responses through the tool-call pipeline', async () => {
      const now = localDate(9, 0);
      const toolCalls = [{ name: 'execute_command', arguments: { command: 'echo hi' } }];
      const { heartbeat, pipeline, beatRunRepository } = makeHeartbeat({
        beats: [{
          id: 'tool-beat',
          beat: 'run command',
          cronExpression: '0 9 * * *',
          type: 'automation',
        }],
        completionResponse: { kind: 'tool_calls', calls: toolCalls },
        pipelineResult: 'hi',
      });

      await heartbeat.handler(now);

      expect(pipeline.execute).toHaveBeenCalledWith(
        toolCalls,
        'run command',
        [],
        expect.objectContaining({
          channel: 'background',
          options: expect.objectContaining({ runId: expect.any(String) }),
          initiatedBy: 'heartbeat',
        }),
      );
      expect(beatRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({ beatId: 'tool-beat', status: 'success', result: 'hi' }));
    });

    it('continues executing remaining beats when one beat fails', async () => {
      const now = localDate(9, 0);
      const { heartbeat, logger, completionService, heartbeatRepository, beatRunRepository } = makeHeartbeat({
        beats: [
          {
            id: 'failing',
            beat: 'broken beat',
            cronExpression: '0 9 * * *',
            type: 'report',
          },
          {
            id: 'success',
            beat: 'healthy beat',
            cronExpression: '0 9 * * *',
            type: 'report',
          },
        ],
      });
      completionService.complete
        .mockRejectedValueOnce(new Error('model failed'))
        .mockResolvedValueOnce({ kind: 'message', text: 'all good' });

      await heartbeat.handler(now);

      expect(completionService.complete).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        'Heartbeat: Beat "failing" failed.',
        expect.objectContaining({ err: expect.any(Error) }),
      );
      expect(heartbeatRepository.updateLastRun).toHaveBeenCalledWith('success', now);
      expect(beatRunRepository.save).toHaveBeenCalledWith(expect.objectContaining({ beatId: 'success', status: 'success', result: 'all good' }));
      expect(logger.info).toHaveBeenCalledWith('Heartbeat: Beat "success" completed successfully.');
    });

    it('logs beat failures without stopping other beats', async () => {
      const now = localDate(9, 0);
      const { heartbeat, logger, completionService } = makeHeartbeat({
        beats: [{
          id: 'failing',
          beat: 'broken beat',
          cronExpression: '0 9 * * *',
          type: 'report',
        }],
      });
      completionService.complete.mockRejectedValue(new Error('model failed'));

      await heartbeat.handler(now);

      expect(logger.error).toHaveBeenCalledWith(
        'Heartbeat: Beat "failing" failed.',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });

    it('marks lastRun at dispatch even when the beat execution fails', async () => {
      const now = localDate(9, 0);
      const { heartbeat, logger, completionService, heartbeatRepository } = makeHeartbeat({
        beats: [{
          id: 'failing',
          beat: 'broken beat',
          cronExpression: '0 9 * * *',
          type: 'report',
        }],
      });
      completionService.complete.mockRejectedValue(new Error('model failed'));

      await heartbeat.handler(now);

      expect(heartbeatRepository.updateLastRun).toHaveBeenCalledWith('failing', now);
      expect(logger.error).toHaveBeenCalledWith(
        'Heartbeat: Beat "failing" failed.',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });

    it('executes due beats serially through the internal queue when subagents_parallel is false', async () => {
      (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = true;
      const now = localDate(9, 0);
      const release: Array<() => void> = [];
      const gated = () => new Promise((resolve) => release.push(() => resolve({ kind: 'message', text: 'beat done' })));

      const { heartbeat, completionService, beatRunRepository } = makeHeartbeat({
        beats: [
          {
            id: 'beat-a',
            beat: 'first beat',
            cronExpression: '0 9 * * *',
            type: 'report',
          },
          {
            id: 'beat-b',
            beat: 'second beat',
            cronExpression: '0 9 * * *',
            type: 'report',
          },
        ],
      });
      completionService.complete.mockImplementation(gated);

      const run = heartbeat.handler(now);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(completionService.complete).toHaveBeenCalledTimes(1);

      release[0]();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(completionService.complete).toHaveBeenCalledTimes(2);

      release[1]();
      await run;

      expect(beatRunRepository.save.mock.calls.map(([run]) => run.beatId)).toEqual(['beat-a', 'beat-b']);
    });

    it('uses the shared sub-agent queue when subagents_parallel is false', async () => {
      (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = false;
      const { heartbeat } = makeHeartbeat();

      expect((heartbeat as unknown as { queue: unknown }).queue).toBe(sharedSubAgentQueue);
    });

    it('uses its own queue when subagents_parallel is true', async () => {
      (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = true;
      const { heartbeat } = makeHeartbeat();

      expect((heartbeat as unknown as { queue: unknown }).queue).not.toBe(sharedSubAgentQueue);
    });

    it('executes a system cleanup beat natively without the LLM or a stored run', async () => {
      const now = localDate(0, 0);
      const { heartbeat, imageRepository, completionService, promptRepository, beatRunRepository, heartbeatRepository } = makeHeartbeat({
        beats: [{
          id: 'cleanup',
          beat: SYSTEM_BEAT_CLEAR_IMAGES,
          cronExpression: '0 0 * * *',
          type: 'scheduled_beat',
        }],
      });

      await heartbeat.handler(now);

      expect(imageRepository.deleteAll).toHaveBeenCalledTimes(1);
      expect(completionService.complete).not.toHaveBeenCalled();
      expect(promptRepository.build).not.toHaveBeenCalled();
      expect(beatRunRepository.save).not.toHaveBeenCalled();
      expect(heartbeatRepository.updateLastRun).toHaveBeenCalledWith('cleanup', now);
    });

    it('exposes queue state via snapshot', async () => {
      (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = true;
      const now = localDate(9, 0);
      const release: Array<() => void> = [];
      const gated = () => new Promise((resolve) => release.push(() => resolve({ kind: 'message', text: 'ok' })));
      const { heartbeat, completionService } = makeHeartbeat({
        beats: [
          { id: 'a', beat: 'first beat', cronExpression: '0 9 * * *', type: 'report' },
          { id: 'b', beat: 'second beat', cronExpression: '0 9 * * *', type: 'report' },
        ],
      });
      completionService.complete.mockImplementation(gated);

      const run = heartbeat.handler(now);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const queue = (heartbeat as unknown as { queue: { snapshot(): unknown } }).queue;
      expect(queue.snapshot()).toEqual({ queued: 1, active: 1, concurrency: 1, queuedLabels: ['heartbeat: b'], activeLabels: ['heartbeat: a'] });

      release[0]();
      await new Promise((resolve) => setTimeout(resolve, 0));
      release[1]();
      await run;

      expect(queue.snapshot()).toEqual({ queued: 0, active: 0, concurrency: 1, queuedLabels: [], activeLabels: [] });
    });
  });

  describe('run history', () => {
    it('records each run with its own id and result', async () => {
      const now = localDate(9, 0);
      const { heartbeat, completionService, beatRunRepository } = makeHeartbeat({
        beats: [{ id: 'morning', beat: 'send status', cronExpression: '0 9 * * *', type: 'scheduled_beat' }],
        completionResponse: { kind: 'message', text: 'status ok' },
      });

      await heartbeat.handler(now);

      const [run] = beatRunRepository.save.mock.calls[0];
      expect(run).toMatchObject({
        beatId: 'morning', beat: 'send status', beatType: 'scheduled_beat',
        status: 'success', result: 'status ok', startedAt: expect.any(Date), finishedAt: expect.any(Date),
      });
      expect(run.id).not.toBe('morning');
      expect(completionService.complete).toHaveBeenCalledWith(expect.anything(), { audit: { channel: 'background', runId: run.id } });
    });

    it('records a failed run with its error and keeps other beats running', async () => {
      const now = localDate(9, 0);
      const { heartbeat, completionService, beatRunRepository } = makeHeartbeat({
        beats: [
          { id: 'failing', beat: 'broken beat', cronExpression: '0 9 * * *', type: 'report' },
          { id: 'success', beat: 'healthy beat', cronExpression: '0 9 * * *', type: 'report' },
        ],
      });
      completionService.complete.mockRejectedValueOnce(new Error('model failed')).mockResolvedValueOnce({ kind: 'message', text: 'all good' });

      await heartbeat.handler(now);

      const runs = beatRunRepository.save.mock.calls.map(([run]) => run);
      expect(runs).toEqual([
        expect.objectContaining({ beatId: 'failing', status: 'error', errorMessage: 'model failed', result: undefined }),
        expect.objectContaining({ beatId: 'success', status: 'success', result: 'all good' }),
      ]);
      expect(runs[0].id).not.toBe(runs[1].id);
    });

    it('logs a run that cannot be recorded, and skips the system image cleanup', async () => {
      const now = localDate(9, 0);
      const { heartbeat, beatRunRepository, logger } = makeHeartbeat({
        beats: [
          { id: 'morning', beat: 'send status', cronExpression: '0 9 * * *', type: 'report' },
          { id: 'system', beat: SYSTEM_BEAT_CLEAR_IMAGES, cronExpression: '0 9 * * *', type: 'scheduled_beat' },
        ],
        completionResponse: { kind: 'message', text: 'status ok' },
      });
      beatRunRepository.save.mockImplementation(() => { throw new Error('disk full'); });

      await heartbeat.handler(now);

      expect(beatRunRepository.save).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Heartbeat: Could not record the run of beat "morning".', expect.anything());
    });
  });
});
