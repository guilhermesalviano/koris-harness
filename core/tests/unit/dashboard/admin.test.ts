import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ILogger } from '../../../src/infrastructure/logger';

const {
  mockHealthCheck,
  auditRepo,
  sessionRepo,
  sessionManager,
  errandRepo,
  messageRepo,
  memoryRepo,
  heartbeatRepo,
  beatRunRepo,
  channelRepo,
  outboundRepo,
  learnedSkillsRepo,
  skillsRepo,
  skillSync,
  toolSync,
  settingsWriter,
  liveChannelRuntime,
  pluginSettingsRepo,
  pluginCatalog,
  channelsManager,
  hubSync,
  channelsCommands,
} = vi.hoisted(() => ({
  mockHealthCheck: vi.fn(async () => ({ status: 'ok', timestamp: '2026-01-01' })),
  auditRepo: {
    count: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    deleteById: vi.fn(),
    deleteAll: vi.fn(),
    usage: vi.fn(),
  },
  sessionRepo: {
    count: vi.fn(),
    countOpen: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(() => []),
    findLatestOpen: vi.fn(),
    save: vi.fn(),
    deleteById: vi.fn(),
  },
  sessionManager: {
    getSessionService: vi.fn(),
    getSessionServiceById: vi.fn(),
    invalidate: vi.fn(),
    invalidateKey: vi.fn(),
  },
  errandRepo: {
    countByState: vi.fn(() => 0),
    findTargets: vi.fn(() => []),
  },
  messageRepo: { count: vi.fn(), getBySessionId: vi.fn(() => []), getPreviewBySessionId: vi.fn(() => null) },
  memoryRepo: { count: vi.fn(), getBySessionId: vi.fn(() => []) },
  beatRunRepo: { findRecent: vi.fn(() => []) },
  heartbeatRepo: {
    getAll: vi.fn(() => []),
    getById: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
  },
  channelRepo: { getAll: vi.fn(() => []), setPrincipal: vi.fn() },
  outboundRepo: {
    count: vi.fn(),
    save: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
  },
  learnedSkillsRepo: { count: vi.fn(), getAll: vi.fn(), getByName: vi.fn(), setEnabled: vi.fn() },
  skillsRepo: { get: vi.fn() },
  skillSync: { sync: vi.fn(), getExistingInstance: vi.fn() },
  toolSync: { sync: vi.fn(), getExistingInstance: vi.fn() },
  settingsWriter: {
    loadCurrentOrExampleSettings: vi.fn(() => ({})),
    mergeSettingsPayload: vi.fn((base: object, patch: object) => ({ ...base, ...patch })),
    writeSettingsFile: vi.fn(() => '/tmp/koris.json'),
  },
  liveChannelRuntime: {
    startChannelLive: vi.fn(),
    liveChannelNames: vi.fn(() => ['telegram', 'whatsapp']),
    loadChannelConfig: vi.fn((name: string) =>
      name === 'telegram'
        ? { token: '', whitelist: '', allowUnlistedSenders: false }
        : { authFolder: '', whitelist: '', allowUnlistedSenders: false },
    ),
    writeChannelConfigPatch: vi.fn(),
    reprimeChannelRuntime: vi.fn(),
    reprimeLiveChannelDescriptors: vi.fn(),
  },
  pluginSettingsRepo: { getEnabled: vi.fn(), setEnabled: vi.fn(), getAll: vi.fn() },
  pluginCatalog: { getInstance: vi.fn(), getExistingInstance: vi.fn(() => []), append: vi.fn() },
  channelsManager: { getExistingInstance: vi.fn(() => undefined as { stopChannel: (name: string) => void } | undefined) },
  hubSync: { listMissing: vi.fn(), pullEntry: vi.fn(), fetchChannelHints: vi.fn(), fetchChannelCatalog: vi.fn() },
  channelsCommands: { listInstalledChannelNames: vi.fn(() => [] as string[]) },
}));

vi.mock('../../../src/services/provider-health-service', () => ({
  healthCheck: mockHealthCheck,
}));

vi.mock('../../../src/repositories/audit-log', () => ({
  AuditLogRepositoryFactory: { create: () => auditRepo },
}));

vi.mock('../../../src/repositories/session', () => ({
  SessionRepositoryFactory: { create: () => sessionRepo },
}));

vi.mock('../../../src/repositories/errand', () => ({
  ErrandRepositoryFactory: { create: () => errandRepo },
}));

vi.mock('../../../src/repositories/message', () => ({
  MessageRepositoryFactory: { create: () => messageRepo },
}));

vi.mock('../../../src/repositories/memory', () => ({
  MemoryRepositoryFactory: { create: () => memoryRepo },
}));

vi.mock('../../../src/repositories/heartbeat', () => ({
  HeartbeatRepositoryFactory: { create: () => heartbeatRepo },
}));

vi.mock('../../../src/repositories/beat-run', () => ({
  BeatRunRepositoryFactory: { create: () => beatRunRepo },
}));

vi.mock('../../../src/repositories/channel', () => ({
  ChannelRepositoryFactory: { create: () => channelRepo },
}));

vi.mock('../../../src/repositories/outbound-message', () => ({
  OutboundMessageRepositoryFactory: { create: () => outboundRepo },
}));

vi.mock('../../../src/repositories/learned-skills', () => ({
  LearnedSkillsRepositoryFactory: { create: () => learnedSkillsRepo },
}));

vi.mock('../../../src/repositories/skills', () => ({
  SkillsRepositoryFactory: { create: () => skillsRepo },
}));

vi.mock('../../../src/services/skills/skill-sync', () => ({
  SkillSyncSingleton: skillSync,
}));

vi.mock('../../../src/services/tools/tool-sync', () => ({
  ToolSyncSingleton: toolSync,
}));

vi.mock('../../../src/config/settings-writer', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/config/settings-writer')>();
  // Keep the real applyAiRolePatch / upsertAiProvider; stub only the IO helpers.
  return { ...actual, ...settingsWriter };
});

vi.mock('../../../src/dashboard/live-channel-runtime', () => liveChannelRuntime);

vi.mock('../../../src/repositories/plugin-settings', () => ({
  PluginSettingsRepositoryFactory: { create: () => pluginSettingsRepo },
}));

vi.mock('../../../src/services/plugins/plugin-catalog-singleton', () => ({
  PluginCatalogSingleton: pluginCatalog,
}));

vi.mock('../../../src/channels', () => ({
  ChannelsSingleton: channelsManager,
}));

vi.mock('../../../../scripts/hub-sync', () => hubSync);

vi.mock('../../../src/services/commands/channels', () => channelsCommands);

import { AdminRouterFactory } from '../../../src/dashboard/admin';
import { config } from '../../../src/config';

function makeResponse(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function makeRequest(method: string, url: string, query: Record<string, string> = {}): Request {
  return {
    method,
    url,
    query,
    params: {},
    body: {},
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Request;
}

function callRoute(router: ReturnType<typeof AdminRouterFactory.create>, req: Request, res: Response): void {
  router.handle(req, res, () => {});
}

const logger: ILogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

describe('AdminRouterFactory /audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists audit entries with pagination and forwards filters', () => {
    auditRepo.count.mockReturnValue(3);
    auditRepo.findAll.mockReturnValue([
      {
        id: 'a1',
        type: 'llm',
        role: 'manager',
        agent_name: 'manager',
        provider: 'ollama',
        model: 'qwen2.5',
        prompt: '{"messages":"..."}',
        response: 'hi there',
        duration_ms: 10,
        status: 'success',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'a2',
        type: 'tool',
        role: 'worker',
        agent_name: 'executorWorker',
        tool_name: 'curl-request',
        duration_ms: 4,
        status: 'error',
        error_message: 'blocked',
        created_at: '2026-01-01T00:01:00.000Z',
      },
      { id: 'a3', type: 'tool', role: 'worker', agent_name: 'executorWorker', tool_name: 'search_engine', duration_ms: 2, status: 'success', created_at: '2026-01-01T00:02:00.000Z' },
    ] as never);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/audit?type=llm&limit=25', { type: 'llm', limit: '25' }), res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.total).toBe(3);
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      id: 'a1',
      type: 'llm',
      agentName: 'manager',
      promptPreview: expect.stringContaining('...'),
      responsePreview: 'hi there',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(auditRepo.findAll).toHaveBeenCalledWith({
      limit: 25,
      offset: 0,
      filters: expect.objectContaining({ type: 'llm' }),
    });
    expect(auditRepo.count).toHaveBeenCalledWith(expect.objectContaining({ type: 'llm' }));
  });

  it('returns a single audit entry by id', () => {
    auditRepo.findById.mockReturnValue({
      id: 'a1',
      type: 'llm',
      role: 'manager',
      agent_name: 'manager',
      provider: 'ollama',
      model: 'qwen2.5',
      prompt: '{"x":1}',
      response: 'hi',
      duration_ms: 10,
      status: 'success',
      tools_enabled: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    } as never);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/audit/a1'), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({ id: 'a1', type: 'llm', status: 'success', toolsEnabled: true });
  });

  it('returns 404 when the audit entry is not found', () => {
    auditRepo.findById.mockReturnValue(null);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/audit/missing'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Audit entry not found' });
  });

  it('deletes a single audit entry', () => {
    auditRepo.deleteById.mockReturnValue(true);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('DELETE', '/audit/a1'), res);

    expect(auditRepo.deleteById).toHaveBeenCalledWith('a1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('returns 404 when deleting a missing audit entry', () => {
    auditRepo.deleteById.mockReturnValue(false);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('DELETE', '/audit/missing'), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('clears all audit entries', () => {
    auditRepo.deleteAll.mockReturnValue(12);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('DELETE', '/audit'), res);

    expect(res.json).toHaveBeenCalledWith({ success: true, deleted: 12 });
  });
});

describe('AdminRouterFactory /queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the serial queue state', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/queue'), res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(typeof body.parallel).toBe('boolean');
    expect(typeof body.subagentsParallel).toBe('boolean');
    expect(typeof body.backgroundGraceMs).toBe('number');
    expect(Array.isArray(body.subAgents)).toBe(true);
    expect(Array.isArray(body.running)).toBe(true);
    expect(body.running).toEqual([]);
    expect(body.queued).toEqual([]);
  });
});

describe('AdminRouterFactory /usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a usage report for all-time', () => {
    auditRepo.usage.mockReturnValue([
      { id: 'a1', run_id: 'r1', channel: 'telegram', type: 'llm', role: 'manager', agent_name: 'manager', prompt_length: 40, response_length: 8, duration_ms: 10, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', run_id: 'r1', channel: 'telegram', type: 'tool', role: 'worker', agent_name: 'executorWorker', tool_name: 'curl-request', duration_ms: 4, created_at: '2026-01-01T00:00:10.000Z' },
    ] as never);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/usage'), res);

    expect(auditRepo.usage).toHaveBeenCalledWith({ from: undefined });
    const body = res.json.mock.calls[0][0];
    expect(body.days).toBeNull();
    expect(body.total.calls).toBe(1);
    expect(body.total.toolCalls).toBe(1);
    expect(body.total.totalTokens).toBe(12);
    expect(body.byAgent.manager).toBeDefined();
    expect(body.byChannel.telegram).toBeDefined();
    expect(body.byTool['curl-request']).toBeDefined();
  });

  it('forwards the days filter to the repository', () => {
    auditRepo.usage.mockReturnValue([]);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/usage', { days: '7' }), res);

    const [call] = auditRepo.usage.mock.calls[0];
    expect(call.from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.json.mock.calls[0][0].days).toBe(7);
  });

  it('ignores invalid days values', () => {
    auditRepo.usage.mockReturnValue([]);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/usage', { days: 'abc' }), res);

    expect(auditRepo.usage).toHaveBeenCalledWith({ from: undefined });
    expect(res.json.mock.calls[0][0].days).toBeNull();
  });
});

describe('AdminRouterFactory /overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    sessionRepo.count.mockReturnValue(4);
    sessionRepo.countOpen.mockReturnValue(1);
    messageRepo.count.mockReturnValue(42);
    memoryRepo.count.mockReturnValue(7);
    heartbeatRepo.getAll.mockReturnValue([
      { lastRun: new Date('2026-01-02T10:00:00.000Z') },
      { lastRun: new Date('2026-01-03T10:00:00.000Z') },
    ] as never);
    learnedSkillsRepo.count.mockReturnValue(2);
    skillsRepo.get.mockReturnValue([{}, {}, {}] as never);
    outboundRepo.count.mockReturnValue(11);
    channelRepo.getAll.mockReturnValue([
      { channel: 'telegram', target: '@me', isPrincipal: true },
    ] as never);
    auditRepo.count.mockReturnValue(2);
    auditRepo.findAll.mockReturnValue([
      {
        id: 'e1',
        type: 'tool',
        role: 'worker',
        agent_name: 'executorWorker',
        tool_name: 'curl-request',
        duration_ms: 3,
        status: 'error',
        error_message: 'blocked',
        created_at: '2026-01-03T09:00:00.000Z',
      },
    ] as never);
    auditRepo.usage.mockReturnValue([
      { id: 'u1', type: 'llm', agent_name: 'manager', prompt_length: 40, response_length: 8, duration_ms: 10, created_at: '2026-01-01T00:00:00.000Z' },
    ] as never);
  });

  it('returns aggregate counts, config, queue, usage and recent errors', async () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    router.handle(makeRequest('GET', '/overview'), res, () => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];

    expect(body.sessions).toBe(4);
    expect(body.openSessions).toBe(1);
    expect(body.messages).toBe(42);
    expect(body.memories).toBe(7);
    expect(body.heartbeats).toBe(2);
    expect(body.learnedSkills).toBe(2);
    expect(body.skills).toBe(3);
    expect(body.outboundMessages).toBe(11);
    expect(body.auditErrors).toBe(2);
    expect(body.lastHeartbeatRunAt).toMatch(/^2026-01-03T/);

    expect(body.workerProvider).toBeDefined();
    expect(body.workerModel).toBeDefined();
    expect(body.heartbeatEnabled).toBeTypeOf('boolean');
    expect(body.summarizerEnabled).toBeTypeOf('boolean');
    expect(body.aiParallel).toBeTypeOf('boolean');
    expect(body.aiSubagentsParallel).toBeTypeOf('boolean');

    expect(body.channels).toEqual([
      { type: 'telegram', enabled: expect.any(Boolean) },
      { type: 'whatsapp', enabled: expect.any(Boolean) },
    ]);
    expect(body.registeredChannels).toEqual([
      { type: 'telegram', target: '@me', principal: true },
    ]);

    expect(body.health.status).toBe('ok');
    expect(body.activeRuns).toEqual([]);
    expect(body.queue).toMatchObject({
      parallel: expect.any(Boolean),
      subagentsParallel: expect.any(Boolean),
      running: [],
      queued: [],
    });
    expect(body.usage.totalTokens).toBeGreaterThan(0);
    expect(body.recentErrors).toHaveLength(1);
    expect(body.recentErrors[0]).toMatchObject({ id: 'e1', status: 'error' });

    expect(auditRepo.count).toHaveBeenCalledWith({ status: 'error' });
    expect(auditRepo.findAll).toHaveBeenCalledWith({
      limit: 5,
      filters: { status: 'error' },
    });
    expect(auditRepo.usage).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String) }));
  });
});

describe('AdminRouterFactory /skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /skills/sync triggers a resync when initialized', () => {
    skillSync.getExistingInstance.mockReturnValue(skillSync);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/skills/sync'), res);

    expect(skillSync.sync).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST /skills/sync returns 503 when sync is not initialized', () => {
    skillSync.getExistingInstance.mockReturnValue(null);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/skills/sync'), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Skill sync not initialized' });
    expect(skillSync.sync).not.toHaveBeenCalled();
  });
});

describe('AdminRouterFactory /plugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginCatalog.getExistingInstance.mockReturnValue([
      { family: 'tools', name: 'curl-request' },
      { family: 'channels', name: 'telegram' },
    ]);
    // `/plugins` now also reads the skills repos; default them to empty so each
    // test opts into skill rows explicitly.
    skillsRepo.get.mockReturnValue([]);
    learnedSkillsRepo.getAll.mockReturnValue([]);
    toolSync.getExistingInstance.mockReturnValue({ sync: toolSync.sync });
    skillSync.getExistingInstance.mockReturnValue({ sync: skillSync.sync });
    channelsCommands.listInstalledChannelNames.mockReturnValue([]);
  });

  it('GET /plugins lists every catalog entry with its resolved enabled state and syncs tools/skills', () => {
    pluginSettingsRepo.getEnabled.mockImplementation((family: string, name: string) =>
      family === 'tools' && name === 'curl-request' ? false : null);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/plugins'), res);

    expect(toolSync.sync).toHaveBeenCalled();
    expect(skillSync.sync).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      items: [
        { family: 'tools', name: 'curl-request', enabled: false },
        { family: 'channels', name: 'telegram', enabled: false },
      ],
    });
  });

  it('GET /plugins appends skills, merging disk entries with their learned state', () => {
    skillsRepo.get.mockReturnValue([
      { name: 'git', description: 'Git skill', read_when: ['when needed'], content: 'run rebase' },
      { name: 'docker', description: 'Docker skill', read_when: null, content: 'run compose' },
    ] as never);
    learnedSkillsRepo.getAll.mockReturnValue([
      { name: 'git', enabled: false, learned_at: '2026-01-01 00:00:00' },
    ] as never);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/plugins'), res);

    const { items } = res.json.mock.calls[0][0];
    expect(items.filter((i: { family: string }) => i.family === 'skills')).toEqual([
      {
        family: 'skills',
        name: 'git',
        enabled: false,
        description: 'Git skill',
        read_when: ['when needed'],
        content: 'run rebase',
        learned_at: '2026-01-01 00:00:00',
      },
      {
        family: 'skills',
        name: 'docker',
        // A skill on disk that has never been synced still lists as enabled.
        enabled: true,
        description: 'Docker skill',
        read_when: null,
        content: 'run compose',
        learned_at: null,
      },
    ]);
  });

  it('PATCH /plugins/skills/:name writes through the learned-skills store, not plugin_settings', () => {
    learnedSkillsRepo.setEnabled.mockReturnValue(true);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/skills/git');
    req.body = { enabled: false };
    callRoute(router, req, res);

    expect(learnedSkillsRepo.setEnabled).toHaveBeenCalledWith('git', false);
    expect(pluginSettingsRepo.setEnabled).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      item: { family: 'skills', name: 'git', enabled: false },
    });
  });

  it('PATCH /plugins/skills/:name returns 404 for an unknown skill', () => {
    learnedSkillsRepo.setEnabled.mockReturnValue(false);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/skills/missing');
    req.body = { enabled: true };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Skill not found' });
  });

  it('PATCH /plugins/skills/:name rejects a non-boolean enabled value', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/skills/git');
    req.body = { enabled: 'yes' };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'enabled must be a boolean' });
    expect(learnedSkillsRepo.setEnabled).not.toHaveBeenCalled();
  });

  it('PATCH /plugins/:family/:name rejects an invalid family', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/bogus/curl-request');
    req.body = { enabled: true };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pluginSettingsRepo.setEnabled).not.toHaveBeenCalled();
  });

  it('PATCH /plugins/:family/:name rejects a non-boolean enabled value', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/tools/curl-request');
    req.body = { enabled: 'yes' };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(pluginSettingsRepo.setEnabled).not.toHaveBeenCalled();
  });

  it('PATCH /plugins/:family/:name returns 404 for a plugin not in the catalog', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/tools/does-not-exist');
    req.body = { enabled: true };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(pluginSettingsRepo.setEnabled).not.toHaveBeenCalled();
  });

  it('PATCH /plugins/:family/:name toggles a tool and does not touch live channels', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/tools/curl-request');
    req.body = { enabled: false };
    callRoute(router, req, res);

    expect(pluginSettingsRepo.setEnabled).toHaveBeenCalledWith('tools', 'curl-request', false);
    expect(liveChannelRuntime.startChannelLive).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, item: { family: 'tools', name: 'curl-request', enabled: false } });
  });

  it('PATCH /plugins/:family/:name starts a channel live when enabling it', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/channels/telegram');
    req.body = { enabled: true };
    callRoute(router, req, res);

    expect(pluginSettingsRepo.setEnabled).toHaveBeenCalledWith('channels', 'telegram', true);
    expect(liveChannelRuntime.startChannelLive).toHaveBeenCalledTimes(1);
    expect(liveChannelRuntime.startChannelLive).toHaveBeenCalledWith('telegram', expect.anything(), expect.anything());
  });

  it('PATCH /plugins/:family/:name stops a running channel live when disabling it', () => {
    const stopChannel = vi.fn();
    channelsManager.getExistingInstance.mockReturnValue({ stopChannel });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/channels/telegram');
    req.body = { enabled: false };
    callRoute(router, req, res);

    expect(pluginSettingsRepo.setEnabled).toHaveBeenCalledWith('channels', 'telegram', false);
    expect(stopChannel).toHaveBeenCalledWith('telegram');
  });

  it('GET /plugins discovers and appends channels installed on disk to the catalog', () => {
    channelsCommands.listInstalledChannelNames.mockReturnValue(['whatsapp']);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/plugins'), res);

    expect(pluginCatalog.append).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ family: 'channels', name: 'whatsapp' })]),
    );
  });

  it('PATCH /plugins/channels/:name appends channel from disk if not yet in catalog', () => {
    channelsCommands.listInstalledChannelNames.mockReturnValue(['whatsapp']);
    pluginCatalog.getExistingInstance.mockReturnValue([{ family: 'channels', name: 'whatsapp' }]);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('PATCH', '/plugins/channels/whatsapp');
    req.body = { enabled: true };
    callRoute(router, req, res);

    expect(pluginCatalog.append).toHaveBeenCalledWith([{ family: 'channels', name: 'whatsapp' }]);
    expect(pluginSettingsRepo.setEnabled).toHaveBeenCalledWith('channels', 'whatsapp', true);
  });
});

describe('AdminRouterFactory /marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /marketplace lists missing koris-hub entries, pinning baseDir to config.BASE_DIR', async () => {
    hubSync.listMissing.mockResolvedValue([{ family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' }]);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/marketplace'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(hubSync.listMissing).toHaveBeenCalledWith({ baseDir: config.BASE_DIR });
    expect(res.json).toHaveBeenCalledWith({ items: [{ family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' }] });
  });

  it('GET /marketplace returns 502 when koris-hub is unreachable', async () => {
    hubSync.listMissing.mockRejectedValue(new Error('Request to https://api.github.com/... failed: 500 Internal Server Error'));

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/marketplace'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'Request to https://api.github.com/... failed: 500 Internal Server Error' });
  });

  it('POST /marketplace/:slug/pull installs a channel INACTIVE, overriding any stale enabled row', async () => {
    hubSync.pullEntry.mockResolvedValue({ family: 'channel', slug: 'whatsapp', createdFiles: ['plugins/channels/whatsapp/index.js'] });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/marketplace/whatsapp/pull'), res);
    await new Promise((resolve) => setImmediate(resolve));

    // A channel is useless until it's configured, so a pull must write
    // enabled=false rather than rely on "no row means off" — a re-pull would
    // otherwise inherit the row a previous install left behind.
    expect(pluginSettingsRepo.setEnabled).toHaveBeenCalledWith('channels', 'whatsapp', false);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST /marketplace/:slug/pull leaves tool enablement alone', async () => {
    hubSync.pullEntry.mockResolvedValue({ family: 'tool', slug: 'issue', createdFiles: ['plugins/tools/issue/index.ts'] });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/marketplace/issue/pull'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pluginSettingsRepo.setEnabled).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('GET /channels/hints fetches hints dynamically', async () => {
    hubSync.fetchChannelHints.mockResolvedValue({
      telegram: { uninstalled: 'Download TG' },
      whatsapp: { uninstalled: 'Download WA' },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/channels/hints'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(hubSync.fetchChannelHints).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ baseDir: config.BASE_DIR }),
    );
    expect(res.json).toHaveBeenCalledWith({
      hints: {
        telegram: { uninstalled: 'Download TG' },
        whatsapp: { uninstalled: 'Download WA' },
      },
    });
  });

  it('GET /channels/hints falls back to empty hints on error', async () => {
    hubSync.fetchChannelHints.mockRejectedValue(new Error('Network failure'));

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/channels/hints'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.json).toHaveBeenCalledWith({ hints: {} });
  });

  it('GET /channels/catalog fetches channels dynamically', async () => {
    hubSync.fetchChannelCatalog.mockResolvedValue([
      { slug: 'telegram', name: 'Telegram', hints: { uninstalled: 'Download TG' } },
      { slug: 'whatsapp', name: 'WhatsApp' },
    ]);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/channels/catalog'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(hubSync.fetchChannelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: config.BASE_DIR }),
    );
    expect(res.json).toHaveBeenCalledWith({
      items: [
        { slug: 'telegram', name: 'Telegram', hints: { uninstalled: 'Download TG' } },
        { slug: 'whatsapp', name: 'WhatsApp' },
      ],
    });
  });

  it('GET /channels/catalog falls back to empty array on error', async () => {
    hubSync.fetchChannelCatalog.mockRejectedValue(new Error('Network failure'));

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/channels/catalog'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.json).toHaveBeenCalledWith({ items: [] });
  });

  it('POST /marketplace/:slug/pull pulls the entry, pinning baseDir to config.BASE_DIR and syncs tools', async () => {
    hubSync.pullEntry.mockResolvedValue({ family: 'tool', slug: 'issue', createdFiles: ['plugins/tools/issue/index.ts'] });
    toolSync.getExistingInstance.mockReturnValue({ sync: toolSync.sync });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/marketplace/issue/pull'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(hubSync.pullEntry).toHaveBeenCalledWith('issue', { baseDir: config.BASE_DIR });
    expect(toolSync.sync).toHaveBeenCalledWith('issue');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      item: { family: 'tool', slug: 'issue', createdFiles: ['plugins/tools/issue/index.ts'] },
    });
  });

  it('POST /marketplace/:slug/pull syncs skills when pulling a skill', async () => {
    hubSync.pullEntry.mockResolvedValue({ family: 'skill', slug: 'git', createdFiles: ['plugins/skills/git/SKILL.md'] });
    skillSync.getExistingInstance.mockReturnValue({ sync: skillSync.sync });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/marketplace/git/pull'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(hubSync.pullEntry).toHaveBeenCalledWith('git', { baseDir: config.BASE_DIR });
    expect(skillSync.sync).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST /marketplace/:slug/pull repriming live channels and appending to plugin catalog when pulling a channel', async () => {
    hubSync.pullEntry.mockResolvedValue({
      family: 'channel',
      slug: 'telegram',
      createdFiles: ['plugins/channels/telegram/index.js', 'plugins/channels/telegram/config.example.yml'],
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/marketplace/telegram/pull'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(hubSync.pullEntry).toHaveBeenCalledWith('telegram', { baseDir: config.BASE_DIR });
    expect(liveChannelRuntime.reprimeLiveChannelDescriptors).toHaveBeenCalled();
    expect(pluginCatalog.append).toHaveBeenCalledWith([{ family: 'channels', name: 'telegram' }]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST /marketplace/:slug/pull returns 400 when the plugin already exists locally', async () => {
    hubSync.pullEntry.mockRejectedValue(new Error('"plugins/tools/issue" already exists locally. Pass --force to overwrite.'));

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/marketplace/issue/pull'), res);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: '"plugins/tools/issue" already exists locally. Pass --force to overwrite.' });
  });
});

describe('AdminRouterFactory /settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /settings/status reports whether a settings file is configured', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/settings/status'), res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(typeof body.configured).toBe('boolean');
  });

  it('GET /capabilities returns the real supported providers and channel types, excluding the internal mock provider', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/capabilities'), res);

    expect(res.json).toHaveBeenCalledWith({
      providers: expect.arrayContaining(['ollama', 'nvidia']),
      channels: expect.arrayContaining(['telegram', 'whatsapp']),
    });
    const body = res.json.mock.calls[0][0];
    expect(body.providers).not.toContain('mock');
  });

  it('GET /providers returns the metadata catalogue plus the active per-role config', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/providers'), res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];

    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.map((c: { name: string }) => c.name)).not.toContain('mock');

    const openrouter = body.providers.find((c: { name: string }) => c.name === 'openrouter');
    expect(openrouter).toMatchObject({
      label: 'OpenRouter',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      apiKeyUrl: 'https://openrouter.ai/keys',
      embeddings: false,
      isOpenAICompatible: true,
      configured: expect.any(Boolean),
    });

    const ollama = body.providers.find((c: { name: string }) => c.name === 'ollama');
    expect(ollama.embeddings).toBe(true);
    expect(ollama.apiKeyUrl).toBeUndefined();

    expect(body.active.manager.provider).toBe(config.AI.MANAGER.PROVIDER);
    expect(body.active.workers.provider).toBe(config.AI.WORKERS.PROVIDER);
    expect(typeof body.active.manager.hasToken).toBe('boolean');
    expect(body.active.embed.provider).toBe(config.AI.EMBED.PROVIDER);
    expect(body.active.embed.model).toBe(config.AI.EMBED.MODEL);
    expect(typeof body.active.embed.enabled).toBe('boolean');

    expect(typeof body.defaultNumCtx).toBe('number');
    expect(body.active.manager.numCtx).toBe(config.AI.MANAGER.NUM_CTX);
    expect(body.active.workers.numCtx).toBe(config.AI.WORKERS.NUM_CTX);
    expect(body.active.embed.numCtx).toBeUndefined();
  });

  it('GET /providers marks a provider saved in ai.providers[] as configured and surfaces its model/token', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
          { provider: 'nvidia', base_url: '', api_token: 'nv-key', model: 'meta/llama-3.3-70b-instruct' },
        ],
        roles: { manager: { provider: 'ollama' }, workers: { provider: 'ollama' } },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/providers'), res);

    const body = res.json.mock.calls[0][0];
    const nvidia = body.providers.find((c: { name: string }) => c.name === 'nvidia');
    expect(nvidia).toMatchObject({
      configured: true,
      model: 'meta/llama-3.3-70b-instruct',
      hasToken: true,
      storedBaseUrl: '',
    });
    expect(nvidia.storedNumCtx).toBeUndefined();
    const ollama = body.providers.find((c: { name: string }) => c.name === 'ollama');
    expect(ollama.storedNumCtx).toBeUndefined();
  });

  it('GET /providers surfaces a stored num_ctx as storedNumCtx', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [
          { provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen/qwen3', num_ctx: 32768 },
        ],
        roles: { manager: { provider: 'openrouter' }, workers: { provider: 'openrouter' } },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/providers'), res);

    const body = res.json.mock.calls[0][0];
    const openrouter = body.providers.find((c: { name: string }) => c.name === 'openrouter');
    expect(openrouter.storedNumCtx).toBe(32768);
  });

  it.each([{}, { location: 'New place' }])('POST /settings replaces personal information with %j', async (personalInformation) => {
    const actual = await vi.importActual<typeof import('../../../src/config/settings-writer')>('../../../src/config/settings-writer');
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({ personal_information: { name: 'Old name', location: 'Old place' }, allowed_domains: ['example.com'] });
    settingsWriter.mergeSettingsPayload.mockImplementationOnce(actual.mergeSettingsPayload);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { personal_information: personalInformation };
    callRoute(router, req, res);
    expect(settingsWriter.writeSettingsFile).toHaveBeenCalledWith({ personal_information: personalInformation, allowed_domains: ['example.com'] });
  });

  it('POST /settings rejects a non-object body', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = 'nope';
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects an out-of-range web_port', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { web_port: 99999 };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('web_port')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects an unrecognised skills.mode', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { skills: { mode: 'nope' } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('skills.mode')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects a non-positive skills.limit', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { skills: { limit: 0 } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('skills.limit')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings accepts a skills mode patch', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { skills: { mode: 'manual' } };
    callRoute(router, req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(settingsWriter.writeSettingsFile).toHaveBeenCalled();
  });

  it('POST /settings rejects an unsupported AI provider', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { manager: { provider: 'anthropic' } } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('ai.manager.provider')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects the internal mock provider', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { manager: { provider: 'mock' } } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('reserved for internal testing')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects blanking the Telegram bot token while Telegram is enabled', () => {
    pluginSettingsRepo.getEnabled.mockImplementation((family: string, name: string) => family === 'channels' && name === 'telegram');
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { channels: { telegram: { bot_token: '' } } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('channels.telegram.bot_token')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings writes a valid patch and reports success', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { web_port: 4000 };
    callRoute(router, req, res);

    expect(settingsWriter.loadCurrentOrExampleSettings).toHaveBeenCalledTimes(1);
    expect(settingsWriter.mergeSettingsPayload).toHaveBeenCalledWith({}, { web_port: 4000 });
    expect(settingsWriter.writeSettingsFile).toHaveBeenCalledWith({ web_port: 4000 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('POST /settings translates a per-role provider patch into an ai.providers[] upsert, keeping prior providers', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
        ],
        roles: {
          manager: { provider: 'ollama' },
          workers: { provider: 'ollama' },
        },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = {
      ai: { manager: { provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', api_token: 'sk-1' } },
    };
    callRoute(router, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const [transformedCurrent] = settingsWriter.mergeSettingsPayload.mock.calls.at(-1) as [
      { ai: { providers: { provider: string; model?: string }[]; roles: Record<string, unknown> } },
      unknown,
    ];
    expect(transformedCurrent.ai.providers.map((p) => p.provider)).toEqual(['ollama', 'openai']);
    expect(transformedCurrent.ai.providers.find((p) => p.provider === 'openai')?.model).toBe('gpt-4o-mini');
    expect(transformedCurrent.ai.roles.manager).toEqual({ provider: 'openai' });
    expect(transformedCurrent.ai.roles.workers).toEqual({ provider: 'ollama' });
  });

  it('POST /settings with an ai.embed patch updates ai.embed without repointing any role', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
          { provider: 'openai', base_url: '', api_token: 'sk-1', model: 'gpt-4o-mini' },
        ],
        roles: { manager: { provider: 'openai' }, workers: { provider: 'openai' } },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { embed: { enabled: true, provider: 'ollama', model: 'nomic-embed-text' } } };
    callRoute(router, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const [transformedCurrent] = settingsWriter.mergeSettingsPayload.mock.calls.at(-1) as [
      { ai: { embed: Record<string, unknown>; roles: Record<string, unknown> } },
      unknown,
    ];
    expect(transformedCurrent.ai.embed).toEqual({ enabled: true, provider: 'ollama', model: 'nomic-embed-text' });
    expect(transformedCurrent.ai.roles).toEqual({ manager: { provider: 'openai' }, workers: { provider: 'openai' } });
  });

  it('POST /settings rejects an unsupported provider in an ai.embed patch', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { embed: { enabled: true, provider: 'anthropic', model: 'x' } } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('ai.embed.provider')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings with an ai.provider patch saves the provider without repointing any role', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', models: ['gemma'] },
        ],
        roles: {
          manager: { provider: 'ollama', model: 'gemma' },
          workers: { provider: 'ollama', model: 'gemma' },
        },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = {
      ai: { provider: { provider: 'nvidia', base_url: '', model: 'meta/llama-3.3-70b-instruct', api_token: 'nv-key' } },
    };
    callRoute(router, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const [transformedCurrent] = settingsWriter.mergeSettingsPayload.mock.calls.at(-1) as [
      { ai: { providers: { provider: string }[]; roles: Record<string, unknown> } },
      unknown,
    ];
    expect(transformedCurrent.ai.providers.map((p) => p.provider)).toEqual(['ollama', 'nvidia']);
    expect(transformedCurrent.ai.roles.manager).toEqual({ provider: 'ollama', model: 'gemma' });
    expect(transformedCurrent.ai.roles.workers).toEqual({ provider: 'ollama', model: 'gemma' });
  });

  it('POST /settings rejects an unsupported provider in an ai.provider save patch', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { provider: { provider: 'anthropic', model: 'claude' } } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('ai.provider.provider')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects an out-of-range num_ctx on a provider patch', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { manager: { provider: 'openrouter', model: 'qwen/qwen3', num_ctx: 10 } } };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining('ai.manager.num_ctx')]));
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings rejects manager+workers on one provider with conflicting num_ctx', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = {
      ai: {
        manager: { provider: 'openrouter', model: 'qwen/qwen3', num_ctx: 32768 },
        workers: { provider: 'openrouter', model: 'qwen/qwen3', num_ctx: 8192 },
      },
    };
    callRoute(router, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.details).toEqual(
      expect.arrayContaining([expect.stringContaining('num_ctx is shared')]),
    );
    expect(settingsWriter.writeSettingsFile).not.toHaveBeenCalled();
  });

  it('POST /settings allows manager+workers on one provider with matching num_ctx', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [{ provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen/qwen3' }],
        roles: { manager: { provider: 'openrouter' }, workers: { provider: 'openrouter' } },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = {
      ai: {
        manager: { provider: 'openrouter', model: 'qwen/qwen3', num_ctx: 16384 },
        workers: { provider: 'openrouter', model: 'qwen/qwen3', num_ctx: 16384 },
      },
    };
    callRoute(router, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('POST /settings upserts a valid num_ctx onto the provider entry', () => {
    settingsWriter.loadCurrentOrExampleSettings.mockReturnValueOnce({
      ai: {
        providers: [{ provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen/qwen3' }],
        roles: { manager: { provider: 'openrouter' }, workers: { provider: 'openrouter' } },
      },
    });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/settings');
    req.body = { ai: { manager: { provider: 'openrouter', model: 'qwen/qwen3', num_ctx: 32768 } } };
    callRoute(router, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const [transformedCurrent] = settingsWriter.mergeSettingsPayload.mock.calls.at(-1) as [
      { ai: { providers: { provider: string; num_ctx?: number }[] } },
      unknown,
    ];
    expect(transformedCurrent.ai.providers.find((p) => p.provider === 'openrouter')?.num_ctx).toBe(32768);
  });

  it('POST /ai/test-connection requires a provider and base_url', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/ai/test-connection'), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /ai/test-connection skips connectivity checks for the mock provider', async () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    const req = makeRequest('POST', '/ai/test-connection');
    req.body = { provider: 'mock', base_url: 'http://localhost:11434' };
    callRoute(router, req, res);

    await new Promise((resolve) => setImmediate(resolve));

    expect(res.json).toHaveBeenCalledWith({ ok: true, skipped: true });
  });

  it('POST /whatsapp/connect triggers a live connection attempt', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/whatsapp/connect'), res);

    expect(liveChannelRuntime.startChannelLive).toHaveBeenCalledWith('whatsapp', expect.anything(), expect.anything());
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('GET /health returns 200 when health status is ok and 500 when error', async () => {
    mockHealthCheck.mockResolvedValueOnce({ status: 'ok', timestamp: '2026-01-01' });
    const router = AdminRouterFactory.create(logger, {} as never, {} as never);
    let res = makeResponse();
    callRoute(router, makeRequest('GET', '/health'), res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }));

    mockHealthCheck.mockResolvedValueOnce({ status: 'error', timestamp: '2026-01-01', details: 'down' });
    res = makeResponse();
    callRoute(router, makeRequest('GET', '/health'), res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('POST /allowed-domains rejects invalid domains and adds valid domains', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never);

    let res = makeResponse();
    const reqInvalid = makeRequest('POST', '/allowed-domains');
    reqInvalid.body = { domain: '' };
    callRoute(router, reqInvalid, res);
    expect(res.status).toHaveBeenCalledWith(400);

    res = makeResponse();
    const reqValid = makeRequest('POST', '/allowed-domains');
    reqValid.body = { domain: 'https://new-api.example.com/path' };
    callRoute(router, reqValid, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, added: true }));
  });

  it('GET /chat/gate-blocks queries gate blocks for a given session', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never);
    auditRepo.findAll.mockReturnValueOnce([]);
    const res = makeResponse();
    const req = makeRequest('GET', '/chat/gate-blocks', { sessionId: 'sess-123' });
    callRoute(router, req, res);
    expect(res.json).toHaveBeenCalledWith({ blocks: [] });
  });
});

describe('AdminRouterFactory chat/context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /chat/context reports zero usage when the session is missing', () => {
    sessionRepo.findLatestOpen.mockReturnValue(undefined);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/chat/context'), res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.used).toBe(0);
    expect(typeof payload.limit).toBe('number');
    expect(typeof payload.threshold).toBe('number');
  });

  it('GET /chat/context targets an explicit sessionId and estimates its token use', () => {
    sessionRepo.findById.mockReturnValue({ id: 'sess-9', metadata: {} });
    messageRepo.getBySessionId.mockReturnValue([
      { id: 'm1', role: 'user', content: 'a longer message that carries some tokens' },
    ]);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/chat/context', { sessionId: 'sess-9' }), res);

    expect(sessionRepo.findById).toHaveBeenCalledWith('sess-9');
    expect(sessionRepo.findLatestOpen).not.toHaveBeenCalled();
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.used).toBeGreaterThan(0);
  });
});

describe('AdminRouterFactory /agents', () => {
  it('GET /agents returns the roster with the orchestrator as the only messageable root', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/agents'), res);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.items.map((a: { id: string }) => a.id)).toEqual(['orchestrator', 'negotiator', 'watcher']);
    expect(body.items.filter((a: { parentId: string | null }) => a.parentId === null)).toHaveLength(1);
    expect(body.items.filter((a: { messageable: boolean }) => a.messageable).map((a: { id: string }) => a.id)).toEqual([
      'orchestrator',
    ]);
  });
});

describe('AdminRouterFactory /sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelsManager.getExistingInstance.mockReturnValue(undefined);
  });

  it('GET /sessions lists sessions with channel/peerId/kind (not the old entryChannel shape)', () => {
    sessionRepo.count.mockReturnValue(1);
    sessionRepo.findAll.mockReturnValue([
      {
        id: 's1',
        channel: 'whatsapp',
        peerId: '5551234',
        kind: 'delegated',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: undefined,
        messageCount: 3,
        metadata: {},
      },
    ] as never);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/sessions'), res);

    expect(sessionRepo.findAll).toHaveBeenCalledWith(20, 0, undefined);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.items[0]).toMatchObject({ id: 's1', channel: 'whatsapp', peerId: '5551234', kind: 'delegated' });
    expect(body.items[0]).not.toHaveProperty('entryChannel');
  });

  it('GET /sessions?kind=user forwards the kind filter', () => {
    sessionRepo.count.mockReturnValue(0);
    sessionRepo.findAll.mockReturnValue([]);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/sessions', { kind: 'user' }), res);

    expect(sessionRepo.findAll).toHaveBeenCalledWith(20, 0, 'user');
    expect(sessionRepo.count).toHaveBeenCalledWith('user');
  });

  it('POST /sessions creates a web session and invalidates the manager cache for it', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/sessions'), res);

    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    expect(sessionManager.invalidateKey).toHaveBeenCalledWith({ channel: 'web', peerId: 'web', kind: 'user' });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('DELETE /sessions/:id deletes the row and invalidates the manager cache', () => {
    sessionRepo.findById.mockReturnValue({ id: 's1' });

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('DELETE', '/sessions/s1'), res);

    expect(sessionRepo.deleteById).toHaveBeenCalledWith('s1');
    expect(sessionManager.invalidate).toHaveBeenCalledWith('s1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('DELETE /sessions/:id returns 404 without touching the cache when the session is missing', () => {
    sessionRepo.findById.mockReturnValue(null);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('DELETE', '/sessions/missing'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sessionRepo.deleteById).not.toHaveBeenCalled();
    expect(sessionManager.invalidate).not.toHaveBeenCalled();
  });
});

describe('AdminRouterFactory /errands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelsManager.getExistingInstance.mockReturnValue(undefined);
  });

  // No channels manager is running in this test process (channelsManager.getExistingInstance
  // defaults to undefined), so every errand route must degrade to 503 rather than throw.
  it('GET /errands returns 503 when no channel manager is running', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/errands'), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('GET /errands/:id returns 503 when no channel manager is running', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/errands/e1'), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('POST /errands/:id/approve returns 503 when no channel manager is running', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('POST', '/errands/e1/approve'), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('POST /errands/:id/reply returns 503 when no channel manager is running', async () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    await router.handle(makeRequest('POST', '/errands/e1/reply', { answer: 'yes' }), res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('GET /errands/:id/transcript returns 503 when no channel manager is running', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/errands/e1/transcript'), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('/overview folds every non-terminal errand state into openErrands', async () => {
    errandRepo.countByState.mockImplementation((state: string) =>
      ({ draft: 1, queued: 2, open: 0, awaiting_peer: 3, awaiting_principal: 1 } as Record<string, number>)[state] ?? 0,
    );
    sessionRepo.count.mockReturnValue(0);
    sessionRepo.countOpen.mockReturnValue(0);
    messageRepo.count.mockReturnValue(0);
    memoryRepo.count.mockReturnValue(0);
    learnedSkillsRepo.count.mockReturnValue(0);
    skillsRepo.get.mockReturnValue([]);
    outboundRepo.count.mockReturnValue(0);
    auditRepo.count.mockReturnValue(0);
    auditRepo.findAll.mockReturnValue([]);
    auditRepo.usage.mockReturnValue([]);

    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    router.handle(makeRequest('GET', '/overview'), res, () => {});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.openErrands).toBe(7);
  });
});

describe('AdminRouterFactory heartbeats/channels/outbound reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /heartbeats serialises each beat with its next scheduled fire', () => {
    heartbeatRepo.getAll.mockReturnValue([
      {
        id: 'b1',
        beat: 'daily digest',
        type: 'prompt',
        cronExpression: '0 9 * * *',
        channel: 'telegram',
        target: '123',
        lastRun: new Date('2026-01-01T09:00:00.000Z'),
        createdAt: new Date('2025-12-01T00:00:00.000Z'),
      },
    ]);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/heartbeats'), res);

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: 'b1',
      beat: 'daily digest',
      cron_expression: '0 9 * * *',
      channel: 'telegram',
      target: '123',
      run_once: false,
    });
    expect(typeof payload.items[0].next_run).toBe('string');
  });

  it('GET /heartbeats/runs returns the latest runs with the tools each one called', () => {
    beatRunRepo.findRecent.mockReturnValue([{
      id: 'run-1', beatId: 'b1', beat: 'daily digest', beatType: 'scheduled_beat',
      status: 'success', result: 'Sunny', startedAt: new Date('2026-01-01T09:00:00.000Z'), finishedAt: new Date('2026-01-01T09:00:05.000Z'),
    }]);
    auditRepo.findAll.mockReturnValue([
      { tool_name: 'read_url', status: 'error' },
      { tool_name: 'search_engine', status: 'success' },
    ]);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/heartbeats/runs', { limit: '500' }), res);

    expect(beatRunRepo.findRecent).toHaveBeenCalledWith(100);
    expect(auditRepo.findAll).toHaveBeenCalledWith({ limit: 50, offset: 0, filters: { type: 'tool', runId: 'run-1' } });
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.items).toEqual([expect.objectContaining({
      id: 'run-1', beatId: 'b1', beat: 'daily digest', type: 'scheduled_beat', status: 'success',
      result: 'Sunny', errorMessage: null, startedAt: expect.any(String), finishedAt: expect.any(String),
      tools: [{ name: 'search_engine', status: 'success' }, { name: 'read_url', status: 'error' }],
    })]);
  });

    it('GET /channels returns the stored channel rows', () => {
    channelRepo.getAll.mockReturnValue([{ id: 'c1', type: 'telegram', principal: true }]);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/channels'), res);

    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'c1', type: 'telegram', principal: true }] });
  });

  it('PATCH /channels/:id/principal promotes an existing channel', () => {
    channelRepo.setPrincipal.mockReturnValue({ id: 'c1', principal: true });
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('PATCH', '/channels/c1/principal'), res);

    expect(channelRepo.setPrincipal).toHaveBeenCalledWith('c1');
    expect(res.json).toHaveBeenCalledWith({ id: 'c1', principal: true });
  });

  it('PATCH /channels/:id/principal is a 404 when the channel is unknown', () => {
    channelRepo.setPrincipal.mockReturnValue(undefined);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('PATCH', '/channels/missing/principal'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Channel not found' });
  });

  it('GET /outbound lists queued outbound messages', () => {
    outboundRepo.getAll.mockReturnValue([{ id: 'o1', status: 'pending' }]);
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);
    const res = makeResponse();
    callRoute(router, makeRequest('GET', '/outbound'), res);

    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 'o1', status: 'pending' }] });
  });

  it('POST /outbound validates inputs and reports 503 if no channel manager is running', async () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);

    // Missing content
    let req = makeRequest('POST', '/outbound');
    req.body = { content: '' };
    let res = makeResponse();
    await callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'content is required' });

    // Missing channel or target
    req = makeRequest('POST', '/outbound');
    req.body = { content: 'hello' };
    res = makeResponse();
    await callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'channel and target are required.' });

    // Invalid channel
    req = makeRequest('POST', '/outbound');
    req.body = { content: 'hello', channel: 'invalid', target: '123' };
    res = makeResponse();
    await callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Invalid channel') }));

    // Channel manager not running
    channelsManager.getExistingInstance.mockReturnValue(undefined);
    req = makeRequest('POST', '/outbound');
    req.body = { content: 'hello', channel: 'telegram', target: '123' };
    res = makeResponse();
    await callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('POST /heartbeats validates fields, intervals, and saves valid beats', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);

    // Missing beat
    let req = makeRequest('POST', '/heartbeats');
    req.body = { beat: '' };
    let res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Invalid cron
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: 'invalid cron' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Invalid type
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '0 9 * * *', type: 'unknown' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Invalid channel
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '0 9 * * *', channel: 'bad' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Channel without target
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '0 9 * * *', channel: 'telegram' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Every minute disallowed
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '* * * * *' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Beats that run every minute are not allowed.' });

    // Specific hour required
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '*/1 * * * *' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Valid heartbeat
    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'Daily check', cronExpression: '0 9 * * *', type: 'reminder' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(heartbeatRepo.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST /heartbeats accepts one-time beats only with a pinned date', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);

    let req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '0 9 * * *', runOnce: 'yes' };
    let res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'runOnce must be a boolean.' });

    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'check', cronExpression: '0 9 * * *', runOnce: true };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('one-time beat needs a pinned date') });
    expect(heartbeatRepo.save).not.toHaveBeenCalled();

    req = makeRequest('POST', '/heartbeats');
    req.body = { beat: 'call mom', cronExpression: '30 9 15 6 *', runOnce: true };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(heartbeatRepo.save).toHaveBeenCalledWith(expect.objectContaining({ runOnce: true }));
  });

  it('PATCH and DELETE /heartbeats/:id handle not-found and valid updates', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);

    // PATCH not found
    heartbeatRepo.getById.mockReturnValueOnce(null);
    let req = makeRequest('PATCH', '/heartbeats/missing');
    req.params = { id: 'missing' };
    let res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(404);

    // PATCH invalid cron
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1' });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { cronExpression: 'bad' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // PATCH invalid type
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1' });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { type: 'bad_type' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // PATCH invalid channel
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1' });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { channel: 'unknown_chan' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // PATCH channel without target
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1' });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { channel: 'telegram' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // PATCH valid
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1' });
    heartbeatRepo.update.mockReturnValueOnce({ id: 'b1', beat: 'Updated' });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { beat: 'Updated', cronExpression: '0 10 * * *' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(heartbeatRepo.update).toHaveBeenCalledWith('b1', expect.objectContaining({ beat: 'Updated' }));
    expect(res.json).toHaveBeenCalledWith({ id: 'b1', beat: 'Updated' });

    // PATCH a one-time beat to a repeating cron
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1', cronExpression: '30 9 15 6 *', runOnce: true });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { cronExpression: '0 10 * * *' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('one-time beat needs a pinned date') });

    // PATCH a one-time beat into a recurring one
    heartbeatRepo.getById.mockReturnValueOnce({ id: 'b1', cronExpression: '30 9 15 6 *', runOnce: true });
    heartbeatRepo.update.mockReturnValueOnce({ id: 'b1', runOnce: false });
    req = makeRequest('PATCH', '/heartbeats/b1');
    req.params = { id: 'b1' };
    req.body = { cronExpression: '0 10 * * *', runOnce: false };
    res = makeResponse();
    callRoute(router, req, res);
    expect(heartbeatRepo.update).toHaveBeenLastCalledWith('b1', expect.objectContaining({ cronExpression: '0 10 * * *', runOnce: false }));

    // DELETE not found
    heartbeatRepo.deleteById.mockReturnValueOnce(false);
    req = makeRequest('DELETE', '/heartbeats/missing');
    req.params = { id: 'missing' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.status).toHaveBeenCalledWith(404);

    // DELETE success
    heartbeatRepo.deleteById.mockReturnValueOnce(true);
    req = makeRequest('DELETE', '/heartbeats/b1');
    req.params = { id: 'b1' };
    res = makeResponse();
    callRoute(router, req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST /skills/sync triggers sync or returns 503 when not initialized', () => {
    const router = AdminRouterFactory.create(logger, {} as never, {} as never, sessionManager as never);

    skillSync.getExistingInstance.mockReturnValueOnce(null);
    let res = makeResponse();
    callRoute(router, makeRequest('POST', '/skills/sync'), res);
    expect(res.status).toHaveBeenCalledWith(503);

    const mockSync = { sync: vi.fn() };
    skillSync.getExistingInstance.mockReturnValueOnce(mockSync);
    res = makeResponse();
    callRoute(router, makeRequest('POST', '/skills/sync'), res);
    expect(mockSync.sync).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

