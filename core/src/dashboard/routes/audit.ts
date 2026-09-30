import type { Request, Response, Router } from 'express';
import type { IMemoryRepository } from '../../repositories/memory';
import type { IAuditLogRepository } from '../../repositories/audit-log';
import type { AuditType, AuditStatus } from '../../entities/audit-log';
import { parsePagination } from '../pagination';
import { toAuditJson, toMemoryJson } from '../serializers';
import { buildUsageReport, usageFrom } from '../../services/usage/usage';

export interface AuditRouteDependencies {
  memoryRepo: Pick<IMemoryRepository, 'getBySessionId' | 'getAll' | 'deleteById'>;
  auditRepo: Pick<IAuditLogRepository, 'count' | 'findAll' | 'findById' | 'deleteById' | 'deleteAll' | 'usage'>;
}

export function registerAuditRoutes(router: Router, dependencies: AuditRouteDependencies): void {
  const { memoryRepo, auditRepo } = dependencies;

  router.get('/memories', (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const memories = sessionId ? memoryRepo.getBySessionId(sessionId) : memoryRepo.getAll();

    res.json({
      items: memories.map((m) => ({
        ...toMemoryJson(m),
        sessionId: m.sessionId,
        source: m.source,
      })),
    });
  });

  router.delete('/memories/:id', (req: Request, res: Response) => {
    memoryRepo.deleteById(String(req.params.id));
    res.json({ success: true });
  });

  router.get('/audit', (req: Request, res: Response) => {
    const { limit, offset } = parsePagination(req);
    const filters: {
      type?: AuditType;
      sessionId?: string;
      role?: 'manager' | 'worker';
      status?: AuditStatus;
      agentName?: string;
    } = {
      type: typeof req.query.type === 'string' ? (req.query.type as AuditType) : undefined,
      sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
      role: typeof req.query.role === 'string' ? (req.query.role as 'manager' | 'worker') : undefined,
      status: typeof req.query.status === 'string' ? (req.query.status as AuditStatus) : undefined,
      agentName: typeof req.query.agentName === 'string' ? req.query.agentName : undefined,
    };

    res.json({
      total: auditRepo.count(filters),
      limit,
      offset,
      items: auditRepo.findAll({ limit, offset, filters }).map(toAuditJson),
    });
  });

  router.get('/audit/:id', (req: Request, res: Response) => {
    const row = auditRepo.findById(String(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Audit entry not found' });
      return;
    }
    res.json(toAuditJson(row));
  });

  router.delete('/audit/:id', (req: Request, res: Response) => {
    const deleted = auditRepo.deleteById(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: 'Audit entry not found' });
      return;
    }
    res.json({ success: true });
  });

  router.delete('/audit', (_req: Request, res: Response) => {
    res.json({ success: true, deleted: auditRepo.deleteAll() });
  });

  router.get('/usage', (req: Request, res: Response) => {
    const rawDays = req.query.days;
    let days: number | null = null;

    if (typeof rawDays === 'string' && rawDays !== '') {
      const parsed = Number(rawDays);
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        days = parsed;
      }
    }

    const rows = auditRepo.usage({ from: usageFrom(days) });
    res.json(buildUsageReport(rows, days));
  });
}
