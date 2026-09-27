import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { listMissing, pullEntry, fetchChannelHints, fetchChannelCatalog, type HubSyncFileIO, type HubSyncHttp, type ChannelHints, type ChannelConfigField } from './hub-sync';

const BASE_DIR = '/repo';

function makeIO(dirContents: Record<string, string[]> = {}, existingPaths: string[] = []): HubSyncFileIO & { written: Map<string, string> } {
  const written = new Map<string, string>();
  const existing = new Set(existingPaths);
  return {
    written,
    exists: vi.fn((p: string) => existing.has(p)),
    listDirs: vi.fn((p: string) => dirContents[p] ?? []),
    mkdir: vi.fn(),
    writeFile: vi.fn((p: string, content: string) => { written.set(p, content); }),
    remove: vi.fn((p: string) => {
      existing.delete(p);
      for (const key of [...written.keys()]) {
        if (key === p || key.startsWith(p + path.sep)) written.delete(key);
      }
    }),
  };
}

/**
 * Stands in for `require()`ing a pulled channel bundle: `io` here writes to a
 * Map rather than to disk, so the real loader would have nothing to read.
 */
function makeBundleLoader(slug: string): (modulePath: string) => unknown {
  return () => ({ create: () => null, liveChannel: { name: slug } });
}

interface HttpFixture {
  tree?: { tree: { path: string; type: 'blob' | 'tree' }[]; truncated?: boolean };
  catalog?: Record<string, { name?: string; group?: string; summary?: string; hints?: ChannelHints; configFields?: ChannelConfigField[] }>;
  files?: Record<string, string>;
  release?: { assets: { name: string; browser_download_url: string }[] };
}

function makeHttp(fixture: HttpFixture = {}): HubSyncHttp {
  const tree = fixture.tree ?? { tree: [], truncated: false };
  const catalog = fixture.catalog ?? {};
  const files = fixture.files ?? {};
  const release = fixture.release ?? { assets: [] };

  return {
    fetchJson: vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return tree;
      if (url.includes('/releases/tags/')) return release;
      const match = url.match(/content\/marketplace\/(tools|skills|channels)\/([^/]+)\.json$/);
      if (match) {
        const slug = match[2]!;
        if (catalog[slug]) return catalog[slug];
        throw new Error(`404: no catalog entry for ${slug}`);
      }
      throw new Error(`Unexpected fetchJson url: ${url}`);
    }),
    fetchText: vi.fn(async (url: string) => {
      if (url in files) return files[url]!;
      throw new Error(`Unexpected fetchText url: ${url}`);
    }),
  };
}

const HUB_TREE = {
  tree: [
    { path: 'koris-plugins/README.md', type: 'blob' as const },
    { path: 'koris-plugins/tools/issue/index.ts', type: 'blob' as const },
    { path: 'koris-plugins/tools/issue/index.test.ts', type: 'blob' as const },
    { path: 'koris-plugins/tools/list-beats/index.ts', type: 'blob' as const },
    { path: 'koris-plugins/tools/list-beats/index.test.ts', type: 'blob' as const },
    { path: 'koris-plugins/skills/weather/SKILL.md', type: 'blob' as const },
    { path: 'koris-plugins/skills/cat-fact/SKILL.md', type: 'blob' as const },
    { path: 'koris-plugins/channels/telegram/index.js', type: 'blob' as const },
    { path: 'koris-plugins/channels/telegram/config.example.yml', type: 'blob' as const },
  ],
  truncated: false,
};

const LOCAL_TOOLS_DIR = path.join(BASE_DIR, 'plugins/tools');
const LOCAL_SKILLS_DIR = path.join(BASE_DIR, 'plugins/skills');
const LOCAL_CHANNELS_DIR = path.join(BASE_DIR, 'plugins/channels');

describe('listMissing', () => {
  it('reports hub slugs not present locally, skipping stray files directly under the hub dir', async () => {
    const io = makeIO({ [LOCAL_TOOLS_DIR]: ['list-beats'], [LOCAL_SKILLS_DIR]: ['cat-fact'], [LOCAL_CHANNELS_DIR]: ['telegram'] });
    const http = makeHttp({
      tree: HUB_TREE,
      catalog: { issue: { summary: 'File a GitHub issue.' } },
    });

    const entries = await listMissing({ baseDir: BASE_DIR, io, http });

    expect(entries).toEqual([
      { family: 'skill', slug: 'weather', summary: undefined },
      { family: 'tool', slug: 'issue', summary: 'File a GitHub issue.' },
    ]);
  });

  it('preserves catalog group metadata when present', async () => {
    const io = makeIO({ [LOCAL_TOOLS_DIR]: ['list-beats'], [LOCAL_SKILLS_DIR]: ['weather', 'cat-fact'], [LOCAL_CHANNELS_DIR]: ['telegram'] });
    const http = makeHttp({
      tree: HUB_TREE,
      catalog: { issue: { summary: 'File a GitHub issue.', group: 'github' } },
    });

    const entries = await listMissing({ baseDir: BASE_DIR, io, http });

    expect(entries).toEqual([
      { family: 'tool', slug: 'issue', summary: 'File a GitHub issue.', group: 'github' },
    ]);
  });

  it('excludes slugs already present locally', async () => {
    const io = makeIO({ [LOCAL_TOOLS_DIR]: ['issue', 'list-beats'], [LOCAL_SKILLS_DIR]: ['weather', 'cat-fact'], [LOCAL_CHANNELS_DIR]: ['telegram'] });
    const http = makeHttp({ tree: HUB_TREE });

    const entries = await listMissing({ baseDir: BASE_DIR, io, http });

    expect(entries).toEqual([]);
  });

  it('tolerates a missing/failing catalog entry, still reporting the slug without a summary', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: HUB_TREE });

    const entries = await listMissing({ baseDir: BASE_DIR, io, http });

    const issue = entries.find((e) => e.slug === 'issue');
    expect(issue).toEqual({ family: 'tool', slug: 'issue', summary: undefined });
  });

  it('throws when the hub tree is truncated', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: { tree: [], truncated: true } });

    await expect(listMissing({ baseDir: BASE_DIR, io, http })).rejects.toThrow(/truncated/);
  });

  it('sources channels from the channels-latest release, not the branch tree', async () => {
    const io = makeIO({ [LOCAL_CHANNELS_DIR]: ['telegram'] });
    const http = makeHttp({
      tree: HUB_TREE,
      release: {
        assets: [
          { name: 'telegram-index.js', browser_download_url: 'https://x/telegram-index.js' },
          { name: 'whatsapp-index.js', browser_download_url: 'https://x/whatsapp-index.js' },
        ],
      },
    });

    const entries = await listMissing({ baseDir: BASE_DIR, io, http });

    expect(entries.filter((e) => e.family === 'channel')).toEqual([
      { family: 'channel', slug: 'whatsapp', summary: undefined },
    ]);
  });
});

describe('pullEntry', () => {
  it('rejects a non-kebab-case slug', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: HUB_TREE });

    await expect(pullEntry('Issue Tracker', { baseDir: BASE_DIR, io, http })).rejects.toThrow(/kebab-case/);
  });

  it('rejects a slug attempting path traversal', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: HUB_TREE });

    await expect(pullEntry('../../etc', { baseDir: BASE_DIR, io, http })).rejects.toThrow(/kebab-case/);
  });

  it('throws when the slug is not found in either family', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: HUB_TREE });

    await expect(pullEntry('does-not-exist', { baseDir: BASE_DIR, io, http })).rejects.toThrow(/not found/);
  });

  it('throws when a skill slug is pulled with family: tool', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: HUB_TREE });

    await expect(pullEntry('weather', { baseDir: BASE_DIR, io, http, family: 'tool' })).rejects.toThrow(/not found under koris-plugins\/tools/);
  });

  it('throws when a tool slug is pulled with family: skill', async () => {
    const io = makeIO();
    const http = makeHttp({ tree: HUB_TREE });

    await expect(pullEntry('issue', { baseDir: BASE_DIR, io, http, family: 'skill' })).rejects.toThrow(/not found under koris-plugins\/skills/);
  });

  it('refuses to overwrite an existing local folder without --force', async () => {
    const target = path.join(LOCAL_TOOLS_DIR, 'issue');
    const io = makeIO({}, [target]);
    const http = makeHttp({ tree: HUB_TREE });

    await expect(pullEntry('issue', { baseDir: BASE_DIR, io, http })).rejects.toThrow(/already exists/);
  });

  it('overwrites an existing local folder when --force is passed', async () => {
    const target = path.join(LOCAL_TOOLS_DIR, 'issue');
    const io = makeIO({}, [target]);
    const http = makeHttp({
      tree: HUB_TREE,
      files: {
        'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/tools/issue/index.ts': 'export {}',
        'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/tools/issue/index.test.ts': 'test content',
      },
    });

    const result = await pullEntry('issue', { baseDir: BASE_DIR, io, http, force: true });

    expect(result.family).toBe('tool');
    expect(io.written.get(path.join(target, 'index.ts'))).toBe('export {}');
  });

  it('downloads every file for a tool slug and writes them under plugins/tools/<slug>', async () => {
    const io = makeIO();
    const http = makeHttp({
      tree: HUB_TREE,
      files: {
        'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/tools/list-beats/index.ts': 'tool source',
        'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/tools/list-beats/index.test.ts': 'tool test',
      },
    });

    const result = await pullEntry('list-beats', { baseDir: BASE_DIR, io, http });

    expect(result).toEqual({
      family: 'tool',
      slug: 'list-beats',
      createdFiles: ['plugins/tools/list-beats/index.ts', 'plugins/tools/list-beats/index.test.ts'],
    });
    expect(io.written.get(path.join(LOCAL_TOOLS_DIR, 'list-beats', 'index.ts'))).toBe('tool source');
    expect(io.written.get(path.join(LOCAL_TOOLS_DIR, 'list-beats', 'index.test.ts'))).toBe('tool test');
  });

  it('downloads a skill slug into plugins/skills/<slug>', async () => {
    const io = makeIO();
    const http = makeHttp({
      tree: HUB_TREE,
      files: {
        'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/skills/weather/SKILL.md': '# Weather',
      },
    });

    const result = await pullEntry('weather', { baseDir: BASE_DIR, io, http });

    expect(result.family).toBe('skill');
    expect(result.createdFiles).toEqual(['plugins/skills/weather/SKILL.md']);
    expect(io.written.get(path.join(LOCAL_SKILLS_DIR, 'weather', 'SKILL.md'))).toBe('# Weather');
  });

  it('downloads a channel bundle from the channels-latest release into plugins/channels/<slug>', async () => {
    const assetUrl = 'https://github.com/guilhermesalviano/koris-hub/releases/download/channels-latest/telegram-index.js';
    const io = makeIO();
    const http = makeHttp({
      tree: HUB_TREE,
      release: { assets: [{ name: 'telegram-index.js', browser_download_url: assetUrl }] },
      files: { [assetUrl]: 'channel bundle' },
    });

    const result = await pullEntry('telegram', { baseDir: BASE_DIR, io, http, loadChannelBundle: makeBundleLoader('telegram') });

    expect(result.family).toBe('channel');
    expect(result.createdFiles).toEqual(['plugins/channels/telegram/index.js']);
    expect(io.written.get(path.join(LOCAL_CHANNELS_DIR, 'telegram', 'index.js'))).toBe('channel bundle');
  });

  it('resolves a channel slug even when family is pinned to "channel"', async () => {
    const assetUrl = 'https://github.com/guilhermesalviano/koris-hub/releases/download/channels-latest/whatsapp-index.js';
    const io = makeIO();
    const http = makeHttp({
      release: { assets: [{ name: 'whatsapp-index.js', browser_download_url: assetUrl }] },
      files: { [assetUrl]: 'wa bundle' },
    });

    const result = await pullEntry('whatsapp', { baseDir: BASE_DIR, io, http, family: 'channel', loadChannelBundle: makeBundleLoader('whatsapp') });

    expect(result.createdFiles).toEqual(['plugins/channels/whatsapp/index.js']);
    expect(io.written.get(path.join(LOCAL_CHANNELS_DIR, 'whatsapp', 'index.js'))).toBe('wa bundle');
  });

  it('throws when a channel slug has no matching asset on the release', async () => {
    const io = makeIO();
    const http = makeHttp({ release: { assets: [{ name: 'telegram-index.js', browser_download_url: 'https://x/telegram-index.js' }] } });

    await expect(pullEntry('signal', { baseDir: BASE_DIR, io, http, family: 'channel' })).rejects.toThrow(/no "signal-index\.js" asset/);
  });

  describe('channel bundle smoke check', () => {
    const assetUrl = 'https://x/whatsapp-index.js';

    function channelHttp(): HubSyncHttp {
      return makeHttp({
        release: { assets: [{ name: 'whatsapp-index.js', browser_download_url: assetUrl }] },
        files: { [assetUrl]: 'wa bundle' },
      });
    }

    it('rejects and rolls back a bundle that fails to load, so a dead channel never installs silently', async () => {
      const io = makeIO();
      const loadChannelBundle = () => {
        throw new Error("Cannot find module '../contracts'");
      };

      await expect(
        pullEntry('whatsapp', { baseDir: BASE_DIR, io, http: channelHttp(), family: 'channel', loadChannelBundle }),
      ).rejects.toThrow(/fails to load: Cannot find module '\.\.\/contracts'/);

      expect(io.remove).toHaveBeenCalledWith(path.join(LOCAL_CHANNELS_DIR, 'whatsapp'));
      expect(io.written.size).toBe(0);
    });

    it('rejects a bundle with no create() export', async () => {
      const io = makeIO();

      await expect(
        pullEntry('whatsapp', {
          baseDir: BASE_DIR, io, http: channelHttp(), family: 'channel',
          loadChannelBundle: () => ({ liveChannel: { name: 'whatsapp' } }),
        }),
      ).rejects.toThrow(/exports no create\(\) function/);
    });

    it('rejects a bundle whose liveChannel names a different slug', async () => {
      const io = makeIO();

      await expect(
        pullEntry('whatsapp', {
          baseDir: BASE_DIR, io, http: channelHttp(), family: 'channel',
          loadChannelBundle: () => ({ create: () => null, liveChannel: { name: 'telegram' } }),
        }),
      ).rejects.toThrow(/names "telegram"/);
    });

    it('keeps an existing install when --force pulls a broken bundle over it', async () => {
      const target = path.join(LOCAL_CHANNELS_DIR, 'whatsapp');
      const io = makeIO({}, [target]);
      const loadChannelBundle = () => {
        throw new Error('boom');
      };

      await expect(
        pullEntry('whatsapp', { baseDir: BASE_DIR, io, http: channelHttp(), family: 'channel', force: true, loadChannelBundle }),
      ).rejects.toThrow(/fails to load: boom/);

      expect(io.remove).not.toHaveBeenCalled();
    });

    it('leaves tool pulls alone — only channels ship a prebuilt bundle', async () => {
      const io = makeIO();
      const http = makeHttp({
        tree: HUB_TREE,
        files: {
          'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/tools/issue/index.ts': 'tool source',
          'https://raw.githubusercontent.com/guilhermesalviano/koris-hub/main/koris-plugins/tools/issue/index.test.ts': 'tool test',
        },
      });

      const result = await pullEntry('issue', { baseDir: BASE_DIR, io, http });

      expect(result.family).toBe('tool');
      expect(io.remove).not.toHaveBeenCalled();
    });
  });
});

describe('fetchChannelHints', () => {
  it('fetches hints for requested channels from catalog metadata', async () => {
    const http = makeHttp({
      catalog: {
        telegram: {
          hints: {
            uninstalled: 'Download Telegram from Hub',
            inactive: 'Activate Telegram',
          },
        },
        whatsapp: {
          hints: {
            uninstalled: 'Download WhatsApp from Hub',
            pairing: 'Scan QR Code',
          },
        },
      },
    });

    const hints = await fetchChannelHints(['telegram', 'whatsapp'], { baseDir: BASE_DIR, http });

    expect(hints).toEqual({
      telegram: {
        uninstalled: 'Download Telegram from Hub',
        inactive: 'Activate Telegram',
      },
      whatsapp: {
        uninstalled: 'Download WhatsApp from Hub',
        pairing: 'Scan QR Code',
      },
    });
  });

  it('tolerates missing or failed channel metadata gracefully', async () => {
    const http = makeHttp({
      catalog: {
        telegram: {
          hints: { uninstalled: 'Download Telegram' },
        },
      },
    });

    const hints = await fetchChannelHints(['telegram', 'unknown_channel'], { baseDir: BASE_DIR, http });

    expect(hints).toEqual({
      telegram: { uninstalled: 'Download Telegram' },
    });
  });
});

describe('fetchChannelCatalog', () => {
  it('discovers channels from tree, catalog metadata, and local directories', async () => {
    const io = makeIO({
      [LOCAL_CHANNELS_DIR]: ['custom-channel'],
    });
    const http = makeHttp({
      tree: {
        tree: [
          { path: 'content/marketplace/channels/telegram.json', type: 'blob' as const },
          { path: 'koris-plugins/channels/whatsapp/index.js', type: 'blob' as const },
        ],
        truncated: false,
      },
      catalog: {
        telegram: {
          summary: 'Telegram channel',
          hints: { uninstalled: 'Download TG' },
        },
        whatsapp: {
          summary: 'WhatsApp channel',
          hints: { pairing: 'Scan QR' },
        },
      },
    });

    const catalog = await fetchChannelCatalog({ baseDir: BASE_DIR, io, http });

    expect(catalog).toEqual([
      {
        slug: 'custom-channel',
        name: 'Custom Channel',
      },
      {
        slug: 'telegram',
        name: 'Telegram',
        summary: 'Telegram channel',
        hints: { uninstalled: 'Download TG' },
      },
      {
        slug: 'whatsapp',
        name: 'Whatsapp',
        summary: 'WhatsApp channel',
        hints: { pairing: 'Scan QR' },
      },
    ]);
  });

  it('carries configFields through from catalog metadata', async () => {
    const http = makeHttp({
      tree: {
        tree: [{ path: 'content/marketplace/channels/telegram.json', type: 'blob' as const }],
        truncated: false,
      },
      catalog: {
        telegram: {
          summary: 'Telegram channel',
          configFields: [
            { name: 'bot_token', label: 'Bot token', type: 'password', required: true, placeholder: '123:AA' },
            { name: 'allow_unlisted_senders', label: 'Allow unlisted senders', type: 'boolean' },
          ],
        },
      },
    });

    const catalog = await fetchChannelCatalog({ baseDir: BASE_DIR, io: makeIO(), http });

    expect(catalog).toEqual([
      {
        slug: 'telegram',
        name: 'Telegram',
        summary: 'Telegram channel',
        configFields: [
          { name: 'bot_token', label: 'Bot token', type: 'password', required: true, placeholder: '123:AA' },
          { name: 'allow_unlisted_senders', label: 'Allow unlisted senders', type: 'boolean' },
        ],
      },
    ]);
  });
});

