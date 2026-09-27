import { describe, it, expect, vi } from 'vitest';
import { ImageRepository } from '../../../src/repositories/image';

function makeDb(rows: any[] = []) {
  return {
    query: vi.fn().mockReturnValue(rows),
    get: vi.fn(),
    run: vi.fn(),
  };
}

describe('ImageRepository', () => {
  it('inserts an image row', () => {
    const db = makeDb();
    const repository = new ImageRepository(db as any);

    repository.save({ id: 'img-1', data: 'aGVsbG8=', mimeType: 'image/png', createdAt: '2026-05-01T12:00:00.000Z' });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO images');
    expect(params).toEqual(['img-1', 'aGVsbG8=', 'image/png', '2026-05-01T12:00:00.000Z']);
  });

  it('stores null mime_type and current timestamp when not provided', () => {
    const db = makeDb();
    const repository = new ImageRepository(db as any);
    const before = Date.now();

    repository.save({ id: 'img-1', data: 'aGVsbG8=' });

    const [, params] = db.run.mock.calls[0];
    expect(params[0]).toBe('img-1');
    expect(params[1]).toBe('aGVsbG8=');
    expect(params[2]).toBeNull();
    expect(Date.parse(String(params[3]))).toBeGreaterThanOrEqual(before);
  });

  it('returns an empty array when no ids are requested', () => {
    const db = makeDb();
    const repository = new ImageRepository(db as any);

    expect(repository.getByIds([])).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('fetches images by ids and maps columns back', () => {
    const db = makeDb([
      { id: 'img-1', data: 'aGVsbG8=', mime_type: 'image/png', created_at: '2026-05-01T12:00:00.000Z' },
    ]);
    const repository = new ImageRepository(db as any);

    const images = repository.getByIds(['img-1']);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE id IN (?)');
    expect(params).toEqual(['img-1']);
    expect(images).toEqual([
      { id: 'img-1', data: 'aGVsbG8=', mimeType: 'image/png', createdAt: '2026-05-01T12:00:00.000Z' },
    ]);
  });

  it('maps null mime_type back to undefined', () => {
    const db = makeDb([{ id: 'img-1', data: 'aGVsbG8=', mime_type: null, created_at: null }]);
    const repository = new ImageRepository(db as any);

    const images = repository.getByIds(['img-1']);

    expect(images).toEqual([{ id: 'img-1', data: 'aGVsbG8=', mimeType: undefined, createdAt: undefined }]);
  });

  it('deletes all images and returns the number of deleted rows', () => {
    const db = makeDb();
    (db.run as ReturnType<typeof vi.fn>).mockReturnValue({ changes: 4, lastInsertRowid: 0 });
    const repository = new ImageRepository(db as any);

    const deleted = repository.deleteAll();

    const [sql] = db.run.mock.calls[0];
    expect(sql).toBe('DELETE FROM images');
    expect(deleted).toBe(4);
  });
});
