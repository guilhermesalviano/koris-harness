import { describe, it, expect, vi, beforeEach } from 'vitest';
import { watch, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { ToolSyncService, type ToolSyncOptions } from '../../../../src/services/tools/tool-sync';
import { ToolPluginsSingleton } from '../../../../src/services/tools/registry-singleton';
import { PluginCatalogSingleton } from '../../../../src/services/plugins/plugin-catalog-singleton';

vi.mock('fs', () => ({
  watch: vi.fn(() => ({ close: vi.fn() })),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../../../../src/services/tools/registry-singleton', () => ({
  ToolPluginsSingleton: { replace: vi.fn() },
}));

vi.mock('../../../../src/services/plugins/plugin-catalog-singleton', () => ({
  PluginCatalogSingleton: { append: vi.fn() },
}));

const SOURCE_DIR = '/repo/plugins/tools';
const DIST_DIR = '/repo/dist/plugins/tools';

function makeEntry(name: string, isDirectory: boolean) {
  return { name, isDirectory: () => isDirectory, isFile: () => !isDirectory };
}

function makeService(overrides: Partial<ToolSyncOptions> = {}, knownSlugs: string[] = []) {
  const registry = { collect: vi.fn(() => ['collected-def']) };
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const requireModule = vi.fn();
  const transpile = vi.fn((_source: string, filename: string) => `// compiled ${filename}`);

  const options: ToolSyncOptions = {
    sourceDir: SOURCE_DIR,
    distDir: DIST_DIR,
    context: {} as never,
    registry: registry as never,
    requireModule,
    transpile,
    ...overrides,
  };

  const service = new ToolSyncService(logger as never, options, knownSlugs);
  return { service, logger, registry, requireModule, transpile };
}

describe('ToolSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the source dir cannot be read', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ENOENT'); });
    const { service, requireModule } = makeService();

    expect(() => service.sync()).not.toThrow();
    expect(requireModule).not.toHaveBeenCalled();
    expect(ToolPluginsSingleton.replace).not.toHaveBeenCalled();
  });

  it('does nothing when every directory on disk is already known', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([makeEntry('curl-request', true)]);
    const { service, requireModule } = makeService({}, ['curl-request']);

    service.sync();

    expect(requireModule).not.toHaveBeenCalled();
    expect(ToolPluginsSingleton.replace).not.toHaveBeenCalled();
  });

  it('hot-loads a newly pulled tool: transpiles, writes dist output, requires it, and wires it into the live registry', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('weather', true)];
      if (dir === `${SOURCE_DIR}/weather`) return [makeEntry('index.ts', false), makeEntry('index.test.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('export function create() {}');

    const plugin = { name: 'weather', setup: vi.fn() };
    const { service, requireModule, transpile, registry, logger } = makeService();
    requireModule.mockReturnValue({ create: () => plugin });

    service.sync();

    expect(transpile).toHaveBeenCalledTimes(1);
    expect(transpile).toHaveBeenCalledWith('export function create() {}', `${SOURCE_DIR}/weather/index.ts`);
    expect(writeFileSync).toHaveBeenCalledWith(`${DIST_DIR}/weather/index.js`, '// compiled /repo/plugins/tools/weather/index.ts', 'utf-8');
    expect(mkdirSync).toHaveBeenCalledWith(`${DIST_DIR}/weather`, { recursive: true });
    expect(requireModule).toHaveBeenCalledWith(`${DIST_DIR}/weather`);
    expect(plugin.setup).toHaveBeenCalledWith(registry);
    expect(ToolPluginsSingleton.replace).toHaveBeenCalledWith(['collected-def']);
    expect(PluginCatalogSingleton.append).toHaveBeenCalledWith([{ family: 'tools', name: 'weather' }]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Hot-loaded 1 new tool(s): weather'));
  });

  it('transpiles every non-test .ts file in a multi-file tool folder', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('search-engine', true)];
      if (dir === `${SOURCE_DIR}/search-engine`) {
        return [makeEntry('index.ts', false), makeEntry('searxng.ts', false), makeEntry('index.test.ts', false)];
      }
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');

    const { service, requireModule, transpile } = makeService();
    requireModule.mockReturnValue({ create: () => ({ name: 'search-engine', setup: vi.fn() }) });

    service.sync();

    expect(transpile).toHaveBeenCalledTimes(2);
    const transpiledFiles = transpile.mock.calls.map((call) => call[1]);
    expect(transpiledFiles).toEqual(
      expect.arrayContaining([`${SOURCE_DIR}/search-engine/index.ts`, `${SOURCE_DIR}/search-engine/searxng.ts`]),
    );
    expect(transpiledFiles).not.toContain(`${SOURCE_DIR}/search-engine/index.test.ts`);
  });

  it('skips a candidate whose module has no create() and never touches the singletons', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('broken', true)];
      if (dir === `${SOURCE_DIR}/broken`) return [makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');

    const { service, requireModule } = makeService();
    requireModule.mockReturnValue({});

    service.sync();

    expect(ToolPluginsSingleton.replace).not.toHaveBeenCalled();
    expect(PluginCatalogSingleton.append).not.toHaveBeenCalled();
  });

  it('skips a candidate whose create() returns null', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('disabled', true)];
      if (dir === `${SOURCE_DIR}/disabled`) return [makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');

    const { service, requireModule } = makeService();
    requireModule.mockReturnValue({ create: () => null });

    service.sync();

    expect(ToolPluginsSingleton.replace).not.toHaveBeenCalled();
  });

  it('logs and skips a candidate that fails to load, without throwing or retrying it later', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('broken', true)];
      if (dir === `${SOURCE_DIR}/broken`) return [makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('not valid typescript {{{');

    const { service, transpile, logger } = makeService();
    transpile.mockImplementation(() => { throw new Error('Transform failed'); });

    expect(() => service.sync()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to hot-load tool "broken"'),
      expect.objectContaining({ error: expect.stringContaining('Transform failed') }),
    );

    // Second sync pass: still shows up on disk, but must not be retried.
    vi.clearAllMocks();
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('broken', true)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    service.sync();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('processes multiple new tools in one sync pass and replaces the registry once', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('weather', true), makeEntry('issue', true)];
      if (dir === `${SOURCE_DIR}/weather` || dir === `${SOURCE_DIR}/issue`) return [makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');

    const { service, requireModule } = makeService();
    requireModule.mockImplementation((modulePath: string) => ({
      create: () => ({ name: modulePath.split('/').pop(), setup: vi.fn() }),
    }));

    service.sync();

    expect(ToolPluginsSingleton.replace).toHaveBeenCalledTimes(1);
    expect(PluginCatalogSingleton.append).toHaveBeenCalledWith([
      { family: 'tools', name: 'weather' },
      { family: 'tools', name: 'issue' },
    ]);
  });

  it('start creates the source dir, runs an initial sync, and watches for further changes', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const { service } = makeService();

    service.start();

    expect(mkdirSync).toHaveBeenCalledWith(SOURCE_DIR, { recursive: true });
    expect(readdirSync).toHaveBeenCalledWith(SOURCE_DIR, { withFileTypes: true });
    expect(watch).toHaveBeenCalledWith(SOURCE_DIR, { persistent: true }, expect.any(Function));
  });

  it('start picks up a tool that was pulled while the process was down', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('weather', true)];
      if (dir === `${SOURCE_DIR}/weather`) return [makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');
    const { service, requireModule } = makeService();
    requireModule.mockReturnValue({ create: () => ({ name: 'weather', setup: vi.fn() }) });

    service.start();

    expect(ToolPluginsSingleton.replace).toHaveBeenCalledWith(['collected-def']);
    expect(PluginCatalogSingleton.append).toHaveBeenCalledWith([{ family: 'tools', name: 'weather' }]);
  });

  it('does not mark a candidate as known if index.ts is missing (in-progress download), allowing retry', () => {
    // First sync pass: only auxiliary file written so far
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('downloading', true)];
      if (dir === `${SOURCE_DIR}/downloading`) return [makeEntry('aux.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });

    const { service, requireModule } = makeService();
    service.sync();
    expect(requireModule).not.toHaveBeenCalled();

    // Second sync pass: index.ts is now written and ready
    vi.clearAllMocks();
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('downloading', true)];
      if (dir === `${SOURCE_DIR}/downloading`) return [makeEntry('aux.ts', false), makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');
    requireModule.mockReturnValue({ create: () => ({ name: 'downloading', setup: vi.fn() }) });

    service.sync();
    expect(requireModule).toHaveBeenCalledWith(`${DIST_DIR}/downloading`);
    expect(ToolPluginsSingleton.replace).toHaveBeenCalled();
  });

  it('allows forced re-sync of an already known slug', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === SOURCE_DIR) return [makeEntry('existing', true)];
      if (dir === `${SOURCE_DIR}/existing`) return [makeEntry('index.ts', false)];
      throw new Error(`unexpected readdirSync(${dir})`);
    });
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('source');

    const { service, requireModule } = makeService({}, ['existing']);
    requireModule.mockReturnValue({ create: () => ({ name: 'existing', setup: vi.fn() }) });

    // Normal sync skips it
    service.sync();
    expect(requireModule).not.toHaveBeenCalled();

    // Forced sync reloads it
    service.sync('existing');
    expect(requireModule).toHaveBeenCalledWith(`${DIST_DIR}/existing`);
  });

  it('stop closes the watcher', () => {
    (readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const { service } = makeService();

    service.start();
    service.stop();

    const watcher = (watch as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(watcher.close).toHaveBeenCalled();
  });
});
