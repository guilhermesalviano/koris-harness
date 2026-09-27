import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../../../../src/config';

const mockDefs = [
  { name: 'curl_request', schema: { description: 'Curl tool' }, enabled: vi.fn((opts) => opts.trusted) },
  { name: 'search_engine', schema: { description: 'Search tool' }, enabled: vi.fn((opts) => opts.trusted) },
  { name: 'disabled_tool', schema: { description: 'Disabled tool' }, enabled: vi.fn(() => false) },
];

vi.mock('../../../../src/services/tools/registry-singleton', () => ({
  ToolPluginsSingleton: {
    getExistingInstance: vi.fn(() => mockDefs),
  },
}));

const syncMock = vi.fn();
vi.mock('../../../../src/services/tools/tool-sync', () => ({
  ToolSyncSingleton: {
    getExistingInstance: vi.fn(() => ({ sync: syncMock })),
  },
}));

const listMissingMock = vi.fn();
const pullEntryMock = vi.fn();
vi.mock('../../../../../scripts/hub-sync', () => ({
  listMissing: (...args: unknown[]) => listMissingMock(...args),
  pullEntry: (...args: unknown[]) => pullEntryMock(...args),
}));

import { listTools, handleToolsCommand } from '../../../../src/services/commands/tools';

describe('tools command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTools', () => {
    it('returns only enabled tools', () => {
      const tools = listTools();
      expect(tools).toEqual([
        { name: 'curl_request', description: 'Curl tool' },
        { name: 'search_engine', description: 'Search tool' },
      ]);
    });
  });

  describe('handleToolsCommand', () => {
    it('rejects untrusted senders', async () => {
      const result = await handleToolsCommand('/tools', { source: 'tui', trusted: false });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('trusted senders');
    });

    it('lists loaded tools by default', async () => {
      const result = await handleToolsCommand('/tools', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Tools (2)');
      expect(result.response).toContain('curl_request');
      expect(result.response).toContain('search_engine');
      expect(result.response).not.toContain('disabled_tool');
      expect(result.response).toContain('/tools remote');
    });

    it('reports when no tools are loaded', async () => {
      const { ToolPluginsSingleton } = await import('../../../../src/services/tools/registry-singleton');
      vi.mocked(ToolPluginsSingleton.getExistingInstance).mockReturnValueOnce([]);
      const result = await handleToolsCommand('/tools', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('No tools are loaded.');
    });

    it('lists loaded tools with /tools list or /tools local', async () => {
      const listRes = await handleToolsCommand('/tools list', { source: 'tui', trusted: true });
      expect(listRes.response).toContain('Tools (2)');

      const localRes = await handleToolsCommand('/tools local', { source: 'tui', trusted: true });
      expect(localRes.response).toContain('Tools (2)');
    });

    it('lists remote tools available in koris-hub', async () => {
      listMissingMock.mockResolvedValueOnce([
        { family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' },
        { family: 'skill', slug: 'weather', summary: 'Weather skill' },
      ]);

      const result = await handleToolsCommand('/tools remote', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(listMissingMock).toHaveBeenCalledWith({ baseDir: config.BASE_DIR });
      expect(result.response).toContain('Available Remote Tools (1)');
      expect(result.response).toContain('issue');
      expect(result.response).toContain('File a GitHub issue.');
      expect(result.response).not.toContain('weather');
      expect(result.response).toContain('/tools download <name>');
    });

    it('supports /tools list remote and /tools available', async () => {
      listMissingMock.mockResolvedValue([
        { family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' },
      ]);

      const res1 = await handleToolsCommand('/tools list remote', { source: 'tui', trusted: true });
      expect(res1.response).toContain('Available Remote Tools (1)');

      const res2 = await handleToolsCommand('/tools available', { source: 'tui', trusted: true });
      expect(res2.response).toContain('Available Remote Tools (1)');
    });

    it('reports when no new remote tools are available', async () => {
      listMissingMock.mockResolvedValueOnce([
        { family: 'skill', slug: 'weather', summary: 'Weather skill' },
      ]);

      const result = await handleToolsCommand('/tools remote', { source: 'tui', trusted: true });
      expect(result.response).toContain('No new remote tools available');
    });

    it('handles remote listing errors gracefully', async () => {
      listMissingMock.mockRejectedValueOnce(new Error('GitHub API rate limit exceeded'));

      const result = await handleToolsCommand('/tools remote', { source: 'tui', trusted: true });
      expect(result.response).toContain('Failed to reach koris-hub: GitHub API rate limit exceeded');
    });

    it('requires a tool name when downloading', async () => {
      const result = await handleToolsCommand('/tools download', { source: 'tui', trusted: true });
      expect(result.response).toContain('Missing tool name');
      expect(result.response).toContain('Usage: /tools download <name>');
    });

    it('downloads a tool and triggers sync', async () => {
      pullEntryMock.mockResolvedValueOnce({
        family: 'tool',
        slug: 'issue',
        createdFiles: ['plugins/tools/issue/index.ts'],
      });

      const result = await handleToolsCommand('/tools download issue', { source: 'tui', trusted: true });
      expect(pullEntryMock).toHaveBeenCalledWith('issue', {
        baseDir: config.BASE_DIR,
        family: 'tool',
        force: false,
      });
      expect(syncMock).toHaveBeenCalledWith('issue');
      expect(result.response).toContain('Successfully downloaded tool "issue"');
    });

    it('supports /tools pull and /tools install aliases with --force', async () => {
      pullEntryMock.mockResolvedValueOnce({
        family: 'tool',
        slug: 'issue',
        createdFiles: ['plugins/tools/issue/index.ts'],
      });

      const result = await handleToolsCommand('/tools pull issue --force', { source: 'tui', trusted: true });
      expect(pullEntryMock).toHaveBeenCalledWith('issue', {
        baseDir: config.BASE_DIR,
        family: 'tool',
        force: true,
      });
      expect(syncMock).toHaveBeenCalledWith('issue');
      expect(result.response).toContain('Successfully downloaded tool "issue"');
    });

    it('handles download failure gracefully', async () => {
      pullEntryMock.mockRejectedValueOnce(new Error('"issue" was not found'));

      const result = await handleToolsCommand('/tools download issue', { source: 'tui', trusted: true });
      expect(result.response).toContain('Failed to download tool "issue": "issue" was not found');
    });

    it('shows usage for unknown subcommands', async () => {
      const result = await handleToolsCommand('/tools unknown', { source: 'tui', trusted: true });
      expect(result.response).toContain('Usage: /tools');
      expect(result.response).toContain('/tools remote');
      expect(result.response).toContain('/tools download <name>');
    });
  });
});
