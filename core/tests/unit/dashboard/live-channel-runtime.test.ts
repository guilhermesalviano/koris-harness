import { beforeEach, describe, expect, it, vi } from 'vitest';

const listLiveChannelsMock = vi.fn();
vi.mock('../../../../plugins/channels', () => ({
  listLiveChannels: (...args: unknown[]) => listLiveChannelsMock(...args),
}));

import {
  isChannelLiveStarted,
  liveChannelNames,
  loadChannelConfig,
  reprimeChannelRuntime,
  reprimeLiveChannelDescriptors,
  startChannelLive,
  writeChannelConfigPatch,
} from '../../../src/dashboard/live-channel-runtime';
import type { LiveChannelDescriptor } from '../../../../plugins/channels/contracts';

describe('live-channel-runtime', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const gateway = { handle: vi.fn() } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    reprimeLiveChannelDescriptors();
  });

  function makeDescriptor(name: string, overrides: Partial<LiveChannelDescriptor> = {}): LiveChannelDescriptor {
    return {
      name,
      start: vi.fn(async () => ({ stop: vi.fn() })),
      configureRuntime: vi.fn(),
      loadConfig: vi.fn(() => ({ token: 'secret' })),
      writeConfigPatch: vi.fn(),
      ...overrides,
    };
  }

  it('lists channel names discovered through listLiveChannels', () => {
    listLiveChannelsMock.mockReturnValue([makeDescriptor('telegram'), makeDescriptor('whatsapp')]);
    expect(liveChannelNames()).toEqual(['telegram', 'whatsapp']);
  });

  it('caches descriptors and refreshes on reprimeLiveChannelDescriptors', () => {
    listLiveChannelsMock.mockReturnValue([makeDescriptor('telegram')]);
    expect(liveChannelNames()).toEqual(['telegram']);
    expect(listLiveChannelsMock).toHaveBeenCalledTimes(1);

    // Cached call
    expect(liveChannelNames()).toEqual(['telegram']);
    expect(listLiveChannelsMock).toHaveBeenCalledTimes(1);

    // After reprime, rescans
    reprimeLiveChannelDescriptors();
    listLiveChannelsMock.mockReturnValue([makeDescriptor('telegram'), makeDescriptor('discord')]);
    expect(liveChannelNames()).toEqual(['telegram', 'discord']);
    expect(listLiveChannelsMock).toHaveBeenCalledTimes(2);
  });

  it('no-ops when starting a non-existent channel descriptor', () => {
    listLiveChannelsMock.mockReturnValue([]);
    startChannelLive('missing', logger as never, gateway);
    expect(isChannelLiveStarted('missing')).toBe(false);
  });

  it('starts channel live and tracks running state', async () => {
    const stopFn = vi.fn();
    const descriptor = makeDescriptor('telegram', {
      start: vi.fn(async () => ({ stop: stopFn })),
    });
    listLiveChannelsMock.mockReturnValue([descriptor]);

    expect(isChannelLiveStarted('telegram')).toBe(false);
    startChannelLive('telegram', logger as never, gateway);

    // Wait for the start promise microtask
    await vi.waitFor(() => expect(isChannelLiveStarted('telegram')).toBe(true));
    expect(descriptor.start).toHaveBeenCalledTimes(1);

    // Calling again while already started no-ops
    startChannelLive('telegram', logger as never, gateway);
    expect(descriptor.start).toHaveBeenCalledTimes(1);
  });

  it('handles and logs start errors gracefully', async () => {
    const descriptor = makeDescriptor('broken', {
      start: vi.fn(async () => {
        throw new Error('Connection refused');
      }),
    });
    listLiveChannelsMock.mockReturnValue([descriptor]);

    startChannelLive('broken', logger as never, gateway);

    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('Failed to start broken live: Connection refused'));
    expect(isChannelLiveStarted('broken')).toBe(false);
  });

  it('reprimes channel runtime state', () => {
    const descriptor = makeDescriptor('telegram');
    listLiveChannelsMock.mockReturnValue([descriptor]);

    reprimeChannelRuntime('telegram');
    expect(descriptor.configureRuntime).toHaveBeenCalledTimes(1);

    // Unknown channel safely no-ops
    reprimeChannelRuntime('unknown');
  });

  it('loads channel config and safely returns undefined for unknown channel', () => {
    const descriptor = makeDescriptor('telegram', {
      loadConfig: vi.fn(() => ({ bot_token: '123' })),
    });
    listLiveChannelsMock.mockReturnValue([descriptor]);

    expect(loadChannelConfig('telegram')).toEqual({ bot_token: '123' });
    expect(loadChannelConfig('unknown')).toBeUndefined();
  });

  it('writes config patch and safely ignores unknown channels', () => {
    const descriptor = makeDescriptor('telegram');
    listLiveChannelsMock.mockReturnValue([descriptor]);

    writeChannelConfigPatch('telegram', { bot_token: 'new' });
    expect(descriptor.writeConfigPatch).toHaveBeenCalledWith({ bot_token: 'new' });

    writeChannelConfigPatch('unknown', { foo: 'bar' });
  });
});
