import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService, AuditServiceFactory } from '../../../../src/services/audit/audit-service';
import { AuditLog } from '../../../../src/entities/audit-log';

describe('AuditService', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const repository = { save: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    (AuditServiceFactory as any).instance = undefined;
  });

  function makeEntry(): AuditLog {
    return {
      id: 'aud-1',
      type: 'tool',
      role: 'manager',
      createdAt: new Date(),
      toolName: 'curl',
      durationMs: 10,
      status: 'success',
      input: '{}',
    };
  }

  it('records an audit entry successfully', () => {
    const service = new AuditService(repository as never, logger as never);
    const entry = makeEntry();

    service.record(entry);
    expect(repository.save).toHaveBeenCalledWith(entry);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('catches and logs errors when repository.save fails', () => {
    const service = new AuditService(repository as never, logger as never);
    const entry = makeEntry();
    const boom = new Error('Disk full');
    repository.save.mockImplementationOnce(() => {
      throw boom;
    });

    service.record(entry);
    expect(logger.error).toHaveBeenCalledWith('Failed to record audit entry', {
      type: entry.type,
      error: boom,
    });
  });

  it('manages singleton lifecycle via AuditServiceFactory', () => {
    expect(() => AuditServiceFactory.getInstance()).toThrow('AuditService not initialized');

    const service1 = AuditServiceFactory.create(logger as never);
    expect(service1).toBeInstanceOf(AuditService);

    const service2 = AuditServiceFactory.create(logger as never);
    expect(service2).toBe(service1);

    expect(AuditServiceFactory.getInstance()).toBe(service1);
  });
});
