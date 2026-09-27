import { describe, it, expect, vi } from 'vitest';
import { ChannelService } from '../../../src/services/channel-service';
import { Channel } from '../../../src/entities/channel';
import { Heartbeat } from '../../../src/entities/heartbeat';

function makeChannel(overrides: Partial<ConstructorParameters<typeof Channel>[0]> = {}): Channel {
  return new Channel({
    channel: 'telegram',
    target: '987654321',
    isPrincipal: false,
    ...overrides,
  });
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    upsert: vi.fn(),
    setPrincipal: vi.fn().mockReturnValue(overrides.setPrincipal ?? null),
    getPrincipal: vi.fn().mockReturnValue(overrides.principal ?? null),
    getByChannel: vi.fn().mockReturnValue(overrides.byChannel ?? []),
    getAll: vi.fn().mockReturnValue(overrides.all ?? []),
  };
}

function makeBeat(overrides: { channel?: string; target?: string } = {}): Heartbeat {
  return new Heartbeat({
    id: 'h1',
    beat: 'status',
    type: 'reminder',
    cronExpression: '0 9 * * *',
    ...overrides,
  });
}

describe('ChannelService', () => {
  it('record upserts the channel and target', () => {
    const repo = makeRepo();
    const service = new ChannelService(repo as never);

    service.record('telegram', '987654321');

    expect(repo.upsert).toHaveBeenCalledWith('telegram', '987654321');
  });

  it('record ignores non-telegram/whatsapp channels', () => {
    const repo = makeRepo();
    const service = new ChannelService(repo as never);

    service.record('web', 'origin-1');

    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('record ignores empty targets', () => {
    const repo = makeRepo();
    const service = new ChannelService(repo as never);

    service.record('telegram', '');

    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('getPrincipal returns the principal channel from the repository', () => {
    const principal = makeChannel({ isPrincipal: true });
    const repo = makeRepo({ principal });
    const service = new ChannelService(repo as never);

    expect(service.getPrincipal()).toBe(principal);
  });

  it('getAll returns every recorded channel', () => {
    const channels = [makeChannel(), makeChannel({ channel: 'whatsapp', target: '5511@s.whatsapp.net' })];
    const repo = makeRepo({ all: channels });
    const service = new ChannelService(repo as never);

    expect(service.getAll()).toEqual(channels);
  });

  it('getByChannel returns the channels for one channel type from the repository', () => {
    const whatsapp = makeChannel({ channel: 'whatsapp', target: '5511@s.whatsapp.net' });
    const repo = makeRepo({ byChannel: [whatsapp] });
    const service = new ChannelService(repo as never);

    expect(service.getByChannel('whatsapp')).toEqual([whatsapp]);
    expect(repo.getByChannel).toHaveBeenCalledWith('whatsapp');
  });

  it('setPrincipal delegates to the repository', () => {
    const principal = makeChannel({ channel: 'whatsapp', target: '5511@s.whatsapp.net', isPrincipal: true });
    const repo = makeRepo({ setPrincipal: principal });
    const service = new ChannelService(repo as never);

    expect(service.setPrincipal('c1')).toBe(principal);
    expect(repo.setPrincipal).toHaveBeenCalledWith('c1');
  });

  it('resolveDelivery uses the beat channel and target when specified', () => {
    const repo = makeRepo();
    const service = new ChannelService(repo as never);
    const beat = makeBeat({ channel: 'whatsapp', target: '5511@s.whatsapp.net' });

    expect(service.resolveDelivery(beat)).toEqual({
      channel: 'whatsapp',
      target: '5511@s.whatsapp.net',
    });
    expect(repo.getByChannel).not.toHaveBeenCalled();
  });

  it('resolveDelivery falls back to the first recorded target when the beat has no target', () => {
    const repo = makeRepo({
      byChannel: [makeChannel({ channel: 'whatsapp', target: '5511@s.whatsapp.net' })],
    });
    const service = new ChannelService(repo as never);
    const beat = makeBeat({ channel: 'whatsapp' });

    expect(service.resolveDelivery(beat)).toEqual({
      channel: 'whatsapp',
      target: '5511@s.whatsapp.net',
    });
    expect(repo.getByChannel).toHaveBeenCalledWith('whatsapp');
  });

  it('resolveDelivery returns null when the beat channel has no recorded target', () => {
    const repo = makeRepo({ byChannel: [] });
    const service = new ChannelService(repo as never);
    const beat = makeBeat({ channel: 'whatsapp' });

    expect(service.resolveDelivery(beat)).toBeNull();
  });

  it('resolveDelivery returns null for an invalid beat channel', () => {
    const repo = makeRepo();
    const service = new ChannelService(repo as never);
    const beat = makeBeat({ channel: 'slack' });

    expect(service.resolveDelivery(beat)).toBeNull();
  });

  it('resolveDelivery falls back to the principal channel when the beat has no channel', () => {
    const principal = makeChannel({ channel: 'telegram', target: '111', isPrincipal: true });
    const repo = makeRepo({ principal });
    const service = new ChannelService(repo as never);

    expect(service.resolveDelivery(makeBeat())).toEqual({ channel: 'telegram', target: '111' });
  });

  it('resolveDelivery returns null when no principal is recorded', () => {
    const repo = makeRepo();
    const service = new ChannelService(repo as never);

    expect(service.resolveDelivery(makeBeat())).toBeNull();
    expect(service.resolveDelivery()).toBeNull();
  });
});
