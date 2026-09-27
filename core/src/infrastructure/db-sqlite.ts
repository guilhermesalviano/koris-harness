import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { LoggerFactory } from './logger';

const logger = LoggerFactory.create();

// Multiple DatabaseService instances are created per process (chat service,
// workers, tools...). Only report initialization once to avoid log spam.
let initReported = false;

interface DatabaseOptions {
  filepath?: string;
  verbose?: boolean;
  timeout?: number;
}

interface QueryResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface Row {
  [key: string]: unknown;
}

interface IDatabaseService {
  query<T extends Row = Row>(sql: string, params?: unknown[]): T[];
  get<T extends Row = Row>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): QueryResult;
  transaction<T>(fn: () => T): T;
  exec(sql: string): void;
  getStats(): Record<string, unknown>;
  close(): void;
  vacuum(): void;
  backup(targetPath: string): void;
}


const ERRANDS_TABLE_BODY = `(
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'draft','queued','open','awaiting_peer','awaiting_principal','awaiting_confirmation',
    'resolved','failed','cancelled','expired')),
  origin_session_id TEXT NOT NULL,
  pending_message TEXT,
  pending_delivery TEXT,
  closing_reply TEXT,
  notes TEXT,
  result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_progress_at DATETIME,
  closed_at DATETIME,
  FOREIGN KEY (origin_session_id) REFERENCES sessions(id) ON DELETE CASCADE
)`;

const ERRAND_COLUMNS = 'id, goal, state, origin_session_id, pending_message, pending_delivery, closing_reply, notes, result, created_at, last_progress_at, closed_at';

class DatabaseService implements IDatabaseService {
  private db: Database.Database;
  private filepath: string;
  private verbose: boolean;

  constructor(options: DatabaseOptions = {}) {
    this.filepath = options.filepath || path.join(config.DATA_DIR, 'memory', 'database.db');
    this.verbose = options.verbose ?? config.ENVIRONMENT === 'development';
    
    try {
      fs.mkdirSync(path.dirname(this.filepath), { recursive: true });

      this.db = new Database(this.filepath, {
        timeout: options.timeout || 5000,
        fileMustExist: false,
      });

      this.db.pragma('foreign_keys = ON');

      if (this.verbose) {
        this.db.pragma('journal_mode = WAL');
      }

      this.initializeSchema();

      if (!initReported) {
        initReported = true;
        logger.debug(`[database] SQLite initialized at ${this.filepath}`);
      }
    } catch (error) {
      logger.error('[database] Failed to initialize database', { error, filepath: this.filepath });
      throw error;
    }
  }

  /**
   * Initialize database schema with all required tables
   */
  private initializeSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS heartbeat (
          id TEXT PRIMARY KEY,
          beat TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('reminder', 'scheduled_beat')),
          cron_expression TEXT NOT NULL,
          last_run DATETIME,
          channel TEXT,
          target TEXT,
          managed INTEGER NOT NULL DEFAULT 0,
          run_once INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const heartbeatColumns = this.db.prepare('PRAGMA table_info(heartbeat)').all() as { name: string }[];
      if (!heartbeatColumns.some((column) => column.name === 'run_once')) {
        // Pre-existing beats keep firing on every cron match, as they always did.
        this.db.exec('ALTER TABLE heartbeat ADD COLUMN run_once INTEGER NOT NULL DEFAULT 0;');
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS heartbeat_runs (
          id TEXT PRIMARY KEY,
          run_at DATETIME NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('success', 'error')),
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_run_at ON heartbeat_runs(run_at);
      `);

      /**
       * One row per executed beat (heartbeat_runs only logs the scheduler tick),
       * kept after a run-once beat is deleted so the Watcher chat can show it.
       */
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS beat_runs (
          id TEXT PRIMARY KEY,
          beat_id TEXT NOT NULL,
          beat TEXT NOT NULL,
          beat_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('success', 'error')),
          result TEXT,
          error_message TEXT,
          started_at DATETIME NOT NULL,
          finished_at DATETIME NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_beat_runs_started_at ON beat_runs(started_at);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS channels (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK(channel IN ('telegram', 'whatsapp')),
          target TEXT NOT NULL,
          is_principal INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(channel, target)
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_channels_is_principal ON channels(is_principal);
        CREATE INDEX IF NOT EXISTS idx_channels_channel ON channels(channel);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS outbound_messages (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK(channel IN ('telegram', 'whatsapp')),
          target TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          sent_at DATETIME
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_outbound_messages_created_at ON outbound_messages(created_at);
        CREATE INDEX IF NOT EXISTS idx_outbound_messages_status ON outbound_messages(status);
      `);

      // TODO: add topic and update after first message
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          peer_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'user' CHECK(kind IN ('user', 'delegated')),
          started_at DATETIME,
          ended_at DATETIME,
          message_count INTEGER DEFAULT 0,
          metadata TEXT
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_lookup
          ON sessions(channel, peer_id, kind, ended_at, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS errands ${ERRANDS_TABLE_BODY};
      `);

      const errandColumns = this.db.prepare('PRAGMA table_info(errands)').all() as { name: string }[];
      if (!errandColumns.some((column) => column.name === 'pending_delivery')) {
        this.db.exec('ALTER TABLE errands ADD COLUMN pending_delivery TEXT;');
      }
      if (!errandColumns.some((column) => column.name === 'closing_reply')) {
        this.db.exec('ALTER TABLE errands ADD COLUMN closing_reply TEXT;');
      }

      const errandsSchema = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'errands'")
        .get() as { sql?: string } | undefined;
      if (errandsSchema?.sql && !errandsSchema.sql.includes("'awaiting_confirmation'")) {
        // SQLite cannot alter a CHECK constraint in place: rebuild the table.
        // `errand_targets` cascades on delete from `errands`, so foreign keys stay
        // off while the old table is dropped (the pragma is a no-op inside a
        // transaction), and the copy runs atomically.
        this.db.pragma('foreign_keys = OFF');
        try {
          this.db.transaction(() => this.db.exec(`
            CREATE TABLE errands_rebuilt ${ERRANDS_TABLE_BODY};
            INSERT INTO errands_rebuilt (${ERRAND_COLUMNS})
              SELECT ${ERRAND_COLUMNS} FROM errands;
            DROP TABLE errands;
            ALTER TABLE errands_rebuilt RENAME TO errands;
          `))();
          const violations = this.db.pragma('foreign_key_check') as unknown[];
          if (violations.length) throw new Error(`errands rebuild left ${violations.length} foreign key violation(s)`);
        } finally {
          this.db.pragma('foreign_keys = ON');
        }
      }

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_errands_state ON errands(state, last_progress_at);
        CREATE INDEX IF NOT EXISTS idx_errands_origin ON errands(origin_session_id);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS errand_targets (
          errand_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          PRIMARY KEY (errand_id, session_id),
          FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_errand_targets_session ON errand_targets(session_id);
      `);

      /**
       * Long term memory.
       * TODO: vector search - nomic-embed-text
       */
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          source TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('summary', 'fact', 'lesson', 'reminder')),
          content TEXT NOT NULL,
          embedding TEXT NULL,
          tags TEXT NULL,
          importance INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
        CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
      `);

      /**
       * Short term memory.
       */
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
          content TEXT NOT NULL,
          image_ids TEXT,
          error_code TEXT,
          sender_agent_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      `);

      const messageColumns = this.db.pragma('table_info(messages)') as { name: string }[];
      if (!messageColumns.some((column) => column.name === 'sender_agent_id')) {
        this.db.exec('ALTER TABLE messages ADD COLUMN sender_agent_id TEXT;');
      }

      /**
       * Image attachments stored independently so messages only reference them by id.
       */
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS images (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          mime_type TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS learned_skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          read_when TEXT,
          content TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          learned_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_learned_skills_name ON learned_skills(name);
        CREATE INDEX IF NOT EXISTS idx_learned_skills_enabled ON learned_skills(enabled);
        CREATE INDEX IF NOT EXISTS idx_learned_skills_learned_at ON learned_skills(learned_at);
      `);

      /**
       * Stickers learned from conversation: a lightweight channel-native
       * reference (e.g. a WhatsApp message key + content, for forwarding by
       * reference) plus a description of when the agent should reuse it.
       */
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sticker_rules (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          reference TEXT NOT NULL,
          channel TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          learned_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sticker_rules_enabled ON sticker_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_sticker_rules_learned_at ON sticker_rules(learned_at);
        CREATE INDEX IF NOT EXISTS idx_sticker_rules_channel ON sticker_rules(channel);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          session_id TEXT,
          channel TEXT,
          type TEXT NOT NULL CHECK(type IN ('llm', 'tool')),
          role TEXT NOT NULL CHECK(role IN ('manager', 'worker')),
          agent_name TEXT,
          provider TEXT,
          model TEXT,
          prompt TEXT,
          prompt_length INTEGER,
          response TEXT,
          response_length INTEGER,
          finish_reason TEXT,
          tool_calls INTEGER DEFAULT 0,
          tools_enabled INTEGER,
          tool_name TEXT,
          tool_args TEXT,
          success INTEGER,
          duration_ms INTEGER,
          status TEXT NOT NULL CHECK(status IN ('success', 'error')),
          error_code TEXT,
          error_message TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON audit_logs(session_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_type ON audit_logs(type);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_role ON audit_logs(role);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);
      `);

      /**
       * Plugin on/off state, DB-backed so toggling a plugin doesn't require a
       * process restart (see AGENTS.md's "Plugins & skills" section).
       */
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS plugin_settings (
          family TEXT NOT NULL CHECK(family IN ('tools', 'channels', 'mcps')),
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (family, name)
        );
      `);

      const pluginSettingsSchema = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plugin_settings'")
        .get() as { sql?: string } | undefined;
      if (pluginSettingsSchema?.sql && !pluginSettingsSchema.sql.includes("'mcps'")) {
        // SQLite cannot alter a CHECK constraint in place: rebuild the table,
        // atomically so a failure never leaves it renamed or half-copied.
        this.db.transaction(() => this.db.exec(`
          ALTER TABLE plugin_settings RENAME TO plugin_settings_legacy;
          CREATE TABLE plugin_settings (
            family TEXT NOT NULL CHECK(family IN ('tools', 'channels', 'mcps')),
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (family, name)
          );
          INSERT INTO plugin_settings (family, name, enabled, updated_at)
            SELECT family, name, enabled, updated_at FROM plugin_settings_legacy;
          DROP TABLE plugin_settings_legacy;
        `))();
      }

    } catch (error) {
      logger.error('[database] Failed to initialize database schema', { error });
      throw error;
    }
  }

  /**
   * Execute a query and return results
   */
  query<T extends Row = Row>(sql: string, params?: unknown[]): T[] {
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...(params || [])) as T[];
      return rows;
    } catch (error) {
      logger.error('[database] Query execution failed', { sql, error });
      throw error;
    }
  }

  /**
   * Get a single row
   */
  get<T extends Row = Row>(sql: string, params?: unknown[]): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...(params || [])) as T | undefined;
      return row;
    } catch (error) {
      logger.error('[database] Get query failed', { sql, error });
      throw error;
    }
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params?: unknown[]): QueryResult {
    try {
      const stmt = this.db.prepare(sql);
      const info = stmt.run(...(params || []));
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid,
      };
    } catch (error) {
      logger.error('[database] Run query failed', { sql, error });
      throw error;
    }
  }

  /**
   * Start a transaction
   */
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Execute multiple statements in a transaction
   */
  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (error) {
      logger.error('[database] Exec failed', { sql, error });
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  getStats(): Record<string, unknown> {
    try {
      const pageCount = this.db.pragma('page_count', { simple: true }) as number;
      const pageSize = this.db.pragma('page_size', { simple: true }) as number;
      const journalMode = this.db.pragma('journal_mode', { simple: true }) as string;

      const tableStats = this.query<{ name: string; type: string }>(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index')"
      );

      return {
        filepath: this.filepath,
        pageCount,
        pageSize,
        journalMode,
        totalSize: pageCount * pageSize,
        tables: tableStats.length,
      };
    } catch (error) {
      logger.error('[database] Failed to get database stats', { error });
      return {};
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    try {
      this.db.close();
      logger.info('[database] Database connection closed');
    } catch (error) {
      logger.error('[database] Failed to close database', { error });
    }
  }

  /**
   * Vacuum (optimize) the database
   */
  vacuum(): void {
    try {
      this.db.exec('VACUUM;');
      logger.info('[database] Database vacuumed successfully');
    } catch (error) {
      logger.error('[database] Failed to vacuum database', { error });
    }
  }

  /**
   * Backup database to file
   */
  backup(targetPath: string): void {
    try {
      this.db.exec(`VACUUM INTO '${targetPath}';`);
      logger.info('[database] Database backed up', { targetPath });
    } catch (error) {
      logger.error('[database] Failed to backup database', { error, targetPath });
      throw error;
    }
  }
}

class DatabaseServiceFactory {
  static create(options?: DatabaseOptions): DatabaseService {
    return new DatabaseService(options);
  }
}

export { DatabaseServiceFactory, IDatabaseService };
