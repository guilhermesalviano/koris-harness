/**
 * Dynamic skill commands, live only while `skills.mode` is `manual`.
 *
 * In that mode skill bodies are kept out of the system prompt, so a skill is
 * pulled in for a single turn by naming it: `/<skill-name> [request]` or
 * `/skill <name> [request]`. The resolved `content` is the
 * `SKILL_LEARNING_PROMPT`-wrapped body straight out of `learned_skills` — the
 * same text `context` mode would have injected for that one skill.
 *
 * These are deliberately absent from `SLASH_COMMANDS` (`registry.ts`), which
 * stays the static source of truth: a skill command exists only as long as its
 * row does, so it is resolved per message instead.
 */

import { DatabaseServiceFactory } from '../../infrastructure/db-sqlite';
import { LearnedSkillsRepositoryFactory } from '../../repositories/learned-skills';
import { config } from '../../config';
import { commandToken } from './registry';
import { listMissing, pullEntry } from '../../../../scripts/hub-sync';
import { SkillSyncSingleton } from '../skills/skill-sync';
import type { CommandContext, CommandResult } from '../../types/commands';
import { formatCommandResult } from './format';

export interface ResolvedSkillCommand {
  name: string;
  content: string;
  /** Whatever the human typed after the skill name; may be empty. */
  args: string;
}

export interface SkillCommandSummary {
  name: string;
  description: string;
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Enabled skills the LLM is given this turn, in either mode. */
function enabledSkills() {
  const repo = LearnedSkillsRepositoryFactory.create(DatabaseServiceFactory.create());
  return repo.getRecent(config.SKILLS.LIMIT);
}

/** The subset that is callable as a command — none outside `manual` mode. */
function commandableSkills() {
  return config.SKILLS.MODE === 'manual' ? enabledSkills() : [];
}

/**
 * Split a message into the skill name it targets and the remaining text,
 * accepting both `/skill <name> [args]` and the direct `/<name> [args]`.
 */
function parseSkillInvocation(message: string): { name: string; args: string } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;

  const token = commandToken(trimmed);
  const rest = trimmed.slice(token.length).trim();

  if (token === '/skill') {
    const [name = '', ...args] = rest.split(/\s+/);
    if (!name) return null;
    return { name: name.toLowerCase(), args: args.join(' ') };
  }

  return { name: token.slice(1), args: rest };
}

/**
 * The skill a message invokes, or `null` when it names none, the skill is
 * disabled/unknown, or `skills.mode` is not `manual`.
 */
export function resolveSkillCommand(message: string): ResolvedSkillCommand | null {
  const invocation = parseSkillInvocation(message);
  if (!invocation || !SKILL_NAME_PATTERN.test(invocation.name)) return null;

  const skill = commandableSkills().find((candidate) => candidate.name.toLowerCase() === invocation.name);
  if (!skill) return null;

  return { name: skill.name, content: skill.content ?? '', args: invocation.args };
}

/** Whether a message invokes a skill by command. */
export function isSkillCommand(message: string): boolean {
  return resolveSkillCommand(message) !== null;
}

/** Enabled skills as commands, for `/help` and input completion. */
export function listSkillCommands(): SkillCommandSummary[] {
  return commandableSkills().map((skill) => ({ name: skill.name, description: skill.description }));
}

/**
 * Every skill the agent currently has, regardless of mode — what `/skills`
 * reports. In `auto` mode these are already in the prompt; in `manual` mode
 * each is callable as `/<name>`.
 */
export function listSkills(): SkillCommandSummary[] {
  return enabledSkills().map((skill) => ({ name: skill.name, description: skill.description }));
}

export async function handleSkillsCommand(command: string, context: CommandContext): Promise<CommandResult> {
  if (context.learnedSkillsEnabled === false) {
    return formatCommandResult('Skills are only available to trusted senders.', context.source);
  }

  const rawArgs = command.trim().split(/\s+/).slice(1);
  const sub = rawArgs[0]?.toLowerCase();

  const isRemote = sub === 'remote' || sub === 'available' || (sub === 'list' && rawArgs[1]?.toLowerCase() === 'remote');
  const isLocal = !sub || sub === 'local' || (sub === 'list' && rawArgs[1]?.toLowerCase() !== 'remote');
  const isDownload = sub === 'download' || sub === 'pull' || sub === 'install';

  if (isLocal) {
    const skills = listSkills();
    if (skills.length === 0) {
      return formatCommandResult(
        'No skills are enabled. Add a plugins/skills/<name>/SKILL.md folder to teach me one.\nUse `/skills remote` to see skills available for download.',
        context.source,
      );
    }

    const manualMode = config.SKILLS.MODE === 'manual';
    const rows = skills.map((skill) => {
      const invocation = manualMode ? `/${skill.name}` : skill.name;
      return `  ${invocation.padEnd(24)} ${skill.description}`;
    });

    const footer = manualMode
      ? 'Run one with `/<name> <request>` (or `/skill <name> <request>`) to load its instructions for that message.\nUse `/skills remote` to see skills available for download.'
      : 'These are already part of my context on every message — just ask.\nUse `/skills remote` to see skills available for download.';

    const message = `*Skills* (${skills.length})\n\n${rows.join('\n')}\n\n${footer}`;

    return formatCommandResult(message, context.source);
  }

  if (isRemote) {
    try {
      const missing = await listMissing({ baseDir: config.BASE_DIR });
      const remoteSkills = missing.filter((item) => item.family === 'skill');

      if (remoteSkills.length === 0) {
        return formatCommandResult(
          'No new remote skills available in koris-hub. All skills are already installed.',
          context.source,
        );
      }

      const rows = remoteSkills.map((skill) => `  ${skill.slug.padEnd(24)} ${skill.summary ?? ''}`.trimEnd());
      const message = `*Available Remote Skills* (${remoteSkills.length})\n\n${rows.join('\n')}\n\nUse \`/skills download <name>\` to download and install a skill.`;
      return formatCommandResult(message, context.source);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to reach koris-hub: ${errorMsg}`, context.source);
    }
  }

  if (isDownload) {
    if (context.trusted === false) {
      return formatCommandResult('Downloading skills is restricted to trusted senders.', context.source);
    }

    const remaining = rawArgs.slice(1);
    const force = remaining.includes('--force');
    const slug = remaining.find((arg) => arg !== '--force')?.toLowerCase();

    if (!slug) {
      return formatCommandResult(
        'Missing skill name.\n\nUsage: /skills download <name> [--force]\nUse `/skills remote` to see available skills.',
        context.source,
      );
    }

    try {
      await pullEntry(slug, { baseDir: config.BASE_DIR, family: 'skill', force });
      SkillSyncSingleton.getExistingInstance()?.sync();
      return formatCommandResult(
        `Successfully downloaded skill "${slug}". It is loaded and ready to use.`,
        context.source,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to download skill "${slug}": ${errorMsg}`, context.source);
    }
  }

  return formatCommandResult(
    'Usage: /skills [remote | download <name> [--force]]\n\n' +
    '  /skills                  — List loaded skills\n' +
    '  /skills remote           — List available skills in koris-hub\n' +
    '  /skills download <name>  — Download a skill from koris-hub',
    context.source,
  );
}

