import type { Request, Response, Router } from 'express';
import type { IHeartbeatRepository } from '../../repositories/heartbeat';
import type { IBeatRunRepository } from '../../repositories/beat-run';
import type { IAuditLogRepository } from '../../repositories/audit-log';
import { Heartbeat } from '../../entities/heartbeat';
import { CHANNEL_TYPES, type ChannelType } from '../../entities/channel';
import { BEAT_TYPES, type BeatType } from '../../types/beat';
import { hasSpecificHour, isEveryMinute, isOneTimeCron, isValidCronExpression, nextCronFire } from '../../utils/heartbeat';
import { formatISO } from '../../utils/date';
import { queryInteger } from '../pagination';

export interface HeartbeatsRouteDependencies {
  heartbeatRepo: Pick<IHeartbeatRepository, 'getAll' | 'getById' | 'save' | 'update' | 'deleteById'>;
  beatRunRepo: Pick<IBeatRunRepository, 'findRecent'>;
  auditRepo: Pick<IAuditLogRepository, 'findAll'>;
  reschedule: () => void;
}

export function registerHeartbeatsRoutes(router: Router, dependencies: HeartbeatsRouteDependencies): void {
  const { heartbeatRepo, beatRunRepo, auditRepo, reschedule } = dependencies;

  const ONE_TIME_CRON_ERROR = 'A one-time beat needs a pinned date: exact minute, hour, day-of-month and month, with "*" as day-of-week (e.g. "30 9 15 6 *").';

  router.get('/heartbeats', (_req: Request, res: Response) => {
    const now = new Date();
    res.json({
      items: heartbeatRepo.getAll().map((beat) => {
        const since = beat.lastRun ?? beat.createdAt;
        const from = since > now ? since : now;
        const next = nextCronFire(beat.cronExpression, from);
        return {
          id: beat.id,
          beat: beat.beat,
          type: beat.type,
          cron_expression: beat.cronExpression,
          channel: beat.channel ?? null,
          target: beat.target ?? null,
          run_once: beat.runOnce ?? false,
          last_run: beat.lastRun ? formatISO(beat.lastRun) : null,
          created_at: formatISO(beat.createdAt),
          next_run: next ? formatISO(next) : null,
        };
      }),
    });
  });

  router.get('/heartbeats/runs', (req: Request, res: Response) => {
    const limit = queryInteger(req.query.limit, 20, 1, 100);
    res.json({
      items: beatRunRepo.findRecent(limit).map((run) => ({
        id: run.id,
        beatId: run.beatId,
        beat: run.beat,
        type: run.beatType,
        status: run.status,
        result: run.result ?? null,
        errorMessage: run.errorMessage ?? null,
        startedAt: formatISO(run.startedAt),
        finishedAt: formatISO(run.finishedAt),
        tools: auditRepo.findAll({ limit: 50, offset: 0, filters: { type: 'tool', runId: run.id } })
          .reverse()
          .map((row) => ({ name: row.tool_name ?? 'unknown', status: row.status })),
      })),
    });
  });

  router.post('/heartbeats', (req: Request, res: Response) => {
    const { beat, type = 'reminder', cronExpression, channel, target, runOnce = false } = req.body ?? {};

    if (typeof beat !== 'string' || !beat.trim()) {
      res.status(400).json({ error: 'beat is required' });
      return;
    }

    if (typeof cronExpression !== 'string' || !isValidCronExpression(cronExpression)) {
      res.status(400).json({ error: 'Invalid cron_expression. Expected 5-field standard cron format.' });
      return;
    }

    if (!BEAT_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${BEAT_TYPES.join(', ')}.` });
      return;
    }

    if (channel !== undefined && !CHANNEL_TYPES.includes(channel)) {
      res.status(400).json({ error: `Invalid channel. Must be one of: ${CHANNEL_TYPES.join(', ')}.` });
      return;
    }

    if ((channel !== undefined && !target) || (channel === undefined && target !== undefined)) {
      res.status(400).json({ error: 'channel and target must be provided together.' });
      return;
    }

    if (isEveryMinute(cronExpression)) {
      res.status(400).json({ error: 'Beats that run every minute are not allowed.' });
      return;
    }

    if (!hasSpecificHour(cronExpression)) {
      res.status(400).json({ error: 'A specific hour must be provided.' });
      return;
    }

    if (typeof runOnce !== 'boolean') {
      res.status(400).json({ error: 'runOnce must be a boolean.' });
      return;
    }

    if (runOnce && !isOneTimeCron(cronExpression)) {
      res.status(400).json({ error: ONE_TIME_CRON_ERROR });
      return;
    }

    const heartbeat = new Heartbeat({
      beat: beat.trim(),
      type: type as BeatType,
      cronExpression: cronExpression.trim(),
      channel: channel as ChannelType | undefined,
      target: target as string | undefined,
      runOnce,
    });
    heartbeatRepo.save(heartbeat);
    reschedule();

    res.status(201).json(heartbeat);
  });

  router.patch('/heartbeats/:id', (req: Request, res: Response) => {
    const existing = heartbeatRepo.getById(String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Heartbeat not found' });
      return;
    }

    const { beat, type, cronExpression, channel, target, runOnce } = req.body ?? {};

    if (cronExpression !== undefined && (typeof cronExpression !== 'string' || !isValidCronExpression(cronExpression))) {
      res.status(400).json({ error: 'Invalid cron_expression.' });
      return;
    }

    if (runOnce !== undefined && typeof runOnce !== 'boolean') {
      res.status(400).json({ error: 'runOnce must be a boolean.' });
      return;
    }

    if ((runOnce ?? existing.runOnce) && !isOneTimeCron(cronExpression ?? existing.cronExpression)) {
      res.status(400).json({ error: ONE_TIME_CRON_ERROR });
      return;
    }

    if (type !== undefined && !BEAT_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${BEAT_TYPES.join(', ')}.` });
      return;
    }

    if (channel !== undefined && channel !== null && !CHANNEL_TYPES.includes(channel)) {
      res.status(400).json({ error: `Invalid channel. Must be one of: ${CHANNEL_TYPES.join(', ')}.` });
      return;
    }

    if ((channel !== undefined && channel !== null && !target) || ((channel === undefined || channel === null) && target !== undefined)) {
      res.status(400).json({ error: 'channel and target must be provided together.' });
      return;
    }

    const updated = heartbeatRepo.update(String(req.params.id), {
      beat,
      type,
      cronExpression: typeof cronExpression === 'string' ? cronExpression.trim() : cronExpression,
      channel: channel === undefined ? undefined : channel,
      target: target === undefined ? undefined : target,
      runOnce,
    });
    reschedule();

    res.json(updated);
  });

  router.delete('/heartbeats/:id', (req: Request, res: Response) => {
    const deleted = heartbeatRepo.deleteById(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Heartbeat not found' });
      return;
    }

    reschedule();
    res.json({ success: true });
  });
}
