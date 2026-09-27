import { IDatabaseService } from '../infrastructure/db-sqlite';
import { OutboundMessage } from '../entities/outbound-message';
import { nowISO } from '../utils/date';

interface IOutboundMessageRepository {
  save(message: OutboundMessage): void;
  getById(id: string): OutboundMessage | null;
  getAll(limit?: number): OutboundMessage[];
  markSent(id: string): void;
  markFailed(id: string, errorMessage: string): void;
  count(): number;
}

function mapRowToOutboundMessage(row: any): OutboundMessage {
  return new OutboundMessage({
    id: row.id,
    channel: row.channel,
    target: row.target,
    content: row.content,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
  });
}

class OutboundMessageRepository implements IOutboundMessageRepository {
  constructor(private db: IDatabaseService) {}

  save(message: OutboundMessage): void {
    this.db.run(
      `INSERT INTO outbound_messages (id, channel, target, content, status, error_message, created_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.channel,
        message.target,
        message.content,
        message.status,
        message.errorMessage ?? null,
        message.createdAt,
        message.sentAt ?? null,
      ],
    );
  }

  getById(id: string): OutboundMessage | null {
    const row = this.db.get<any>(`SELECT * FROM outbound_messages WHERE id = ?`, [id]);
    return row ? mapRowToOutboundMessage(row) : null;
  }

  getAll(limit = 100): OutboundMessage[] {
    const rows = this.db.query<any>(
      `SELECT * FROM outbound_messages ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(mapRowToOutboundMessage);
  }

  markSent(id: string): void {
    this.db.run(
      `UPDATE outbound_messages SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?`,
      [nowISO(), id],
    );
  }

  markFailed(id: string, errorMessage: string): void {
    this.db.run(
      `UPDATE outbound_messages SET status = 'failed', error_message = ? WHERE id = ?`,
      [errorMessage, id],
    );
  }

  count(): number {
    const row = this.db.get('SELECT COUNT(*) AS total FROM outbound_messages') as { total?: number } | undefined;
    return row?.total ?? 0;
  }
}

class OutboundMessageRepositoryFactory {
  public static create(db: IDatabaseService): OutboundMessageRepository {
    return new OutboundMessageRepository(db);
  }
}

export { IOutboundMessageRepository, OutboundMessageRepository, OutboundMessageRepositoryFactory };