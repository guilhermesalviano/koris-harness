import { Message } from '../entities/message';
import { IDatabaseService } from '../infrastructure/db-sqlite';
import { generateId } from '../utils/generate-id';
import { IImageRepository, ImageRepositoryFactory } from './image';
import { SessionKey } from '../types/session';

/** Position just past the oldest message of a timeline page. `rowid` breaks
 * ties between messages persisted with the same `created_at`. */
interface TimelineCursor {
  createdAt: string;
  rowid: number;
}

interface TimelineQuery {
  /** Without `peerId`, the timeline spans every peer on the channel (e.g. all negotiation sessions). */
  key: Omit<Required<SessionKey>, 'peerId'> & { peerId?: string };
  before?: TimelineCursor;
  limit: number;
}

interface TimelinePage {
  /** Chronological (oldest first), like `getBySessionId`. */
  messages: Message[];
  /** Cursor for the next older page, or `null` when this page reaches the start. */
  nextCursor: TimelineCursor | null;
}

interface IMessageRepository {
  save(message: Message): void;
  deleteById(id: string): void;
  getBySessionId(sessionId: string, limit?: number): Message[];
  getPreviewBySessionId(sessionId: string): string | null;
  /** Messages of every session on one thread (e.g. all web chats), newest page first. */
  getTimeline(query: TimelineQuery): TimelinePage;
  count(): number;
}

class MessageRepository implements IMessageRepository {
  constructor(
    private db: IDatabaseService,
    private imageRepository: IImageRepository,
  ) { }

  save(message: Message): void {
    const imageIds = message.images?.map((image) => {
      const id = generateId();
      this.imageRepository.save({ id, data: image.data, mimeType: image.mimeType });
      return id;
    }) ?? [];

    this.db.run(
      `INSERT INTO messages (id, session_id, role, content, image_ids, error_code, created_at, sender_agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.sessionId,
        message.role,
        message.content,
        imageIds.length ? JSON.stringify(imageIds) : null,
        message.errorCode ?? null,
        message.createdAt,
        message.senderAgentId ?? null,
      ]
    );
  }

  deleteById(id: string): void {
    this.db.run('DELETE FROM messages WHERE id = ?', [id]);
  }

  getBySessionId(sessionId: string, limit = 15): Message[] {
    const rows = this.db.query<any>(
      `SELECT id, session_id, role, content, image_ids, error_code, created_at, sender_agent_id FROM (
         SELECT rowid AS insertion_order, id, session_id, role, content, image_ids, error_code, created_at, sender_agent_id FROM messages
         WHERE session_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?
       ) recent_messages
       ORDER BY created_at ASC, insertion_order ASC`,
      [sessionId, limit]
    );

    return rows.map((row: any) => this.mapRow(row));
  }

  getTimeline({ key, before, limit }: TimelineQuery): TimelinePage {
    const cursorClause = before
      ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?))'
      : '';
    const cursorParams = before ? [before.createdAt, before.createdAt, before.rowid] : [];
    const peerClause = key.peerId === undefined ? '' : 'AND s.peer_id = ?';
    const peerParams = key.peerId === undefined ? [] : [key.peerId];

    // One extra row tells whether an older page exists without a COUNT query.
    const rows = this.db.query<any>(
      `SELECT m.rowid AS row_order, m.id, m.session_id, m.role, m.content, m.image_ids, m.error_code, m.created_at, m.sender_agent_id
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE s.channel = ? ${peerClause} AND s.kind = ? ${cursorClause}
       ORDER BY m.created_at DESC, m.rowid DESC
       LIMIT ?`,
      [key.channel, ...peerParams, key.kind, ...cursorParams, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const oldest = page[page.length - 1];

    return {
      messages: page.reverse().map((row: any) => this.mapRow(row)),
      nextCursor: hasMore && oldest ? { createdAt: oldest.created_at, rowid: oldest.row_order } : null,
    };
  }

  private mapRow(row: any): Message {
    const imageIds = this.parseImageIds(row.image_ids);
    const images = this.imageRepository.getByIds(imageIds).map(({ data, mimeType }) => ({ data, mimeType }));
    const missingImages = imageIds.length - images.length;

    return new Message({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      senderAgentId: row.sender_agent_id ?? undefined,
      images: images.length ? images : undefined,
      missingImages: missingImages > 0 ? missingImages : undefined,
      errorCode: row.error_code ?? undefined,
      createdAt: row.created_at
    });
  }

  private parseImageIds(raw: unknown): string[] {
    if (typeof raw !== 'string' || !raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  }

  getPreviewBySessionId(sessionId: string): string | null {
    const row = this.db.get(
      `SELECT content FROM messages
       WHERE session_id = ? AND role = 'user'
       ORDER BY created_at ASC
       LIMIT 1`,
      [sessionId],
    ) as { content?: string } | undefined;

    return row?.content ?? null;
  }

  count(): number {
    const row = this.db.get('SELECT COUNT(*) AS total FROM messages') as { total?: number } | undefined;
    return row?.total ?? 0;
  }
}

class MessageRepositoryFactory {
  public static create(db: IDatabaseService): MessageRepository {
    return new MessageRepository(db, ImageRepositoryFactory.create(db));
  }
}

export { IMessageRepository, MessageRepository, MessageRepositoryFactory, TimelineCursor, TimelinePage, TimelineQuery };
