import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateBeat, create } from './index';
import type { HeartbeatRecord, IHeartbeatGateway, ILogger, ToolDefinition, ToolPluginContext } from '../contracts';
import type { PluginRegistry } from '../../registry';

const logger: ILogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
const existingBeat = { id: 'hb-1', beat: 'old beat', type: 'reminder', cronExpression: '0 8 * * *' } as HeartbeatRecord;

function makeGateway(overrides: Partial<IHeartbeatGateway> = {}): IHeartbeatGateway {
  return {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(existingBeat),
    getAll: vi.fn().mockReturnValue([]),
    update: vi.fn().mockReturnValue({ ...existingBeat }),
    deleteById: vi.fn(),
    reschedule: vi.fn(),
    ...overrides,
  };
}

describe('updateBeat', () => {
  let gateway: IHeartbeatGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = makeGateway();
  });

  it('returns error when id is missing', async () => {
    const result = await updateBeat(logger, {}, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('id');
  });

  it('returns error when no update fields are provided', async () => {
    const result = await updateBeat(logger, { id: 'hb-1' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('At least one');
  });

  it('returns error for invalid type', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', type: 'bad_type' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid type');
  });

  it('returns error for invalid cron expression', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', cron_expression: 'bad cron' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid cron expression');
  });

  it('returns error when wildcard minutes are used without a specific hour', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '* * * * *' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('allows hourly schedules without a specific hour', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '0 * * * *' }, gateway);
    expect(result.success).toBe(true);
  });

  it('do not allows every-minute schedules', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '* 9 * * *' }, gateway);
    expect(result.success).toBe(false);
  });

  it('returns error when beat not found', async () => {
    gateway = makeGateway({ getById: vi.fn().mockReturnValue(null) });
    const result = await updateBeat(logger, { id: 'hb-1', beat: 'new beat' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns success when updating beat field', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', beat: 'new beat' }, gateway);
    expect(result.success).toBe(true);
    expect(result.toolName).toBe('update_beat');
    expect(gateway.update).toHaveBeenCalledTimes(1);
    expect(gateway.reschedule).toHaveBeenCalledTimes(1);
  });

  it('returns success when updating cron_expression', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '0 10 * * *' }, gateway);
    expect(result.success).toBe(true);
  });

  it('returns success when updating type', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', type: 'scheduled_beat' }, gateway);
    expect(result.success).toBe(true);
  });

  it('returns error for invalid channel', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', channel: 'slack', target: 'x' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid channel');
  });

  it('returns error when only one of channel or target is provided', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', channel: 'telegram' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('together');
  });

  it('returns success when updating channel and target', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', channel: 'whatsapp', target: '5511@s.whatsapp.net' }, gateway);
    expect(result.success).toBe(true);
    expect(gateway.update).toHaveBeenCalledWith(
      'hb-1',
      expect.objectContaining({ channel: 'whatsapp', target: '5511@s.whatsapp.net' }),
    );
  });

  it('returns error when gateway throws', async () => {
    gateway = makeGateway({ getById: vi.fn(() => { throw new Error('db fail'); }) });
    const result = await updateBeat(logger, { id: 'hb-1', beat: 'x' }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toBe('db fail');
  });

  describe('one-time beats', () => {
    const oneTimeBeat = { ...existingBeat, cronExpression: '30 9 15 6 *', runOnce: true } as HeartbeatRecord;

    beforeEach(() => {
      gateway = makeGateway({ getById: vi.fn().mockReturnValue(oneTimeBeat) });
    });

    it('moves a one-time beat to another pinned date and keeps it one-time', async () => {
      const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '0 10 20 6 *' }, gateway);
      expect(result.success).toBe(true);
      expect(gateway.update).toHaveBeenCalledWith('hb-1', expect.objectContaining({ cronExpression: '0 10 20 6 *', runOnce: undefined }));
    });

    it('rejects a repeating cron on a one-time beat and points to recurring: true', async () => {
      const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '0 10 * * *' }, gateway);
      expect(result.success).toBe(false);
      expect(result.error).toContain('recurring: true');
      expect(gateway.update).not.toHaveBeenCalled();
    });

    it('turns a one-time beat into a recurring one', async () => {
      const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '0 10 * * *', recurring: true }, gateway);
      expect(result.success).toBe(true);
      expect(gateway.update).toHaveBeenCalledWith('hb-1', expect.objectContaining({ runOnce: false }));
    });
  });

  it('rejects turning a repeating beat into a one-time one without a pinned date', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', recurring: false }, gateway);
    expect(result.success).toBe(false);
    expect(result.error).toContain('one-time');
  });

  it('turns a recurring beat into a one-time one with a pinned date', async () => {
    const result = await updateBeat(logger, { id: 'hb-1', cron_expression: '30 9 15 6 *', recurring: false }, gateway);
    expect(result.success).toBe(true);
    expect(gateway.update).toHaveBeenCalledWith('hb-1', expect.objectContaining({ runOnce: true }));
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
