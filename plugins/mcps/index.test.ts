import { describe, expect, it, vi } from 'vitest';
import { createMcpPlugins } from './index';

describe('createMcpPlugins', () => {
  it('loads plugin directories and isolates module failures', () => {
    const onLoadError = vi.fn();
    const plugins = createMcpPlugins({
      directory: __dirname,
      readdirSync: () => [
        { name: 'good', isDirectory: () => true },
        { name: 'broken', isDirectory: () => true },
        { name: 'contracts.ts', isDirectory: () => false },
      ],
      loadModule: (modulePath) => {
        if (modulePath.endsWith('broken')) throw new Error('boom');
        return { create: () => ({ name: 'good', setup: vi.fn() }) };
      },
      onLoadError,
    });

    expect(plugins.map((plugin) => plugin.name)).toEqual(['good']);
    expect(onLoadError).toHaveBeenCalledWith('broken', expect.any(Error));
  });

  it('returns empty array when target directory does not exist', () => {
    const plugins = createMcpPlugins({ directory: '/non/existent/path/mcps' });
    expect(plugins).toEqual([]);
  });

  it('ignores modules without a create function or returning null', () => {
    const plugins = createMcpPlugins({
      directory: __dirname,
      readdirSync: () => [
        { name: 'no-create', isDirectory: () => true },
        { name: 'null-plugin', isDirectory: () => true },
      ],
      loadModule: (modulePath) => {
        if (modulePath.endsWith('no-create')) return {} as never;
        return { create: () => null };
      },
    });
    expect(plugins).toEqual([]);
  });

  it('logs console warning when onLoadError is omitted and module fails to load', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugins = createMcpPlugins({
      directory: __dirname,
      readdirSync: () => [{ name: 'failing', isDirectory: () => true }],
      loadModule: () => {
        throw new Error('failed to import');
      },
    });

    expect(plugins).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[mcps] "failing" was skipped - its plugin failed to load: failed to import'),
    );
    warnSpy.mockRestore();
  });
});
