import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';
import { parse } from 'yaml';
import { mergePluginConfigPatch, writePluginConfigPatch } from './writer';

describe('mergePluginConfigPatch', () => {
  it('overlays scalar values from the patch onto the base', () => {
    const merged = mergePluginConfigPatch({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(merged).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('recurses into nested plain objects rather than replacing them wholesale', () => {
    const merged = mergePluginConfigPatch(
      { nested: { keep: 'yes', override: 'old' }, top: 1 },
      { nested: { override: 'new', added: true } },
    );
    expect(merged).toEqual({
      nested: { keep: 'yes', override: 'new', added: true },
      top: 1,
    });
  });

  it('replaces arrays instead of merging them', () => {
    const merged = mergePluginConfigPatch({ list: [1, 2, 3] }, { list: [9] });
    expect(merged).toEqual({ list: [9] });
  });

  it('lets the patch replace an object with a scalar (and vice versa)', () => {
    expect(mergePluginConfigPatch({ x: { deep: 1 } }, { x: 'flat' })).toEqual({ x: 'flat' });
    expect(mergePluginConfigPatch({ x: 'flat' }, { x: { deep: 1 } })).toEqual({ x: { deep: 1 } });
  });

  it('does not mutate the base object', () => {
    const base = { nested: { a: 1 } };
    mergePluginConfigPatch(base, { nested: { b: 2 } });
    expect(base).toEqual({ nested: { a: 1 } });
  });
});

describe('writePluginConfigPatch', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'koris-writer-test-'));
  });

  afterEach(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  it('writes the patch as YAML when no config file exists yet', () => {
    const writeFile = vi.fn();
    const path = writePluginConfigPatch(
      { token: 'abc', nested: { on: true } },
      { pluginDir, exists: () => false, writeFile },
    );

    expect(path).toBe(normalize(join(pluginDir, 'config.yml')));
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(parse(writeFile.mock.calls[0][1])).toEqual({ token: 'abc', nested: { on: true } });
  });

  it('merges the patch onto an existing config file', () => {
    const writeFile = vi.fn();
    writePluginConfigPatch(
      { nested: { added: 1 }, top: 'new' },
      {
        pluginDir,
        exists: () => true,
        readFile: () => 'top: old\nnested:\n  kept: 2\n',
        writeFile,
      },
    );

    expect(parse(writeFile.mock.calls[0][1])).toEqual({
      top: 'new',
      nested: { kept: 2, added: 1 },
    });
  });

  it('honours a custom filename', () => {
    const writeFile = vi.fn();
    const path = writePluginConfigPatch(
      { a: 1 },
      { pluginDir, filename: 'settings.yml', exists: () => false, writeFile },
    );
    expect(path).toBe(normalize(join(pluginDir, 'settings.yml')));
  });

  it('overwrites a corrupt existing file instead of throwing', () => {
    const writeFile = vi.fn();
    writePluginConfigPatch(
      { fresh: true },
      {
        pluginDir,
        exists: () => true,
        readFile: () => ':\n  - not: valid: yaml: at all\n[',
        writeFile,
      },
    );
    expect(parse(writeFile.mock.calls[0][1])).toEqual({ fresh: true });
  });

  it('ignores a non-object parse result (e.g. a bare scalar file)', () => {
    const writeFile = vi.fn();
    writePluginConfigPatch(
      { fresh: true },
      { pluginDir, exists: () => true, readFile: () => '"just a string"', writeFile },
    );
    expect(parse(writeFile.mock.calls[0][1])).toEqual({ fresh: true });
  });

  it('uses the real filesystem when no file IO is injected', () => {
    writeFileSync(join(pluginDir, 'config.yml'), 'top: old\nnested:\n  kept: 2\n');
    const path = writePluginConfigPatch({ nested: { added: 1 }, top: 'new' }, { pluginDir });

    expect(path).toBe(normalize(join(pluginDir, 'config.yml')));
    expect(parse(readFileSync(path, 'utf-8'))).toEqual({ top: 'new', nested: { kept: 2, added: 1 } });
  });
});
