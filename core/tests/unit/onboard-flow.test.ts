import { describe, expect, it, vi } from 'vitest';
import { buildLaunchCommand, buildOnboardingSummary, Onboard, parseChannels } from '../../src/onboard';

// Completing onboarding saves the draft over the real koris.json. None of these
// tests should get that far; make any accidental completion fail instead of
// touching the developer's config.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const refuse = () => { throw new Error('onboard-flow tests must not write files'); };
  return { ...actual, default: { ...actual, writeFileSync: refuse, mkdirSync: refuse }, writeFileSync: refuse, mkdirSync: refuse };
});

function makeCtx(input = '') {
  let value = input;
  return {
    getInputValue: () => value,
    setInputValue: vi.fn((next: string) => { value = next; }),
    redraw: vi.fn(),
    println: vi.fn(),
    rl: { close: vi.fn() },
    terminalWidth: 80,
    colors: { bright: '', dim: '', reset: '' },
  };
}

// Private members are the unit under test here: the TUI only ever reaches the
// flow through these callbacks.
function makeOnboard(): any {
  return new Onboard();
}

describe('parseChannels', () => {
  it('normalizes, dedupes and keeps order', () => {
    expect(parseChannels(' WhatsApp, telegram,,whatsapp ')).toEqual(['whatsapp', 'telegram']);
  });

  it('rejects unsupported channels, naming each one', () => {
    expect(() => parseChannels('discord')).toThrow('Unsupported channel: discord. Use telegram, whatsapp.');
    expect(() => parseChannels('discord, irc')).toThrow('Unsupported channels: discord, irc.');
  });

  it('rejects an empty selection', () => {
    expect(() => parseChannels(' , ')).toThrow('Choose a supported channel: telegram, whatsapp.');
  });
});

describe('buildLaunchCommand', () => {
  it('adds a flag per channel', () => {
    expect(buildLaunchCommand(['telegram', 'whatsapp'])).toBe('pnpm app -- --telegram --whatsapp');
    expect(buildLaunchCommand([])).toBe('pnpm app');
  });
});

describe('buildOnboardingSummary', () => {
  it('lists the captured answers and non-empty personal details', () => {
    const summary = buildOnboardingSummary({
      channels: ['telegram'],
      telegramToken: 't',
      provider: 'ollama',
      providerApiToken: '',
      providerUrl: '',
      personalInfo: { enabled: true, details: { name: 'John', city: '' } },
    } as never);
    expect(summary).toContain('Telegram token: configured');
    expect(summary).toContain('Provider URL: default');
    expect(summary).toContain('name: John');
    expect(summary).not.toContain('city');
  });
});

describe('Onboard commands', () => {
  it('/start and /clear refresh the screen', () => {
    const onboard = makeOnboard();
    expect(onboard.handleCommand('/start', makeCtx())).toEqual({ handled: true, action: 'clear' });
    expect(onboard.handleCommand('/CLEAR extra', makeCtx())).toEqual({ handled: true, action: 'clear' });
    expect(onboard.notice).toBe('Screen refreshed.');
  });

  it('/help lists the onboarding commands and supported options', () => {
    const result = makeOnboard().handleCommand('/help', makeCtx());
    expect(result.action).toBe('none');
    expect(result.response).toContain('Onboarding commands');
    expect(result.response).toContain('telegram, whatsapp');
    expect(result.response).toContain('/exit');
  });

  it('/status renders the current step', () => {
    const result = makeOnboard().handleCommand('/status', makeCtx());
    expect(result.action).toBe('none');
    expect(result.response).toContain('Koris Assistant onboarding');
  });

  it('/reset clears the draft', () => {
    const onboard = makeOnboard();
    onboard.handleInput('telegram', makeCtx());
    expect(onboard.handleCommand('/reset', makeCtx())).toEqual({ handled: true, action: 'clear' });
    expect(onboard.answers).toEqual({});
    expect(onboard.selectedChannels.size).toBe(0);
    expect(onboard.notice).toBe('Draft cleared. Back to step 1.');
  });

  it.each(['/exit', '/quit', '/bye'])('%s leaves onboarding', (command) => {
    expect(makeOnboard().handleCommand(command, makeCtx())).toEqual({ handled: true, action: 'exit', response: 'Leaving onboarding.' });
  });

  it('reports unknown commands', () => {
    expect(makeOnboard().handleCommand('/nope', makeCtx()).response).toBe('Unknown command: /nope\nType /help for available commands.');
  });
});

describe('Onboard typed input', () => {
  it('walks the text steps, applying skips and the provider default URL', () => {
    const onboard = makeOnboard();
    const ctx = makeCtx();

    onboard.handleInput('telegram', ctx);
    expect(onboard.answers.channels).toEqual(['telegram']);
    expect(onboard.getFooterText()).toBe('step 2/7');

    onboard.handleInput('123:abc', ctx);
    expect(onboard.answers.telegramToken).toBe('123:abc');
    expect(onboard.notice).toBe('Captured Telegram bot token.');

    onboard.handleInput('ollama', ctx);
    expect(onboard.answers.provider).toBe('ollama');
    expect(onboard.answers.providerUrl).toBeTruthy();

    onboard.handleInput('', ctx);
    expect(onboard.notice).toBe('Provider API token left empty.');

    onboard.handleInput('skip', ctx);
    expect(onboard.skippedSteps.has('providerModel')).toBe(true);
    expect(onboard.notice).toBe('Model skipped.');

    expect(ctx.redraw).toHaveBeenCalled();
    expect(ctx.setInputValue).toHaveBeenCalledWith('');
  });

  it('collects personal details until "done"', () => {
    const onboard = makeOnboard();
    onboard.answers = { channels: ['whatsapp'], provider: 'ollama', providerApiToken: 'x', providerModel: 'm', providerUrl: 'http://h' };
    const ctx = makeCtx();

    onboard.handleInput('true', ctx);
    expect(onboard.answers.personalInfo).toEqual({ enabled: true });

    onboard.handleInput('name: John Doe', ctx);
    onboard.handleInput('city: Goiânia', ctx);
    expect(onboard.answers.personalInfo.details).toEqual({ name: 'John Doe', city: 'Goiânia' });
    expect(onboard.notice).toBe('Added "city" (2 detail(s)). Type "done" to finish.');

    expect(() => onboard.handleInput('no separator', ctx)).toThrow('Expected "key: value" format.');
    expect(() => onboard.handleInput(': value', ctx)).toThrow('Detail key must not be empty.');
    expect(() => onboard.handleInput('key:', ctx)).toThrow('Detail value must not be empty.');
  });

  it('skipping personal details clears what was collected', () => {
    const onboard = makeOnboard();
    onboard.answers = { personalInfo: { enabled: true, details: { name: 'John' } } };
    onboard.applySkip('personalDetails');
    expect(onboard.answers.personalInfo).toEqual({ enabled: true });

    onboard.answers = { personalInfo: {} };
    onboard.clearPersonalDetails();
    expect(onboard.answers.personalInfo).toBeUndefined();
  });

  it.each([
    ['providerUrl', 'providerUrl'],
    ['providerApiToken', 'providerApiToken'],
    ['providerModel', 'providerModel'],
    ['telegramToken', 'telegramToken'],
    ['personalInformation', 'personalInfo'],
  ])('skipping %s drops its answer', (step, field) => {
    const onboard = makeOnboard();
    onboard.answers = { [field]: 'value' };
    onboard.applySkip(step);
    expect(onboard.answers).not.toHaveProperty(field);
    expect(onboard.skippedSteps.has(step)).toBe(true);
  });

  it('rejects unsupported providers and boolean answers', () => {
    const onboard = makeOnboard();
    onboard.answers = { channels: ['whatsapp'] };
    expect(() => onboard.handleInput('nope', makeCtx())).toThrow('Unsupported provider: nope.');

    onboard.answers = { channels: ['whatsapp'], provider: 'ollama', providerApiToken: 'x', providerModel: 'm', providerUrl: 'http://h' };
    expect(() => onboard.handleInput('maybe', makeCtx())).toThrow('Unsupported value: maybe. Use true, false.');
    // Answering "false" here would complete onboarding, so set it directly.
    onboard.setPersonalInformationEnabled(false);
    expect(onboard.answers.personalInfo).toEqual({ enabled: false });
  });

  it('keeps a provider URL the user already set', () => {
    const onboard = makeOnboard();
    onboard.answers = { provider: 'ollama', providerUrl: 'http://custom' };
    onboard.applyProviderDefaultUrl();
    expect(onboard.answers.providerUrl).toBe('http://custom');
  });
});

describe('Onboard picker keys', () => {
  it('moves the selection with up/down and wraps around', () => {
    const onboard = makeOnboard();
    const ctx = makeCtx();
    expect(onboard.handleKeypress('', { name: 'down' }, ctx)).toBe(true);
    expect(onboard.getSelectedOption('channels')).toBe('whatsapp');
    expect(onboard.handleKeypress('', { name: 'down' }, ctx)).toBe(true);
    expect(onboard.getSelectedOption('channels')).toBe('telegram');
    expect(onboard.handleKeypress('', { name: 'up' }, ctx)).toBe(true);
    expect(onboard.getSelectedOption('channels')).toBe('whatsapp');
    expect(ctx.redraw).toHaveBeenCalledTimes(3);
  });

  it('toggles several channels with space/tab and commits them with enter', () => {
    const onboard = makeOnboard();
    const ctx = makeCtx();
    onboard.handleKeypress(' ', { name: 'space' }, ctx);
    onboard.handleKeypress('', { name: 'down' }, ctx);
    onboard.handleKeypress('\t', { name: 'tab' }, ctx);
    expect(onboard.getSelectedOptions('channels')).toEqual(['telegram', 'whatsapp']);
    onboard.handleKeypress('', { name: 'tab' }, ctx);
    expect(onboard.getSelectedOptions('channels')).toEqual(['telegram']);

    expect(onboard.handleKeypress('', { name: 'return' }, ctx)).toBe(true);
    expect(onboard.answers.channels).toEqual(['telegram']);
    expect(onboard.getSelectedOptions('provider')).toBeUndefined();
  });

  it('commits the highlighted channel when none was toggled, dropping a stale Telegram token', () => {
    const onboard = makeOnboard();
    onboard.answers = { telegramToken: 'old' };
    onboard.handleKeypress('', { name: 'down' }, makeCtx());
    onboard.handleKeypress('', { name: 'enter' }, makeCtx());
    expect(onboard.answers.channels).toEqual(['whatsapp']);
    expect(onboard.answers).not.toHaveProperty('telegramToken');
  });

  it('commits provider and personal-information pickers', () => {
    const onboard = makeOnboard();
    onboard.answers = { channels: ['whatsapp'] };
    onboard.handleKeypress('', { name: 'return' }, makeCtx());
    expect(onboard.answers.provider).toBeTruthy();

    onboard.answers = { channels: ['whatsapp'], provider: 'ollama', providerApiToken: 'x', providerModel: 'm', providerUrl: 'http://h' };
    onboard.handleKeypress('', { name: 'return' }, makeCtx());
    expect(onboard.answers.personalInfo).toEqual({ enabled: true });
  });

  it('swallows printable and editing keys on a picker step, but lets commands through', () => {
    const onboard = makeOnboard();
    expect(onboard.handleKeypress('a', { name: 'a' }, makeCtx())).toBe(true);
    expect(onboard.handleKeypress('', { name: 'backspace' }, makeCtx())).toBe(true);
    expect(onboard.handleKeypress('/', { name: 'slash' }, makeCtx())).toBe(false);
    expect(onboard.handleKeypress('h', { name: 'h' }, makeCtx('/'))).toBe(false);
    expect(onboard.handleKeypress('', { name: 'c', ctrl: true }, makeCtx())).toBe(false);
  });

  it('fills a text step with its placeholder when enter is pressed on empty input', () => {
    const onboard = makeOnboard();
    onboard.answers = { channels: ['whatsapp'], provider: 'ollama', providerApiToken: 'x' };
    const ctx = makeCtx();
    expect(onboard.handleKeypress('', { name: 'return' }, ctx)).toBe(false);
    expect(ctx.setInputValue).toHaveBeenCalledWith('z-ai/glm-5.1');
    expect(onboard.handleKeypress('', { name: 'escape' }, makeCtx())).toBe(true);
  });

  it('ignores typing once onboarding is complete', () => {
    const onboard = makeOnboard();
    onboard.answers = { channels: ['whatsapp'], provider: 'ollama', providerApiToken: 'x', providerModel: 'm', providerUrl: 'http://h', personalInfo: { enabled: false } };
    expect(onboard.getFooterText()).toBe('onboarding complete');
    expect(onboard.handleKeypress('a', { name: 'a' }, makeCtx())).toBe(true);

    const ctx = makeCtx();
    onboard.handleInput('anything', ctx);
    expect(onboard.notice).toBe('Onboarding is already complete. Use /reset to start over or /exit to leave.');
    expect(ctx.redraw).toHaveBeenCalledTimes(1);
  });
});

describe('Onboard welcome screen', () => {
  it('prints the screen and clears the input on a picker step', () => {
    const onboard = makeOnboard();
    const ctx = makeCtx('typed');
    onboard.renderWelcome(ctx);
    expect(ctx.println).toHaveBeenCalled();
    expect(ctx.setInputValue).toHaveBeenCalledWith('');
  });

  it('keeps the typed input on a text step', () => {
    const onboard = makeOnboard();
    onboard.answers = { channels: ['telegram'] };
    const ctx = makeCtx('123:abc');
    onboard.renderWelcome(ctx);
    expect(ctx.setInputValue).not.toHaveBeenCalled();
    expect(ctx.println.mock.calls.flat().join('\n')).toContain('123:abc');
  });
});
