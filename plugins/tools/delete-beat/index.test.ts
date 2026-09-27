import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteBeat, create } from './index';
import type { IHeartbeatGateway, ILogger, ToolDefinition, ToolPluginContext } from '../contracts';
import type { PluginRegistry } from '../../registry';

const logger: ILogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

function makeGateway(overrides: Partial<IHeartbeatGateway> = {}): IHeartbeatGateway {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    reschedule: vi.fn(),
    ...overrides,
  };
}

describe('deleteBeat', () => {
  let gateway: IHeartbeatGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = makeGateway();
  });

  it('returns error when id is missing', async () => {
    const result = await deleteBeat(logger, {}, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('id');
  });

  it('returns error when beat is not found', async () => {
    gateway = makeGateway({ deleteById: vi.fn().mockReturnValue(false) });
    const result = await deleteBeat(logger, { id: 'no-such-id' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns success when beat is deleted', async () => {
    gateway = makeGateway({ deleteById: vi.fn().mockReturnValue(true) });
    const result = await deleteBeat(logger, { id: 'hb-1' }, gateway);
    expect(result.success).toBe(true);
    expect(result.toolName).toBe('delete_beat');
    expect(gateway.reschedule).toHaveBeenCalledTimes(1);
  });

  it('result contains the deleted id', async () => {
    gateway = makeGateway({ deleteById: vi.fn().mockReturnValue(true) });
    const result = await deleteBeat(logger, { id: 'hb-1' }, gateway);
    const parsed = JSON.parse(result.result!);
    expect(parsed.deleted_id).toBe('hb-1');
  });

  it('calls gateway.deleteById with the provided id', async () => {
    gateway = makeGateway({ deleteById: vi.fn().mockReturnValue(true) });
    await deleteBeat(logger, { id: 'hb-42' }, gateway);
    expect(gateway.deleteById).toHaveBeenCalledWith('hb-42');
  });

  it('returns error when gateway throws', async () => {
    gateway = makeGateway({ deleteById: vi.fn(() => { throw new Error('db fail'); }) });
    const result = await deleteBeat(logger, { id: 'hb-1' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toBe('db fail');
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
