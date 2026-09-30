import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeConfigFileAtomic } from './persistence';

const directories: string[] = [];
function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'koris-atomic-config-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('writeConfigFileAtomic', () => {
  it('creates parent directories and replaces a complete file without temporary leftovers', () => {
    const directory = join(createDirectory(), 'nested');
    const destination = join(directory, 'config.json');
    writeConfigFileAtomic(destination, 'first');
    writeConfigFileAtomic(destination, 'second');
    expect(readFileSync(destination, 'utf-8')).toBe('second');
    expect(readdirSync(directory)).toEqual(['config.json']);
  });

  it.skipIf(process.platform === 'win32')('restricts new files and preserves existing permissions', () => {
    const destination = join(createDirectory(), 'config.json');
    writeConfigFileAtomic(destination, 'secret');
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    chmodSync(destination, 0o640);
    writeConfigFileAtomic(destination, 'new secret');
    expect(statSync(destination).mode & 0o777).toBe(0o640);
  });

  it('cleans up a failed replacement and preserves the destination', () => {
    const directory = createDirectory();
    const destination = join(directory, 'config.json');
    mkdirSync(destination);
    writeFileSync(join(destination, 'existing'), 'keep');
    expect(() => writeConfigFileAtomic(destination, 'new')).toThrow();
    expect(readFileSync(join(destination, 'existing'), 'utf-8')).toBe('keep');
    expect(readdirSync(directory)).toEqual(['config.json']);
  });
});
