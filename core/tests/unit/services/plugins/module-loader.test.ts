import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fileSystem from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRegistry } from '../../../../../plugins/registry';
import { loadPluginModule } from '../../../../src/services/plugins/module-loader';

const roots: string[] = [];

function makeOptions() {
  const root = fileSystem.mkdtempSync(join(tmpdir(), 'plugin-loader-'));
  roots.push(root);
  const sourceDir = join(root, 'source');
  fileSystem.mkdirSync(join(sourceDir, 'demo'), { recursive: true });
  return {
    sourceDir, distDir: join(root, 'dist'), fileSystem,
    context: { record: vi.fn() }, registry: new PluginRegistry(),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    for (const modulePath of Object.keys(require.cache)) {
      if (modulePath.startsWith(root)) delete require.cache[modulePath];
    }
    fileSystem.rmSync(root, { recursive: true, force: true });
  }
});

describe('loadPluginModule', () => {
  it('keeps a disappearing plugin folder retryable', () => {
    const options = makeOptions();
    expect(loadPluginModule('missing', options)).toBe(false);
  });

  it('reloads helper modules after a plugin is recompiled', () => {
    const options = makeOptions();
    const source = join(options.sourceDir, 'demo');
    fileSystem.writeFileSync(join(source, 'index.ts'), `
      import { value } from './config';
      export function create(context: { record: (value: string) => void }) {
        return { name: 'demo', setup() { context.record(value); } };
      }
    `);
    fileSystem.writeFileSync(join(source, 'config.ts'), "export const value = 'first';");
    expect(loadPluginModule('demo', options)).toBe(true);
    expect(options.context.record).toHaveBeenLastCalledWith('first');

    fileSystem.writeFileSync(join(source, 'config.ts'), "export const value = 'second';");
    expect(loadPluginModule('demo', options)).toBe(true);
    expect(options.context.record).toHaveBeenLastCalledWith('second');
  });

  it('ignores tests and declarations while keeping an incomplete download retryable', () => {
    const options = makeOptions();
    const source = join(options.sourceDir, 'demo');
    for (const name of ['index.test.ts', 'index.spec.ts', 'index.d.ts']) {
      fileSystem.writeFileSync(join(source, name), 'not valid TypeScript');
    }
    expect(loadPluginModule('demo', options)).toBe(false);
    fileSystem.writeFileSync(join(source, 'index.ts'), "export function create() { return { name: 'demo', setup() {} }; }");
    expect(loadPluginModule('demo', options)).toBe(true);
    expect(fileSystem.readdirSync(join(options.distDir, 'demo'))).toEqual(['index.js']);
  });
});
