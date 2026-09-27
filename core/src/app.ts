// Must run before any module-level LoggerFactory.create() calls (e.g. db-sqlite.ts).
// Detecting --tui flag directly from argv here silences the console transport
// globally, preventing any log output from breaking the TUI alt-screen layout.
if (process.argv.includes('tui') || process.argv.includes('--tui')) {
  process.env.LOG_SILENCE_CONSOLE = 'true';
}

import { startTUI } from '../../apps/tui';
import { LoggerFactory, ILogger } from './infrastructure/logger';
import { MessageGatewayFactory, IMessageGateway } from './services/agents/message-gateway';
import { IHeartbeatRunner, HeartbeatSingleton } from './services/agents/sub-agents/heartbeat/runner';
import { ChannelsSingleton, ADAPTERS, ChannelHandlerFactory, configureChannelHandler, applyChannelOverrides, type IChannelsManager } from './channels';
import { loadChannelOverrides } from './config/channel-overrides';
import { SHUTDOWN_SIGNALS } from './constants/tui';
import { hasFlag, logError } from './utils/runtime';
import { SessionManager } from './services/session-manager';
import { DatabaseServiceFactory } from './infrastructure/db-sqlite';
import { HeartbeatRepositoryFactory } from './repositories/heartbeat';
import { HeartbeatRunRepositoryFactory } from './repositories/heartbeat-run';
import { seedDefaultBeats } from './services/agents/sub-agents/heartbeat/default-beats';
import { SkillsRepositoryFactory } from './repositories/skills';
import { LearnedSkillsRepositoryFactory } from './repositories/learned-skills';
import { SkillSyncSingleton } from './services/skills/skill-sync';
import { DashboardServerFactory, WebServerHandle, WebListenOptions } from './dashboard';
import { createPlugins, buildRegistry } from '../../plugins/channels';
import { createToolPlugins, TOOLS_DIR } from '../../plugins/tools';
import { createMcpPlugins, MCPS_DIR } from '../../plugins/mcps';
import { MCP_SERVERS } from '../../plugins/mcps/contracts';
import { COMMANDS } from '../../plugins/tools/contracts';
import { ToolPluginsSingleton } from './services/tools/registry-singleton';
import { ToolSyncSingleton } from './services/tools/tool-sync';
import { config } from './config';
import path from 'node:path';
import type { PluginContext } from '../../plugins/channels/contracts';
import type { ErrandRecord, IErrandsGateway, ToolPluginContext } from '../../plugins/tools/contracts';
import type { McpPluginContext } from '../../plugins/mcps/contracts';
import { IDatabaseService } from './infrastructure/db-sqlite';
import { Heartbeat } from './entities/heartbeat';
import type { BeatType } from './types/beat';
import { StickerRulesRepositoryFactory } from './repositories/sticker-rules';
import { OutboundMessageServiceFactory } from './services/outbound/message-service';
import { gateErrorForUrl } from './services/security/gate';
import { PluginSettingsRepositoryFactory } from './repositories/plugin-settings';
import { migrateLegacyPluginEnabledFlags, resolvePluginEnabled, type PluginIdentity } from './services/plugins/plugin-enablement';
import { PluginCatalogSingleton } from './services/plugins/plugin-catalog-singleton';
import { listInstalledChannelNames } from './services/commands/channels';
import { getAudioTranscriptionService } from './services/audio/audio-transcription-service';
import { McpManagerSingleton } from './services/mcps/mcp-manager';
import { McpSyncSingleton } from './services/mcps/mcp-sync';
import { buildErrandService } from './services/errands';
import { startErrand } from './services/errands/start';
import type { Errand } from './entities/errand';

const logger = LoggerFactory.create();
const MODES = ['tui', 'web'] as const;

function createPluginContext(logger: ILogger, gateway: IMessageGateway, db: IDatabaseService): PluginContext {
  const pluginSettingsRepo = PluginSettingsRepositoryFactory.create(db);
  return {
    logger,
    gateway,
    channelHandler: ChannelHandlerFactory,
    pluginEnablement: {
      isEnabled: (name) => resolvePluginEnabled(pluginSettingsRepo, 'channels', name),
    },
    audioTranscriber: getAudioTranscriptionService(logger),
  };
}

function toErrandRecord(errand: Errand): ErrandRecord {
  return {
    id: errand.id,
    goal: errand.goal,
    state: errand.state,
    originSessionId: errand.originSessionId,
    pendingMessage: errand.pendingMessage,
    deliveryIncomplete: Boolean(errand.pendingDelivery),
    deliveryError: errand.pendingDelivery?.error,
    notes: errand.notes,
    result: errand.result,
    createdAt: errand.createdAt,
  };
}

function createErrandsGateway(logger: ILogger, db: IDatabaseService): IErrandsGateway {
  const resolve = () => {
    const sessionManager = new SessionManager(db);
    const errandService = buildErrandService(logger, db, sessionManager);
    if (!errandService) throw new Error('Errands are not available: no channel manager is running.');
    return { sessionManager, errandService };
  };
  return {
    listForSession: (sessionId) => resolve().errandService.listByOrigin(sessionId).map(toErrandRecord),
    start: async (input) => {
      const { sessionManager, errandService } = resolve();
      const { errand, openingMessage } = await startErrand(logger, db, sessionManager, errandService, input);
      return { errand: toErrandRecord(errand), openingMessage };
    },
    approve: async (id) => toErrandRecord(await resolve().errandService.approve(id)),
    retry: async (id) => toErrandRecord(await resolve().errandService.retryDelivery(id)),
    answer: async (id, answer) => {
      const { errand, reply } = await resolve().errandService.resumeWithPrincipalAnswer(id, answer);
      return { errand: toErrandRecord(errand), reply };
    },
    confirm: async (id) => toErrandRecord(await resolve().errandService.confirmResolution(id)),
    close: async (id, result) => toErrandRecord(resolve().errandService.resolve(id, result)),
    cancel: async (id) => toErrandRecord(resolve().errandService.cancel(id)),
    followUrl: () => `${config.GATEWAY_HOST.replace(/\/+$/, '')}/admin/agents/negotiator`,
  };
}

function createToolPluginContext(logger: ILogger, db: IDatabaseService): ToolPluginContext {
  const pluginSettingsRepo = PluginSettingsRepositoryFactory.create(db);
  return {
    logger,
    heartbeats: {
      create: (input) => {
        const repo = HeartbeatRepositoryFactory.create(db);
        const heartbeat = new Heartbeat({
          beat: input.beat,
          type: input.type as BeatType,
          cronExpression: input.cronExpression,
          channel: input.channel,
          target: input.target,
          runOnce: input.runOnce,
        });
        repo.save(heartbeat);
        return heartbeat;
      },
      getById: (id) => HeartbeatRepositoryFactory.create(db).getById(id),
      getAll: () => HeartbeatRepositoryFactory.create(db).getAll(),
      update: (id, input) => HeartbeatRepositoryFactory.create(db).update(id, {
        beat: input.beat,
        type: input.type as BeatType | undefined,
        cronExpression: input.cronExpression,
        channel: input.channel,
        target: input.target,
        runOnce: input.runOnce,
      }),
      deleteById: (id) => HeartbeatRepositoryFactory.create(db).deleteById(id),
      reschedule: () => { HeartbeatSingleton.getExistingInstance()?.reschedule(); },
    },
    channels: {
      sendMessage: async (channel, target, content) => {
        const channelsManager = ChannelsSingleton.getExistingInstance();
        if (!channelsManager) {
          throw new Error('Outbound messaging is not available: no channel manager is running.');
        }
        const service = OutboundMessageServiceFactory.create(logger, channelsManager, db, new SessionManager(db));
        return service.send({ content, channel, target });
      },
      sendSticker: async (channel, target, sticker) => {
        const channelsManager = ChannelsSingleton.getExistingInstance();
        if (!channelsManager) {
          throw new Error('Outbound messaging is not available: no channel manager is running.');
        }
        await channelsManager.sendSticker(channel, target, sticker);
      },
    },
    stickerRules: {
      save: (input) => StickerRulesRepositoryFactory.create(db).save(input),
      getById: (id) => StickerRulesRepositoryFactory.create(db).getById(id),
      deleteById: (id) => StickerRulesRepositoryFactory.create(db).deleteById(id),
    },
    errands: createErrandsGateway(logger, db),
    security: {
      gateUrl: gateErrorForUrl,
    },
    config: {
      searxngUrl: config.AI.SEARXNG_URL,
      allowedDomains: config.ALLOWED_DOMAINS,
      githubOwner: config.GITHUB.OWNER,
      githubToken: config.GITHUB.TOKEN,
    },
    pluginEnablement: {
      isEnabled: (name) => resolvePluginEnabled(pluginSettingsRepo, 'tools', name),
    },
  };
}

function createMcpPluginContext(logger: ILogger, db: IDatabaseService): McpPluginContext {
  const pluginSettingsRepo = PluginSettingsRepositoryFactory.create(db);
  return {
    logger,
    pluginEnablement: {
      isEnabled: (name) => resolvePluginEnabled(pluginSettingsRepo, 'mcps', name),
    },
  };
}

async function checkAndLogVoiceServerConnectivity(logger: ILogger): Promise<void> {
  const sttEnabled = config.AUDIO.STT.ENABLED;
  const ttsEnabled = config.AUDIO.TTS.ENABLED;
  const endpoint = sttEnabled
    ? config.AUDIO.STT.ENDPOINT
    : ttsEnabled
      ? config.AUDIO.TTS.ENDPOINT
      : config.AUDIO.STT.ENDPOINT;

  try {
    const url = new URL(endpoint);
    const healthUrl = `${url.origin}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(healthUrl, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (res.ok) {
      logger.info(`[audio] Voice server is connected at ${url.origin} (health: ok)`);
    } else {
      logger.info(`[audio] Voice server responded at ${url.origin} (status: ${res.status})`);
    }
  } catch {
    if (sttEnabled || ttsEnabled) {
      logger.info(`[audio] Voice server is offline or unreachable at ${endpoint}`);
    }
  }
}

type Mode = typeof MODES[number];
type RuntimeModes = Record<Mode, boolean>;

interface IRuntime {
  gateway: IMessageGateway;
  channels: IChannelsManager;
  heartbeat: IHeartbeatRunner;
  webServer: WebServerHandle | null;
};

interface IApplication {
  start(): Promise<void>;
}

class Application implements IApplication {
  private runtime: IRuntime | null = null;
  private isShuttingDown = false;

  constructor(
    private readonly logger: ILogger,
    private readonly source: Mode = resolveSessionSourceFromArgs(),
    private readonly modes: RuntimeModes = resolveRuntimeModes(),
    private readonly webListen: WebListenOptions | undefined = undefined,
  ) {}

  /** The port the web dashboard is bound to (0 before `start`/`startEmbedded`). */
  get webPort(): number {
    return this.runtime?.webServer?.port ?? 0;
  }

  async start(): Promise<void> {
    this.runtime = await this.createCliRuntime();
    this.registerShutdownHandlers();
    this.startTuiIfEnabled();
  }

  /**
   * Like `start()` but for running inside a host process (the Electron desktop
   * app): the host owns the process lifecycle, so no signal / `beforeExit`
   * handlers are installed. Call `stop()` from the host's shutdown hook.
   */
  async startEmbedded(): Promise<void> {
    this.runtime = await this.createCliRuntime();
    this.startTuiIfEnabled();
  }

  async stop(reason = 'stop'): Promise<void> {
    await this.shutdown(reason);
  }

  private async createCliRuntime(): Promise<IRuntime> {
    const db = DatabaseServiceFactory.create();
    seedDefaultBeats(db, this.logger);
    const sessionManager = new SessionManager(db);
    configureChannelHandler({ sessionManager, logger: this.logger });
    const gateway = MessageGatewayFactory.create(this.logger, this.source, db, sessionManager);
    const channelPlugins = createPlugins({
      context: createPluginContext(this.logger, gateway, db),
      directory: path.join(config.BASE_DIR, 'plugins', 'channels'),
    });
    const toolPlugins = createToolPlugins({ context: createToolPluginContext(this.logger, db) });
    const mcpContext = createMcpPluginContext(this.logger, db);
    const mcpPlugins = createMcpPlugins({ context: mcpContext });
    const diskChannels = listInstalledChannelNames(config.BASE_DIR);
    const channelNames = Array.from(new Set([...channelPlugins.map((plugin) => plugin.name), ...diskChannels]));
    const pluginIdentities: PluginIdentity[] = [
      ...channelNames.map((name) => ({ family: 'channels' as const, name })),
      ...toolPlugins.map((plugin) => ({ family: 'tools' as const, name: plugin.name })),
      ...mcpPlugins.map((plugin) => ({ family: 'mcps' as const, name: plugin.name })),
    ];
    migrateLegacyPluginEnabledFlags(PluginSettingsRepositoryFactory.create(db), pluginIdentities, this.logger);
    PluginCatalogSingleton.getInstance(pluginIdentities);
    const registry = buildRegistry([...channelPlugins, ...toolPlugins, ...mcpPlugins]);
    ToolPluginsSingleton.getInstance(registry.collect(COMMANDS));
    const mcpManager = McpManagerSingleton.getInstance(this.logger, registry, registry.collect(MCP_SERVERS));
    // Not awaited: an unreachable server would otherwise hold boot for the
    // SDK's request timeout. Tools are published as each server connects.
    void mcpManager.startAll();
    const registeredChannels = applyChannelOverrides(registry.collect(ADAPTERS), loadChannelOverrides());
    const channels = ChannelsSingleton.getInstance(this.logger, gateway, registeredChannels);
    const heartbeat = HeartbeatSingleton.getInstance(
      this.logger,
      HeartbeatRepositoryFactory.create(db),
      HeartbeatRunRepositoryFactory.create(db),
    );
    const skillSync = SkillSyncSingleton.getInstance(
      this.logger,
      SkillsRepositoryFactory.create(this.logger),
      LearnedSkillsRepositoryFactory.create(db),
    );
    const mcpSync = McpSyncSingleton.getInstance(
      this.logger,
      {
        sourceDir: path.join(config.BASE_DIR, 'plugins', 'mcps'),
        distDir: MCPS_DIR,
        context: mcpContext,
        registry,
        manager: mcpManager,
        pluginSettings: PluginSettingsRepositoryFactory.create(db),
      },
      mcpPlugins.map((plugin) => plugin.name),
    );
    const toolSync = ToolSyncSingleton.getInstance(
      this.logger,
      {
        sourceDir: path.join(config.BASE_DIR, 'plugins', 'tools'),
        distDir: TOOLS_DIR,
        context: createToolPluginContext(this.logger, db),
        registry,
      },
      toolPlugins.map((plugin) => plugin.name),
    );

    channels.startAll();
    heartbeat.start();
    skillSync.start();
    toolSync.start();
    mcpSync.start();
    void checkAndLogVoiceServerConnectivity(this.logger);

    try {
      const webServer = this.modes.web
        ? await DashboardServerFactory.create(this.logger, gateway, db, sessionManager, this.webListen).start()
        : null;

      return { gateway, channels, heartbeat, webServer };
    } catch (error) {
      channels.stopAll();
      heartbeat.stop();
      await mcpManager.stopAll();
      throw error;
    }
  }

  private startTuiIfEnabled(): void {
    if (!this.runtime || !this.modes.tui) {
      return;
    }

    const { gateway } = this.runtime;

    startTUI({
      title: 'koris',
      showHints: false,
      placeholder: 'Type /help for commands.',
      onInput: async (input: string) => gateway.handle(input, 'tui', {
        toolsEnabled: true,
        learnedSkillsEnabled: true,
      }),
    });
  }

  private registerShutdownHandlers(): void {
    for (const signal of SHUTDOWN_SIGNALS) {
      process.once(signal, () => {
        void this.shutdown(signal, 0);
      });
    }

    process.once('beforeExit', () => {
      void this.shutdown('beforeExit');
    });
  }

  private async shutdown(reason: string, exitCode?: number): Promise<void> {
    if (this.isShuttingDown || !this.runtime) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info(`Shutting down application (${reason})...`);

    this.runtime.channels.stopAll();
    this.runtime.heartbeat.stop();
    SkillSyncSingleton.getExistingInstance()?.stop();
    ToolSyncSingleton.getExistingInstance()?.stop();
    McpSyncSingleton.getExistingInstance()?.stop();
    await McpManagerSingleton.getExistingInstance()?.stopAll();

    try {
      await this.runtime.webServer?.stop();
    } catch (error) {
      logError(this.logger, `Failed to stop web server during ${reason}.`, error);
    }

    if (exitCode !== undefined) {
      process.exit(exitCode);
    }
  }
}

function resolveRuntimeModes(argv: string[] = process.argv): RuntimeModes {
  const explicitModes = MODES.reduce<RuntimeModes>((modes, mode) => {
    modes[mode] = hasFlag(mode, argv);
    return modes;
  }, { tui: false, web: false });

  if (Object.values(explicitModes).some(Boolean)) {
    return explicitModes;
  }

  return {
    tui: false,
    web: true,
  };
}

function resolveSessionSourceFromArgs(argv: string[] = process.argv): Mode {
  const modesArg = resolveRuntimeModes(argv);

  for (const mode of MODES) {
    if (modesArg[mode]) {
      return mode;
    }
  }

  return 'web';
}

export interface ServerHandle {
  /** The loopback port the web dashboard is listening on. */
  port: number;
  /** Stop the web server, channels, heartbeat and skill sync. */
  stop(): Promise<void>;
}

export interface StartServerOptions {
  /** Defaults to `{ tui: false, web: true }`. */
  modes?: Partial<RuntimeModes>;
  /** Bind overrides for the dashboard, e.g. `{ host: '127.0.0.1', port: 0 }`. */
  webListen?: WebListenOptions;
}

/**
 * Start the koris runtime inside the current process and return a handle to
 * stop it. Used by the Electron desktop app to run the server in-process
 * instead of spawning `node dist/core/src/app.js`. Installs no signal handlers.
 */
export async function startServer(options: StartServerOptions = {}): Promise<ServerHandle> {
  const modes: RuntimeModes = { tui: false, web: true, ...options.modes };
  const application = new Application(logger, 'web', modes, options.webListen);
  await application.startEmbedded();
  return {
    port: application.webPort,
    stop: () => application.stop('embedded-host'),
  };
}

const app = new Application(logger);

if (require.main === module) {
  app.start().catch((error) => {
    logError(logger, 'Failed to start application.', error);
    process.exit(1);
  });
}
