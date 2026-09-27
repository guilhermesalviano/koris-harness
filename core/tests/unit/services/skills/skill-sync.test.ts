import { describe, it, expect, vi, beforeEach } from 'vitest';
import { watch, mkdirSync } from 'fs';
import { SkillSyncService, SkillSyncSingleton } from '../../../../src/services/skills/skill-sync';
import { config } from '../../../../src/config';
import type { Skill } from '../../../../src/types/skills';

vi.mock('fs', () => ({
  watch: vi.fn(() => ({ close: vi.fn() })),
  mkdirSync: vi.fn(),
}));

function makeRepos() {
  const skillsRepo = {
    get: vi.fn(() => [
      { name: 'git', description: 'Git skill', read_when: ['when needed'], content: 'run rebase at <GATEWAY_HOST>/api' },
    ] as Skill[]),
  };
  const learnedRepo = {
    save: vi.fn(),
    deleteNotIn: vi.fn(() => 0),
  };
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { skillsRepo, learnedRepo, logger };
}

function makeService() {
  const repos = makeRepos();
  const service = new SkillSyncService(
    repos.logger as never,
    repos.skillsRepo as never,
    repos.learnedRepo as never,
  );
  return { service, ...repos };
}

describe('SkillSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores each disk skill wrapped in the learning prompt with GATEWAY_HOST resolved', () => {
    const { service, skillsRepo, learnedRepo } = makeService();

    service.sync();

    expect(skillsRepo.get).toHaveBeenCalledTimes(1);
    expect(learnedRepo.save).toHaveBeenCalledTimes(1);
    const saved = learnedRepo.save.mock.calls[0][0] as {
      name: string;
      description: string;
      read_when: string[];
      content: string;
    };
    expect(saved.name).toBe('git');
    expect(saved.description).toBe('Git skill');
    expect(saved.read_when).toEqual(['when needed']);
    expect(saved.content).toContain('Agent has just learned the "git" skill.');
    expect(saved.content).toContain('run rebase at');
    expect(saved.content).toContain(config.GATEWAY_HOST);
    expect(saved.content).not.toContain('<GATEWAY_HOST>');
  });

  it('prunes learned skills that no longer exist on disk', () => {
    const { service, skillsRepo, learnedRepo } = makeService();
    skillsRepo.get.mockReturnValue([
      { name: 'git', description: '', read_when: null, content: 'a' },
      { name: 'docker', description: '', read_when: null, content: 'b' },
    ] as Skill[]);
    learnedRepo.deleteNotIn.mockReturnValue(1);

    service.sync();

    expect(learnedRepo.deleteNotIn).toHaveBeenCalledWith(['git', 'docker']);
  });

  it('clears learned skills when the skills directory is empty', () => {
    const { service, skillsRepo, learnedRepo } = makeService();
    skillsRepo.get.mockReturnValue([]);

    service.sync();

    expect(learnedRepo.save).not.toHaveBeenCalled();
    expect(learnedRepo.deleteNotIn).toHaveBeenCalledWith([]);
  });

  it('start creates the skills dir, syncs, and watches base dir plus each skill', () => {
    const { service, learnedRepo } = makeService();

    service.start();

    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('skills'), { recursive: true });
    expect(learnedRepo.save).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(2);
  });

  it('stop closes registered watchers', () => {
    const { service } = makeService();

    service.start();
    service.stop();

    const baseWatcher = watch.mock.results[0].value;
    const skillWatcher = watch.mock.results[1].value;
    expect(baseWatcher.close).toHaveBeenCalled();
    expect(skillWatcher.close).toHaveBeenCalled();
  });

  it('logs a warning when registering watchers fails', () => {
    const { service, logger } = makeService();
    vi.mocked(watch).mockImplementationOnce(() => {
      throw new Error('EMFILE: too many open files');
    });

    service.start();

    expect(logger.warn).toHaveBeenCalledWith(
      '[skill-sync] Failed to watch skills directory',
      expect.objectContaining({ error: 'EMFILE: too many open files' }),
    );
  });

  it('debounces multiple watch events into a single sync', async () => {
    vi.useFakeTimers();
    let changeHandler: (() => void) | undefined;
    vi.mocked(watch).mockImplementation((_path, _opts, listener) => {
      if (typeof listener === 'function') changeHandler = listener as () => void;
      return { close: vi.fn() } as never;
    });

    const { service, learnedRepo } = makeService();
    service.start();
    expect(learnedRepo.save).toHaveBeenCalledTimes(1); // initial sync

    // Fire watcher callback multiple times
    changeHandler?.();
    changeHandler?.();
    changeHandler?.();

    // Before debounce timer expires, no extra sync
    expect(learnedRepo.save).toHaveBeenCalledTimes(1);

    // Advance past debounce timer
    vi.advanceTimersByTime(500);
    expect(learnedRepo.save).toHaveBeenCalledTimes(2);

    service.stop();
    vi.useRealTimers();
  });

  it('provides singleton access via SkillSyncSingleton', () => {
    const repos = makeRepos();
    const instance1 = SkillSyncSingleton.getInstance(
      repos.logger as never,
      repos.skillsRepo as never,
      repos.learnedRepo as never,
    );
    const instance2 = SkillSyncSingleton.getInstance(
      repos.logger as never,
      repos.skillsRepo as never,
      repos.learnedRepo as never,
    );

    expect(instance1).toBe(instance2);
    expect(SkillSyncSingleton.getExistingInstance()).toBe(instance1);
  });
});