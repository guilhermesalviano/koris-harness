import { DatabaseServiceFactory } from '../../infrastructure/db-sqlite';
import { MemoryRepositoryFactory } from '../../repositories/memory';
import { formatCommandResult } from './format';
import type { Memory } from '../../entities/memory';
import type { MemoryType } from '../../types/memory';
import type { CommandContext, CommandResult } from '../../types/commands';

const MEMORY_TYPES: readonly MemoryType[] = ['summary', 'fact', 'lesson', 'reminder'];
export const DEFAULT_MEMORY_COUNT = 10;
export const MAX_MEMORY_COUNT = 50;
const MAX_CONTENT_CHARS = 280;

const USAGE = `Usage: /memories [${MEMORY_TYPES.join('|')}] [count]`;

export interface MemoriesArgs {
  type?: MemoryType;
  count: number;
}

/** `/memories [type] [count]`, in either order. `null` when an argument is not understood. */
export function parseMemoriesArgs(command: string): MemoriesArgs | null {
  const args: MemoriesArgs = { count: DEFAULT_MEMORY_COUNT };
  for (const token of command.trim().split(/\s+/).slice(1)) {
    const lower = token.toLowerCase();
    if (MEMORY_TYPES.includes(lower as MemoryType) && !args.type) {
      args.type = lower as MemoryType;
    } else if (/^\d+$/.test(lower) && Number(lower) > 0) {
      args.count = Math.min(Number(lower), MAX_MEMORY_COUNT);
    } else {
      return null;
    }
  }
  return args;
}

function formatWhen(date: Date): string {
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}

function formatMemory(memory: Memory): string {
  const meta = [`[${memory.type}]`, formatWhen(memory.createdAt)];
  if (memory.importance != null) meta.push(`importance ${memory.importance}`);

  const content = memory.content.length > MAX_CONTENT_CHARS
    ? `${memory.content.slice(0, MAX_CONTENT_CHARS)}…`
    : memory.content;
  const lines = [meta.filter(Boolean).join(' · '), `  ${content.replace(/\n/g, '\n  ')}`];

  const tags = (memory.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0) lines.push(`  ${tags.map((tag) => `#${tag}`).join(' ')}`);
  return lines.join('\n');
}

export function formatMemories(memories: Memory[], total: number, args: MemoriesArgs): string {
  const kind = args.type ? `${args.type} memories` : 'memories';
  if (memories.length === 0) {
    return args.type
      ? `No ${kind} yet.`
      : 'No memories yet. The Summarizer writes them as conversations are summarized.';
  }

  const header = `*Memories* (newest ${memories.length} of ${total} ${kind})`;
  return [header, '', memories.map(formatMemory).join('\n\n')].join('\n');
}

/**
 * `/memories` — what the Summarizer has condensed into long-term memory, newest
 * first. Read-only; spans every session, so untrusted senders are refused.
 */
export function handleMemoriesCommand(command: string, context: CommandContext): CommandResult {
  if (context.trusted === false) {
    return formatCommandResult('Memories are only available to trusted senders.', context.source);
  }

  const args = parseMemoriesArgs(command);
  if (!args) return formatCommandResult(USAGE, context.source);

  const repository = MemoryRepositoryFactory.create(DatabaseServiceFactory.create());
  const memories = repository.findRecent(args.count, 0, args.type);
  const total = repository.countAll(args.type);
  return formatCommandResult(formatMemories(memories, total, args), context.source);
}
