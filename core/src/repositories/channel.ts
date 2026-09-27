import { IDatabaseService } from '../infrastructure/db-sqlite';
import { Channel, ChannelType } from '../entities/channel';

interface ChannelRow {
  id: string;
  channel: ChannelType;
  target: string;
  is_principal: number;
  created_at: string;
  updated_at: string;
}

function mapRowToChannel(row: ChannelRow): Channel {
  return new Channel({
    id: row.id,
    channel: row.channel,
    target: row.target,
    isPrincipal: row.is_principal === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

interface IChannelRepository {
  upsert(channel: ChannelType, target: string): Channel;
  setPrincipal(id: string): Channel | null;
  getPrincipal(): Channel | null;
  getByChannel(channel: ChannelType): Channel[];
  getAll(): Channel[];
}

class ChannelRepository implements IChannelRepository {
  constructor(private db: IDatabaseService) {}

  upsert(channel: ChannelType, target: string): Channel {
    return this.db.transaction(() => {
      const pending = new Channel({ channel, target });
      this.db.run(
        `INSERT OR IGNORE INTO channels (id, channel, target, is_principal, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
        [pending.id, channel, target, pending.createdAt, pending.updatedAt],
      );

      const row = this.db.get<any>(
        `SELECT * FROM channels WHERE channel = ? AND target = ?`,
        [channel, target],
      );

      if (row && row.is_principal === 0 && !this.getPrincipal()) {
        this.db.run(
          `UPDATE channels SET is_principal = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [row.id],
        );
        return mapRowToChannel({ ...row, is_principal: 1 });
      }

      if (!row) {
        throw new Error(`Failed to persist channel: ${channel}:${target}`);
      }

      return mapRowToChannel(row);
    });
  }

  setPrincipal(id: string): Channel | null {
    return this.db.transaction(() => {
      const row = this.db.get<any>(`SELECT * FROM channels WHERE id = ?`, [id]);
      if (!row) {
        return null;
      }

      this.db.run(
        `UPDATE channels SET is_principal = 0, updated_at = CURRENT_TIMESTAMP WHERE id != ?`,
        [id],
      );
      this.db.run(
        `UPDATE channels SET is_principal = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
      );

      return mapRowToChannel({ ...row, is_principal: 1 });
    });
  }

  getPrincipal(): Channel | null {
    const row = this.db.get<any>(
      `SELECT * FROM channels WHERE is_principal = 1 ORDER BY created_at ASC LIMIT 1`,
    );
    return row ? mapRowToChannel(row) : null;
  }

  getByChannel(channel: ChannelType): Channel[] {
    const rows = this.db.query<any>(
      `SELECT * FROM channels WHERE channel = ? ORDER BY created_at ASC`,
      [channel],
    );
    return rows.map(mapRowToChannel);
  }

  getAll(): Channel[] {
    const rows = this.db.query<any>(`SELECT * FROM channels ORDER BY created_at ASC`);
    return rows.map(mapRowToChannel);
  }
}

class ChannelRepositoryFactory {
  public static create(db: IDatabaseService): ChannelRepository {
    return new ChannelRepository(db);
  }
}

export { IChannelRepository, ChannelRepository, ChannelRepositoryFactory };
export type { ChannelRow };
