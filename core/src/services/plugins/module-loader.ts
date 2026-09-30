import type * as fs from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import type { Plugin, PluginRegistry } from '../../../../plugins/registry';

interface PluginModule<Context> {
  create?(context: Context): Plugin | null;
}

interface ModuleLoaderOptions<Context> {
  sourceDir: string;
  distDir: string;
  context: Context;
  registry: PluginRegistry;
  fileSystem: Pick<typeof fs, 'readdirSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync'>;
  requireModule?: (modulePath: string) => PluginModule<Context>;
  transpile?: (source: string, filename: string) => string;
}

/** Compiles and loads one plugin; family-specific registration stays with the caller. */
export function loadPluginModule<Context>(slug: string, options: ModuleLoaderOptions<Context>): boolean {
  const sourceDir = join(options.sourceDir, slug);
  const distDir = join(options.distDir, slug);
  const { fileSystem } = options;
  let entries;
  try {
    entries = fileSystem.readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    // A folder can disappear between discovery and loading.
    return false;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts')
      && !/\.(?:test|spec|d)\.ts$/.test(entry.name));
  // An incomplete download remains retryable until its entry point exists.
  if (!files.some((file) => file.name === 'index.ts')) return false;

  fileSystem.mkdirSync(distDir, { recursive: true });
  const transpile = options.transpile ?? ((source: string, filename: string) =>
    transformSync(source, { loader: 'ts', format: 'cjs', sourcefile: filename }).code);
  const outputs = files.map((file) => {
    const sourcePath = join(sourceDir, file.name);
    const outputPath = join(distDir, file.name.replace(/\.ts$/, '.js'));
    fileSystem.writeFileSync(outputPath, transpile(fileSystem.readFileSync(sourcePath, 'utf-8'), sourcePath), 'utf-8');
    return outputPath;
  });

  // Refresh helper modules too: re-pulling a plugin may change config.js alone.
  for (const modulePath of [distDir, ...outputs]) {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch {
      // A newly compiled module has no cache entry yet.
    }
  }

  const loadModule = options.requireModule ?? ((modulePath: string) => require(modulePath) as PluginModule<Context>);
  const module = loadModule(distDir);
  if (typeof module.create !== 'function') return false;
  const plugin = module.create(options.context);
  if (!plugin) return false;
  plugin.setup(options.registry);
  return true;
}
