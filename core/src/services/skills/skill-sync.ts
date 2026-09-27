import { watch, type FSWatcher } from 'fs';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../../config';
import { SKILL_LEARNING_PROMPT } from '../../constants';
import { replacePlaceholders } from '../../utils/prompt';
import { ISkillsRepository } from '../../repositories/skills';
import { ILearnedSkillsRepository } from '../../repositories/learned-skills';
import { ILogger } from '../../infrastructure/logger';
import type { Skill } from '../../types/skills';

const DEBOUNCE_MS = 500;

interface ISkillSyncService {
  sync(): void;
  start(): void;
  stop(): void;
}

class SkillSyncService implements ISkillSyncService {
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watching = false;

  constructor(
    private logger: ILogger,
    private skillsRepo: ISkillsRepository,
    private learnedSkillsRepo: ILearnedSkillsRepository,
  ) {}

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

    if (this.watching) {
      this.registerWatchers(join(config.BASE_DIR, 'plugins', 'skills'));
    }

    this.logger.info(`[skill-sync] Synced ${skills.length} skills from disk (${removed} removed)`);
  }

  start(): void {
    const skillsPath = join(config.BASE_DIR, 'plugins', 'skills');
    mkdirSync(skillsPath, { recursive: true });

    this.watching = true;
    this.sync();
    this.logger.info('[skill-sync] Watching skills directory for changes');
  }

  stop(): void {
    this.watching = false;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.closeWatchers();
  }

  private registerWatchers(skillsPath: string): void {
    this.closeWatchers();

    try {
      this.watchers.push(
        watch(skillsPath, { persistent: true }, () => this.scheduleSync()),
      );

      const skills = this.skillsRepo.get();
      for (const skill of skills) {
        this.watchers.push(
          watch(join(skillsPath, skill.name), { persistent: true }, () => this.scheduleSync()),
        );
      }
    } catch (error) {
      this.logger.warn('[skill-sync] Failed to watch skills directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.sync(), DEBOUNCE_MS);
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
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