import express, { type Request, type Response, type Router } from 'express';
import { createHash } from 'node:crypto';
import { config, reloadConfig } from '../config';
import { isConfigFilePresent } from '../config/helpers';
import {
  VALID_LOG_LEVELS,
  isValidUrl,
  isValidLogLevel,
  isSupportedProvider,
  checkAiProviderConnectivity,
} from '../config/validators';
import { applyAiProviderPatch, applyAiRolePatch, applyAiEmbedPatch, loadCurrentOrExampleSettings, mergeSettingsPayload, writeSettingsFile } from '../config/settings-writer';
import type { AiRolePatch, AiEmbedPatch } from '../config/settings-writer';
import { DEFAULT_NUM_CTX } from '../config/ai-config';
import { estimateSessionTokens, compactTriggerTokens } from '../services/agents/context-budget';
import { addAllowedDomain } from '../services/security/allowed-domains';
import { findGateBlocks } from '../services/security/gate-blocks';
import { getSupportedProviders, getProviderCatalog, getProviderDefaultBaseUrl, clearProviderCache } from '../services/providers';
import {
  startChannelLive,
  loadChannelConfig,
  writeChannelConfigPatch,
  reprimeChannelRuntime,
  liveChannelNames,
} from './live-channel-runtime';
import { ILogger } from '../infrastructure/logger';
import { IDatabaseService } from '../infrastructure/db-sqlite';
import { healthCheck } from '../services/provider-health-service';
import { SessionRepositoryFactory } from '../repositories/session';
import { MessageRepositoryFactory, type TimelineCursor } from '../repositories/message';
import type { Message } from '../entities/message';
import { MemoryRepositoryFactory } from '../repositories/memory';
import { HeartbeatRepositoryFactory } from '../repositories/heartbeat';
import { BeatRunRepositoryFactory } from '../repositories/beat-run';
import { ChannelRepositoryFactory } from '../repositories/channel';
import { CHANNEL_TYPES, ChannelType } from '../entities/channel';
import { LearnedSkillsRepositoryFactory } from '../repositories/learned-skills';
import { SkillsRepositoryFactory } from '../repositories/skills';
import { SkillSyncSingleton } from '../services/skills/skill-sync';
import { ToolSyncSingleton } from '../services/tools/tool-sync';
import { McpSyncSingleton } from '../services/mcps/mcp-sync';
import { McpManagerSingleton } from '../services/mcps/mcp-manager';
import { AuditLogRepositoryFactory, AuditLogRow } from '../repositories/audit-log';
import { buildUsageReport, usageFrom } from '../services/usage/usage';
import { Heartbeat } from '../entities/heartbeat';
import { AuditStatus, AuditType } from '../entities/audit-log';
import { Session } from '../entities/session';
import { NEGOTIATION_CHANNEL, SESSION_START_REASONS, type SessionKey, type SessionStartReason } from '../types/session';
import { carryForwardMetadata } from '../utils/session';
import { BEAT_TYPES, BeatType } from '../types/beat';
import { HeartbeatSingleton } from '../services/agents/sub-agents/heartbeat/runner';
import { hasSpecificHour, isEveryMinute, isOneTimeCron, isValidCronExpression, nextCronFire } from '../utils/heartbeat';
import { formatISO } from '../utils/date';
import { activeRunsRegistry } from './active-runs';
import { sharedSerialQueue } from '../services/providers/serial-queue';
import { subAgentQueuesRegistry } from '../services/agents/sub-agents/queue/sub-agent-queue-registry';
import { OutboundMessageRepositoryFactory } from '../repositories/outbound-message';
import { ChannelsSingleton } from '../channels';
import { OutboundMessageServiceFactory } from '../services/outbound/message-service';
import { IMessageGateway } from '../services/agents/message-gateway';
import { ISessionManager } from '../services/session-manager';
import { ErrandRepositoryFactory } from '../repositories/errand';
import { buildErrandService } from '../services/errands';
import { ERRAND_STATES, ErrandState } from '../types/errand';
import { Errand } from '../entities/errand';
import { AGENTS } from '../constants/agents';
import { PluginSettingsRepositoryFactory, type IPluginSettingsRepository } from '../repositories/plugin-settings';
import { resolvePluginEnabled } from '../services/plugins/plugin-enablement';
import { PluginCatalogSingleton } from '../services/plugins/plugin-catalog-singleton';
import { registerPulledChannel } from '../services/plugins/channel-install';
import {
  listMissing,
  pullEntry,
  fetchChannelHints,
  fetchChannelCatalog,
  type ChannelHints,
  type ChannelCatalogItem,
} from '../../../scripts/hub-sync';
import { listInstalledChannelNames } from '../services/commands/channels';

const ONE_TIME_CRON_ERROR = 'A one-time beat needs a pinned date: exact minute, hour, day-of-month and month, with "*" as day-of-week (e.g. "30 9 15 6 *").';

const MASKED_KEYS = new Set(['BOT_TOKEN', 'API_TOKEN', 'BEARER_TOKEN', 'bearerToken', 'bearer_token']);

function maskDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = MASKED_KEYS.has(key) && typeof val === 'string' && val
        ? maskSecret(val)
        : maskDeep(val);
    }
    return out;
  }

  return value;
}

function maskSecret(value: string): string {
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

/**
 * Reassembles the `CHANNELS.TELEGRAM`/`WHATSAPP` shape the frontend expects,
 * sourcing every field (including the per-channel `ALLOW_UNLISTED_SENDERS`
 * policy) from each plugin's own config.yml.
 */
function buildChannelsSnapshot(pluginSettingsRepo: IPluginSettingsRepository) {
  const telegram = (loadChannelConfig('telegram') ?? {}) as {
    token?: string;
    whitelist?: string;
    allowUnlistedSenders?: boolean;
  };
  const whatsapp = (loadChannelConfig('whatsapp') ?? {}) as {
    authFolder?: string;
    whitelist?: string;
    allowUnlistedSenders?: boolean;
  };
  return {
    TELEGRAM: {
      ENABLED: resolvePluginEnabled(pluginSettingsRepo, 'channels', 'telegram'),
      BOT_TOKEN: telegram.token ?? '',
      WHITELIST: telegram.whitelist ?? '',
      ALLOW_UNLISTED_SENDERS: telegram.allowUnlistedSenders ?? false,
    },
    WHATSAPP: {
      ENABLED: resolvePluginEnabled(pluginSettingsRepo, 'channels', 'whatsapp'),
      AUTH_FOLDER: whatsapp.authFolder ?? '',
      WHITELIST: whatsapp.whitelist ?? '',
      ALLOW_UNLISTED_SENDERS: whatsapp.allowUnlistedSenders ?? false,
    },
  };
}

function buildSettingsResponse(pluginSettingsRepo: IPluginSettingsRepository): Record<string, unknown> {
  return { ...config, CHANNELS: buildChannelsSnapshot(pluginSettingsRepo) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Maps a snake_case per-role settings patch to an `AiRolePatch`. */
function toAiRolePatch(profile: Record<string, unknown>): AiRolePatch {
  const patch: AiRolePatch = { provider: String(profile.provider) };
  if (typeof profile.base_url === 'string') patch.base_url = profile.base_url;
  if (typeof profile.api_token === 'string') patch.api_token = profile.api_token;
  if (typeof profile.model === 'string') patch.model = profile.model;
  if (profile.num_ctx !== undefined && Number.isFinite(Number(profile.num_ctx))) {
    patch.num_ctx = Number(profile.num_ctx);
  }
  return patch;
}

/** Maps a snake_case `ai.embed` settings patch to an `AiEmbedPatch`. */
function toAiEmbedPatch(profile: Record<string, unknown>): AiEmbedPatch {
  const patch: AiEmbedPatch = { provider: String(profile.provider) };
  if (typeof profile.enabled === 'boolean') patch.enabled = profile.enabled;
  if (typeof profile.model === 'string') patch.model = profile.model;
  if (typeof profile.base_url === 'string') patch.base_url = profile.base_url;
  if (typeof profile.api_token === 'string') patch.api_token = profile.api_token;
  return patch;
}

function collectSettingsPayloadErrors(
  payload: Record<string, unknown>,
  pluginSettingsRepo: IPluginSettingsRepository,
): string[] {
  const errors: string[] = [];

  if ('web_port' in payload) {
    const port = Number(payload.web_port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      errors.push('web_port must be an integer between 1 and 65535.');
    }
  }

  if (typeof payload.log_level === 'string' && !isValidLogLevel(payload.log_level)) {
    errors.push(`log_level must be one of: ${VALID_LOG_LEVELS.join(', ')}.`);
  }

  if (typeof payload.gateway_host === 'string' && payload.gateway_host && !isValidUrl(payload.gateway_host)) {
    errors.push('gateway_host must be a valid URL.');
  }

  const skills = asRecord(payload.skills);
  if (skills) {
    if (skills.mode !== undefined && skills.mode !== 'auto' && skills.mode !== 'manual') {
      errors.push('skills.mode must be "auto" or "manual".');
    }
    if (skills.limit !== undefined && skills.limit !== '') {
      const limit = Number(skills.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        errors.push('skills.limit must be a positive integer.');
      }
    }
  }

  const ai = asRecord(payload.ai);
  if (ai) {
    // `ai.<role>` = save + activate for that role; `ai.provider` = save only.
    for (const key of ['manager', 'workers', 'provider'] as const) {
      const profile = asRecord(ai[key]);
      if (!profile) continue;
      const label = `ai.${key}`;

      if (typeof profile.provider === 'string' && profile.provider === 'mock') {
        errors.push(`${label}.provider "mock" is reserved for internal testing and cannot be set here.`);
      } else if (typeof profile.provider === 'string' && !isSupportedProvider(profile.provider)) {
        errors.push(`${label}.provider "${profile.provider}" is not supported.`);
      }
      if (typeof profile.base_url === 'string' && profile.base_url && !isValidUrl(profile.base_url)) {
        errors.push(`${label}.base_url must be a valid URL.`);
      }
      if (typeof profile.model === 'string' && !profile.model.trim()) {
        errors.push(`${label}.model must not be empty.`);
      }
      if (profile.num_ctx !== undefined && profile.num_ctx !== '') {
        const numCtx = Number(profile.num_ctx);
        if (!Number.isInteger(numCtx) || numCtx < 512 || numCtx > 131072) {
          errors.push(`${label}.num_ctx must be an integer between 512 and 131072.`);
        }
      }
    }

    // `num_ctx` (and model) live on the shared `ai.providers[]` entry keyed by
    // provider name, so a manager + workers patch that names the same provider
    // with different context sizes would silently clobber one on save. Reject it
    // rather than lose the value.
    const managerProfile = asRecord(ai.manager);
    const workersProfile = asRecord(ai.workers);
    if (
      managerProfile
      && workersProfile
      && typeof managerProfile.provider === 'string'
      && managerProfile.provider === workersProfile.provider
      && managerProfile.num_ctx !== undefined && managerProfile.num_ctx !== ''
      && workersProfile.num_ctx !== undefined && workersProfile.num_ctx !== ''
      && Number(managerProfile.num_ctx) !== Number(workersProfile.num_ctx)
    ) {
      errors.push(
        `ai.manager and ai.workers both use provider "${managerProfile.provider}", whose num_ctx is shared. `
        + 'Set the same num_ctx for both roles, or point them at separate provider entries.',
      );
    }

    const embed = asRecord(ai.embed);
    if (embed) {
      const label = 'ai.embed';
      if (typeof embed.provider === 'string' && embed.provider === 'mock') {
        errors.push(`${label}.provider "mock" is reserved for internal testing and cannot be set here.`);
      } else if (typeof embed.provider === 'string' && !isSupportedProvider(embed.provider)) {
        errors.push(`${label}.provider "${embed.provider}" is not supported.`);
      }
      if (typeof embed.base_url === 'string' && embed.base_url && !isValidUrl(embed.base_url)) {
        errors.push(`${label}.base_url must be a valid URL.`);
      }
      if (embed.enabled !== false && typeof embed.model === 'string' && !embed.model.trim()) {
        errors.push(`${label}.model must not be empty when embeddings are enabled.`);
      }
    }
  }

  const telegram = asRecord(asRecord(payload.channels)?.telegram);
  if (telegram && 'bot_token' in telegram && resolvePluginEnabled(pluginSettingsRepo, 'channels', 'telegram')) {
    const token = typeof telegram.bot_token === 'string' ? telegram.bot_token.trim() : '';
    if (!token) {
      errors.push('channels.telegram.bot_token cannot be blanked out while Telegram is enabled. Disable it first in Configuration → Plugins.');
    }
  }

  return errors;
}

function parsePagination(req: Request): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}

/** The principal's own web chat — every session on it forms the Orchestrator thread. */
const ORCHESTRATOR_THREAD: Required<SessionKey> = { channel: 'web', peerId: 'web', kind: 'user' };

const TIMELINE_DEFAULT_LIMIT = 50;

function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.rowid])).toString('base64url');
}

/** `undefined` for no cursor, `null` for one that is malformed. */
function decodeTimelineCursor(raw: unknown): TimelineCursor | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && Number.isInteger(parsed[1])
    ) {
      return { createdAt: parsed[0], rowid: parsed[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

function toMessageJson(m: Message) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    senderAgentId: m.senderAgentId,
    images: m.images,
    missingImages: m.missingImages,
    errorCode: m.errorCode,
    createdAt: m.createdAt,
  };
}

function toSessionJson(session: Session) {
  return {
    id: session.id,
    channel: session.channel,
    peerId: session.peerId,
    kind: session.kind,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messageCount,
    metadata: session.metadata,
  };
}

function sessionStartReason(session: Session): SessionStartReason | null {
  const value = session.metadata.startReason;
  return SESSION_START_REASONS.includes(value as SessionStartReason) ? (value as SessionStartReason) : null;
}

function previewText(value: string | null, maxLength = 120): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function toAuditJson(row: AuditLogRow) {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    channel: row.channel,
    type: row.type,
    role: row.role,
    agentName: row.agent_name,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    promptPreview: previewText(row.prompt ?? null),
    promptLength: row.prompt_length,
    response: row.response,
    responsePreview: previewText(row.response ?? null),
    responseLength: row.response_length,
    finishReason: row.finish_reason,
    toolCalls: row.tool_calls,
    toolsEnabled: row.tools_enabled == null ? undefined : row.tools_enabled === 1,
    toolName: row.tool_name,
    toolArgs: row.tool_args,
    success: row.success == null ? undefined : row.success === 1,
    durationMs: row.duration_ms,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

class AdminRouterFactory {
  static create(logger: ILogger, db: IDatabaseService, gateway: IMessageGateway, sessionManager: ISessionManager): Router {
    const router = express.Router();

    const sessionRepo = SessionRepositoryFactory.create(db);
    const messageRepo = MessageRepositoryFactory.create(db);
    const memoryRepo = MemoryRepositoryFactory.create(db);
    const heartbeatRepo = HeartbeatRepositoryFactory.create(db);
    const beatRunRepo = BeatRunRepositoryFactory.create(db);
    const channelRepo = ChannelRepositoryFactory.create(db);
    const outboundRepo = OutboundMessageRepositoryFactory.create(db);
    const learnedSkillsRepo = LearnedSkillsRepositoryFactory.create(db);
    const skillsRepo = SkillsRepositoryFactory.create(logger);
    const auditRepo = AuditLogRepositoryFactory.create(db);
    const pluginSettingsRepo = PluginSettingsRepositoryFactory.create(db);

    /**
     * Skills as plugin rows, for the shared `/plugins` listing. Disk decides
     * which skills exist; the `learned_skills` row only supplies state, so a
     * skill that has not been synced yet still lists as enabled.
     */
    function listSkillPlugins() {
      const learnedByName = new Map(learnedSkillsRepo.getAll().map((skill) => [skill.name, skill]));

      return skillsRepo.get().map((skill) => {
        const learned = learnedByName.get(skill.name);
        return {
          family: 'skills' as const,
          name: skill.name,
          enabled: learned ? learned.enabled : true,
          description: skill.description,
          read_when: skill.read_when ?? null,
          content: skill.content ?? null,
          learned_at: learned ? learned.learned_at : null,
        };
      });
    }

    router.get('/overview', async (_req: Request, res: Response) => {
      const health = await healthCheck(logger);

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

      const channelsSnapshot = buildChannelsSnapshot(pluginSettingsRepo);
      const enabledChannels: { type: ChannelType; enabled: boolean }[] = [
        { type: 'telegram', enabled: channelsSnapshot.TELEGRAM.ENABLED },
        { type: 'whatsapp', enabled: channelsSnapshot.WHATSAPP.ENABLED },
      ];

      const recentErrors = auditRepo.findAll({
        limit: 5,
        filters: { status: 'error' },
      }).map(toAuditJson);

      res.json({
        sessions: sessionRepo.count(),
        openSessions: sessionRepo.countOpen(),
        openErrands: (['draft', 'queued', 'open', 'awaiting_peer', 'awaiting_principal', 'awaiting_confirmation'] as ErrandState[])
          .reduce((sum, state) => sum + ErrandRepositoryFactory.create(db).countByState(state), 0),
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
        activeRuns: activeRunsRegistry.list(),
        queue: {
          parallel: config.AI.PARALLEL,
          subagentsParallel: config.AI.SUBAGENTS_PARALLEL,
          backgroundGraceMs: config.AI.BACKGROUND_GRACE_MS,
          subAgents: subAgentQueuesRegistry.getSnapshot(),
          ...sharedSerialQueue.snapshot(),
        },
        usage: buildUsageReport(auditRepo.usage({ from: usageFrom(7) }), 7).total,
        recentErrors,
      });
    });

    router.get('/agents', (_req: Request, res: Response) => {
      res.json({ items: AGENTS });
    });

    // The Orchestrator thread: messages across every web session, paged from
    // the newest backwards. Each page carries the sessions its messages belong
    // to (plus the open session, on the newest page, even while it is still
    // empty) so the client can draw session boundaries.
    router.get('/agents/orchestrator/timeline', (req: Request, res: Response) => {
      const before = decodeTimelineCursor(req.query.before);
      if (before === null) {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || TIMELINE_DEFAULT_LIMIT, 1), 200);

      const page = messageRepo.getTimeline({ key: ORCHESTRATOR_THREAD, before, limit });
      const active = sessionRepo.findLatestOpen(ORCHESTRATOR_THREAD);

      const sessionIds = new Set(page.messages.map((m) => m.sessionId));
      if (!before && active) sessionIds.add(active.id);
      const sessions = [...sessionIds]
        .map((id) => (id === active?.id ? active : sessionRepo.findById(id)))
        .filter((session): session is Session => session !== null)
        .map((session) => ({
          id: session.id,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          startReason: sessionStartReason(session),
          compactSummary: typeof session.metadata.compactSummary === 'string' ? session.metadata.compactSummary : null,
        }));

      res.json({
        messages: page.messages.map((m) => ({ ...toMessageJson(m), sessionId: m.sessionId })),
        sessions,
        activeSessionId: active?.id ?? null,
        nextCursor: page.nextCursor ? encodeTimelineCursor(page.nextCursor) : null,
      });
    });

    // The negotiation center: every errand's negotiation session (Negotiator
    // notices and the principal's answers) as one feed, paged from the newest
    // backwards. Each message names the errand its session belongs to.
    router.get('/agents/negotiator/notices', (req: Request, res: Response) => {
      const before = decodeTimelineCursor(req.query.before);
      if (before === null) {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || TIMELINE_DEFAULT_LIMIT, 1), 200);

      const page = messageRepo.getTimeline({ key: { channel: NEGOTIATION_CHANNEL, kind: 'user' }, before, limit });
      const errandIds = new Map([...new Set(page.messages.map((m) => m.sessionId))]
        .map((id) => [id, sessionRepo.findById(id)?.peerId ?? null]));
      // Questions and proposed results still waiting on the principal, read in the
      // same request as the notices so the page never shows one it cannot answer yet.
      const errandService = buildErrandService(logger, db, sessionManager);
      // Fingerprint of what the errand list shows (the same latest 50 errands):
      // state, progress, delivery and each contact session's message count. It
      // changes on every status change, with or without a notice, so the page can
      // refresh the errand list only when it needs to.
      const errands = errandService?.listAll(undefined, 50) ?? [];
      const errandsVersion = createHash('sha1').update(JSON.stringify(errands.map((errand) => [
        errand.id, errand.state, errand.lastProgressAt ?? null, errand.closedAt ?? null,
        errand.pendingDelivery ? [errand.pendingDelivery.id, errand.pendingDelivery.targets.filter((target) => target.sentAt).length] : null,
        getTargetDetails(errand.id).map((target) => target.messageCount),
      ]))).digest('hex').slice(0, 16);
      const pending = (['awaiting_principal', 'awaiting_confirmation'] as const)
        .flatMap((state) => errandService?.listAll(state, 50) ?? [])
        .filter((errand) => !errand.pendingDelivery)
        .map((errand) => ({
          errandId: errand.id,
          goal: errand.goal,
          kind: errand.state === 'awaiting_confirmation' ? 'confirmation' : 'question',
          question: errand.pendingMessage ?? null,
          askedAt: errand.lastProgressAt ?? errand.createdAt,
        }));

      res.json({
        messages: page.messages.map((m) => ({ ...toMessageJson(m), errandId: errandIds.get(m.sessionId) ?? null })),
        pending,
        errandsVersion,
        nextCursor: page.nextCursor ? encodeTimelineCursor(page.nextCursor) : null,
      });
    });

    // "New session" in the Orchestrator header: like `/clear`, ends the open web
    // session and starts a fresh one. An open session with no messages yet is
    // reused, so repeated clicks don't pile up empty sessions.
    router.post('/agents/orchestrator/new-session', (_req: Request, res: Response) => {
      const open = sessionRepo.findLatestOpen(ORCHESTRATOR_THREAD);

      if (open && activeRunsRegistry.list().some((run) => run.sessionId === open.id)) {
        res.status(409).json({ error: 'A reply is still running in this session' });
        return;
      }

      if (open && messageRepo.getBySessionId(open.id, 1).length === 0) {
        res.json({ session: toSessionJson(open), rotated: false });
        return;
      }

      let session: Session;
      if (open) {
        session = sessionManager
          .getSessionServiceById(open.id)
          .forceRotate('clear', carryForwardMetadata(open.metadata));
      } else {
        session = new Session({ ...ORCHESTRATOR_THREAD });
        sessionRepo.save(session);
      }
      sessionManager.invalidateKey(ORCHESTRATOR_THREAD);

      res.status(201).json({ session: toSessionJson(session), rotated: Boolean(open) });
    });

    router.get('/sessions', (req: Request, res: Response) => {
      const { limit, offset } = parsePagination(req);
      const kind = req.query.kind === 'user' || req.query.kind === 'delegated' ? req.query.kind : undefined;
      const sessions = sessionRepo.findAll(limit, offset, kind);
      res.json({
        total: sessionRepo.count(kind),
        limit,
        offset,
        items: sessions.map((session) => ({
          id: session.id,
          channel: session.channel,
          peerId: session.peerId,
          kind: session.kind,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          messageCount: session.messageCount,
          preview: previewText(messageRepo.getPreviewBySessionId(session.id)),
          metadata: session.metadata,
        })),
      });
    });

    router.post('/sessions', (_req: Request, res: Response) => {
      const session = new Session({ channel: 'web', peerId: 'web' });
      sessionRepo.save(session);
      sessionManager.invalidateKey({ channel: session.channel, peerId: session.peerId, kind: session.kind });
      res.status(201).json({
        id: session.id,
        channel: session.channel,
        peerId: session.peerId,
        kind: session.kind,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        messageCount: session.messageCount,
        metadata: session.metadata,
      });
    });

    router.get('/sessions/:id', (req: Request, res: Response) => {
      const session = sessionRepo.findById(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const messages = messageRepo.getBySessionId(session.id, 200);
      const memories = memoryRepo.getBySessionId(session.id);

      res.json({
        session: {
          id: session.id,
          channel: session.channel,
          peerId: session.peerId,
          kind: session.kind,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          messageCount: session.messageCount,
          metadata: session.metadata,
        },
        messages: messages.map(toMessageJson),
        memories: memories.map((m) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          importance: m.importance,
          tags: m.tags,
          createdAt: m.createdAt,
        })),
      });
    });

    router.delete('/sessions/:id', (req: Request, res: Response) => {
      const id = String(req.params.id);
      if (!sessionRepo.findById(id)) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      sessionRepo.deleteById(id);
      sessionManager.invalidate(id);
      res.json({ success: true });
    });

    function toErrandJson(errand: Errand) {
      return {
        id: errand.id,
        goal: errand.goal,
        state: errand.state,
        originSessionId: errand.originSessionId,
        pendingMessage: errand.pendingMessage ?? null,
        delivery: errand.pendingDelivery ? {
          type: errand.pendingDelivery.type,
          sent: errand.pendingDelivery.targets.filter((target) => target.sentAt).length,
          total: errand.pendingDelivery.targets.length,
          error: errand.pendingDelivery.error ?? null,
        } : null,
        notes: errand.notes ?? null,
        result: errand.result ?? null,
        createdAt: errand.createdAt,
        lastProgressAt: errand.lastProgressAt ?? null,
        closedAt: errand.closedAt ?? null,
      };
    }

    function getTargetDetails(errandId: string) {
      const targetSessionIds = ErrandRepositoryFactory.create(db).findTargets(errandId);
      const sessionRepo = SessionRepositoryFactory.create(db);

      return targetSessionIds.map((sessionId) => {
        const session = sessionRepo.findById(sessionId);
        return {
          sessionId,
          channel: session?.channel ?? 'unknown',
          peerId: session?.peerId ?? 'unknown',
          kind: session?.kind ?? 'delegated',
          startedAt: session?.startedAt ?? null,
          endedAt: session?.endedAt ?? null,
          messageCount: session?.messageCount ?? 0,
        };
      });
    }

    router.get('/errands', (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      const { limit, offset } = parsePagination(req);
      const rawState = typeof req.query.state === 'string' ? req.query.state : undefined;
      const state = rawState && (ERRAND_STATES as readonly string[]).includes(rawState) ? (rawState as ErrandState) : undefined;

      const errands = errandService.listAll(state, limit, offset);
      res.json({
        limit,
        offset,
        items: errands.map((errand) => ({
          ...toErrandJson(errand),
          targets: getTargetDetails(errand.id),
        })),
      });
    });

    router.get('/errands/:id', (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      const errand = errandService.get(String(req.params.id));
      if (!errand) {
        res.status(404).json({ error: 'Errand not found' });
        return;
      }

      res.json({
        ...toErrandJson(errand),
        targets: getTargetDetails(errand.id),
      });
    });

    router.get('/errands/:id/transcript', (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      const errand = errandService.get(String(req.params.id));
      if (!errand) {
        res.status(404).json({ error: 'Errand not found' });
        return;
      }

      const targetSessionIds = ErrandRepositoryFactory.create(db).findTargets(errand.id);
      const messageRepo = MessageRepositoryFactory.create(db);
      const messages = targetSessionIds.flatMap((sessionId) => {
        return messageRepo.getBySessionId(sessionId, 100).map((msg) => ({
          id: msg.id,
          sessionId,
          role: msg.role,
          content: msg.content,
          ...(msg.images?.length ? { images: msg.images } : {}),
          ...(msg.missingImages ? { missingImages: msg.missingImages } : {}),
          createdAt: msg.createdAt,
        }));
      }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      res.json({
        errandId: errand.id,
        messages,
      });
    });

    router.post('/errands/:id/approve', async (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      try {
        res.json(toErrandJson(await errandService.approve(String(req.params.id))));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.post('/errands/:id/reply', async (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
      if (!answer) {
        res.status(400).json({ error: 'Missing "answer" in request body.' });
        return;
      }

      try {
        const result = await errandService.resumeWithPrincipalAnswer(String(req.params.id), answer);
        res.json({
          errand: toErrandJson(result.errand),
          reply: result.reply,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.post('/errands/:id/retry', async (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }
      try {
        res.json(toErrandJson(await errandService.retryDelivery(String(req.params.id))));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.post('/errands/:id/cancel', (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      try {
        res.json(toErrandJson(errandService.cancel(String(req.params.id))));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.post('/errands/:id/confirm', async (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }
      try {
        res.json(toErrandJson(await errandService.confirmResolution(String(req.params.id))));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.post('/errands/:id/close', (req: Request, res: Response) => {
      const errandService = buildErrandService(logger, db, sessionManager);
      if (!errandService) {
        res.status(503).json({ error: 'Errands are not available: no channel manager is running.' });
        return;
      }

      const result = typeof req.body?.result === 'string' && req.body.result.trim()
        ? req.body.result.trim()
        : 'Closed by the principal.';

      try {
        res.json(toErrandJson(errandService.resolve(String(req.params.id), result)));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    router.get('/memories', (req: Request, res: Response) => {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
      const memories = sessionId ? memoryRepo.getBySessionId(sessionId) : memoryRepo.getAll();

      res.json({
        items: memories.map((m) => ({
          id: m.id,
          sessionId: m.sessionId,
          source: m.source,
          type: m.type,
          content: m.content,
          importance: m.importance,
          tags: m.tags,
          createdAt: m.createdAt,
        })),
      });
    });

    router.delete('/memories/:id', (req: Request, res: Response) => {
      memoryRepo.deleteById(String(req.params.id));
      res.json({ success: true });
    });

    router.get('/active', (_req: Request, res: Response) => {
      res.json({ items: activeRunsRegistry.list() });
    });

    router.get('/queue', (_req: Request, res: Response) => {
      res.json({
        parallel: config.AI.PARALLEL,
        subagentsParallel: config.AI.SUBAGENTS_PARALLEL,
        backgroundGraceMs: config.AI.BACKGROUND_GRACE_MS,
        subAgents: subAgentQueuesRegistry.getSnapshot(),
        ...sharedSerialQueue.snapshot(),
      });
    });

    router.get('/audit', (req: Request, res: Response) => {
      const { limit, offset } = parsePagination(req);
      const filters: {
        type?: AuditType;
        sessionId?: string;
        role?: 'manager' | 'worker';
        status?: AuditStatus;
        agentName?: string;
      } = {
        type: typeof req.query.type === 'string' ? (req.query.type as AuditType) : undefined,
        sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
        role: typeof req.query.role === 'string' ? (req.query.role as 'manager' | 'worker') : undefined,
        status: typeof req.query.status === 'string' ? (req.query.status as AuditStatus) : undefined,
        agentName: typeof req.query.agentName === 'string' ? req.query.agentName : undefined,
      };

      res.json({
        total: auditRepo.count(filters),
        limit,
        offset,
        items: auditRepo.findAll({ limit, offset, filters }).map(toAuditJson),
      });
    });

    router.get('/audit/:id', (req: Request, res: Response) => {
      const row = auditRepo.findById(String(req.params.id));
      if (!row) {
        res.status(404).json({ error: 'Audit entry not found' });
        return;
      }
      res.json(toAuditJson(row));
    });

    router.delete('/audit/:id', (req: Request, res: Response) => {
      const deleted = auditRepo.deleteById(String(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Audit entry not found' });
        return;
      }
      res.json({ success: true });
    });

    router.delete('/audit', (_req: Request, res: Response) => {
      res.json({ success: true, deleted: auditRepo.deleteAll() });
    });

    router.get('/usage', (req: Request, res: Response) => {
      const rawDays = req.query.days;
      let days: number | null = null;

      if (typeof rawDays === 'string' && rawDays !== '') {
        const parsed = Number.parseInt(rawDays, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          days = parsed;
        }
      }

      const rows = auditRepo.usage({ from: usageFrom(days) });
      res.json(buildUsageReport(rows, days));
    });

    // Estimated context usage for a chat session — powers the small usage bar
    // in the chat UI. `?sessionId=` targets the viewed session; without it the
    // live web session is used. Mirrors what the manual-mode auto-compact check
    // measures (`context-budget.ts`).
    router.get('/chat/context', (req: Request, res: Response) => {
      const requestedId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
      const session = requestedId
        ? sessionRepo.findById(requestedId)
        : sessionRepo.findLatestOpen({ channel: 'web', peerId: 'web' });
      const limit = config.AI.MANAGER.NUM_CTX;
      if (!session) {
        res.json({ used: 0, limit, threshold: compactTriggerTokens() });
        return;
      }

      // No limit arg → the same recent-history window the manager actually
      // sends to the model (and that the auto-compact check measures).
      const history = messageRepo.getBySessionId(session.id);
      const compactSummary = typeof session.metadata?.compactSummary === 'string'
        ? session.metadata.compactSummary
        : undefined;
      res.json({
        used: estimateSessionTokens(history, compactSummary),
        limit,
        threshold: compactTriggerTokens(),
      });
    });

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

    // Latest executed beats, newest first, with the tools each run called.
    router.get('/heartbeats/runs', (req: Request, res: Response) => {
      const requested = Number(req.query.limit);
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 20;
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

    router.get('/channels', (_req: Request, res: Response) => {
      res.json({ items: channelRepo.getAll() });
    });

    router.patch('/channels/:id/principal', (req: Request, res: Response) => {
      const updated = channelRepo.setPrincipal(String(req.params.id));
      if (!updated) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      res.json(updated);
    });

    router.get('/outbound', (_req: Request, res: Response) => {
      res.json({ items: outboundRepo.getAll() });
    });

    router.post('/outbound', async (req: Request, res: Response) => {
      const { content, channel, target } = req.body ?? {};

      if (typeof content !== 'string' || !content.trim()) {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      if (channel === undefined || target === undefined) {
        res.status(400).json({ error: 'channel and target are required.' });
        return;
      }

      if (!CHANNEL_TYPES.includes(channel as ChannelType)) {
        res.status(400).json({ error: `Invalid channel. Must be one of: ${CHANNEL_TYPES.join(', ')}.` });
        return;
      }

      const channelsManager = ChannelsSingleton.getExistingInstance();
      if (!channelsManager) {
        res.status(503).json({ error: 'Outbound messaging is not available: no channel manager is running.' });
        return;
      }

      const service = OutboundMessageServiceFactory.create(logger, channelsManager, db, sessionManager);
      const message = await service.send({
        content: content.trim(),
        channel: String(channel),
        target: String(target),
      });

      if (message.status === 'failed') {
        res.status(502).json({ error: message.errorMessage ?? 'Failed to send the message.' });
        return;
      }

      res.status(201).json(message);
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
      HeartbeatSingleton.getExistingInstance()?.reschedule();

      res.status(201).json(heartbeat);
    });

    router.patch('/heartbeats/:id', (req: Request, res: Response) => {
      const existing = heartbeatRepo.getById(String(req.params.id));
      if (!existing) {
        res.status(404).json({ error: 'Heartbeat not found' });
        return;
      }

      const { beat, type, cronExpression, channel, target, runOnce } = req.body ?? {};

      if (cronExpression !== undefined && !isValidCronExpression(cronExpression)) {
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
      HeartbeatSingleton.getExistingInstance()?.reschedule();

      res.json(updated);
    });

    router.delete('/heartbeats/:id', (req: Request, res: Response) => {
      const deleted = heartbeatRepo.deleteById(String(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Heartbeat not found' });
        return;
      }

      HeartbeatSingleton.getExistingInstance()?.reschedule();
      res.json({ success: true });
    });

    router.post('/skills/sync', (_req: Request, res: Response) => {
      const sync = SkillSyncSingleton.getExistingInstance();
      if (!sync) {
        res.status(503).json({ error: 'Skill sync not initialized' });
        return;
      }

      sync.sync();
      res.json({ success: true });
    });

    router.get('/plugins', (_req: Request, res: Response) => {
      ToolSyncSingleton.getExistingInstance()?.sync();
      void McpSyncSingleton.getExistingInstance()?.sync();
      SkillSyncSingleton.getExistingInstance()?.sync();

      const diskChannels = listInstalledChannelNames(config.BASE_DIR);
      if (diskChannels.length > 0) {
        PluginCatalogSingleton.append(diskChannels.map((name) => ({ family: 'channels', name })));
      }

      const mcpStatuses = new Map(
        (McpManagerSingleton.getExistingInstance()?.getStatuses() ?? []).map((status) => [status.name, status]),
      );
      const items = PluginCatalogSingleton.getExistingInstance().map(({ family, name }) => ({
        family,
        name,
        enabled: resolvePluginEnabled(pluginSettingsRepo, family, name),
        ...(family === 'mcps' ? { mcpStatus: mcpStatuses.get(name) } : {}),
      }));

      res.json({ items: [...items, ...listSkillPlugins()] });
    });

    router.patch('/plugins/:family/:name', async (req: Request, res: Response) => {
      const family = req.params.family;
      if (family !== 'tools' && family !== 'channels' && family !== 'mcps' && family !== 'skills') {
        res.status(400).json({ error: "family must be 'tools', 'channels', 'mcps' or 'skills'." });
        return;
      }

      const enabled = req.body?.enabled;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }

      const name = String(req.params.name);

      // Skills are listed alongside plugins but keep their own store: their
      // enabled flag is a column on the `learned_skills` content row, not a
      // `plugin_settings` entry, and they are never in the plugin catalog.
      if (family === 'skills') {
        if (!learnedSkillsRepo.setEnabled(name, enabled)) {
          res.status(404).json({ error: 'Skill not found' });
          return;
        }

        res.json({ success: true, item: { family, name, enabled } });
        return;
      }

      if (family === 'channels') {
        const diskChannels = listInstalledChannelNames(config.BASE_DIR);
        if (diskChannels.includes(name)) {
          PluginCatalogSingleton.append([{ family: 'channels', name }]);
        }
      }

      const catalog = PluginCatalogSingleton.getExistingInstance();
      if (!catalog.some((p) => p.family === family && p.name === name)) {
        res.status(404).json({ error: 'Plugin not found' });
        return;
      }

      pluginSettingsRepo.setEnabled(family, name, enabled);

      if (family === 'channels') {
        if (enabled) {
          startChannelLive(name, logger, gateway);
        } else {
          ChannelsSingleton.getExistingInstance()?.stopChannel(name);
        }
      } else if (family === 'mcps') {
        const manager = McpManagerSingleton.getExistingInstance();
        if (enabled) {
          await manager?.enable(name);
        } else {
          await manager?.disable(name);
        }
      }

      res.json({ success: true, item: { family, name, enabled } });
    });

    router.get('/mcps/:name/config', (req: Request, res: Response) => {
      const definition = McpManagerSingleton.getExistingInstance()?.getDefinition(String(req.params.name));
      if (!definition) {
        res.status(404).json({ error: 'MCP plugin not found' });
        return;
      }
      const current = definition.loadConfig();
      res.json({
        name: definition.name,
        url: current.url,
        bearer_token: current.bearerToken ? maskSecret(current.bearerToken) : '',
      });
    });

    router.patch('/mcps/:name/config', async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const definition = McpManagerSingleton.getExistingInstance()?.getDefinition(name);
      if (!definition?.writeConfigPatch) {
        res.status(404).json({ error: 'Configurable MCP plugin not found' });
        return;
      }
      const patch: Record<string, unknown> = {};
      if (typeof req.body?.url === 'string') {
        try {
          const url = new URL(req.body.url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
          patch.url = url.toString();
          // Warn when a bearer_token would be sent over a plaintext HTTP connection
          // to a non-loopback host — the token would be exposed in transit.
          if (
            url.protocol === 'http:'
            && url.hostname !== '127.0.0.1'
            && url.hostname !== 'localhost'
          ) {
            logger.warn(
              `[MCP] Insecure http:// URL configured for "${name}" — bearer_token will be transmitted in plaintext. Consider using https://.`,
            );
          }
        } catch {
          res.status(400).json({ error: 'url must be an absolute http or https URL' });
          return;
        }
      }
      if (typeof req.body?.bearer_token === 'string' && !req.body.bearer_token.includes('••••')) {
        patch.bearer_token = req.body.bearer_token;
      }
      definition.writeConfigPatch(patch);
      if (resolvePluginEnabled(pluginSettingsRepo, 'mcps', name)) {
        await McpManagerSingleton.getExistingInstance()?.reconnect(name);
      }
      const configuredUrl = typeof patch.url === 'string' ? patch.url : definition.loadConfig().url;
      const urlInsecure = (() => {
        try {
          const u = new URL(configuredUrl ?? '');
          return u.protocol === 'http:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost';
        } catch { return false; }
      })();
      res.json({ success: true, ...(urlInsecure ? { warning: 'MCP server URL uses http:// — bearer_token is transmitted in plaintext.' } : {}) });
    });

    // koris-hub marketplace: tools/skills whose source moved out of this repo
    // (see scripts/hub-sync.ts and AGENTS.md's "Website" section). `baseDir`
    // is pinned to config.BASE_DIR — the repo root when self-hosted — since
    // hub-sync's own default (relative to its compiled location under
    // dist/scripts/) would resolve into dist/ once this module is bundled.
    router.get('/marketplace', async (_req: Request, res: Response) => {
      try {
        const items = await listMissing({ baseDir: config.BASE_DIR });
        res.json({ items });
      } catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to reach koris-hub.' });
      }
    });

    let channelHintsCache: { timestamp: number; data: Record<string, ChannelHints> } | null = null;
    const CHANNEL_HINTS_TTL_MS = 10 * 60 * 1000;

    router.get('/channels/hints', async (_req: Request, res: Response) => {
      const now = Date.now();
      if (channelHintsCache && now - channelHintsCache.timestamp < CHANNEL_HINTS_TTL_MS) {
        res.json({ hints: channelHintsCache.data });
        return;
      }
      try {
        const hints = await fetchChannelHints(undefined, {
          baseDir: config.BASE_DIR,
        });
        channelHintsCache = { timestamp: now, data: hints };
        res.json({ hints });
      } catch {
        res.json({ hints: channelHintsCache?.data ?? {} });
      }
    });

    let channelCatalogCache: { timestamp: number; data: ChannelCatalogItem[] } | null = null;
    const CHANNEL_CATALOG_TTL_MS = 10 * 60 * 1000;

    router.get('/channels/catalog', async (_req: Request, res: Response) => {
      const now = Date.now();
      if (channelCatalogCache && now - channelCatalogCache.timestamp < CHANNEL_CATALOG_TTL_MS) {
        res.json({ items: channelCatalogCache.data });
        return;
      }
      try {
        const items = await fetchChannelCatalog({
          baseDir: config.BASE_DIR,
        });
        channelCatalogCache = { timestamp: now, data: items };
        res.json({ items });
      } catch {
        res.json({ items: channelCatalogCache?.data ?? [] });
      }
    });

    router.post('/marketplace/:slug/pull', async (req: Request, res: Response) => {
      try {
        const item = await pullEntry(String(req.params.slug), { baseDir: config.BASE_DIR });
        if (item.family === 'tool') {
          ToolSyncSingleton.getExistingInstance()?.sync(item.slug);
        } else if (item.family === 'mcp') {
          await McpSyncSingleton.getExistingInstance()?.sync(item.slug);
        } else if (item.family === 'skill') {
          SkillSyncSingleton.getExistingInstance()?.sync();
        } else if (item.family === 'channel') {
          // Installed inactive on purpose — see `registerPulledChannel`.
          registerPulledChannel(item.slug, pluginSettingsRepo);
        }
        res.status(201).json({ success: true, item });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to pull from koris-hub.' });
      }
    });

    router.get('/settings', (_req: Request, res: Response) => {
      res.json(maskDeep(buildSettingsResponse(pluginSettingsRepo)));
    });

    router.get('/settings/status', (_req: Request, res: Response) => {
      const configured = isConfigFilePresent();
      res.json({ configured });
    });

    router.get('/capabilities', (_req: Request, res: Response) => {
      // "mock" is an internal testing provider, not a real choice for end users.
      const providers = getSupportedProviders().filter((provider) => provider !== 'mock');
      res.json({ providers, channels: CHANNEL_TYPES });
    });

    router.get('/providers', (_req: Request, res: Response) => {
      const activeProfile = (profile: {
        PROVIDER: string;
        MODEL: string;
        BASE_URL: string;
        API_TOKEN: string;
        NUM_CTX?: number;
      }) => ({
        provider: profile.PROVIDER,
        model: profile.MODEL,
        baseUrl: profile.BASE_URL,
        hasToken: !!profile.API_TOKEN?.trim(),
        numCtx: profile.NUM_CTX,
      });
      const configured = new Set([config.AI.MANAGER.PROVIDER, config.AI.WORKERS.PROVIDER, config.AI.EMBED.PROVIDER]);
      // Surface every provider kept in ai.providers[] on disk with its saved
      // models / base_url so the chat picker can switch straight to it instead
      // of showing "Set up".
      const storedByName = new Map<string, Record<string, unknown>>();
      const storedProviders = asRecord(asRecord(loadCurrentOrExampleSettings())?.ai)?.providers;
      if (Array.isArray(storedProviders)) {
        for (const raw of storedProviders) {
          const entry = asRecord(raw);
          const name = entry?.provider;
          if (entry && typeof name === 'string' && name.trim()) {
            configured.add(name);
            storedByName.set(name, entry);
          }
        }
      }
      const providers = getProviderCatalog().map((entry) => {
        const stored = storedByName.get(entry.name);
        const model = typeof stored?.model === 'string' ? stored.model : '';
        return {
          ...entry,
          configured: configured.has(entry.name),
          model,
          storedBaseUrl: typeof stored?.base_url === 'string' ? stored.base_url : '',
          hasToken: typeof stored?.api_token === 'string' ? !!stored.api_token.trim() : false,
          storedNumCtx: stored?.num_ctx !== undefined && Number.isFinite(Number(stored.num_ctx))
            ? Number(stored.num_ctx)
            : undefined,
        };
      });
      res.json({
        providers,
        defaultNumCtx: DEFAULT_NUM_CTX,
        active: {
          manager: activeProfile(config.AI.MANAGER),
          workers: activeProfile(config.AI.WORKERS),
          embed: { ...activeProfile(config.AI.EMBED), enabled: config.AI.EMBED.ENABLED },
        },
      });
    });

    router.post('/settings', (req: Request, res: Response) => {
      const patch = req.body;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        res.status(400).json({ error: 'Request body must be a JSON object.' });
        return;
      }

      const errors = collectSettingsPayloadErrors(patch as Record<string, unknown>, pluginSettingsRepo);
      if (errors.length > 0) {
        res.status(400).json({ error: 'Invalid settings.', details: errors });
        return;
      }

      const rawPatch = patch as Record<string, unknown>;
      const channelsPatch = asRecord(rawPatch.channels);
      // Split `channels.*` into live-channel `config.yml` patches (any key that
      // matches a discovered live channel) and the rest, which stays in the
      // core settings file. No channel is named here.
      const liveNames = new Set(liveChannelNames());
      const channelConfigPatches: { name: string; patch: Record<string, unknown> }[] = [];
      const coreChannelsPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(channelsPatch ?? {})) {
        const record = asRecord(value);
        if (liveNames.has(key) && record) {
          channelConfigPatches.push({ name: key, patch: record });
        } else {
          coreChannelsPatch[key] = value;
        }
      }
      const corePatch: Record<string, unknown> = { ...rawPatch };
      if (channelsPatch) {
        corePatch.channels = coreChannelsPatch;
      }

      // The web UI still sends provider changes as a per-role patch
      // (`{ ai: { manager: { provider, base_url, model, api_token } } }`).
      // Translate each role into an `ai.providers[]` upsert + `ai.roles`
      // repoint so previously-configured providers are preserved on disk.
      // `ai.<role>` patch = save the provider AND make it active for that role.
      // `ai.provider` patch = save the provider's config only (no role change).
      const aiPatch = asRecord(corePatch.ai);
      const rolePatches: { role: 'manager' | 'workers'; patch: AiRolePatch }[] = [];
      let providerOnlyPatch: AiRolePatch | undefined;
      let embedPatch: AiEmbedPatch | undefined;
      if (aiPatch) {
        const restAi: Record<string, unknown> = { ...aiPatch };
        for (const role of ['manager', 'workers'] as const) {
          const profile = asRecord(aiPatch[role]);
          if (!profile) continue;
          delete restAi[role];
          if (typeof profile.provider !== 'string' || !profile.provider.trim()) continue;
          rolePatches.push({ role, patch: toAiRolePatch(profile) });
        }
        const providerProfile = asRecord(aiPatch.provider);
        if (providerProfile && typeof providerProfile.provider === 'string' && providerProfile.provider.trim()) {
          delete restAi.provider;
          providerOnlyPatch = toAiRolePatch(providerProfile);
        }
        const embedProfile = asRecord(aiPatch.embed);
        if (embedProfile && typeof embedProfile.provider === 'string' && embedProfile.provider.trim()) {
          delete restAi.embed;
          embedPatch = toAiEmbedPatch(embedProfile);
        }
        corePatch.ai = restAi;
      }

      let current = loadCurrentOrExampleSettings();
      if (providerOnlyPatch) {
        current = applyAiProviderPatch(current, providerOnlyPatch);
      }
      for (const { role, patch: rolePatch } of rolePatches) {
        current = applyAiRolePatch(current, role, rolePatch);
      }
      if (embedPatch) {
        current = applyAiEmbedPatch(current, embedPatch);
      }
      const merged = mergeSettingsPayload(current, corePatch);
      const personalInformation = asRecord(corePatch.personal_information);
      if (personalInformation) merged.personal_information = personalInformation;
      const writtenPath = writeSettingsFile(merged);

      // `enabled` is DB-backed now (see PATCH /plugins/:family/:name) — strip it
      // defensively so a stale cached frontend can't write it back into config.yml.
      for (const { name, patch: channelPatch } of channelConfigPatches) {
        const { enabled: _enabled, ...rest } = channelPatch;
        writeChannelConfigPatch(name, rest);
        reprimeChannelRuntime(name);
      }

      reloadConfig();
      clearProviderCache();

      logger.info(`Settings saved to ${writtenPath}`);
      res.json({ success: true, settings: maskDeep(buildSettingsResponse(pluginSettingsRepo)) });
    });

    router.get('/allowed-domains', (_req: Request, res: Response) => {
      res.json({ allowedDomains: config.ALLOWED_DOMAINS });
    });

    router.post('/allowed-domains', (req: Request, res: Response) => {
      const raw = typeof req.body?.domain === 'string' ? req.body.domain : '';
      const result = addAllowedDomain(raw);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      if (result.added) {
        logger.info(`allowed_domains: added "${result.hostname}"`);
      }
      res.json({ ok: true, added: result.added, allowedDomains: result.allowedDomains });
    });

    router.get('/chat/gate-blocks', (req: Request, res: Response) => {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
      const blocks = findGateBlocks(auditRepo, { sessionId, allowed: config.ALLOWED_DOMAINS });
      res.json({ blocks });
    });

    router.post('/ai/test-connection', async (req: Request, res: Response) => {
      const { provider, base_url: baseUrl, api_token: apiToken } = (req.body ?? {}) as Record<string, unknown>;

      const baseUrlStr = typeof baseUrl === 'string' ? baseUrl : '';
      if (typeof provider !== 'string' || (!baseUrlStr && !getProviderDefaultBaseUrl(provider))) {
        res.status(400).json({ error: 'provider and base_url are required.' });
        return;
      }

      const result = await checkAiProviderConnectivity({
        label: 'test',
        provider,
        baseUrl: baseUrlStr,
        apiToken: typeof apiToken === 'string' ? apiToken : '',
      });

      res.json(result);
    });

    router.post('/whatsapp/connect', (_req: Request, res: Response) => {
      // WhatsApp pairing goes through Baileys' own terminal QR prompt
      // (plugins/whatsapp's startBaileysSocket already prints it via
      // qrcode-terminal) — this just triggers the live connection attempt.
      startChannelLive('whatsapp', logger, gateway);
      res.json({ success: true });
    });

    router.get('/health', async (_req: Request, res: Response) => {
      const result = await healthCheck(logger);
      res.status(result.status === 'ok' ? 200 : 500).json(result);
    });

    return router;
  }
}

export { AdminRouterFactory };
