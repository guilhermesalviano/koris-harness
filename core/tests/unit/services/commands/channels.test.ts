import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../../../../src/config';

const getEnabledMock = vi.fn();
const setEnabledMock = vi.fn();
vi.mock('../../../../src/repositories/plugin-settings', () => ({
  PluginSettingsRepositoryFactory: {
    create: vi.fn(() => ({
      getEnabled: getEnabledMock,
      setEnabled: setEnabledMock,
    })),
  },
}));

vi.mock('../../../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: {
    create: vi.fn(() => ({})),
  },
}));

const isChannelLiveStartedMock = vi.fn();
const reprimeLiveChannelDescriptorsMock = vi.fn();
const loadChannelConfigMock = vi.fn();
const writeChannelConfigPatchMock = vi.fn();
const reprimeChannelRuntimeMock = vi.fn();
const startChannelLiveMock = vi.fn();
vi.mock('../../../../src/dashboard/live-channel-runtime', () => ({
  isChannelLiveStarted: (...args: unknown[]) => isChannelLiveStartedMock(...args),
  reprimeLiveChannelDescriptors: () => reprimeLiveChannelDescriptorsMock(),
  loadChannelConfig: (...args: unknown[]) => loadChannelConfigMock(...args),
  writeChannelConfigPatch: (...args: unknown[]) => writeChannelConfigPatchMock(...args),
  reprimeChannelRuntime: (...args: unknown[]) => reprimeChannelRuntimeMock(...args),
  startChannelLive: (...args: unknown[]) => startChannelLiveMock(...args),
}));

const appendMock = vi.fn();
vi.mock('../../../../src/services/plugins/plugin-catalog-singleton', () => ({
  PluginCatalogSingleton: {
    append: (...args: unknown[]) => appendMock(...args),
  },
}));

const stopChannelMock = vi.fn();
const runtimeDeps = { logger: { warn: vi.fn() }, gateway: {} };
const channelsInstance: { stopChannel: typeof stopChannelMock; runtimeDeps: typeof runtimeDeps } | null = {
  stopChannel: stopChannelMock,
  runtimeDeps,
};
vi.mock('../../../../src/channels', () => ({
  ChannelsSingleton: {
    getExistingInstance: vi.fn(() => channelsInstance),
  },
}));

const listMissingMock = vi.fn();
const pullEntryMock = vi.fn();
const fetchChannelCatalogMock = vi.fn();
vi.mock('../../../../../scripts/hub-sync', () => ({
  listMissing: (...args: unknown[]) => listMissingMock(...args),
  pullEntry: (...args: unknown[]) => pullEntryMock(...args),
  fetchChannelCatalog: (...args: unknown[]) => fetchChannelCatalogMock(...args),
}));

const readdirSyncMock = vi.fn();
const existsSyncMock = vi.fn();
vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

import { listChannels, handleChannelsCommand } from '../../../../src/services/commands/channels';

describe('channels command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listChannels', () => {
    it('returns empty array when channels directory does not exist', () => {
      existsSyncMock.mockReturnValue(false);
      expect(listChannels()).toEqual([]);
    });

    it('returns channels with enabled and running state', () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([
        { name: 'telegram', isDirectory: () => true },
        { name: 'whatsapp', isDirectory: () => true },
        { name: '.gitkeep', isDirectory: () => false },
      ]);

      getEnabledMock.mockImplementation((family, name) => name === 'telegram');
      isChannelLiveStartedMock.mockImplementation((name) => name === 'telegram');

      const channels = listChannels();
      expect(channels).toEqual([
        { name: 'telegram', enabled: true, running: true },
        { name: 'whatsapp', enabled: false, running: false },
      ]);
    });
  });

  describe('handleChannelsCommand', () => {
    it('rejects untrusted senders', async () => {
      const result = await handleChannelsCommand('/channels', { source: 'tui', trusted: false });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('trusted senders');
    });

    it('reports when no channels are installed', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([]);

      const result = await handleChannelsCommand('/channels', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('No channels are installed');
      expect(result.response).toContain('/channels remote');
    });

    it('lists installed channels by default', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([
        { name: 'telegram', isDirectory: () => true },
        { name: 'whatsapp', isDirectory: () => true },
      ]);
      getEnabledMock.mockImplementation((family, name) => name === 'telegram');
      isChannelLiveStartedMock.mockImplementation((name) => name === 'telegram');

      const result = await handleChannelsCommand('/channels', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Channels (2)');
      expect(result.response).toContain('telegram');
      expect(result.response).toContain('enabled, running');
      expect(result.response).toContain('whatsapp');
      expect(result.response).toContain('disabled');
      expect(result.response).toContain('/channels remote');
    });

    it('lists installed channels with /channels list or /channels local', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([
        { name: 'telegram', isDirectory: () => true },
      ]);
      getEnabledMock.mockReturnValue(true);

      const listRes = await handleChannelsCommand('/channels list', { source: 'tui', trusted: true });
      expect(listRes.response).toContain('Channels (1)');

      const localRes = await handleChannelsCommand('/channels local', { source: 'tui', trusted: true });
      expect(localRes.response).toContain('Channels (1)');
    });

    it('lists remote channels available in koris-hub', async () => {
      listMissingMock.mockResolvedValueOnce([
        { family: 'channel', slug: 'telegram', summary: 'Telegram bot channel' },
        { family: 'tool', slug: 'search_engine', summary: 'Search' },
      ]);

      const result = await handleChannelsCommand('/channels remote', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(listMissingMock).toHaveBeenCalledWith({ baseDir: config.BASE_DIR });
      expect(result.response).toContain('Available Remote Channels (1)');
      expect(result.response).toContain('telegram');
      expect(result.response).toContain('Telegram bot channel');
      expect(result.response).not.toContain('search_engine');
      expect(result.response).toContain('/channels download <name>');
    });

    it('handles no remote channels available', async () => {
      listMissingMock.mockResolvedValueOnce([
        { family: 'tool', slug: 'search_engine', summary: 'Search' },
      ]);

      const result = await handleChannelsCommand('/channels remote', { source: 'tui', trusted: true });
      expect(result.response).toContain('All channels are already installed');
    });

    it('handles remote list failure', async () => {
      listMissingMock.mockRejectedValueOnce(new Error('Network error'));
      const result = await handleChannelsCommand('/channels remote', { source: 'tui', trusted: true });
      expect(result.response).toContain('Failed to reach koris-hub: Network error');
    });

    it('validates missing channel name on download', async () => {
      const result = await handleChannelsCommand('/channels download', { source: 'tui', trusted: true });
      expect(result.response).toContain('Missing channel name');
      expect(result.response).toContain('Usage: /channels download');
    });

    it('downloads and reprimies channel from koris-hub', async () => {
      pullEntryMock.mockResolvedValueOnce({
        family: 'channel',
        slug: 'telegram',
        createdFiles: ['index.js'],
      });

      const result = await handleChannelsCommand('/channels download telegram', { source: 'tui', trusted: true });
      expect(pullEntryMock).toHaveBeenCalledWith('telegram', {
        baseDir: config.BASE_DIR,
        family: 'channel',
        force: false,
      });
      expect(reprimeLiveChannelDescriptorsMock).toHaveBeenCalled();
      expect(appendMock).toHaveBeenCalledWith([{ family: 'channels', name: 'telegram' }]);
      expect(result.response).toContain('Downloaded channel "telegram"');
    });

    it('leaves the downloaded channel inactive and says how to turn it on', async () => {
      pullEntryMock.mockResolvedValueOnce({
        family: 'channel',
        slug: 'telegram',
        createdFiles: ['index.js'],
      });

      const result = await handleChannelsCommand('/channels download telegram', { source: 'tui', trusted: true });

      // A channel can't work before it's configured, so downloading must force
      // it off rather than trust the "no row means off" default — a re-pull
      // would otherwise inherit a stale enabled=1 row and come back up live.
      expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', false);
      expect(result.response).toContain('installed but inactive');
      expect(result.response).toContain('/channels activate telegram');
    });

    describe('activate', () => {
      const TELEGRAM_FIELDS = [
        { name: 'bot_token', label: 'Bot Token', type: 'password', required: true, placeholder: '123:AA' },
        { name: 'whitelist', label: 'Whitelist', type: 'text', placeholder: '123456' },
      ];

      beforeEach(() => {
        existsSyncMock.mockReturnValue(true);
        readdirSyncMock.mockReturnValue([{ name: 'telegram', isDirectory: () => true }]);
        loadChannelConfigMock.mockReturnValue({});
        fetchChannelCatalogMock.mockResolvedValue([
          { slug: 'telegram', name: 'Telegram', configFields: TELEGRAM_FIELDS, hints: { pairing: 'Scan the QR.' } },
        ]);
      });

      it('asks for the missing required variable instead of activating', async () => {
        const result = await handleChannelsCommand('/channels activate telegram', { source: 'tui', trusted: true });

        expect(result.response).toContain('bot_token');
        expect(result.response).toContain('/channels activate telegram');
        // Asking must change nothing.
        expect(setEnabledMock).not.toHaveBeenCalled();
        expect(writeChannelConfigPatchMock).not.toHaveBeenCalled();
        expect(startChannelLiveMock).not.toHaveBeenCalled();
      });

      it('asks the same way for `enable`, which is an alias of activate', async () => {
        const result = await handleChannelsCommand('/channels enable telegram', { source: 'tui', trusted: true });

        expect(result.response).toContain('bot_token');
        expect(setEnabledMock).not.toHaveBeenCalled();
      });

      it('names the optional variables still unset after activating', async () => {
        loadChannelConfigMock.mockReturnValue({ bot_token: 'already-there' });

        const result = await handleChannelsCommand('/channels activate telegram', { source: 'tui', trusted: true });

        expect(result.response).toContain('is now active');
        expect(result.response).toContain('Optional, still unset: whitelist');
      });

      it('refuses to activate while a required variable is missing', async () => {
        const result = await handleChannelsCommand('/channels activate telegram whitelist=123', { source: 'tui', trusted: true });

        expect(result.response).toContain('needs 1 more variable');
        expect(result.response).toContain('bot_token');
        expect(setEnabledMock).not.toHaveBeenCalled();
        expect(writeChannelConfigPatchMock).not.toHaveBeenCalled();
      });

      it('saves the values, enables the channel and starts it live', async () => {
        const result = await handleChannelsCommand(
          '/channels activate telegram bot_token=123:AA whitelist=555',
          { source: 'tui', trusted: true },
        );

        expect(writeChannelConfigPatchMock).toHaveBeenCalledWith('telegram', { bot_token: '123:AA', whitelist: '555' });
        expect(reprimeChannelRuntimeMock).toHaveBeenCalledWith('telegram');
        expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', true);
        expect(startChannelLiveMock).toHaveBeenCalledWith('telegram', runtimeDeps.logger, runtimeDeps.gateway);
        expect(result.response).toContain('is now active');
        expect(result.response).toContain('Scan the QR.');
      });

      it('accepts a required value already present in config.yml', async () => {
        loadChannelConfigMock.mockReturnValue({ bot_token: 'already-there' });

        const result = await handleChannelsCommand('/channels activate telegram whitelist=555', { source: 'tui', trusted: true });

        expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', true);
        expect(result.response).toContain('is now active');
      });

      it('activates straight away when the channel needs nothing', async () => {
        fetchChannelCatalogMock.mockResolvedValue([{ slug: 'telegram', name: 'Telegram', configFields: [] }]);

        const result = await handleChannelsCommand('/channels activate telegram', { source: 'tui', trusted: true });

        expect(writeChannelConfigPatchMock).not.toHaveBeenCalled();
        expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', true);
        expect(result.response).toContain('is now active');
      });

      it('rejects an unknown variable and re-shows the real ones', async () => {
        const result = await handleChannelsCommand('/channels activate telegram nope=1', { source: 'tui', trusted: true });

        expect(result.response).toContain('"nope" is not a variable of telegram');
        expect(result.response).toContain('bot_token');
        expect(setEnabledMock).not.toHaveBeenCalled();
      });

      it('tells the user to download a channel that is not installed', async () => {
        readdirSyncMock.mockReturnValue([]);

        const result = await handleChannelsCommand('/channels activate signal', { source: 'tui', trusted: true });

        expect(result.response).toContain('/channels download signal');
        expect(setEnabledMock).not.toHaveBeenCalled();
      });

      it('requires a channel name', async () => {
        const result = await handleChannelsCommand('/channels activate', { source: 'tui', trusted: true });

        expect(result.response).toContain('Missing channel name');
        expect(result.response).toContain('/channels activate <name>');
      });

      it('still activates when koris-hub is unreachable', async () => {
        fetchChannelCatalogMock.mockRejectedValue(new Error('offline'));

        const result = await handleChannelsCommand('/channels activate telegram', { source: 'tui', trusted: true });

        expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', true);
        expect(result.response).toContain('is now active');
      });
    });

    it('supports --force flag on download', async () => {
      pullEntryMock.mockResolvedValueOnce({
        family: 'channel',
        slug: 'telegram',
        createdFiles: ['index.js'],
      });

      await handleChannelsCommand('/channels download telegram --force', { source: 'tui', trusted: true });
      expect(pullEntryMock).toHaveBeenCalledWith('telegram', {
        baseDir: config.BASE_DIR,
        family: 'channel',
        force: true,
      });
    });

    it('handles download failure', async () => {
      pullEntryMock.mockRejectedValueOnce(new Error('Not found in hub'));
      const result = await handleChannelsCommand('/channels download non-existent', { source: 'tui', trusted: true });
      expect(result.response).toContain('Failed to download channel "non-existent": Not found in hub');
    });

    it('still accepts `pull` as an alias of `download`', async () => {
      pullEntryMock.mockResolvedValueOnce({ family: 'channel', slug: 'telegram', createdFiles: ['index.js'] });

      const result = await handleChannelsCommand('/channels pull telegram', { source: 'tui', trusted: true });

      expect(pullEntryMock).toHaveBeenCalledWith('telegram', expect.objectContaining({ family: 'channel' }));
      expect(result.response).toContain('Downloaded channel "telegram"');
    });

    it('enables an installed channel through the activate path', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([
        { name: 'telegram', isDirectory: () => true },
      ]);
      loadChannelConfigMock.mockReturnValue({});
      fetchChannelCatalogMock.mockResolvedValue([{ slug: 'telegram', name: 'Telegram', configFields: [] }]);

      const result = await handleChannelsCommand('/channels enable telegram', { source: 'tui', trusted: true });
      expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', true);
      expect(result.response).toContain('Channel "telegram" is now active.');
    });

    it('disables and stops an installed channel', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([
        { name: 'telegram', isDirectory: () => true },
      ]);

      const result = await handleChannelsCommand('/channels disable telegram', { source: 'tui', trusted: true });
      expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', false);
      expect(stopChannelMock).toHaveBeenCalledWith('telegram');
      expect(result.response).toContain('Channel "telegram" is now disabled.');
      expect(result.response).toContain('/channels activate telegram');
    });

    it('accepts `deactivate` as an alias of `disable`', async () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([{ name: 'telegram', isDirectory: () => true }]);

      const result = await handleChannelsCommand('/channels deactivate telegram', { source: 'tui', trusted: true });

      expect(setEnabledMock).toHaveBeenCalledWith('channels', 'telegram', false);
      expect(result.response).toContain('is now disabled');
    });

    it('returns usage instructions for invalid subcommands', async () => {
      const result = await handleChannelsCommand('/channels foobar', { source: 'tui', trusted: true });
      expect(result.response).toContain('Usage: /channels');
    });
  });
});
