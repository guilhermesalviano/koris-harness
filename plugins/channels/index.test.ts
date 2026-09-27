import { describe, it, expect, vi } from 'vitest';
import { createPlugins, listLiveChannels } from './index';
import type { LiveChannelDescriptor } from './contracts';

/** A real directory, so the scanner gets past its `existsSync` guard — the
 *  actual listing is injected via `readdirSync` below. */
const DIRECTORY = __dirname;

function dirEntries(...names: string[]) {
  return names.map((name) => ({ name, isDirectory: () => true }));
}

const workingModule = {
  create: () => ({ name: 'telegram', setup: () => {} }),
  liveChannel: { name: 'telegram' } as unknown as LiveChannelDescriptor,
};

describe('channel scanner', () => {
  it('skips a channel whose module throws, keeps the rest, and reports which failed', () => {
    const onLoadError = vi.fn();
    const boom = new Error("Cannot find module '../contracts'");

    const plugins = createPlugins({
      directory: DIRECTORY,
      readdirSync: () => dirEntries('whatsapp', 'telegram'),
      loadModule: (modulePath: string) => {
        if (modulePath.endsWith('whatsapp')) throw boom;
        return workingModule;
      },
      onLoadError,
    });

    expect(plugins.map((plugin) => plugin.name)).toEqual(['telegram']);
    expect(onLoadError).toHaveBeenCalledWith('whatsapp', boom);
  });

  it('reports load failures from listLiveChannels too', () => {
    const onLoadError = vi.fn();

    const descriptors = listLiveChannels({
      directory: DIRECTORY,
      readdirSync: () => dirEntries('whatsapp', 'telegram'),
      loadModule: (modulePath: string) => {
        if (modulePath.endsWith('whatsapp')) throw new Error('boom');
        return workingModule;
      },
      onLoadError,
    });

    expect(descriptors.map((descriptor) => descriptor.name)).toEqual(['telegram']);
    expect(onLoadError).toHaveBeenCalledWith('whatsapp', expect.any(Error));
  });

  it('warns on the console by default, so a failing channel never disappears silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const descriptors = listLiveChannels({
      directory: DIRECTORY,
      readdirSync: () => dirEntries('whatsapp'),
      loadModule: () => {
        throw new Error("Cannot find module '../contracts'");
      },
    });

    expect(descriptors).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('whatsapp');
    expect(warn.mock.calls[0]![0]).toContain("Cannot find module '../contracts'");

    warn.mockRestore();
  });

  it('loads every channel that resolves', () => {
    const onLoadError = vi.fn();

    const plugins = createPlugins({
      directory: DIRECTORY,
      readdirSync: () => dirEntries('telegram'),
      loadModule: () => workingModule,
      onLoadError,
    });

    expect(plugins.map((plugin) => plugin.name)).toEqual(['telegram']);
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it('returns empty array when directory does not exist', () => {
    const plugins = createPlugins({
      directory: '/non/existent/path/for/channels',
    });
    expect(plugins).toEqual([]);

    const live = listLiveChannels({
      directory: '/non/existent/path/for/channels',
    });
    expect(live).toEqual([]);
  });

  it('filters out non-directory entries and modules without create or with null plugin', () => {
    const plugins = createPlugins({
      directory: DIRECTORY,
      readdirSync: () => [
        { name: 'some-file.txt', isDirectory: () => false },
        { name: 'no-create', isDirectory: () => true },
        { name: 'null-plugin', isDirectory: () => true },
      ],
      loadModule: (p: string) => {
        if (p.endsWith('no-create')) return {};
        if (p.endsWith('null-plugin')) return { create: () => null };
        return workingModule;
      },
    });

    expect(plugins).toEqual([]);
  });

  it('skips a channel whose create() throws, so a bad context never takes boot down', () => {
    const onLoadError = vi.fn();
    const boom = new Error('Cannot read properties of undefined');

    const plugins = createPlugins({
      directory: DIRECTORY,
      readdirSync: () => dirEntries('whatsapp', 'telegram'),
      loadModule: (modulePath: string) => {
        if (modulePath.endsWith('whatsapp')) {
          return {
            create: () => {
              throw boom;
            },
          };
        }
        return workingModule;
      },
      onLoadError,
    });

    expect(plugins.map((plugin) => plugin.name)).toEqual(['telegram']);
    expect(onLoadError).toHaveBeenCalledWith('whatsapp', boom);
  });

  it('runs with default options when none are passed', () => {
    // Exercises the real defaults — `resolveDefaultChannelsDir`, `require` as
    // `loadModule`, `console.warn` as `onLoadError` — against whatever channels
    // happen to be installed, so it must not assume any particular one is
    // present or that `create()` tolerates an undefined context.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugins = createPlugins();
    expect(Array.isArray(plugins)).toBe(true);

    const live = listLiveChannels();
    expect(Array.isArray(live)).toBe(true);

    warn.mockRestore();
  });
});
