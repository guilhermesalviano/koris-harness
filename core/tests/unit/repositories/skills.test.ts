import { describe, it, expect, vi } from 'vitest';
import { SkillsRepository, SkillsRepositoryFactory } from '../../../src/repositories/skills';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const configMock = vi.hoisted(() => ({
  config: { BASE_DIR: '/base' },
}));

vi.mock('fs', () => fsMock);
vi.mock('../../../src/config', () => configMock);

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const SKILL_MD = [
  '---',
  'name: Git Helper',
  'description: Git tips and commands',
  'read_when: working with git',
  '---',
  '',
  '# Git Helper',
  'Use `git rebase`.',
].join('\n');

function makeEntry(name: string, isDir = true) {
  return { name, isDirectory: () => isDir };
}

describe('SkillsRepository', () => {
  it('get returns an empty array when the skills path is missing', () => {
    fsMock.existsSync.mockReturnValue(false);
    const repository = new SkillsRepository(logger as never);

    expect(repository.get()).toEqual([]);
  });

  it('get parses SKILL.md files into skills', () => {
    fsMock.existsSync.mockImplementation((path: string) => path.endsWith('SKILL.md') || path === '/base/plugins/skills');
    fsMock.readdirSync.mockReturnValue([makeEntry('git')]);
    fsMock.readFileSync.mockReturnValue(SKILL_MD);
    const repository = new SkillsRepository(logger as never);

    const skills = repository.get();

    expect(skills).toEqual([
      { name: 'Git Helper', description: 'Git tips and commands', read_when: ['working with git'], content: '\n# Git Helper\nUse `git rebase`.' },
    ]);
    expect(fsMock.readdirSync).toHaveBeenCalledWith('/base/plugins/skills', { withFileTypes: true });
    expect(fsMock.readFileSync).toHaveBeenCalledWith('/base/plugins/skills/git/SKILL.md', 'utf-8');
  });

  it('get falls back to the folder name when frontmatter has no name', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([makeEntry('git')]);
    fsMock.readFileSync.mockReturnValue(['---', '---', '', 'content'].join('\n'));
    const repository = new SkillsRepository(logger as never);

    const skills = repository.get();

    expect(skills).toEqual([{ name: 'git', description: '', read_when: null, content: '\ncontent' }]);
  });

  it('get skips folders without a SKILL.md file and warns', () => {
    fsMock.existsSync.mockImplementation((path: string) => path === '/base/plugins/skills');
    fsMock.readdirSync.mockReturnValue([makeEntry('broken')]);
    const repository = new SkillsRepository(logger as never);

    const skills = repository.get();

    expect(skills).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SKILL.md missing'));
  });

  it('findByName returns null when the skills path is missing', () => {
    fsMock.existsSync.mockReturnValue(false);
    const repository = new SkillsRepository(logger as never);

    expect(repository.findByName({ name: 'git' })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skill path not found'));
  });

  it('findByName returns null when the skill folder does not exist', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([makeEntry('other')]);
    const repository = new SkillsRepository(logger as never);

    expect(repository.findByName({ name: 'git' })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skill not found'));
  });

  it('findByName returns null when the SKILL.md file is missing', () => {
    fsMock.existsSync.mockImplementation((path: string) => path === '/base/plugins/skills');
    fsMock.readdirSync.mockReturnValue([makeEntry('git')]);
    const repository = new SkillsRepository(logger as never);

    expect(repository.findByName({ name: 'git' })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SKILL.md missing'));
  });

  it('findByName returns the skill including its content', () => {
    fsMock.existsSync.mockImplementation((path: string) => path.endsWith('SKILL.md') || path === '/base/plugins/skills');
    fsMock.readdirSync.mockReturnValue([makeEntry('git')]);
    fsMock.readFileSync.mockReturnValue(SKILL_MD);
    const repository = new SkillsRepository(logger as never);

    const skill = repository.findByName({ name: 'git' });

    expect(skill).toMatchObject({
      name: 'Git Helper',
      description: 'Git tips and commands',
      read_when: ['working with git'],
    });
    expect(skill?.content).toContain('# Git Helper');
    expect(skill?.content).toContain('Use `git rebase`.');
    expect(fsMock.readdirSync).toHaveBeenCalledWith('/base/plugins/skills', { withFileTypes: true });
    expect(fsMock.readFileSync).toHaveBeenCalledWith('/base/plugins/skills/git/SKILL.md', 'utf-8');
  });

  it('findByName falls back to an empty description when frontmatter has none', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([makeEntry('git')]);
    fsMock.readFileSync.mockReturnValue(['---', 'name: Git', '---', '', 'content'].join('\n'));
    const repository = new SkillsRepository(logger as never);

    const skill = repository.findByName({ name: 'git' });

    expect(skill?.description).toBe('');
    expect(skill?.read_when).toBeNull();
  });

  it('factory create returns a SkillsRepository', () => {
    expect(SkillsRepositoryFactory.create(logger as never)).toBeInstanceOf(SkillsRepository);
  });
});
