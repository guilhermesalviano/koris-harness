import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOnboardingScreen,
  buildOnboardingSettings,
  downloadOnboardingChannels,
  Onboard,
  resolveOnboardingSettingsPath,
  saveOnboardingSettings,
  SETTINGS_FILENAME,
} from '../../src/onboard';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koris-onboard-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('buildOnboardingScreen', () => {
  it('asks for TELEGRAM_BOT_TOKEN when telegram is selected', () => {
    const screen = buildOnboardingScreen(
      {
        answers: {
          channels: ['telegram'],
        },
      },
      72,
      'plain',
    );

    expect(screen).toContain('2. Telegram bot token');
    expect(screen).not.toContain('3. Provider');
  });

  it('skips the Telegram token step when telegram is not selected', () => {
    const screen = buildOnboardingScreen(
      {
        answers: {
          channels: ['discord'],
        },
      },
      72,
      'plain',
    );

    expect(screen).toContain('2. Provider');
    expect(screen).not.toContain('Telegram bot token');
  });

  it('keeps the API token step active until it is answered or skipped', () => {
    const screen = buildOnboardingScreen(
      {
        answers: {
          channels: ['telegram'],
          telegramToken: 'YOUR_BOT_TOKEN',
          provider: 'ollama',
        },
      },
      72,
      'plain',
      );

    expect(screen).toContain('4. API token');
    expect(screen).not.toContain('5. Provider URL');
  });

  it('treats an empty API token as a completed answer and advances onboarding', () => {
    const screen = buildOnboardingScreen(
      {
        answers: {
          channels: ['telegram'],
          telegramToken: 'YOUR_BOT_TOKEN',
          provider: 'ollama',
          providerApiToken: 'YOUR_CHAT_ID',
        },
      },
      72,
      'plain',
    );

    expect(screen).toContain('4. API token ─ configured');
    expect(screen).toContain('5. Model');
  });

  it('renders personal details as a top-level step after personal information', () => {
    const screen = buildOnboardingScreen(
      {
        answers: {
          channels: ['telegram'],
          telegramToken: 'YOUR_BOT_TOKEN',
          provider: 'ollama',
          providerApiToken: 'YOUR_CHAT_ID',
          providerModel: 'z-ai/glm-5.1',
          providerUrl: 'http://localhost:11434',
          personalInfo: { enabled: true, details: { name: 'Joe Doe' }, done: true },
        },
      },
      72,
      'plain',
    );

    expect(screen).toContain('7. Your Information ─ true');
    expect(screen).toContain('8. Personal details ─ 1 detail(s)');
    expect(screen).not.toContain('Your name ─ Joe Doe');
  });
});

describe('Onboard footer progress', () => {
  it('counts the personal details step as a top-level step in the footer', () => {
    const onboard = new Onboard() as any;
    onboard.answers = {
      channels: ['telegram'],
      telegramToken: 'YOUR_BOT_TOKEN',
      provider: 'ollama',
      providerApiToken: 'YOUR_CHAT_ID',
      providerModel: 'z-ai/glm-5.1',
      providerUrl: 'http://localhost:11434',
      personalInfo: { enabled: true },
    };
    onboard.skippedSteps = new Set();

    expect(onboard.getFooterText()).toBe('step 8/8');
  });

  it('creates the temp settings draft when onboarding completes from a false picker selection', () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const repoRoot = createTempDir();
    const appRoot = join(repoRoot, 'apps', 'client');
    const previousCwd = process.cwd();

    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, 'koris.json'), '{}');
    writeFileSync(join(appRoot, 'koris.example.json'), JSON.stringify({
      channels: {
        telegram: {
          ENABLED: true,
          BOT_TOKEN: 'YOUR_BOT_TOKEN',
        },
      },
      ai: {
        PROVIDER: 'ollama',
        BASE_URL: 'http://localhost:11434',
        API_TOKEN: '',
      },
      personal_information: {
        HUMAN_NAME: 'John Doe',
      },
    }));

    try {
      process.chdir(repoRoot);

      const onboard = new Onboard() as any;
      onboard.answers = {
        channels: ['telegram'],
        telegramToken: 'YOUR_BOT_TOKEN',
        provider: 'ollama',
        providerApiToken: 'YOUR_CHAT_ID',
        providerModel: 'z-ai/glm-5.1',
        providerUrl: 'http://localhost:11434',
      };
      onboard.skippedSteps = new Set();
      onboard.pickerStep = 'personalInformation';
      onboard.pickerIndex = 1;

      const redrawCalls: string[] = [];
      const inputValues: string[] = [];
      const ctx = {
        getInputValue: () => '',
        setInputValue: (value: string) => {
          inputValues.push(value);
        },
        redraw: () => {
          redrawCalls.push('redraw');
        },
        println: vi.fn(),
        rl: { close: vi.fn() },
      };

      expect(onboard.handleKeypress('', { name: 'return' }, ctx)).toBe(true);
      vi.advanceTimersByTime(80);
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(readFileSync(join(appRoot, SETTINGS_FILENAME), 'utf-8')).toContain('"personal_information": {}');
      expect(inputValues).toContain('');
      expect(redrawCalls).toHaveLength(1);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('onboarding settings draft', () => {
  it('builds a temp settings payload by overlaying onboarding answers on the example settings', () => {
    expect(buildOnboardingSettings({
      channels: ['telegram', 'discord'],
      telegramToken: 'YOUR_BOT_TOKEN',
      provider: 'ollama',
      providerUrl: 'http://localhost:11434',
      providerApiToken: 'YOUR_CHAT_ID',
      personalInfo: {
        enabled: true,
        details: {
          name: 'Joe Doe',
          gender: 'male',
        },
        done: true,
      },
    }, {
      baseSettings: {
        channels: {
          telegram: {
            enabled: true,
            bot_token: 'YOUR_BOT_TOKEN',
          },
        },
        ai: {
          providers: [
            {
              provider: 'ollama',
              base_url: 'http://localhost:11434',
              api_token: '',
              model: 'gemma4:e4b',
            },
          ],
          roles: {
            manager: { provider: 'ollama' },
            workers: { provider: 'ollama' },
          },
          embed: { enabled: false, provider: 'ollama', model: 'nomic-embed-text' },
        },
        personal_information: {
          name: 'John Doe',
          gender: 'male',
          birthday: '1990-01-01',
          location: 'New York, USA',
          occupation: 'Software Engineer',
        },
      },
    })).toEqual({
      channels: {
        discord: {
          enabled: true,
        },
      },
      ai: {
        providers: [
          {
            provider: 'ollama',
            base_url: 'http://localhost:11434',
            api_token: 'YOUR_CHAT_ID',
            model: 'gemma4:e4b',
          },
        ],
        roles: {
          manager: { provider: 'ollama' },
          workers: { provider: 'ollama' },
        },
        embed: { enabled: false, provider: 'ollama', model: 'nomic-embed-text' },
      },
      personal_information: {
        name: 'Joe Doe',
        gender: 'male',
      },
    });
  });

  it('resolves the draft path to apps/client from the monorepo root', () => {
    const repoRoot = createTempDir();
    const appRoot = join(repoRoot, 'apps', 'client');
    const runtimeDir = join(appRoot, 'dist', 'src');

    mkdirSync(join(appRoot, 'src'), { recursive: true });
    writeFileSync(join(appRoot, 'src', 'onboard.ts'), '');

    expect(resolveOnboardingSettingsPath({
      cwd: repoRoot,
      dirname: runtimeDir,
    })).toBe(join(appRoot, SETTINGS_FILENAME));
  });

  it('saves the draft next to koris.json using koris.example.json as the base', () => {
    const repoRoot = createTempDir();
    const appRoot = join(repoRoot, 'apps', 'client');
    const runtimeDir = join(appRoot, 'dist', 'src');

    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, 'koris.json'), '{}');
    writeFileSync(join(appRoot, 'koris.example.json'), JSON.stringify({
      heartbeat: true,
      channels: {
        telegram: {
          enabled: true,
          bot_token: 'YOUR_BOT_TOKEN',
        },
      },
      ai: {
        providers: [
          {
            provider: 'ollama',
            base_url: 'http://localhost:11434',
            api_token: '',
            model: 'gemma4:e4b',
          },
        ],
        roles: {
          manager: { provider: 'ollama' },
          workers: { provider: 'ollama' },
        },
        embed: { enabled: false, provider: 'ollama', model: 'nomic-embed-text' },
      },
      personal_information: {
        name: 'John Doe',
        gender: 'male',
        birthday: '1990-01-01',
        location: 'New York, USA',
        occupation: 'Software Engineer',
      },
    }));

    const destination = saveOnboardingSettings({
      channels: ['telegram'],
      telegramToken: 'YOUR_BOT_TOKEN',
      provider: 'ollama',
      providerApiToken: '',
    }, {
      cwd: repoRoot,
      dirname: runtimeDir,
    });

    expect(destination).toBe(join(appRoot, SETTINGS_FILENAME));
    expect(JSON.parse(readFileSync(destination, 'utf-8'))).toEqual({
      heartbeat: true,
      channels: {},
      ai: {
        providers: [
          {
            provider: 'ollama',
            base_url: 'http://localhost:11434',
            api_token: '',
            model: 'gemma4:e4b',
          },
        ],
        roles: {
          manager: { provider: 'ollama' },
          workers: { provider: 'ollama' },
        },
        embed: { enabled: false, provider: 'ollama', model: 'nomic-embed-text' },
      },
      personal_information: {
      },
    });
  });

  describe('downloadOnboardingChannels', () => {
    it('downloads missing channels via pullFn', async () => {
      const pullMock = vi.fn().mockResolvedValue({});
      const existsMock = vi.fn().mockReturnValue(false);
      const loggerMock = { info: vi.fn(), warn: vi.fn() };

      const result = await downloadOnboardingChannels(['telegram', 'whatsapp'], {
        baseDir: '/test/dir',
        pullFn: pullMock,
        existsFn: existsMock,
        logger: loggerMock,
      });

      expect(result).toEqual(['telegram', 'whatsapp']);
      expect(pullMock).toHaveBeenCalledWith('telegram', { baseDir: '/test/dir', family: 'channel' });
      expect(pullMock).toHaveBeenCalledWith('whatsapp', { baseDir: '/test/dir', family: 'channel' });
    });

    it('skips channels that already exist locally', async () => {
      const pullMock = vi.fn();
      const existsMock = vi.fn().mockReturnValue(true);

      const result = await downloadOnboardingChannels(['telegram'], {
        baseDir: '/test/dir',
        pullFn: pullMock,
        existsFn: existsMock,
      });

      expect(result).toEqual([]);
      expect(pullMock).not.toHaveBeenCalled();
    });

    it('handles download errors gracefully without throwing', async () => {
      const pullMock = vi.fn().mockRejectedValue(new Error('Network error'));
      const existsMock = vi.fn().mockReturnValue(false);
      const loggerMock = { info: vi.fn(), warn: vi.fn() };

      const result = await downloadOnboardingChannels(['telegram'], {
        baseDir: '/test/dir',
        pullFn: pullMock,
        existsFn: existsMock,
        logger: loggerMock,
      });

      expect(result).toEqual([]);
      expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });
  });
});
