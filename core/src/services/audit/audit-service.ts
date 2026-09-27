import { DatabaseServiceFactory } from '../../infrastructure/db-sqlite';
import { ILogger } from '../../infrastructure/logger';
import { AuditLog } from '../../entities/audit-log';
import { AuditLogRepository, AuditLogRepositoryFactory } from '../../repositories/audit-log';

export interface IAuditService {
  record(entry: AuditLog): void;
}

class AuditService implements IAuditService {
  constructor(
    private readonly repository: AuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  record(entry: AuditLog): void {
    try {
      this.repository.save(entry);
    } catch (error) {
      this.logger.error('Failed to record audit entry', { type: entry.type, error });
    }
  }
}

class AuditServiceFactory {
  private static instance: AuditService;

  static create(logger: ILogger): AuditService {
    if (!this.instance) {
      const db = DatabaseServiceFactory.create();
      const repository = AuditLogRepositoryFactory.create(db);
      this.instance = new AuditService(repository, logger);
    }
    return this.instance;
  }

  static getInstance(): AuditService {
    if (!this.instance) {
      throw new Error('AuditService not initialized. Call create() first.');
    }
    return this.instance;
  }
}

export { AuditService, AuditServiceFactory };
