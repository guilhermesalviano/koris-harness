import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ansi } from './ansi';
import { defaultColors } from './colors';
import { getSigintAction, resolveSubmittedInput, setupLineHandlers } from './line-handler';
import type { TuiContext } from './types';
import type { TuiInternalState } from './renderer';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createState(overrides?: Partial<TuiInternalState>): TuiInternalState {
  return {
    contentBuffer: [],
    scrollOffset: 0,
    terminalWidth: 80,
    terminalHeight: 24,
    inputLineCount: 1,
    spinnerStatus: '',
    isRendering: false,
    renderQueued: false,
    renderScheduled: undefined,
    activeAbortController: undefined,
    isBusy: false,
    iterationBadge: '',
    footerNote: '',
    userTyping: false,
    ...overrides,
  };
}

function createLineHandlerHarness(
  optionsOverrides?: Partial<TuiContext['options']>,
  depsOverrides?: Record<string, unknown>,
) {
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    void chunk;
    return true;
  }) as typeof process.stdout.write);

  const rl = new EventEmitter() as EventEmitter & {
    prompt: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  rl.prompt = vi.fn();
  rl.close = vi.fn();

  const input = new EventEmitter();
  const state = createState();
  const session = { messageCount: 0, startTime: new Date('2026-05-05T00:00:00Z') };
  const anyRl = { input, line: '', cursor: 0 };
  const ctx = {
    rl: rl as unknown as TuiContext['rl'],
    session,
    colors: defaultColors,
    clear: vi.fn(),
    redraw: vi.fn(),
    getInputValue: () => String(anyRl.line ?? ''),
    setInputValue: vi.fn(),
    println: vi.fn(),
    contentBuffer: state.contentBuffer,
    terminalWidth: state.terminalWidth,
    terminalHeight: state.terminalHeight,
    cancelActiveRequest: vi.fn(() => false),
    setIterationBadge: vi.fn(),
    setFooterNote: vi.fn(),
  } as unknown as TuiContext;

  const onInput = optionsOverrides?.onInput ?? vi.fn(async () => '');
  const onCommand = optionsOverrides?.onCommand;
  const println = (depsOverrides?.println as ReturnType<typeof vi.fn>) ?? vi.fn();
  const clearScreen = (depsOverrides?.clearScreen as ReturnType<typeof vi.fn>) ?? vi.fn();
  const renderWelcome = (depsOverrides?.renderWelcome as ReturnType<typeof vi.fn>) ?? vi.fn();
  const requestRender = (depsOverrides?.requestRender as ReturnType<typeof vi.fn>) ?? vi.fn();
  const isCommand = (depsOverrides?.isCommand as (c: string) => boolean) ?? ((cmd: string) => cmd.startsWith('/'));

  setupLineHandlers({
    state,
    rl: rl as unknown as TuiContext['rl'],
    anyRl,
    ansi,
    colors: defaultColors,
    fixedInput: true,
    session,
    options: {
      onInput,
      onCommand,
      confirmExit: true,
      ...optionsOverrides,
    },
    ctx,
    println,
    requestRender,
    renderSpinnerRow: vi.fn(),
    clearScreen,
    renderWelcome,
    acDismiss: vi.fn(),
    onAcKeypress: vi.fn(),
    acInput: input,
    inputFilter: undefined,
    isCommand,
    formatResponse: (response) => response,
    assistantPrefix: '●',
    handleResize: vi.fn(),
    recordRaw: vi.fn(),
    ...depsOverrides,
  });

  return { rl, input, state, ctx, println, onInput, onCommand, clearScreen, renderWelcome, requestRender, session };
}

describe('resolveSubmittedInput', () => {
  it('returns trimmed text for non-empty input', () => {
    expect(resolveSubmittedInput('  hello  ')).toBe('hello');
  });

  it('drops blank submissions by default', () => {
    expect(resolveSubmittedInput('   ')).toBeUndefined();
  });

  it('keeps blank submissions when empty input is allowed', () => {
    expect(resolveSubmittedInput('   ', true)).toBe('');
  });
});

describe('getSigintAction', () => {
  it('prompts for confirmation on the first Ctrl+C', () => {
    expect(getSigintAction(false)).toBe('prompt');
  });

  it('exits on the second Ctrl+C', () => {
    expect(getSigintAction(true)).toBe('exit');
  });
});

describe('setupLineHandlers', () => {
  it('cancels exit confirmation after 3 seconds', () => {
    vi.useFakeTimers();
    const { rl, input } = createLineHandlerHarness();

    rl.emit('SIGINT');
    expect(input.listenerCount('keypress')).toBe(1);

    vi.advanceTimersByTime(3000);
    expect(input.listenerCount('keypress')).toBe(0);

    rl.emit('SIGINT');
    expect(rl.close).not.toHaveBeenCalled();

    rl.emit('SIGINT');
    expect(rl.close).toHaveBeenCalledOnce();
  });

  it('prompts again when empty line is entered', async () => {
    const { rl } = createLineHandlerHarness();
    rl.emit('line', '   ');
    expect(rl.prompt).toHaveBeenCalled();
  });

  it('handles normal input with string response', async () => {
    const onInput = vi.fn(async () => 'Agent response');
    const { rl, println, session } = createLineHandlerHarness({ onInput });

    rl.emit('line', 'what is 2+2?');
    await vi.waitFor(() => expect(onInput).toHaveBeenCalledWith('what is 2+2?', expect.anything()));

    expect(session.messageCount).toBe(1);
    expect(println).toHaveBeenCalledWith(expect.stringContaining('Agent response'));
  });

  it('handles normal input with streamed async iterable response', async () => {
    async function* makeStream() {
      yield 'Hello ';
      yield 'world!';
    }
    const onInput = vi.fn(async () => makeStream());
    const recordRaw = vi.fn();
    const { rl, session } = createLineHandlerHarness({ onInput }, { recordRaw });

    rl.emit('line', 'stream test');
    await vi.waitFor(() => expect(onInput).toHaveBeenCalled());
    await vi.waitFor(() => expect(recordRaw).toHaveBeenCalledWith(expect.stringContaining('Hello world!')));

    expect(session.messageCount).toBe(1);
  });

  it('handles error in onInput gracefully', async () => {
    const onInput = vi.fn(async () => {
      throw new Error('LLM Provider down');
    });
    const { rl, println } = createLineHandlerHarness({ onInput });

    rl.emit('line', 'hello');
    await vi.waitFor(() => expect(println).toHaveBeenCalledWith(expect.stringContaining('LLM Provider down')));
  });

  it('cancels active request when escape key is pressed', async () => {
    let resolveInput!: (val: string) => void;
    const onInput = vi.fn(() => new Promise<string>((res) => { resolveInput = res; }));
    const { rl, input, ctx, println } = createLineHandlerHarness({ onInput });
    ctx.cancelActiveRequest = vi.fn(() => true);

    rl.emit('line', 'slow prompt');
    input.emit('keypress', '', { name: 'escape' });

    expect(ctx.cancelActiveRequest).toHaveBeenCalled();
    expect(println).toHaveBeenCalledWith(expect.stringContaining('Request canceled.'));

    resolveInput('done');
  });

  it('routes slash commands to onCommand handler', async () => {
    const onCommand = vi.fn(async () => ({ handled: true, response: 'Help text' }));
    const { rl, println } = createLineHandlerHarness({ onCommand });

    rl.emit('line', '/help');
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledWith('/help', expect.anything()));

    expect(println).toHaveBeenCalledWith(expect.stringContaining('Help text'));
  });

  it('handles command action: exit', async () => {
    const onCommand = vi.fn(async () => ({ action: 'exit' as const, response: 'Goodbye!' }));
    const { rl, println } = createLineHandlerHarness({ onCommand });

    rl.emit('line', '/exit');
    await vi.waitFor(() => expect(rl.close).toHaveBeenCalled());
    expect(println).toHaveBeenCalledWith(expect.stringContaining('Goodbye!'));
  });

  it('handles command action: clear', async () => {
    const onCommand = vi.fn(async () => ({ action: 'clear' as const }));
    const { rl, clearScreen, renderWelcome, state } = createLineHandlerHarness({ onCommand });
    state.contentBuffer.push('old line');

    rl.emit('line', '/clear');
    await vi.waitFor(() => expect(clearScreen).toHaveBeenCalled());
    expect(renderWelcome).toHaveBeenCalled();
    expect(state.contentBuffer).toHaveLength(0);
  });

  it('handles command action: reset', async () => {
    const onCommand = vi.fn(async () => ({ action: 'reset' as const, response: 'Session reset' }));
    const { rl, session, println } = createLineHandlerHarness({ onCommand });
    session.messageCount = 10;

    rl.emit('line', '/reset');
    await vi.waitFor(() => expect(println).toHaveBeenCalledWith(expect.stringContaining('Session reset')));
    expect(session.messageCount).toBe(0);
  });

  it('prints session message count on close', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const { rl, println, session } = createLineHandlerHarness();
    session.messageCount = 5;

    rl.emit('close');
    expect(println).toHaveBeenCalledWith(expect.stringContaining('Session ended. Messages: 5'));
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
