import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  DatabaseServiceFactory: { create: vi.fn(() => ({})) },
}));

const getStatusesMock = vi.fn();
const enableMock = vi.fn();
const disableMock = vi.fn();
vi.mock('../../../../src/services/mcps/mcp-manager', () => ({
  McpManagerSingleton: {
    getExistingInstance: vi.fn(() => ({
      getStatuses: getStatusesMock,
      enable: enableMock,
      disable: disableMock,
    })),
  },
}));

const syncMock = vi.fn();
vi.mock('../../../../src/services/mcps/mcp-sync', () => ({
  McpSyncSingleton: {
    getExistingInstance: vi.fn(() => ({ sync: syncMock })),
  },
}));

const appendMock = vi.fn();
vi.mock('../../../../src/services/plugins/plugin-catalog-singleton', () => ({
  PluginCatalogSingleton: {
    append: (...args: unknown[]) => appendMock(...args),
  },
}));

const listMissingMock = vi.fn();
const pullEntryMock = vi.fn();
vi.mock('../../../../../scripts/hub-sync', () => ({
  listMissing: (...args: unknown[]) => listMissingMock(...args),
  pullEntry: (...args: unknown[]) => pullEntryMock(...args),
}));

const readdirSyncMock = vi.fn();
const existsSyncMock = vi.fn();
vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => readdirSyncMock(...args),
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

import { handleMcpsCommand, listInstalledMcpNames } from '../../../../src/services/commands/mcps';

function install(...names: string[]): void {
  existsSyncMock.mockReturnValue(true);
  readdirSyncMock.mockReturnValue(names.map((name) => ({
    name,
    isDirectory: () => true,
  })));
}

describe('mcps command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatusesMock.mockReturnValue([]);
  });

  describe('listInstalledMcpNames', () => {
    it('returns an empty list when the MCP directory is absent or unreadable', () => {
      existsSyncMock.mockReturnValue(false);
      expect(listInstalledMcpNames()).toEqual([]);

      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockImplementation(() => { throw new Error('permission denied'); });
      expect(listInstalledMcpNames()).toEqual([]);
    });

    it('returns sorted, visible MCP plugin directories only', () => {
      existsSyncMock.mockReturnValue(true);
      readdirSyncMock.mockReturnValue([
        { name: 'weather', isDirectory: () => true },
        { name: '.staging', isDirectory: () => true },
        { name: 'README.md', isDirectory: () => false },
        { name: 'coredash', isDirectory: () => true },
      ]);

      expect(listInstalledMcpNames('/app')).toEqual(['coredash', 'weather']);
    });
  });

  describe('handleMcpsCommand', () => {
    it('rejects untrusted senders', async () => {
      const result = await handleMcpsCommand('/mcps', { source: 'tui', trusted: false });
      expect(result.response).toContain('trusted senders');
    });

    it('reports when no MCP servers are installed', async () => {
      install();
      const result = await handleMcpsCommand('/mcps', { source: 'tui', trusted: true });
      expect(result.response).toContain('No MCP servers are installed');
      expect(result.response).toContain('/mcps remote');
    });

    it('lists configured servers and their runtime status', async () => {
      install('weather', 'coredash', 'offline');
      getEnabledMock.mockImplementation((_family, name) => name !== 'offline');
      getStatusesMock.mockReturnValue([
        { name: 'coredash', state: 'connected', toolCount: 3 },
        { name: 'offline', state: 'error', toolCount: 0, error: 'unreachable' },
      ]);

      const result = await handleMcpsCommand('/mcps list', { source: 'tui', trusted: true });

      expect(result.response).toContain('MCP Servers (3)');
      expect(result.response).toContain('coredash');
      expect(result.response).toContain('enabled, connected, 3 tools');
      expect(result.response).toContain('offline');
      expect(result.response).toContain('disabled, error');
      expect(result.response).toContain('weather');
      expect(result.response).toContain('enabled, not loaded');
    });

    it('accepts local as an alias for the installed list', async () => {
      install('coredash');
      const result = await handleMcpsCommand('/mcps local', { source: 'tui', trusted: true });
      expect(result.response).toContain('MCP Servers (1)');
    });

    it('lists only remote MCP entries from koris-hub', async () => {
      listMissingMock.mockResolvedValueOnce([
        { family: 'mcp', slug: 'coredash', summary: 'Core dashboard tools' },
        { family: 'mcp', slug: 'plain' },
        { family: 'tool', slug: 'search_engine', summary: 'Search' },
      ]);

      const result = await handleMcpsCommand('/mcps available', { source: 'tui', trusted: true });

      expect(listMissingMock).toHaveBeenCalledWith({ baseDir: config.BASE_DIR });
      expect(result.response).toContain('Available Remote MCP Servers');
      expect(result.response).toContain('coredash');
      expect(result.response).toContain('Core dashboard tools');
      expect(result.response).toContain('plain');
      expect(result.response).not.toContain('search_engine');
    });

    it('reports an empty remote list and lookup failures', async () => {
      listMissingMock.mockResolvedValueOnce([{ family: 'tool', slug: 'search_engine' }]);
      const empty = await handleMcpsCommand('/mcps remote', { source: 'tui', trusted: true });
      expect(empty.response).toContain('No new remote MCP servers');

      listMissingMock.mockRejectedValueOnce(new Error('network down'));
      const failed = await handleMcpsCommand('/mcps remote', { source: 'tui', trusted: true });
      expect(failed.response).toContain('Failed to reach koris-hub: network down');
    });

    it('validates the MCP name on download', async () => {
      const result = await handleMcpsCommand('/mcps download --force', { source: 'tui', trusted: true });
      expect(result.response).toContain('Usage: /mcps download <name> [--force]');
    });

    it('downloads and synchronizes an MCP server, including --force', async () => {
      const result = await handleMcpsCommand('/mcps install --force CoreDash', { source: 'tui', trusted: true });

      expect(pullEntryMock).toHaveBeenCalledWith('coredash', {
        baseDir: config.BASE_DIR,
        family: 'mcp',
        force: true,
      });
      expect(syncMock).toHaveBeenCalledWith('coredash');
      expect(result.response).toContain('Downloaded MCP server "coredash"');
    });

    it('reports a downloaded MCP server as enabled and connected', async () => {
      getStatusesMock.mockReturnValue([{ name: 'coredash', state: 'connected', toolCount: 22 }]);
      const result = await handleMcpsCommand('/mcps download coredash', { source: 'tui', trusted: true });
      expect(result.response).toContain('Downloaded and enabled MCP server "coredash" (22 tools)');
    });

    it('reports a downloaded MCP server that failed to connect', async () => {
      getStatusesMock.mockReturnValue([{ name: 'coredash', state: 'error', toolCount: 0, error: 'fetch failed' }]);
      const result = await handleMcpsCommand('/mcps download coredash', { source: 'tui', trusted: true });
      expect(result.response).toContain('failed to connect: fetch failed');
      expect(result.response).toContain('Configuration → Plugins');
    });

    it('keeps a previously disabled MCP server disabled on re-download', async () => {
      getStatusesMock.mockReturnValue([{ name: 'coredash', state: 'disabled', toolCount: 0 }]);
      const result = await handleMcpsCommand('/mcps download coredash --force', { source: 'tui', trusted: true });
      expect(result.response).toContain('stays disabled');
      expect(result.response).toContain('/mcps enable coredash');
    });

    it('reports download failures', async () => {
      pullEntryMock.mockRejectedValueOnce(new Error('not found'));
      const result = await handleMcpsCommand('/mcps pull missing', { source: 'tui', trusted: true });
      expect(result.response).toContain('Failed to download MCP server "missing": not found');
    });

    it('validates enable and disable requests', async () => {
      const missingName = await handleMcpsCommand('/mcps enable', { source: 'tui', trusted: true });
      expect(missingName.response).toContain('Usage: /mcps enable <name>');

      install('coredash');
      const absent = await handleMcpsCommand('/mcps disable weather', { source: 'tui', trusted: true });
      expect(absent.response).toContain('MCP server "weather" is not installed');
    });

    it('enables an installed MCP server and adds it to the catalog', async () => {
      install('coredash');
      enableMock.mockResolvedValueOnce(true);

      const result = await handleMcpsCommand('/mcps enable CoreDash', { source: 'tui', trusted: true });

      expect(setEnabledMock).toHaveBeenCalledWith('mcps', 'coredash', true);
      expect(appendMock).toHaveBeenCalledWith([{ family: 'mcps', name: 'coredash' }]);
      expect(enableMock).toHaveBeenCalledWith('coredash');
      expect(result.response).toContain('MCP server "coredash" is now enabled');
    });

    it('warns when an enabled MCP server cannot connect', async () => {
      install('coredash');
      enableMock.mockResolvedValueOnce(false);
      const result = await handleMcpsCommand('/mcps enable coredash', { source: 'tui', trusted: true });
      expect(result.response).toContain('enabled but failed to connect');
    });

    it('disables an installed MCP server', async () => {
      install('coredash');
      disableMock.mockResolvedValueOnce(true);

      const result = await handleMcpsCommand('/mcps disable coredash', { source: 'tui', trusted: true });

      expect(setEnabledMock).toHaveBeenCalledWith('mcps', 'coredash', false);
      expect(disableMock).toHaveBeenCalledWith('coredash');
      expect(result.response).toContain('MCP server "coredash" is now disabled');
    });

    it('returns usage for an unknown subcommand', async () => {
      const result = await handleMcpsCommand('/mcps nope', { source: 'tui', trusted: true });
      expect(result.response).toContain('Usage: /mcps');
    });
  });
});
