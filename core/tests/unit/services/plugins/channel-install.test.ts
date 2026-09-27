import { describe, it, expect, vi, beforeEach } from 'vitest';

const reprimeLiveChannelDescriptorsMock = vi.fn();
vi.mock('../../../../src/dashboard/live-channel-runtime', () => ({
  reprimeLiveChannelDescriptors: () => reprimeLiveChannelDescriptorsMock(),
}));

const stopChannelMock = vi.fn();
const getExistingInstanceMock = vi.fn<() => { stopChannel: typeof stopChannelMock } | undefined>();
vi.mock('../../../../src/channels', () => ({
  ChannelsSingleton: { getExistingInstance: () => getExistingInstanceMock() },
}));

import { registerPulledChannel } from '../../../../src/services/plugins/channel-install';
import { PluginCatalogSingleton } from '../../../../src/services/plugins/plugin-catalog-singleton';

function makeRepo() {
  return { getEnabled: vi.fn(), setEnabled: vi.fn(), getAll: vi.fn(() => []) };
}

describe('registerPulledChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExistingInstanceMock.mockReturnValue({ stopChannel: stopChannelMock });
  });

  it('writes enabled=false rather than leaving the row absent', () => {
    const repo = makeRepo();

    registerPulledChannel('whatsapp', repo);

    expect(repo.setEnabled).toHaveBeenCalledWith('channels', 'whatsapp', false);
  });

  it('overrides a stale enabled=1 row left by a previous install', () => {
    const repo = makeRepo();
    repo.getEnabled.mockReturnValue(true);

    registerPulledChannel('whatsapp', repo);

    // The whole point: "no row means off" is not enough — a re-pull of a
    // channel that was enabled before must still land inactive.
    expect(repo.setEnabled).toHaveBeenCalledWith('channels', 'whatsapp', false);
    expect(repo.setEnabled).toHaveBeenCalledTimes(1);
  });

  it('makes the channel discoverable and visible to the admin plugin list', () => {
    registerPulledChannel('signal', makeRepo());

    expect(reprimeLiveChannelDescriptorsMock).toHaveBeenCalled();
    expect(PluginCatalogSingleton.getExistingInstance()).toContainEqual({
      family: 'channels',
      name: 'signal',
    });
  });

  it('stops a still-running instance of the bundle it replaced', () => {
    registerPulledChannel('whatsapp', makeRepo());

    expect(stopChannelMock).toHaveBeenCalledWith('whatsapp');
  });

  it('is safe before any channel manager exists (pull during boot)', () => {
    getExistingInstanceMock.mockReturnValue(undefined);
    const repo = makeRepo();

    expect(() => registerPulledChannel('whatsapp', repo)).not.toThrow();
    expect(repo.setEnabled).toHaveBeenCalledWith('channels', 'whatsapp', false);
  });
});
