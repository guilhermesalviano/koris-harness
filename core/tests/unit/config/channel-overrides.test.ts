/// <reference types="node" />

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadChannelOverrides } from '../../../src/config/channel-overrides';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koris-channel-overrides-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config/channel-overrides', () => {
  it('returns an empty object when koris.json has no channels.overrides', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({ web_port: 3000 }));

    expect(loadChannelOverrides({ cwd: dir, dirname: dir })).toEqual({});
  });

  it('returns an empty object when koris.json is missing entirely', () => {
    const dir = createTempDir();

    expect(loadChannelOverrides({ cwd: dir, dirname: dir })).toEqual({});
  });

  it('reads enabled overrides keyed by channel id, ignoring sibling keys under channels', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({
      channels: {
        somethingElse: true,
        overrides: [
          { id: 'telegram', enabled: false },
          { id: 'whatsapp', enabled: true },
        ],
      },
    }));

    expect(loadChannelOverrides({ cwd: dir, dirname: dir })).toEqual({
      telegram: { enabled: false },
      whatsapp: { enabled: true },
    });
  });

  it('ignores entries with a missing id or a non-boolean enabled', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({
      channels: {
        overrides: [
          { enabled: true },
          { id: 'telegram', enabled: 'yes' },
          { id: '', enabled: true },
        ],
      },
    }));

    expect(loadChannelOverrides({ cwd: dir, dirname: dir })).toEqual({});
  });

  it('ignores non-array channels.overrides', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({
      channels: { overrides: 'not-an-array' },
    }));

    expect(loadChannelOverrides({ cwd: dir, dirname: dir })).toEqual({});
  });
});
