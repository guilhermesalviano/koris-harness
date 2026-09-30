import { watch, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../../config';
import { SKILL_LEARNING_PROMPT } from '../../constants';
import { replacePlaceholders } from '../../utils/prompt';
import { ISkillsRepository } from '../../repositories/skills';
import { ILearnedSkillsRepository } from '../../repositories/learned-skills';
import { ILogger } from '../../infrastructure/logger';
import type { Skill } from '../../types/skills';
import { DirectoryWatcher } from '../plugins/directory-watcher';

interface ISkillSyncService {
  sync(): void;
  start(): void;
  stop(): void;
}

class SkillSyncService implements ISkillSyncService {
  private readonly watcher: DirectoryWatcher;

  constructor(
    private logger: ILogger,
    private skillsRepo: Pick<ISkillsRepository, 'get'>,
    private learnedSkillsRepo: Pick<ILearnedSkillsRepository, 'save' | 'deleteNotIn'>,
  ) {
    this.watcher = new DirectoryWatcher({
      root: () => join(config.BASE_DIR, 'plugins', 'skills'),
      directories: () => skillsRepo.get().map((skill) => skill.name),
      watch,
      onChange: () => this.sync(),
      onError: (error) => logger.warn('[skill-sync] Failed to watch skills directory', {
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }

  sync(): void {
    const skills = this.skillsRepo.get();

    for (const skill of skills) {
      this.learnedSkillsRepo.save({
        name: skill.name,
        description: skill.description,
        read_when: skill.read_when ?? null,
        content: this.buildLearningPrompt(skill),
      });
    }

    const removed = this.learnedSkillsRepo.deleteNotIn(skills.map(skill => skill.name));

    this.watcher.refresh();

    this.logger.info(`[skill-sync] Synced ${skills.length} skills from disk (${removed} removed)`);
  }

  start(): void {
    const skillsPath = join(config.BASE_DIR, 'plugins', 'skills');
    mkdirSync(skillsPath, { recursive: true });

    this.sync();
    this.watcher.start();
    this.logger.info('[skill-sync] Watching skills directory for changes');
  }

  stop(): void {
    this.watcher.stop();
  }

  private buildLearningPrompt(skill: Skill): string {
    const skillContent = (skill.content ?? '').replace(/<GATEWAY_HOST>/g, config.GATEWAY_HOST);
    return replacePlaceholders(
      SKILL_LEARNING_PROMPT,
      { v1: skill.name, v2: skillContent }
    );
  }
}

class SkillSyncSingleton {
  private static instance: SkillSyncService | null = null;

  static getInstance(
    logger: ILogger,
    skillsRepo: ISkillsRepository,
    learnedSkillsRepo: ILearnedSkillsRepository,
  ): SkillSyncService {
    if (!SkillSyncSingleton.instance) {
      SkillSyncSingleton.instance = new SkillSyncService(logger, skillsRepo, learnedSkillsRepo);
    }
    return SkillSyncSingleton.instance;
  }

  static getExistingInstance(): SkillSyncService | null {
    return SkillSyncSingleton.instance;
  }
}

export { ISkillSyncService, SkillSyncService, SkillSyncSingleton };
