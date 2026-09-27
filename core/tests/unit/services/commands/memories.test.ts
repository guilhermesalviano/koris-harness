import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Memory } from '../../../../src/entities/memory';

const repo = {
  findRecent: vi.fn((): Memory[] => []),
  countAll: vi.fn(() => 0),
};

vi.mock('../../../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: { create: vi.fn(() => ({})) },
}));

vi.mock('../../../../src/repositories/memory', () => ({
  MemoryRepositoryFactory: { create: vi.fn(() => repo) },
}));

import {
  DEFAULT_MEMORY_COUNT,
  MAX_MEMORY_COUNT,
  handleMemoriesCommand,
  parseMemoriesArgs,
} from '../../../../src/services/commands/memories';
import { handleCommand, isKnownCommand } from '../../../../src/services/commands';

function memory(props: Partial<ConstructorParameters<typeof Memory>[0]> = {}): Memory {
  return new Memory({
    id: 'm1',
    sessionId: 's1',
    source: 'web',
    type: 'lesson',
    content: 'Prefers *morning* meetings',
    tags: 'calendar, habits',
    importance: 4,
    createdAt: new Date('2026-09-01T10:30:00.000Z'),
    ...props,
  });
}

describe('parseMemoriesArgs', () => {
  it('defaults to the newest memories of every type', () => {
    expect(parseMemoriesArgs('/memories')).toEqual({ count: DEFAULT_MEMORY_COUNT });
  });

  it('accepts a type and a count in either order, case-insensitively', () => {
    expect(parseMemoriesArgs('/memories Lesson 5')).toEqual({ type: 'lesson', count: 5 });
    expect(parseMemoriesArgs('/memories 3 reminder')).toEqual({ type: 'reminder', count: 3 });
  });

  it('caps the count', () => {
    expect(parseMemoriesArgs('/memories 999')?.count).toBe(MAX_MEMORY_COUNT);
  });

  it('rejects anything else', () => {
    expect(parseMemoriesArgs('/memories banana')).toBeNull();
    expect(parseMemoriesArgs('/memories 0')).toBeNull();
    expect(parseMemoriesArgs('/memories fact lesson')).toBeNull();
  });
});

describe('handleMemoriesCommand', () => {
  beforeEach(() => {
    repo.findRecent.mockReset().mockReturnValue([]);
    repo.countAll.mockReset().mockReturnValue(0);
  });

  it('lists the newest memories with type, time, importance, content and tags', () => {
    repo.findRecent.mockReturnValue([memory()]);
    repo.countAll.mockReturnValue(12);

    const result = handleMemoriesCommand('/memories lesson 1', { source: 'telegram', trusted: true });

    expect(repo.findRecent).toHaveBeenCalledWith(1, 0, 'lesson');
    expect(repo.countAll).toHaveBeenCalledWith('lesson');
    expect(result.handled).toBe(true);
    expect(result.action).toBe('none');
    expect(result.response).toContain('*Memories* (newest 1 of 12 lesson memories)');
    expect(result.response).toContain('[lesson] · 2026-09-01 10:30 · importance 4');
    expect(result.response).toContain('Prefers *morning* meetings');
    expect(result.response).toContain('#calendar #habits');
  });

  it('strips markdown markers outside telegram and truncates long content', () => {
    repo.findRecent.mockReturnValue([memory({ content: 'x'.repeat(400), tags: undefined, importance: undefined })]);
    repo.countAll.mockReturnValue(1);

    const response = handleMemoriesCommand('/memories', { source: 'web' }).response ?? '';

    expect(repo.findRecent).toHaveBeenCalledWith(DEFAULT_MEMORY_COUNT, 0, undefined);
    expect(response).not.toContain('*');
    expect(response).toContain(`${'x'.repeat(280)}…`);
    expect(response).not.toContain('importance');
    expect(response).not.toContain('#');
  });

  it('explains when there is nothing to show', () => {
    expect(handleMemoriesCommand('/memories', { source: 'tui' }).response).toContain('No memories yet');
    expect(handleMemoriesCommand('/memories fact', { source: 'tui' }).response).toBe('No fact memories yet.');
  });

  it('shows usage for arguments it does not understand, without querying', () => {
    const result = handleMemoriesCommand('/memories banana', { source: 'tui' });

    expect(result.response).toContain('Usage: /memories [summary|fact|lesson|reminder] [count]');
    expect(repo.findRecent).not.toHaveBeenCalled();
  });

  it('refuses untrusted senders', () => {
    const result = handleMemoriesCommand('/memories', { source: 'whatsapp', trusted: false });

    expect(result.response).toContain('only available to trusted senders');
    expect(repo.findRecent).not.toHaveBeenCalled();
  });

  it('is a known command dispatched by handleCommand and listed in /help', async () => {
    expect(isKnownCommand('/memories 5')).toBe(true);
    expect((await handleCommand('/memories', { source: 'tui', trusted: true })).response).toContain('No memories yet');
    expect((await handleCommand('/help', { source: 'tui' })).response).toContain('/memories');
  });
});
