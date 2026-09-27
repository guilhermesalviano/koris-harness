import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ILogger } from '../infrastructure/logger';
import matter from 'gray-matter';
import { config } from '../config';
import { Skill } from '../types/skills';

interface ISkillsRepository {
  get(): Skill[];
  findByName(params: { name: string }): Skill | null;
}

function normalizeDescription(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeReadWhen(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(part => part.trim()).filter(Boolean);
  }
  return null;
}

class SkillsRepository {
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  private parseSkill(entryName: string, skillFile: string): Skill | null {
    if (!existsSync(skillFile)) {
      return this.helperWarnAndReturn(this.logger, `Skill folder found but SKILL.md missing: ${entryName}`);
    }

    const raw = readFileSync(skillFile, 'utf-8');
    const { data, content } = matter(raw);

    return {
      name: String(data.name ?? entryName),
      description: normalizeDescription(data.description),
      read_when: normalizeReadWhen(data.read_when),
      content,
    };
  }

  get(): Skill[] {
    const skillsPath = join(config.BASE_DIR, 'plugins', 'skills');
    if (!existsSync(skillsPath)) return [];

    return readdirSync(skillsPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.parseSkill(entry.name, join(skillsPath, entry.name, 'SKILL.md')))
      .filter((skill): skill is Skill => skill !== null);
  }

  findByName(params: { name: string }): Skill | null {
    const skillsPath = join(config.BASE_DIR, 'plugins', 'skills');
    if (!existsSync(skillsPath)) return this.helperWarnAndReturn(this.logger, `Skill path not found.`);

    const entry = readdirSync(skillsPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .find(entry => entry.name === params.name);

    if (!entry) return this.helperWarnAndReturn(this.logger, `Skill not found: ${params.name}`);

    return this.parseSkill(entry.name, join(skillsPath, entry.name, 'SKILL.md'));
  }

  helperWarnAndReturn(logger: ILogger, message: string) {
    logger.warn(message);
    return null;
  }
}

class SkillsRepositoryFactory {
  static create(logger: ILogger): ISkillsRepository {
    return new SkillsRepository(logger);
  }
}

export { ISkillsRepository, SkillsRepository, SkillsRepositoryFactory };