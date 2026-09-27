import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { scaffoldToolPlugin, type ScaffoldFileIO } from './scaffold-tool';

const BASE_DIR = '/repo/plugins/tools';

function makeIO(existing: Set<string> = new Set()): ScaffoldFileIO & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    exists: vi.fn((p: string) => existing.has(p)),
    mkdir: vi.fn(),
    writeFile: vi.fn((p: string, content: string) => { written.set(p, content); }),
  };
}

describe('scaffoldToolPlugin', () => {
  it('rejects a non-kebab-case name', () => {
    const io = makeIO();
    expect(() => scaffoldToolPlugin({ name: 'Weather Lookup', description: 'x' }, { baseDir: BASE_DIR, io }))
      .toThrow(/kebab-case/);
  });

  it('rejects a name attempting path traversal', () => {
    const io = makeIO();
    expect(() => scaffoldToolPlugin({ name: '../../etc', description: 'x' }, { baseDir: BASE_DIR, io }))
      .toThrow(/kebab-case/);
  });

  it('rejects a name with consecutive or trailing hyphens', () => {
    const io = makeIO();
    expect(() => scaffoldToolPlugin({ name: 'weather--lookup', description: 'x' }, { baseDir: BASE_DIR, io })).toThrow();
    expect(() => scaffoldToolPlugin({ name: 'weather-', description: 'x' }, { baseDir: BASE_DIR, io })).toThrow();
  });

  it('refuses to overwrite an existing plugin folder', () => {
    const target = path.join(BASE_DIR, 'weather-lookup');
    const io = makeIO(new Set([target]));
    expect(() => scaffoldToolPlugin({ name: 'weather-lookup', description: 'x' }, { baseDir: BASE_DIR, io }))
      .toThrow(/already exists/);
  });

  it('creates the expected 2 files under the plugin folder', () => {
    const io = makeIO();
    const result = scaffoldToolPlugin(
      { name: 'weather-lookup', description: 'Look up the weather.', parameters: [{ name: 'city', type: 'string', description: 'City name', required: true }] },
      { baseDir: BASE_DIR, io },
    );

    expect(result.pluginName).toBe('weather-lookup');
    expect(result.toolName).toBe('weather_lookup');
    expect(result.createdFiles).toEqual([
      'weather-lookup/index.ts',
      'weather-lookup/index.test.ts',
    ]);
    expect(io.mkdir).toHaveBeenCalledWith(path.join(BASE_DIR, 'weather-lookup'));
    expect(io.written.size).toBe(2);
  });

  it('derives the tool name from the plugin name by default (hyphens to underscores)', () => {
    const io = makeIO();
    const result = scaffoldToolPlugin({ name: 'get-stock-price', description: 'x' }, { baseDir: BASE_DIR, io });
    expect(result.toolName).toBe('get_stock_price');
  });

  it('honors an explicit toolName override', () => {
    const io = makeIO();
    const result = scaffoldToolPlugin({ name: 'get-stock-price', toolName: 'stock_price', description: 'x' }, { baseDir: BASE_DIR, io });
    expect(result.toolName).toBe('stock_price');
  });

  it('generated index.ts references the exact TOOL_NAME and description', () => {
    const io = makeIO();
    scaffoldToolPlugin({ name: 'weather-lookup', description: 'Look up the weather.' }, { baseDir: BASE_DIR, io });

    const indexContent = io.written.get(path.join(BASE_DIR, 'weather-lookup', 'index.ts'))!;
    expect(indexContent).toContain("TOOL_NAME = 'weather_lookup'");
    expect(indexContent).toContain('Look up the weather.');
    expect(indexContent).toContain('export function create(');
    expect(indexContent).toContain("context.pluginEnablement.isEnabled('weather-lookup')");
  });

  it('generated parameters schema includes each param and marks required ones', () => {
    const io = makeIO();
    scaffoldToolPlugin(
      {
        name: 'weather-lookup',
        description: 'x',
        parameters: [
          { name: 'city', type: 'string', description: 'City name', required: true },
          { name: 'units', type: 'string', description: 'Units', required: false },
        ],
      },
      { baseDir: BASE_DIR, io },
    );

    const indexContent = io.written.get(path.join(BASE_DIR, 'weather-lookup', 'index.ts'))!;
    expect(indexContent).toContain('city:');
    expect(indexContent).toContain('units:');
    expect(indexContent).toMatch(/city: \{\n\s+type: 'string',\n\s+required: true,/);
    expect(indexContent).not.toMatch(/units: \{\n\s+type: 'string',\n\s+required: true,/);
  });

  it('generated index.test.ts imports from the sibling index.ts and asserts the stub fails', () => {
    const io = makeIO();
    scaffoldToolPlugin({ name: 'weather-lookup', description: 'x' }, { baseDir: BASE_DIR, io });

    const testContent = io.written.get(path.join(BASE_DIR, 'weather-lookup', 'index.test.ts'))!;
    expect(testContent).toContain("from './index'");
    expect(testContent).toContain('result.success).toBe(false)');
  });
});
