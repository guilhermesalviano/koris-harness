import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';
import { getPluginConfigValue, loadPluginConfigFile, resolvePluginDir } from './loader';

describe('resolvePluginDir', () => {
  const cwd = '/repo';
  const fallbackDir = '/repo/dist/plugins/channels/whatsapp';

  it('returns the first candidate that already has a config.yml', () => {
    const dir = resolvePluginDir('whatsapp', {
      cwd,
      fallbackDir,
      exists: (p) => p === normalize(join(cwd, 'plugins', 'channels', 'whatsapp', 'config.yml')),
    });
    expect(dir).toBe(normalize(join(cwd, 'plugins', 'channels', 'whatsapp')));
  });

  it('prefers the KORIS_DATA_DIR candidate when it holds the file', () => {
    const dir = resolvePluginDir('whatsapp', {
      cwd,
      fallbackDir,
      dataDir: '/data',
      exists: (p) => p === normalize(join('/data', 'plugins', 'channels', 'whatsapp', 'config.yml')),
    });
    expect(dir).toBe(normalize(join('/data', 'plugins', 'channels', 'whatsapp')));
  });

  it('falls back to the writable data dir when nothing is written yet', () => {
    const dir = resolvePluginDir('whatsapp', {
      cwd,
      fallbackDir,
      dataDir: '/data',
      exists: () => false,
    });
    expect(dir).toBe(normalize(join('/data', 'plugins', 'channels', 'whatsapp')));
  });

  it('with no config anywhere and no dataDir, writes into the repo plugins tree, NOT dist/', () => {
    // Only the repo `plugins/channels` directory exists (no config.yml yet).
    const repoFamilyDir = normalize(join(cwd, 'plugins', 'channels'));
    const dir = resolvePluginDir('whatsapp', {
      cwd,
      fallbackDir,
      exists: (p) => p === repoFamilyDir,
    });
    expect(dir).toBe(normalize(join(cwd, 'plugins', 'channels', 'whatsapp')));
    expect(dir).not.toContain('dist');
  });

  it('falls back to fallbackDir only when not running inside a repo layout', () => {
    const dir = resolvePluginDir('whatsapp', {
      cwd,
      fallbackDir,
      exists: () => false,
    });
    expect(dir).toBe(normalize(fallbackDir));
  });
});

describe('loadPluginConfigFile', () => {
  it('returns empty object when config file does not exist', () => {
    const result = loadPluginConfigFile({
      pluginDir: '/test/dir',
      fileIO: { exists: () => false, read: () => '' },
    });
    expect(result).toEqual({});
  });

  it('parses and returns valid YAML configuration object', () => {
    const result = loadPluginConfigFile({
      pluginDir: '/test/dir',
      fileIO: {
        exists: () => true,
        read: () => 'token: secret123\nport: 8080\n',
      },
    });
    expect(result).toEqual({ token: 'secret123', port: 8080 });
  });

  it('returns empty object when YAML parses into a non-object or array', () => {
    const result = loadPluginConfigFile({
      pluginDir: '/test/dir',
      fileIO: {
        exists: () => true,
        read: () => '- item1\n- item2\n',
      },
    });
    expect(result).toEqual({});
  });

  it('invokes onParseError and returns empty object on invalid YAML', () => {
    const onParseError = vi.fn();
    const result = loadPluginConfigFile({
      pluginDir: '/test/dir',
      filename: 'custom.yml',
      fileIO: {
        exists: () => true,
        read: () => ':\n invalid: [yaml',
      },
      onParseError,
    });
    expect(result).toEqual({});
    expect(onParseError).toHaveBeenCalledWith('Warning: Failed to parse custom.yml, ignoring file.');
  });

  it('uses the default file IO to read a real config file from disk', () => {
    const pluginDir = mkdtempSync(join(tmpdir(), 'koris-loader-test-'));
    try {
      writeFileSync(join(pluginDir, 'config.yml'), 'token: abc\nport: 8080\n');
      expect(loadPluginConfigFile({ pluginDir })).toEqual({ token: 'abc', port: 8080 });
    } finally {
      rmSync(pluginDir, { recursive: true, force: true });
    }
  });
});

describe('getPluginConfigValue', () => {
  it('prefers environment variable over yaml config and fallback', () => {
    const env = { TEST_KEY: 'from-env' };
    const yamlConfig = { key: 'from-yaml' };
    expect(getPluginConfigValue('key', 'fallback', yamlConfig, 'TEST_KEY', env)).toBe('from-env');
  });

  it('reads from yamlConfig when environment variable is not set', () => {
    const env = {};
    const yamlConfig = { key: 'from-yaml' };
    expect(getPluginConfigValue('key', 'fallback', yamlConfig, 'TEST_KEY', env)).toBe('from-yaml');
  });

  it('falls back when neither environment variable nor yaml value exists', () => {
    const env = {};
    const yamlConfig = {};
    expect(getPluginConfigValue('key', 'default-val', yamlConfig, 'TEST_KEY', env)).toBe('default-val');
  });

  it('returns empty string if environment variable is set to empty string', () => {
    const env = { TEST_KEY: '' };
    const yamlConfig = { key: 'from-yaml' };
    expect(getPluginConfigValue('key', 'fallback', yamlConfig, 'TEST_KEY', env)).toBe('');
  });
});

