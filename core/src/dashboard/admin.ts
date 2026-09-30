import express, { type Router } from 'express';
import { config } from '../config';
import { listMissing, pullEntry, fetchChannelHints, fetchChannelCatalog } from '../../../scripts/hub-sync';
import type { ILogger } from '../infrastructure/logger';
import type { IDatabaseService } from '../infrastructure/db-sqlite';
import type { IMessageGateway } from '../services/agents/message-gateway';
import type { ISessionManager } from '../services/session-manager';
import { SessionRepositoryFactory } from '../repositories/session';
import { MessageRepositoryFactory } from '../repositories/message';
import { MemoryRepositoryFactory } from '../repositories/memory';
import { HeartbeatRepositoryFactory } from '../repositories/heartbeat';
import { BeatRunRepositoryFactory } from '../repositories/beat-run';
import { ChannelRepositoryFactory } from '../repositories/channel';
import { OutboundMessageRepositoryFactory } from '../repositories/outbound-message';
import { LearnedSkillsRepositoryFactory } from '../repositories/learned-skills';
import { SkillsRepositoryFactory } from '../repositories/skills';
import { AuditLogRepositoryFactory } from '../repositories/audit-log';
import { PluginSettingsRepositoryFactory } from '../repositories/plugin-settings';
import { ChannelsSingleton } from '../channels';
import { OutboundMessageServiceFactory } from '../services/outbound/message-service';
import { HeartbeatSingleton } from '../services/agents/sub-agents/heartbeat/runner';
import { SkillSyncSingleton } from '../services/skills/skill-sync';
import { ToolSyncSingleton } from '../services/tools/tool-sync';
import { McpSyncSingleton } from '../services/mcps/mcp-sync';
import { McpManagerSingleton } from '../services/mcps/mcp-manager';
import { PluginCatalogSingleton } from '../services/plugins/plugin-catalog-singleton';
import { registerPulledChannel } from '../services/plugins/channel-install';
import { listInstalledChannelNames } from '../services/commands/channels';
import { healthCheck } from '../services/provider-health-service';
import { activeRunsRegistry } from './active-runs';
import { startChannelLive, liveChannelNames, writeChannelConfigPatch, reprimeChannelRuntime } from './live-channel-runtime';
import { buildChannelsSnapshot, buildSettingsResponse } from './settings-snapshot';
import { getQueueStatus } from './runtime-snapshot';
import { registerOverviewRoutes } from './routes/overview';
import { registerSessionsRoutes } from './routes/sessions';
import { registerAuditRoutes } from './routes/audit';
import { registerHeartbeatsRoutes } from './routes/heartbeats';
import { registerChannelsRoutes } from './routes/channels';
import { registerPluginsRoutes } from './routes/plugins';
import { registerMarketplaceRoutes } from './routes/marketplace';
import { registerSettingsRoutes } from './routes/settings';

/** Composition root: constructs dependencies and registers each admin domain. */
export class AdminRouterFactory {
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
    const startChannel = (name: string): void => startChannelLive(name, logger, gateway);
    const syncServices = {
      getSkillSync: () => SkillSyncSingleton.getExistingInstance(),
      getToolSync: () => ToolSyncSingleton.getExistingInstance(),
      getMcpSync: () => McpSyncSingleton.getExistingInstance(),
    };

    registerOverviewRoutes(router, {
      sessionRepo, messageRepo, memoryRepo, heartbeatRepo, channelRepo, outboundRepo,
      learnedSkillsRepo, skillsRepo, auditRepo, activeRuns: activeRunsRegistry,
      getHealth: () => healthCheck(logger), getQueueStatus,
      getChannels: () => buildChannelsSnapshot(pluginSettingsRepo),
    });
    registerSessionsRoutes(router, {
      sessionRepo, messageRepo, memoryRepo, sessionManager, activeRuns: activeRunsRegistry,
    });
    registerAuditRoutes(router, { memoryRepo, auditRepo });
    registerHeartbeatsRoutes(router, {
      heartbeatRepo, beatRunRepo, auditRepo,
      reschedule: () => HeartbeatSingleton.getExistingInstance()?.reschedule(),
    });
    registerChannelsRoutes(router, {
      channelRepo, outboundRepo, startChannel,
      getOutboundService: () => {
        const manager = ChannelsSingleton.getExistingInstance();
        return manager ? OutboundMessageServiceFactory.create(logger, manager, db, sessionManager) : undefined;
      },
    });
    registerPluginsRoutes(router, {
      logger, learnedSkillsRepo, skillsRepo, pluginSettingsRepo, startChannel, ...syncServices,
      catalog: PluginCatalogSingleton,
      installedChannelNames: () => listInstalledChannelNames(config.BASE_DIR),
      getMcpManager: () => McpManagerSingleton.getExistingInstance(),
      stopChannel: (name) => ChannelsSingleton.getExistingInstance()?.stopChannel(name),
    });
    registerMarketplaceRoutes(router, {
      hub: {
        listMissing: () => listMissing({ baseDir: config.BASE_DIR }),
        pullEntry: (slug) => pullEntry(slug, { baseDir: config.BASE_DIR }),
        fetchChannelHints: () => fetchChannelHints(undefined, { baseDir: config.BASE_DIR }),
        fetchChannelCatalog: () => fetchChannelCatalog({ baseDir: config.BASE_DIR }),
      },
      ...syncServices,
      registerChannel: (slug) => registerPulledChannel(slug, pluginSettingsRepo),
    });
    registerSettingsRoutes(router, {
      logger, auditRepo, getSettings: () => buildSettingsResponse(pluginSettingsRepo),
      channelNames: liveChannelNames, writeChannelConfig: writeChannelConfigPatch,
      reprimeChannel: reprimeChannelRuntime,
    });
    return router;
  }
}
