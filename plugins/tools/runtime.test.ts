import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// ── child_process mock (hoisted before imports) ─────────────────────────────

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

// ── imports (after mocks) ───────────────────────────────────────────────────

import {
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
} from './runtime';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  return proc;
}

// ── getRequiredStringArg ────────────────────────────────────────────────────

describe('getRequiredStringArg', () => {
  it('returns trimmed string for a present key', () => {
    expect(getRequiredStringArg({ key: '  hello  ' }, 'key')).toBe('hello');
  });

  it('returns null when key is missing', () => {
    expect(getRequiredStringArg({}, 'key')).toBeNull();
  });

  it('returns null when value is not a string', () => {
    expect(getRequiredStringArg({ key: 42 }, 'key')).toBeNull();
    expect(getRequiredStringArg({ key: null }, 'key')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(getRequiredStringArg({ key: '   ' }, 'key')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getRequiredStringArg({ key: '' }, 'key')).toBeNull();
  });
});

// ── getOptionalStringArg ────────────────────────────────────────────────────

describe('getOptionalStringArg', () => {
  it('returns trimmed string when present', () => {
    expect(getOptionalStringArg({ k: '  hi  ' }, 'k')).toBe('hi');
  });

  it('returns null when key is missing', () => {
    expect(getOptionalStringArg({}, 'k')).toBeNull();
  });

  it('returns null for non-string value', () => {
    expect(getOptionalStringArg({ k: 99 }, 'k')).toBeNull();
  });

  it('returns empty string for whitespace-only (not stripped to null)', () => {
    expect(getOptionalStringArg({ k: '   ' }, 'k')).toBe('');
  });
});

// ── getOptionalStringArrayArg ───────────────────────────────────────────────

describe('getOptionalStringArrayArg', () => {
  it('returns string elements from array', () => {
    expect(getOptionalStringArrayArg({ k: ['a', 'b', 'c'] }, 'k')).toEqual(['a', 'b', 'c']);
  });

  it('filters out non-string items', () => {
    expect(getOptionalStringArrayArg({ k: ['a', 1, null, 'b'] }, 'k')).toEqual(['a', 'b']);
  });

  it('returns empty array when key is missing', () => {
    expect(getOptionalStringArrayArg({}, 'k')).toEqual([]);
  });

  it('returns empty array when value is not an array', () => {
    expect(getOptionalStringArrayArg({ k: 'string' }, 'k')).toEqual([]);
  });
});

// ── getOptionalDataArg ──────────────────────────────────────────────────────

describe('getOptionalDataArg', () => {
  it('returns the trimmed string when present', () => {
    expect(getOptionalDataArg({ k: '  coffee  ' }, 'k')).toBe('coffee');
  });

  it('returns null for whitespace-only or empty strings', () => {
    expect(getOptionalDataArg({ k: '   ' }, 'k')).toBeNull();
    expect(getOptionalDataArg({ k: '' }, 'k')).toBeNull();
  });

  it('serializes a plain object value to JSON', () => {
    expect(getOptionalDataArg({ k: { a: 1, b: 'x' } }, 'k')).toBe('{"a":1,"b":"x"}');
  });

  it('returns null for arrays, numbers and missing keys', () => {
    expect(getOptionalDataArg({ k: [1, 2] }, 'k')).toBeNull();
    expect(getOptionalDataArg({ k: 42 }, 'k')).toBeNull();
    expect(getOptionalDataArg({}, 'k')).toBeNull();
  });
});

// ── getOptionalNumberArg ────────────────────────────────────────────────────

describe('getOptionalNumberArg', () => {
  it('returns the number when valid and finite', () => {
    expect(getOptionalNumberArg({ k: 42 }, 'k', 99)).toBe(42);
  });

  it('returns default when key is missing', () => {
    expect(getOptionalNumberArg({}, 'k', 99)).toBe(99);
  });

  it('returns default for non-finite values', () => {
    expect(getOptionalNumberArg({ k: Infinity }, 'k', 5)).toBe(5);
    expect(getOptionalNumberArg({ k: NaN }, 'k', 5)).toBe(5);
  });

  it('returns default for non-number value', () => {
    expect(getOptionalNumberArg({ k: '42' }, 'k', 7)).toBe(7);
  });
});

// ── getOptionalBooleanArg ───────────────────────────────────────────────────

describe('getOptionalBooleanArg', () => {
  it('returns true when set', () => {
    expect(getOptionalBooleanArg({ k: true }, 'k', false)).toBe(true);
  });

  it('returns false when set', () => {
    expect(getOptionalBooleanArg({ k: false }, 'k', true)).toBe(false);
  });

  it('returns default when key is missing', () => {
    expect(getOptionalBooleanArg({}, 'k', true)).toBe(true);
  });

  it('returns default for non-boolean value', () => {
    expect(getOptionalBooleanArg({ k: 1 }, 'k', false)).toBe(false);
  });
});

// ── getOptionalStringRecord ─────────────────────────────────────────────────

describe('getOptionalStringRecord', () => {
  it('returns a string-string record', () => {
    expect(getOptionalStringRecord({ k: { a: '1', b: '2' } }, 'k')).toEqual({ a: '1', b: '2' });
  });

  it('returns null when key is missing', () => {
    expect(getOptionalStringRecord({}, 'k')).toBeNull();
  });

  it('returns null for arrays', () => {
    expect(getOptionalStringRecord({ k: ['a', 'b'] }, 'k')).toBeNull();
  });

  it('returns null when any value is not a string', () => {
    expect(getOptionalStringRecord({ k: { a: '1', b: 2 } }, 'k')).toBeNull();
  });

  it('returns null for null value', () => {
    expect(getOptionalStringRecord({ k: null }, 'k')).toBeNull();
  });
});

// ── isAllowedValue ──────────────────────────────────────────────────────────

describe('isAllowedValue', () => {
  const METHODS = ['GET', 'POST', 'PUT'] as const;

  it('returns true for a value in the list', () => {
    expect(isAllowedValue('GET', METHODS)).toBe(true);
  });

  it('returns false for a value not in the list', () => {
    expect(isAllowedValue('HACK', METHODS)).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isAllowedValue('get', METHODS)).toBe(false);
  });
});

// ── execFilePromise ─────────────────────────────────────────────────────────

describe('execFilePromise', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('resolves with stdout on success', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, 'hello\n'));

    const result = await execFilePromise('echo', ['hello'], 5000);

    expect(result).toBe('hello\n');
    expect(mockExecFile).toHaveBeenCalledWith(
      'echo',
      ['hello'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('rejects when the callback receives an error', async () => {
    const error = new Error('command failed');
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(error, ''));

    await expect(execFilePromise('bad', [], 5000)).rejects.toThrow('command failed');
  });
});

// ── spawnCommand ────────────────────────────────────────────────────────────

describe('spawnCommand', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('resolves with stdout, stderr and exit code on normal exit', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCommand({ command: 'echo', args: ['hi'], shell: false });

    setImmediate(() => {
      proc.stdout.push('hi\n');
      proc.stdout.push(null);
      proc.emit('close', 0);
    });

    const result = await promise;

    expect(result).toEqual({ stdout: 'hi\n', stderr: '', code: 0 });
    expect(mockSpawn).toHaveBeenCalledWith(
      'echo',
      ['hi'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('captures stderr alongside stdout', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCommand({ command: 'cmd', args: [] });

    setImmediate(() => {
      proc.stderr.push('warning\n');
      proc.stderr.push(null);
      proc.emit('close', 1);
    });

    const result = await promise;

    expect(result.stderr).toBe('warning\n');
    expect(result.code).toBe(1);
  });

  it('rejects when spawn emits an error event', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCommand({ command: 'missing', args: [] });

    setImmediate(() => {
      proc.emit('error', new Error('ENOENT'));
    });

    await expect(promise).rejects.toThrow('ENOENT');
  });

  it('rejects and kills the child when output exceeds maxOutputSize', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCommand({ command: 'big', args: [], maxOutputSize: 5 });

    setImmediate(() => {
      proc.stdout.push('123456');
    });

    await expect(promise).rejects.toThrow('Output size exceeded maximum buffer limit.');
    expect(proc.kill).toHaveBeenCalled();
  });

  it('passes cwd option through to spawn', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCommand({ command: 'ls', args: [], cwd: '/tmp' });

    setImmediate(() => {
      proc.emit('close', 0);
    });

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'ls',
      [],
      expect.objectContaining({ cwd: '/tmp' }),
    );
  });

  it('does not settle twice when both close and error fire', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = spawnCommand({ command: 'cmd', args: [] });

    setImmediate(() => {
      proc.emit('close', 0);
      proc.emit('error', new Error('late error'));
    });

    await expect(promise).resolves.toMatchObject({ code: 0 });
  });

  describe('timeoutMs', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('kills the child and resolves with code null once the timeout elapses', async () => {
      const proc = makeProc();
      mockSpawn.mockReturnValue(proc);

      const promise = spawnCommand({ command: 'sleep', args: ['999'], timeoutMs: 1000 });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(proc.kill).toHaveBeenCalled();
      expect(result.code).toBeNull();
      expect(result.stderr).toContain('timed out after 1000ms');
    });

    it('does not settle twice when close fires after the timeout already resolved', async () => {
      const proc = makeProc();
      mockSpawn.mockReturnValue(proc);

      const promise = spawnCommand({ command: 'sleep', args: ['999'], timeoutMs: 1000 });

      await vi.advanceTimersByTimeAsync(1000);
      proc.emit('close', 0);

      const result = await promise;

      expect(result.code).toBeNull();
    });

    it('does not fire the timeout when the process closes in time', async () => {
      const proc = makeProc();
      mockSpawn.mockReturnValue(proc);

      const promise = spawnCommand({ command: 'echo', args: ['hi'], timeoutMs: 1000 });

      proc.emit('close', 0);
      const result = await promise;
      await vi.advanceTimersByTimeAsync(1000);

      expect(result.code).toBe(0);
      expect(proc.kill).not.toHaveBeenCalled();
    });
  });
});
