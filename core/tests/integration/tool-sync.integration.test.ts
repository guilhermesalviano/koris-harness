import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolSyncService } from '../../src/services/tools/tool-sync';
import { ToolPluginsSingleton } from '../../src/services/tools/registry-singleton';
import { PluginCatalogSingleton } from '../../src/services/plugins/plugin-catalog-singleton';
import { buildRegistry, PluginRegistry } from '../../../plugins/registry';
import { COMMANDS } from '../../../plugins/tools/contracts';
import type { ILogger } from '../../src/infrastructure/logger';

function makeLogger(): ILogger {
  return {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe('ToolSyncService Integration', () => {
  let tempBase: string;
  let sourceDir: string;
  let distDir: string;
  let registry: PluginRegistry;
  let service: ToolSyncService;

  beforeEach(() => {
    tempBase = mkdtempSync(path.join(tmpdir(), 'koris-tool-sync-test-'));
    sourceDir = path.join(tempBase, 'plugins', 'tools');
    distDir = path.join(tempBase, 'dist', 'plugins', 'tools');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });

    PluginCatalogSingleton.getInstance([]);
    registry = buildRegistry([]);
    ToolPluginsSingleton.getInstance(registry.collect(COMMANDS));

    service = new ToolSyncService(
      makeLogger(),
      {
        sourceDir,
        distDir,
        context: {
          logger: makeLogger(),
          security: { gateUrl: () => null },
          pluginEnablement: { isEnabled: () => true },
        } as never,
        registry,
      },
      [],
    );
  });

  afterEach(() => {
    service.stop();
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch {}
  });

  it('transpiles and hot-loads a brand new tool into ToolPluginsSingleton and PluginCatalogSingleton', () => {
    const toolSourceDir = path.join(sourceDir, 'custom-search');
    mkdirSync(toolSourceDir, { recursive: true });

    const toolSourceCode = `
      exports.create = function(context) {
        return {
          name: 'custom-search',
          setup: function(reg) {
            reg.extend({ id: 'tools.commands' }, {
              name: 'custom_search',
              schema: { description: 'A custom search tool' },
              handler: async function() { return { toolName: 'custom_search', success: true }; },
              enabled: function() { return true; }
            });
          }
        };
      };
    `;
    writeFileSync(path.join(toolSourceDir, 'index.ts'), toolSourceCode, 'utf-8');

    // Run sync
    service.sync();

    // Verify compiled file was output
    const distJs = path.join(distDir, 'custom-search', 'index.js');
    expect(existsSync(distJs)).toBe(true);

    // Verify catalog was updated
    const catalog = PluginCatalogSingleton.getExistingInstance();
    expect(catalog).toContainEqual({ family: 'tools', name: 'custom-search' });

    // Verify tool was registered in ToolPluginsSingleton
    const tools = ToolPluginsSingleton.getExistingInstance();
    const customSearch = tools.find((t) => t.name === 'custom_search');
    expect(customSearch).toBeDefined();
    expect(customSearch?.schema.description).toBe('A custom search tool');
  });

  it('handles forced re-sync for existing tool without duplicating in catalog', () => {
    const toolSourceDir = path.join(sourceDir, 'time-tool');
    mkdirSync(toolSourceDir, { recursive: true });

    const codeV1 = `
      exports.create = function(context) {
        return {
          name: 'time-tool',
          setup: function(reg) {
            reg.extend({ id: 'tools.commands' }, {
              name: 'time_tool',
              schema: { description: 'Version 1' },
              handler: async function() { return { toolName: 'time_tool', success: true }; },
              enabled: function() { return true; }
            });
          }
        };
      };
    `;
    writeFileSync(path.join(toolSourceDir, 'index.ts'), codeV1, 'utf-8');
    service.sync();

    let tools = ToolPluginsSingleton.getExistingInstance();
    expect(tools.find((t) => t.name === 'time_tool')?.schema.description).toBe('Version 1');

    // Force re-sync with slug
    service.sync('time-tool');

    // Ensure catalog has only 1 entry for time-tool (no duplicates)
    const catalog = PluginCatalogSingleton.getExistingInstance().filter((p) => p.name === 'time-tool');
    expect(catalog).toHaveLength(1);
  });

  it('tolerates partial folder creation before index.ts is written and hot-loads once ready', () => {
    const toolSourceDir = path.join(sourceDir, 'slow-download');
    mkdirSync(toolSourceDir, { recursive: true });
    // Write auxiliary file first (simulating mid-download)
    writeFileSync(path.join(toolSourceDir, 'helper.ts'), 'export const x = 1;', 'utf-8');

    // First sync should skip it without throwing or permanently ignoring it
    service.sync();
    expect(PluginCatalogSingleton.getExistingInstance().some((p) => p.name === 'slow-download')).toBe(false);

    // Now write index.ts
    const indexCode = `
      exports.create = function() {
        return {
          name: 'slow-download',
          setup: function(reg) {
            reg.extend({ id: 'tools.commands' }, {
              name: 'slow_download',
              schema: { description: 'Slow' },
              handler: async function() { return { toolName: 'slow_download', success: true }; },
              enabled: function() { return true; }
            });
          }
        };
      };
    `;
    writeFileSync(path.join(toolSourceDir, 'index.ts'), indexCode, 'utf-8');

    // Next sync should now discover and load it
    service.sync();
    expect(PluginCatalogSingleton.getExistingInstance()).toContainEqual({ family: 'tools', name: 'slow-download' });
    expect(ToolPluginsSingleton.getExistingInstance().some((t) => t.name === 'slow_download')).toBe(true);
  });
});
