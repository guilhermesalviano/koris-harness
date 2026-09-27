import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listBeats, create } from './index';
import type { HeartbeatRecord, IHeartbeatGateway, ILogger, ToolDefinition, ToolPluginContext } from '../contracts';
import type { PluginRegistry } from '../../registry';

const logger: ILogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

function makeGateway(overrides: Partial<IHeartbeatGateway> = {}): IHeartbeatGateway {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    deleteById: vi.fn(),
    reschedule: vi.fn(),
    ...overrides,
  };
}

describe('listBeats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success with empty list', async () => {
    const gateway = makeGateway({ getAll: vi.fn().mockReturnValue([]) });
    const result = await listBeats(logger, {}, gateway);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result!)).toEqual([]);
  });

  it('returns all beats as JSON', async () => {
    const beats = [
      { id: '1', beat: 'beat 1', type: 'reminder', cronExpression: '0 9 * * *' },
      { id: '2', beat: 'beat 2', type: 'scheduled_beat', cronExpression: '0 10 * * 1' },
    ] as HeartbeatRecord[];
    const gateway = makeGateway({ getAll: vi.fn().mockReturnValue(beats) });
    const result = await listBeats(logger, {}, gateway);
    expect(result.success).toBe(true);
    expect(JSON.parse(result.result!)).toEqual(beats);
  });

  it('toolName is list_beats', async () => {
    const gateway = makeGateway();
    const result = await listBeats(logger, {}, gateway);
    expect(result.toolName).toBe('list_beats');
  });

  it('returns error when gateway throws', async () => {
    const gateway = makeGateway({ getAll: vi.fn(() => { throw new Error('db fail'); }) });
    const result = await listBeats(logger, {}, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toBe('db fail');
    expect(result.toolName).toBe('list_beats');
  });
});

describe('create', () => {
  function register(isEnabled: () => boolean): ToolDefinition {
    const context = { pluginEnablement: { isEnabled } } as unknown as ToolPluginContext;
    let registered: ToolDefinition | undefined;
    const fakeRegistry = {
      extend: vi.fn((_point, value: ToolDefinition) => { registered = value; }),
    } as unknown as PluginRegistry;
    create(context).setup(fakeRegistry);
    return registered!;
  }

  it('is disabled when the plugin is administratively disabled, even when trusted', () => {
    const definition = register(() => false);
    expect(definition.enabled({ trusted: true })).toBe(false);
  });

  it('is enabled when trusted, not the heartbeat agent, and the plugin is enabled', () => {
    const definition = register(() => true);
    expect(definition.enabled({ trusted: true })).toBe(true);
  });
});
