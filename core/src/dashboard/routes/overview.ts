import type { Request, Response, Router } from 'express';
import { config } from '../../config';
import type { ISessionRepository } from '../../repositories/session';
import type { IMessageRepository } from '../../repositories/message';
import type { IMemoryRepository } from '../../repositories/memory';
import type { IHeartbeatRepository } from '../../repositories/heartbeat';
import type { IChannelRepository } from '../../repositories/channel';
import type { IOutboundMessageRepository } from '../../repositories/outbound-message';
import type { ILearnedSkillsRepository } from '../../repositories/learned-skills';
import type { ISkillsRepository } from '../../repositories/skills';
import type { IAuditLogRepository } from '../../repositories/audit-log';
import type { healthCheck } from '../../services/provider-health-service';
import type { activeRunsRegistry } from '../active-runs';
import type { ChannelType } from '../../entities/channel';
import { AGENTS } from '../../constants/agents';
import { formatISO } from '../../utils/date';
import { buildUsageReport, usageFrom } from '../../services/usage/usage';
import { toAuditJson } from '../serializers';
import type { QueueStatus } from '../runtime-snapshot';

export interface OverviewRouteDependencies {
  sessionRepo: Pick<ISessionRepository, 'count' | 'countOpen'>;
  messageRepo: Pick<IMessageRepository, 'count'>;
  memoryRepo: Pick<IMemoryRepository, 'count'>;
  heartbeatRepo: Pick<IHeartbeatRepository, 'getAll'>;
  channelRepo: Pick<IChannelRepository, 'getAll'>;
  outboundRepo: Pick<IOutboundMessageRepository, 'count'>;
  learnedSkillsRepo: Pick<ILearnedSkillsRepository, 'count'>;
  skillsRepo: Pick<ISkillsRepository, 'get'>;
  auditRepo: Pick<IAuditLogRepository, 'findAll' | 'count' | 'usage'>;
  getHealth: () => ReturnType<typeof healthCheck>;
  activeRuns: Pick<typeof activeRunsRegistry, 'list'>;
  getQueueStatus: () => QueueStatus;
  getChannels: () => { WHATSAPP: { ENABLED: boolean } };
}

export function registerOverviewRoutes(router: Router, dependencies: OverviewRouteDependencies): void {
  const {
    sessionRepo, messageRepo, memoryRepo, heartbeatRepo, channelRepo, outboundRepo,
    learnedSkillsRepo, skillsRepo, auditRepo, getHealth, activeRuns, getQueueStatus, getChannels,
  } = dependencies;

  router.get('/overview', async (_req: Request, res: Response) => {
    const health = await getHealth();

    const beats = heartbeatRepo.getAll();
    const lastHeartbeatRunAt = beats.reduce<Date | null>((latest, beat) => {
      const run = beat.lastRun ?? null;
      if (!latest || (run && run.getTime() > latest.getTime())) return run;
      return latest;
    }, null);

    const registeredChannels = channelRepo.getAll().map((channel) => ({
      type: channel.channel,
      target: channel.target,
      principal: channel.isPrincipal,
    }));

    const channelsSnapshot = getChannels();
    const enabledChannels: { type: ChannelType; enabled: boolean }[] = [
      { type: 'whatsapp', enabled: channelsSnapshot.WHATSAPP.ENABLED },
    ];

    const recentErrors = auditRepo.findAll({
      limit: 5,
      filters: { status: 'error' },
    }).map(toAuditJson);

    res.json({
      sessions: sessionRepo.count(),
      openSessions: sessionRepo.countOpen(),
      messages: messageRepo.count(),
      memories: memoryRepo.count(),
      heartbeats: beats.length,
      learnedSkills: learnedSkillsRepo.count(),
      learnedSkillsLimit: config.SKILLS.LIMIT,
      skills: skillsRepo.get().length,
      outboundMessages: outboundRepo.count(),
      auditErrors: auditRepo.count({ status: 'error' }),
      provider: config.AI.MANAGER.PROVIDER,
      model: config.AI.MANAGER.MODEL,
      workerProvider: config.AI.WORKERS.PROVIDER,
      workerModel: config.AI.WORKERS.MODEL,
      environment: config.ENVIRONMENT,
      timezone: config.TIMEZONE,
      heartbeatEnabled: config.HEARTBEAT,
      summarizerEnabled: config.SESSION.SUMMARIZER_MODE === 'auto',
      aiParallel: config.AI.PARALLEL,
      aiSubagentsParallel: config.AI.SUBAGENTS_PARALLEL,
      channels: enabledChannels,
      registeredChannels,
      lastHeartbeatRunAt: lastHeartbeatRunAt ? formatISO(lastHeartbeatRunAt) : null,
      health: { status: health.status, details: health.details },
      activeRuns: activeRuns.list(),
      queue: getQueueStatus(),
      usage: buildUsageReport(auditRepo.usage({ from: usageFrom(7) }), 7).total,
      recentErrors,
    });
  });

  router.get('/agents', (_req: Request, res: Response) => {
    res.json({ items: AGENTS });
  });

  router.get('/active', (_req: Request, res: Response) => {
    res.json({ items: activeRuns.list() });
  });

  router.get('/queue', (_req: Request, res: Response) => {
    res.json(getQueueStatus());
  });

  router.get('/health', async (_req: Request, res: Response) => {
    const result = await getHealth();
    res.status(result.status === 'ok' ? 200 : 500).json(result);
  });
}
