import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpSyncService, McpSyncSingleton } from '../../../../src/services/mcps/mcp-sync';

vi.mock('../../../../src/services/plugins/plugin-catalog-singleton', () => ({
  PluginCatalogSingleton: { append: vi.fn() },
}));

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const roots: string[] = [];

function makeService(stored: boolean | null = null) {
  const root = mkdtempSync(path.join(tmpdir(), 'mcp-sync-'));
  roots.push(root);
  const sourceDir = path.join(root, 'src');
  const setup = vi.fn();
  const requireModule = vi.fn(() => ({ create: () => ({ name: 'coredash', setup }) }));
  const manager = { addDefinitions: vi.fn(async () => undefined) };
  const pluginSettings = { getEnabled: vi.fn(() => stored), setEnabled: vi.fn() };
  const service = new McpSyncService(logger, {
    sourceDir,
    distDir: path.join(root, 'dist'),
    context: {} as never,
    registry: { collect: vi.fn(() => []) } as never,
    manager: manager as never,
    pluginSettings,
    requireModule,
    transpile: (source) => source,
  }, []);
  return { service, sourceDir, requireModule, manager, pluginSettings };
}

function writePlugin(sourceDir: string, slug: string): void {
  mkdirSync(path.join(sourceDir, slug), { recursive: true });
  writeFileSync(path.join(sourceDir, slug, 'index.ts'), 'export {};');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('McpSyncService', () => {
  it('retries a plugin folder whose index.ts had not been written yet', async () => {
    const { service, sourceDir, requireModule, manager } = makeService();
    mkdirSync(path.join(sourceDir, 'coredash'), { recursive: true });

    await service.sync();
    expect(requireModule).not.toHaveBeenCalled();

    writeFileSync(path.join(sourceDir, 'coredash', 'index.ts'), 'export {};');
    await service.sync();

    expect(requireModule).toHaveBeenCalledOnce();
    expect(manager.addDefinitions).toHaveBeenCalledOnce();
  });

  it('enables a newly downloaded plugin before registering its definitions', async () => {
    const { service, sourceDir, manager, pluginSettings } = makeService(null);
    writePlugin(sourceDir, 'coredash');

    await service.sync();

    expect(pluginSettings.setEnabled).toHaveBeenCalledWith('mcps', 'coredash', true);
    expect(pluginSettings.setEnabled.mock.invocationCallOrder[0])
      .toBeLessThan(manager.addDefinitions.mock.invocationCallOrder[0]);
  });

  it('keeps an explicit earlier choice for a re-downloaded plugin', async () => {
    const { service, sourceDir, manager, pluginSettings } = makeService(false);
    writePlugin(sourceDir, 'coredash');

    await service.sync('coredash');

    expect(pluginSettings.setEnabled).not.toHaveBeenCalled();
    expect(manager.addDefinitions).toHaveBeenCalledOnce();
  });

  it('starts watching and stops cleanly', () => {
    const { service } = makeService();
    service.start();
    service.stop();
  });

  it('handles readdir errors gracefully during sync', async () => {
    const { service, sourceDir } = makeService();
    rmSync(sourceDir, { recursive: true, force: true });
    await expect(service.sync()).resolves.toBeUndefined();
  });

  it('handles module throwing error during hot-load', async () => {
    const { service, sourceDir, requireModule } = makeService();
    writePlugin(sourceDir, 'failing-plugin');
    requireModule.mockImplementationOnce(() => {
      throw new Error('Corrupt module');
    });

    await service.sync();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to hot-load "failing-plugin"'),
      expect.any(Object)
    );
  });

  it('handles module with no create function or returning null', async () => {
    const { service, sourceDir, requireModule } = makeService();
    writePlugin(sourceDir, 'no-create');
    requireModule.mockReturnValueOnce({} as any);

    await service.sync();

    writePlugin(sourceDir, 'null-plugin');
    requireModule.mockReturnValueOnce({ create: () => null });

    await service.sync();
  });

  it('McpSyncSingleton manages a singleton instance', () => {
    const inst1 = McpSyncSingleton.getInstance(logger, {} as any, []);
    const inst2 = McpSyncSingleton.getInstance(logger, {} as any, []);
    expect(inst1).toBe(inst2);
    expect(McpSyncSingleton.getExistingInstance()).toBe(inst1);
  });
});

