import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setBeat, create } from './index';
import type { HeartbeatRecord, IHeartbeatGateway, ILogger, ToolDefinition, ToolPluginContext } from '../contracts';
import type { PluginRegistry } from '../../registry';

const logger: ILogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

function makeGateway(overrides: Partial<IHeartbeatGateway> = {}): IHeartbeatGateway {
  return {
    create: vi.fn((input) => ({
      id: 'hb-1',
      beat: input.beat,
      type: input.type,
      cronExpression: input.cronExpression,
      channel: input.channel,
      target: input.target,
      createdAt: new Date(),
    } as HeartbeatRecord)),
    getById: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    reschedule: vi.fn(),
    ...overrides,
  };
}

describe('setBeat', () => {
  let gateway: IHeartbeatGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = makeGateway();
  });

  it('returns error when beat is missing', async () => {
    const result = await setBeat(logger, { cron_expression: '0 9 * * *' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('beat');
  });

  it('returns error when cron_expression is missing', async () => {
    const result = await setBeat(logger, { beat: 'do something' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cron_expression');
  });

  it('returns error for invalid type', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: '0 9 * * *', type: 'invalid_type' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameter: type');
  });

  it('returns error for invalid cron expression', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: 'bad cron' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid cron expression');
  });

  it('returns error when wildcard minutes are used without a specific hour', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: '* * * * *' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('allows hourly schedules without a specific hour', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: '0 * * * *', recurring: true }, gateway);
    expect(result.success).toBe(true);
  });

  it('do not allow every-minute schedules when an hour is provided', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: '* 9 * * *' }, gateway);
    expect(result.success).toBe(false);
  });

  it('saves the beat and returns success for valid input', async () => {
    const result = await setBeat(logger, { beat: 'send report', cron_expression: '0 9 * * 1', recurring: true }, gateway);
    expect(result.success).toBe(true);
    expect(result.toolName).toBe('set_beat');
    expect(gateway.create).toHaveBeenCalledTimes(1);
    expect(gateway.reschedule).toHaveBeenCalledTimes(1);
  });

  it('returns success with scheduled_beat type', async () => {
    const result = await setBeat(logger, { beat: 'sync data', cron_expression: '0 2 * * *', type: 'scheduled_beat', recurring: true }, gateway);
    expect(result.success).toBe(true);
  });

  it('result contains the saved heartbeat as JSON', async () => {
    const result = await setBeat(logger, { beat: 'ping', cron_expression: '30 9 15 6 *' }, gateway);
    const parsed = JSON.parse(result.result!);
    expect(parsed.beat).toBe('ping');
    expect(parsed.cronExpression).toBe('30 9 15 6 *');
  });

  it('returns error for invalid channel', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: '0 9 * * *', channel: 'slack', target: 'x' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameter: channel');
  });

  it('returns error when only one of channel or target is provided', async () => {
    const result = await setBeat(logger, { beat: 'do', cron_expression: '0 9 * * *', channel: 'telegram' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('together');
  });

  it('saves the beat with channel and target', async () => {
    const result = await setBeat(logger, {
      beat: 'send report',
      cron_expression: '0 9 * * 1',
      recurring: true,
      channel: 'whatsapp',
      target: '5511@s.whatsapp.net',
    }, gateway);
    expect(result.success).toBe(true);
    const saved = (gateway.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.channel).toBe('whatsapp');
    expect(saved.target).toBe('5511@s.whatsapp.net');
  });

  it('returns error when gateway.create throws', async () => {
    gateway = makeGateway({ create: vi.fn(() => { throw new Error('db fail'); }) });
    const result = await setBeat(logger, { beat: 'x', cron_expression: '0 9 15 6 *' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toBe('db fail');
  });

  it('creates a one-time beat by default when the cron pins an exact date', async () => {
    const result = await setBeat(logger, { beat: 'call mom', cron_expression: '30 9 15 6 *' }, gateway);
    expect(result.success).toBe(true);
    const saved = (gateway.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.runOnce).toBe(true);
  });

  it.each(['0 9 * * *', '0 9 * * 1', '0 8 1 * *', '0 9 15 6 1', '0 9 1,15 6 *', '0 9 31 2 *'])(
    'rejects "%s" for a one-time beat and points to recurring: true',
    async (cron) => {
      const result = await setBeat(logger, { beat: 'do', cron_expression: cron }, gateway);
      expect(result.success).toBe(false);
      expect(result.error).toContain('recurring: true');
      expect(gateway.create).not.toHaveBeenCalled();
    },
  );

  it.each(['0 9 * * *', '0 9 * * 1', '0 8 1 * *', '0 9 25 12 *'])(
    'saves "%s" as a recurring beat when recurring is true',
    async (cron) => {
      const result = await setBeat(logger, { beat: 'do', cron_expression: cron, recurring: true }, gateway);
      expect(result.success).toBe(true);
      const saved = (gateway.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saved.runOnce).toBe(false);
    },
  );
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

  it('description routes reminder requests here and says external todo tools do not notify', () => {
    const definition = register(() => true);
    expect(definition.schema.description).toMatch(/remind/i);
    expect(definition.schema.description).toContain('do NOT notify the user');
  });
});
