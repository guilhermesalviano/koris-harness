import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('fs', () => fsMock);

// InjectManager caches its result in a `static` field, so each test needs a
// fresh module instance (fresh static state) — reset modules and re-import
// per test rather than sharing one import across the whole file.
async function freshInjectManager() {
  vi.resetModules();
  const mod = await import('../../../src/services/inject-manager');
  return mod.InjectManager;
}

describe('InjectManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads from <cwd>/core/load, not <cwd>/load', async () => {
    fsMock.existsSync.mockReturnValue(false);
    const InjectManager = await freshInjectManager();

    InjectManager.getInjectedContent();

    const checkedPath = fsMock.existsSync.mock.calls[0][0] as string;
    expect(checkedPath.endsWith(path.join('core', 'load'))).toBe(true);
  });

  it('returns an empty string when the directory does not exist', async () => {
    fsMock.existsSync.mockReturnValue(false);
    const InjectManager = await freshInjectManager();

    expect(InjectManager.getInjectedContent()).toBe('');
    expect(fsMock.readdirSync).not.toHaveBeenCalled();
  });

  it('concatenates every .md file with a blank-line separator', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['SOUL.md', 'EXTRA.md']);
    fsMock.readFileSync.mockImplementation((filePath: string) =>
      filePath.endsWith('SOUL.md') ? 'You are Koris.' : 'Extra context.',
    );
    const InjectManager = await freshInjectManager();

    expect(InjectManager.getInjectedContent()).toBe('You are Koris.\n\nExtra context.');
  });

  it('ignores non-.md files in the directory', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['SOUL.md', '.gitkeep', 'notes.txt']);
    fsMock.readFileSync.mockReturnValue('You are Koris.');
    const InjectManager = await freshInjectManager();

    expect(InjectManager.getInjectedContent()).toBe('You are Koris.');
    expect(fsMock.readFileSync).toHaveBeenCalledTimes(1);
  });

  it('caches the result — reads the filesystem only once across multiple calls', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['SOUL.md']);
    fsMock.readFileSync.mockReturnValue('You are Koris.');
    const InjectManager = await freshInjectManager();

    InjectManager.getInjectedContent();
    InjectManager.getInjectedContent();

    expect(fsMock.readdirSync).toHaveBeenCalledTimes(1);
    expect(fsMock.readFileSync).toHaveBeenCalledTimes(1);
  });
});
