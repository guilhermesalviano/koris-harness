import { IDatabaseService } from '../infrastructure/db-sqlite';

export type PluginFamily = 'tools' | 'channels' | 'mcps';

export interface PluginSettingRecord {
  family: PluginFamily;
  name: string;
  enabled: boolean;
}

interface PluginSettingRow {
  family: PluginFamily;
  name: string;
  enabled: number;
  [key: string]: unknown;
}

interface IPluginSettingsRepository {
  getEnabled(family: PluginFamily, name: string): boolean | null;
  setEnabled(family: PluginFamily, name: string, enabled: boolean): void;
  getAll(): PluginSettingRecord[];
}

class PluginSettingsRepository implements IPluginSettingsRepository {
  constructor(private db: IDatabaseService) {}

  getEnabled(family: PluginFamily, name: string): boolean | null {
    const row = this.db.get<PluginSettingRow>(
      'SELECT enabled FROM plugin_settings WHERE family = ? AND name = ?',
      [family, name],
    );
    return row ? row.enabled === 1 : null;
  }

  setEnabled(family: PluginFamily, name: string, enabled: boolean): void {
    this.db.run(
      `INSERT INTO plugin_settings (family, name, enabled, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(family, name) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = CURRENT_TIMESTAMP`,
      [family, name, enabled ? 1 : 0],
    );
  }

  getAll(): PluginSettingRecord[] {
    return this.db
      .query<PluginSettingRow>('SELECT family, name, enabled FROM plugin_settings')
      .map((row) => ({ family: row.family, name: row.name, enabled: row.enabled === 1 }));
  }
}

class PluginSettingsRepositoryFactory {
  private static instance: PluginSettingsRepository;

  static create(db: IDatabaseService): PluginSettingsRepository {
    if (!this.instance) {
      this.instance = new PluginSettingsRepository(db);
    }
    return this.instance;
  }

  static getInstance(): PluginSettingsRepository {
    if (!this.instance) {
      throw new Error('PluginSettingsRepository not initialized. Call create() first.');
    }
    return this.instance;
  }
}

export { IPluginSettingsRepository, PluginSettingsRepository, PluginSettingsRepositoryFactory };
