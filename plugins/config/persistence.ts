import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Replace a config file only after its complete contents are written to disk. */
export function writeConfigFileAtomic(destination: string, content: string): void {
  const directory = dirname(destination);
  mkdirSync(directory, { recursive: true });
  let mode = 0o600;
  try {
    mode = statSync(destination).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', mode);
    writeFileSync(descriptor, content, 'utf-8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, destination);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
