import { describe, expect, it, vi } from 'vitest';
import { AuditLogRepository, AuditLogRepositoryFactory } from '../../../src/repositories/audit-log';
import { AuditLog, AuditLogLlm, AuditLogTool } from '../../../src/entities/audit-log';
import { formatISO } from '../../../src/utils/date';

function makeDb(rows: any[] = []) {
  return {
    run: vi.fn(),
    query: vi.fn().mockReturnValue(rows),
    get: vi.fn(),
  };
}

function makeLlmEntry(): AuditLogLlm {
  return {
    id: 'a1',
    type: 'llm',
    role: 'manager',
    agentName: 'manager',
    provider: 'ollama',
    model: 'qwen2.5',
    prompt: JSON.stringify([{ role: 'user', content: 'hi' }]),
    promptLength: 31,
    response: 'hello',
    responseLength: 5,
    finishReason: 'stop',
    toolCalls: 0,
    durationMs: 120,
    status: 'success',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeToolEntry(): AuditLogTool {
  return {
    id: 'a2',
    type: 'tool',
    role: 'worker',
    agentName: 'executorWorker',
    toolName: 'curl-request',
    toolArgs: JSON.stringify({ url: 'https://example.com' }),
    success: false,
    response: 'blocked',
    durationMs: 5,
    status: 'error',
    errorMessage: 'blocked',
    createdAt: new Date('2026-01-01T00:01:00Z'),
  };
}

describe('AuditLogRepository', () => {
  it('save inserts an llm entry with formatted dates', () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as never);
    const entry = makeLlmEntry();

    repository.save(entry);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(params[0]).toBe('a1');
    expect(params[4]).toBe('llm');
    expect(params[5]).toBe('manager');
    expect(params[7]).toBe('ollama');
    expect(params[8]).toBe('qwen2.5');
    expect(params[9]).toBe(entry.prompt);
    expect(params[25]).toBe(formatISO(entry.createdAt));
  });

  it('save stores token counts for an llm entry', () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as never);
    const entry: AuditLogLlm = { ...makeLlmEntry(), inputTokens: 1200, outputTokens: 340 };

    repository.save(entry);

    const params = db.run.mock.calls[0][1];
    expect(params[23]).toBe(1200);
    expect(params[24]).toBe(340);
  });

  it('save stores nulls for tool-only columns on an llm entry', () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as never);
    const entry = makeLlmEntry();

    repository.save(entry);

    const params = db.run.mock.calls[0][1];
    expect(params[16]).toBeNull();
    expect(params[17]).toBeNull();
    expect(params[18]).toBeNull();
  });

  it('save stores tools_enabled flag for an llm entry', () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as never);
    const entry: AuditLogLlm = { ...makeLlmEntry(), toolsEnabled: true };

    repository.save(entry);

    const params = db.run.mock.calls[0][1];
    expect(params[15]).toBe(1);
  });

  it('save stores tool fields on a tool entry', () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as never);
    const entry = makeToolEntry();

    repository.save(entry);

    const params = db.run.mock.calls[0][1];
    expect(params[4]).toBe('tool');
    expect(params[16]).toBe('curl-request');
    expect(params[17]).toBe(entry.toolArgs);
    expect(params[18]).toBe(0);
    expect(params[7]).toBeNull();
  });

  it('findAll orders by created_at desc and applies limit/offset', () => {
    const db = makeDb([{ id: 'a1' }]);
    const repository = new AuditLogRepository(db as never);

    repository.findAll({ limit: 10, offset: 5 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(sql).toContain('LIMIT ? OFFSET ?');
    expect(params).toEqual([10, 5]);
  });

  it('findAll applies filters', () => {
    const db = makeDb([]);
    const repository = new AuditLogRepository(db as never);

    repository.findAll({
      limit: 20,
      offset: 0,
      filters: { type: 'llm', role: 'manager', status: 'error', sessionId: 's1', agentName: 'manager' },
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('type = ?');
    expect(sql).toContain('role = ?');
    expect(sql).toContain('status = ?');
    expect(sql).toContain('session_id = ?');
    expect(sql).toContain('agent_name = ?');
    expect(params.slice(0, 5)).toEqual(['llm', 's1', 'manager', 'error', 'manager']);
  });

  it('count returns the total from the database', () => {
    const db = makeDb();
    db.get.mockReturnValue({ total: 7 });
    const repository = new AuditLogRepository(db as never);

    expect(repository.count({ type: 'tool' })).toBe(7);
    expect(db.get.mock.calls[0][0]).toContain('COUNT(*) AS total');
    expect(db.get.mock.calls[0][1]).toEqual(['tool']);
  });

  it('count returns 0 when no row is returned', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new AuditLogRepository(db as never);

    expect(repository.count()).toBe(0);
  });

  it('usage applies from filter and orders ascending', () => {
    const db = makeDb([]);
    const repository = new AuditLogRepository(db as never);

    repository.usage({ from: '2026-01-01T00:00:00.000Z' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('created_at >= ?');
    expect(sql).toContain('ORDER BY created_at ASC');
    expect(params[0]).toBe('2026-01-01T00:00:00.000Z');
    expect(params[1]).toBe(10000);
  });

  it('usage applies type and sessionId filters', () => {
    const db = makeDb([]);
    const repository = new AuditLogRepository(db as never);

    repository.usage({ type: 'llm', sessionId: 's1' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('type = ?');
    expect(sql).toContain('session_id = ?');
    expect(params).toEqual(['llm', 's1', 10000]);
  });

  it('usage applies custom limit', () => {
    const db = makeDb([]);
    const repository = new AuditLogRepository(db as never);

    repository.usage({ limit: 5 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('LIMIT ?');
    expect(params).toEqual([5]);
  });

  it('findById returns null when no row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new AuditLogRepository(db as never);

    expect(repository.findById('missing')).toBeNull();
  });

  it('deleteById reports changes', () => {
    const db = makeDb();
    db.run.mockReturnValue({ changes: 1, lastInsertRowid: 0n });
    const repository = new AuditLogRepository(db as never);

    expect(repository.deleteById('a1')).toBe(true);
    expect(db.run.mock.calls[0][0]).toContain('DELETE FROM audit_logs');
  });

  it('factory create returns a singleton', () => {
    const a = AuditLogRepositoryFactory.create({} as never);
    const b = AuditLogRepositoryFactory.create({} as never);
    expect(a).toBe(b);
  });
});
