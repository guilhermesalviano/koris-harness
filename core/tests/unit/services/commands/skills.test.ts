import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../../../../src/config';

const getRecent = vi.fn();

vi.mock('../../../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: { create: () => ({}) },
}));

vi.mock('../../../../src/repositories/learned-skills', () => ({
  LearnedSkillsRepositoryFactory: { create: () => ({ getRecent }) },
}));

const syncMock = vi.fn();
vi.mock('../../../../src/services/skills/skill-sync', () => ({
  SkillSyncSingleton: {
    getExistingInstance: vi.fn(() => ({ sync: syncMock })),
  },
}));

const listMissingMock = vi.fn();
const pullEntryMock = vi.fn();
vi.mock('../../../../../scripts/hub-sync', () => ({
  listMissing: (...args: unknown[]) => listMissingMock(...args),
  pullEntry: (...args: unknown[]) => pullEntryMock(...args),
}));

import {
  handleSkillsCommand,
  isSkillCommand,
  listSkillCommands,
  listSkills,
  resolveSkillCommand,
} from '../../../../src/services/commands/skills';

const originalMode = config.SKILLS.MODE;

function setMode(mode: 'auto' | 'manual') {
  (config.SKILLS as { MODE: string }).MODE = mode;
}

beforeEach(() => {
  getRecent.mockReset();
  getRecent.mockReturnValue([
    { name: 'cat-fact', description: 'Random cat facts', content: 'Call catfact.ninja.' },
    { name: 'weather', description: 'Forecasts', content: 'Call wttr.in.' },
  ]);
  setMode('manual');
});

afterEach(() => {
  setMode(originalMode);
});

describe('resolveSkillCommand', () => {
  it('resolves the short form and keeps the rest of the message as args', () => {
    expect(resolveSkillCommand('/weather Rio de Janeiro')).toEqual({
      name: 'weather',
      content: 'Call wttr.in.',
      args: 'Rio de Janeiro',
    });
  });

  it('resolves the explicit /skill form', () => {
    expect(resolveSkillCommand('/skill cat-fact tell me one')).toEqual({
      name: 'cat-fact',
      content: 'Call catfact.ninja.',
      args: 'tell me one',
    });
  });

  it('resolves a bare invocation with empty args', () => {
    expect(resolveSkillCommand('/cat-fact')).toMatchObject({ name: 'cat-fact', args: '' });
    expect(resolveSkillCommand('/skill cat-fact')).toMatchObject({ name: 'cat-fact', args: '' });
  });

  it('is case-insensitive on the skill name', () => {
    expect(resolveSkillCommand('/Weather Rio')).toMatchObject({ name: 'weather', args: 'Rio' });
  });

  it('returns null for an unknown skill', () => {
    expect(resolveSkillCommand('/nope do a thing')).toBeNull();
    expect(resolveSkillCommand('/skill nope')).toBeNull();
  });

  it('returns null for a skill that is not enabled', () => {
    // getRecent only ever returns enabled rows, so a disabled skill is simply absent.
    getRecent.mockReturnValue([{ name: 'weather', description: 'Forecasts', content: 'Call wttr.in.' }]);
    expect(resolveSkillCommand('/cat-fact')).toBeNull();
  });

  it('returns null in auto mode, so the message flows to the agent unchanged', () => {
    setMode('auto');
    expect(resolveSkillCommand('/weather Rio')).toBeNull();
    expect(getRecent).not.toHaveBeenCalled();
  });

  it('ignores non-command text and paths', () => {
    expect(resolveSkillCommand('weather Rio')).toBeNull();
    expect(resolveSkillCommand('')).toBeNull();
    expect(resolveSkillCommand('/path/to/file.ts')).toBeNull();
    expect(resolveSkillCommand('/skill')).toBeNull();
  });

  it('respects the configured skill limit', () => {
    resolveSkillCommand('/weather');
    expect(getRecent).toHaveBeenCalledWith(config.SKILLS.LIMIT);
  });
});

describe('isSkillCommand', () => {
  it('mirrors resolveSkillCommand', () => {
    expect(isSkillCommand('/cat-fact')).toBe(true);
    expect(isSkillCommand('/nope')).toBe(false);

    setMode('auto');
    expect(isSkillCommand('/cat-fact')).toBe(false);
  });
});

describe('listSkills', () => {
  it('reports every enabled skill in manual mode', () => {
    expect(listSkills()).toEqual([
      { name: 'cat-fact', description: 'Random cat facts' },
      { name: 'weather', description: 'Forecasts' },
    ]);
  });

  it('reports them in auto mode too, unlike listSkillCommands', () => {
    setMode('auto');

    expect(listSkills()).toEqual([
      { name: 'cat-fact', description: 'Random cat facts' },
      { name: 'weather', description: 'Forecasts' },
    ]);
    expect(listSkillCommands()).toEqual([]);
  });

  it('respects the configured limit', () => {
    listSkills();
    expect(getRecent).toHaveBeenCalledWith(config.SKILLS.LIMIT);
  });

  it('is empty when nothing is enabled', () => {
    getRecent.mockReturnValue([]);
    expect(listSkills()).toEqual([]);
  });
});

describe('listSkillCommands', () => {
  it('summarizes the enabled skills in manual mode', () => {
    expect(listSkillCommands()).toEqual([
      { name: 'cat-fact', description: 'Random cat facts' },
      { name: 'weather', description: 'Forecasts' },
    ]);
  });

  it('is empty in auto mode', () => {
    setMode('auto');
    expect(listSkillCommands()).toEqual([]);
  });
});

describe('handleSkillsCommand', () => {
  it('refuses when learned skills are withheld from the sender', async () => {
    const result = await handleSkillsCommand('/skills', { source: 'tui', learnedSkillsEnabled: false });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('trusted senders');
  });

  it('lists loaded skills by default in manual mode', async () => {
    setMode('manual');
    const result = await handleSkillsCommand('/skills', { source: 'tui' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Skills (2)');
    expect(result.response).toContain('/cat-fact');
    expect(result.response).toContain('/weather');
    expect(result.response).toContain('/skills remote');
  });

  it('lists loaded skills in auto mode without slashes', async () => {
    setMode('auto');
    const result = await handleSkillsCommand('/skills', { source: 'tui' });
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Skills (2)');
    expect(result.response).toContain('cat-fact');
    expect(result.response).not.toContain('/cat-fact');
  });

  it('reports when no skills are enabled', async () => {
    getRecent.mockReturnValue([]);
    const result = await handleSkillsCommand('/skills', { source: 'tui' });
    expect(result.response).toContain('No skills are enabled');
    expect(result.response).toContain('/skills remote');
  });

  it('lists remote skills available in koris-hub', async () => {
    listMissingMock.mockResolvedValueOnce([
      { family: 'skill', slug: 'weather', summary: 'Weather forecasts via wttr.in' },
      { family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' },
    ]);

    const result = await handleSkillsCommand('/skills remote', { source: 'tui' });
    expect(result.handled).toBe(true);
    expect(listMissingMock).toHaveBeenCalledWith({ baseDir: config.BASE_DIR });
    expect(result.response).toContain('Available Remote Skills (1)');
    expect(result.response).toContain('weather');
    expect(result.response).toContain('Weather forecasts via wttr.in');
    expect(result.response).not.toContain('issue');
    expect(result.response).toContain('/skills download <name>');
  });

  it('supports /skills list remote and /skills available', async () => {
    listMissingMock.mockResolvedValue([
      { family: 'skill', slug: 'weather', summary: 'Weather forecasts via wttr.in' },
    ]);

    const res1 = await handleSkillsCommand('/skills list remote', { source: 'tui' });
    expect(res1.response).toContain('Available Remote Skills (1)');

    const res2 = await handleSkillsCommand('/skills available', { source: 'tui' });
    expect(res2.response).toContain('Available Remote Skills (1)');
  });

  it('reports when no new remote skills are available', async () => {
    listMissingMock.mockResolvedValueOnce([
      { family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' },
    ]);

    const result = await handleSkillsCommand('/skills remote', { source: 'tui' });
    expect(result.response).toContain('No new remote skills available');
  });

  it('handles remote listing errors gracefully', async () => {
    listMissingMock.mockRejectedValueOnce(new Error('Network error'));

    const result = await handleSkillsCommand('/skills remote', { source: 'tui' });
    expect(result.response).toContain('Failed to reach koris-hub: Network error');
  });

  it('requires trusted sender to download skills', async () => {
    const result = await handleSkillsCommand('/skills download weather', { source: 'tui', trusted: false });
    expect(result.response).toContain('Downloading skills is restricted to trusted senders.');
  });

  it('requires a skill name when downloading', async () => {
    const result = await handleSkillsCommand('/skills download', { source: 'tui', trusted: true });
    expect(result.response).toContain('Missing skill name');
    expect(result.response).toContain('Usage: /skills download <name>');
  });

  it('downloads a skill and triggers sync', async () => {
    pullEntryMock.mockResolvedValueOnce({
      family: 'skill',
      slug: 'weather',
      createdFiles: ['plugins/skills/weather/SKILL.md'],
    });

    const result = await handleSkillsCommand('/skills download weather', { source: 'tui', trusted: true });
    expect(pullEntryMock).toHaveBeenCalledWith('weather', {
      baseDir: config.BASE_DIR,
      family: 'skill',
      force: false,
    });
    expect(syncMock).toHaveBeenCalled();
    expect(result.response).toContain('Successfully downloaded skill "weather"');
  });

  it('supports /skills pull and /skills install aliases with --force', async () => {
    pullEntryMock.mockResolvedValueOnce({
      family: 'skill',
      slug: 'weather',
      createdFiles: ['plugins/skills/weather/SKILL.md'],
    });

    const result = await handleSkillsCommand('/skills pull weather --force', { source: 'tui', trusted: true });
    expect(pullEntryMock).toHaveBeenCalledWith('weather', {
      baseDir: config.BASE_DIR,
      family: 'skill',
      force: true,
    });
    expect(result.response).toContain('Successfully downloaded skill "weather"');
  });

  it('handles download failure gracefully', async () => {
    pullEntryMock.mockRejectedValueOnce(new Error('"weather" was not found'));

    const result = await handleSkillsCommand('/skills download weather', { source: 'tui', trusted: true });
    expect(result.response).toContain('Failed to download skill "weather": "weather" was not found');
  });

  it('shows usage for unknown subcommands', async () => {
    const result = await handleSkillsCommand('/skills unknown', { source: 'tui' });
    expect(result.response).toContain('Usage: /skills');
    expect(result.response).toContain('/skills remote');
    expect(result.response).toContain('/skills download <name>');
  });
});

