import { IDatabaseService } from '../infrastructure/db-sqlite';

export interface ImageRecord {
  id: string;
  data: string;
  mimeType?: string;
  createdAt?: string;
}

interface IImageRepository {
  save(image: ImageRecord): void;
  getByIds(ids: string[]): ImageRecord[];
  deleteAll(): number;
}

class ImageRepository implements IImageRepository {
  constructor(private db: IDatabaseService) {}

  save(image: ImageRecord): void {
    this.db.run(
      `INSERT INTO images (id, data, mime_type, created_at) VALUES (?, ?, ?, ?)`,
      [
        image.id,
        image.data,
        image.mimeType ?? null,
        image.createdAt ?? new Date().toISOString(),
      ],
    );
  }

  getByIds(ids: string[]): ImageRecord[] {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.query<any>(`SELECT id, data, mime_type, created_at FROM images WHERE id IN (${placeholders})`, ids);

    return rows.map((row: any) => ({
      id: row.id,
      data: row.data,
      mimeType: row.mime_type ?? undefined,
      createdAt: row.created_at ?? undefined,
    }));
  }

  deleteAll(): number {
    const result = this.db.run('DELETE FROM images');
    return result.changes;
  }
}

class ImageRepositoryFactory {
  public static create(db: IDatabaseService): ImageRepository {
    return new ImageRepository(db);
  }
}

export { IImageRepository, ImageRepository, ImageRepositoryFactory };