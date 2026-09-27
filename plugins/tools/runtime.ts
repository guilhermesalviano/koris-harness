import { execFile, spawn } from 'node:child_process';

const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

interface SpawnCommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  shell?: boolean;
  maxOutputSize?: number;
  /** Kill the child and resolve (not reject) with `code: null` if it hasn't
   * closed within this many ms — callers branch on `code` uniformly instead
   * of needing a separate timeout-rejection shape. Note: the kill signal only
   * reaches this direct child, not any grandchildren it spawned (e.g. a
   * shell script's own `docker` calls), which may keep running to completion
   * independent of this timeout. */
  timeoutMs?: number;
}

interface SpawnCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function getRequiredStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getOptionalStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : null;
}

function getOptionalDataArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return null;
}

function getOptionalStringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function getOptionalNumberArg(args: Record<string, unknown>, key: string, defaultValue: number): number {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
}

function getOptionalBooleanArg(args: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const value = args[key];
  return typeof value === 'boolean' ? value : defaultValue;
}

function getOptionalStringRecord(args: Record<string, unknown>, key: string): Record<string, string> | null {
  const value = args[key];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.some(([entryKey, entryValue]) => typeof entryKey !== 'string' || typeof entryValue !== 'string')) {
    return null;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function isAllowedValue<T extends string>(value: string, allowedValues: readonly T[]): value is T {
  return allowedValues.includes(value as T);
}

function execFilePromise(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf-8', maxBuffer: MAX_OUTPUT_SIZE, timeout: timeoutMs },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(stdout as string);
      }
    );
  });
}

function spawnCommand(options: SpawnCommandOptions): Promise<SpawnCommandResult> {
  const maxOutputSize = options.maxOutputSize ?? MAX_OUTPUT_SIZE;

  return new Promise((resolve, reject) => {
    try {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        shell: options.shell ?? false,
      });

      let stdout = '';
      let stderr = '';
      let isSettled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const clearTimer = () => {
        if (timer) clearTimeout(timer);
      };

      const finish = (result: SpawnCommandResult) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimer();
        resolve(result);
      };

      const fail = (error: Error) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimer();
        reject(error);
      };

      if (options.timeoutMs) {
        timer = setTimeout(() => {
          child.kill();
          finish({ stdout, stderr: `${stderr}\n[timed out after ${options.timeoutMs}ms]`, code: null });
        }, options.timeoutMs);
      }

      child.stdout.on('data', (data) => {
        stdout += data.toString('utf-8');

        if (stdout.length > maxOutputSize) {
          child.kill();
          fail(new Error('Output size exceeded maximum buffer limit.'));
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      child.on('close', (code) => {
        finish({ stdout, stderr, code });
      });

      child.on('error', (error) => {
        fail(error);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export {
  execFilePromise,
  getOptionalBooleanArg,
  getOptionalDataArg,
  getOptionalNumberArg,
  getOptionalStringArg,
  getOptionalStringArrayArg,
  getOptionalStringRecord,
  getRequiredStringArg,
  isAllowedValue,
  spawnCommand,
};
