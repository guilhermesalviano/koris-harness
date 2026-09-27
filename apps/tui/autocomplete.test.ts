import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createAutocomplete } from './autocomplete';
import { ansi } from './ansi';
import { defaultColors } from './colors';
import type { CommandSuggestion } from './types';

function createHarness(options?: {
  line?: string;
  commands?: CommandSuggestion[];
  fixedInput?: boolean;
  placeholder?: string;
}) {
  const writes: string[] = [];
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  const originalTtyWrite = vi.fn();

  const anyRl = {
    line: options?.line ?? '',
    cursor: (options?.line ?? '').length,
    _refreshLine: vi.fn(),
    _ttyWrite: originalTtyWrite,
  };

  const state = {
    isBusy: false,
    terminalHeight: 18,
    inputLineCount: 1,
  };

  const autocomplete = createAutocomplete({
    state,
    ansi,
    colors: defaultColors,
    fixedInput: options?.fixedInput ?? true,
    anyRl,
    rl: {},
    allCommands: options?.commands ?? [],
    requestRender: vi.fn(),
    placeholder: options?.placeholder ?? '',
  });

  return {
    autocomplete,
    anyRl,
    state,
    writes,
    writeSpy,
    originalTtyWrite,
  };
}

describe('createAutocomplete', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows command suggestions and applies the selected command', () => {
    const { autocomplete, anyRl, writes } = createHarness({
      line: '/he',
      commands: [
        { name: '/help', description: 'Show help' },
        { name: '/hello', description: 'Say hello' },
      ],
    });

    autocomplete.onAcKeypress('', { name: 'tab' });

    const popup = writes.join('');
    expect(popup).toContain('/help');
    expect(popup).toContain('/hello');

    autocomplete.onAcKeypress('', { name: 'enter' });

    expect(anyRl.line).toBe('/help');
    expect(anyRl.cursor).toBe('/help'.length);
    expect(anyRl._refreshLine).toHaveBeenCalledOnce();
  });

  it('filters hidden files, applies directory suggestions, and drills into directories', () => {
    vi.useFakeTimers();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-tui-ac-'));
    const filePath = path.join(tempRoot, 'file.txt');
    const folderPath = path.join(tempRoot, 'folder');
    const hiddenPath = path.join(tempRoot, '.secret');
    const nestedFilePath = path.join(folderPath, 'note.md');

    fs.writeFileSync(filePath, 'demo');
    fs.mkdirSync(folderPath);
    fs.writeFileSync(hiddenPath, 'hidden');
    fs.writeFileSync(nestedFilePath, 'nested');

    try {
      const { autocomplete, anyRl, writes } = createHarness({ line: `attach @${tempRoot}/f` });

      autocomplete.onAcKeypress('', { name: 'tab' });

      const firstPopup = writes.join('');
      expect(firstPopup).toContain(filePath);
      expect(firstPopup).toContain(`${folderPath}/`);
      expect(firstPopup).not.toContain(hiddenPath);

      autocomplete.onAcKeypress('', { name: 'down' });
      autocomplete.onAcKeypress('', { name: 'enter' });

      expect(anyRl.line).toBe(`attach @${folderPath}/`);
      expect(anyRl.cursor).toBe(`attach @${folderPath}/`.length);

      vi.runAllTimers();

      expect(writes.join('')).toContain(nestedFilePath);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('swallows tab and history navigation while the popup is open', () => {
    const { autocomplete, anyRl, originalTtyWrite } = createHarness({
      line: '/he',
      commands: [
        { name: '/help' },
        { name: '/hello' },
      ],
    });

    autocomplete.onAcKeypress('', { name: 'tab' });

    anyRl._ttyWrite('', { name: 'up' });
    anyRl._ttyWrite('', { name: 'down' });
    anyRl._ttyWrite('', { name: 'tab' });
    anyRl._ttyWrite('x', { name: 'x' });

    expect(originalTtyWrite).toHaveBeenCalledTimes(1);
    expect(originalTtyWrite).toHaveBeenCalledWith('x', { name: 'x' });
  });

  it('supports up and down arrow navigation across suggestions', () => {
    const { autocomplete, anyRl, writes } = createHarness({
      line: '/h',
      commands: [
        { name: '/help' },
        { name: '/hello' },
        { name: '/history' },
      ],
    });

    autocomplete.onAcKeypress('', { name: 'tab' });
    autocomplete.onAcKeypress('', { name: 'down' });
    autocomplete.onAcKeypress('', { name: 'up' });
    autocomplete.onAcKeypress('', { name: 'enter' });

    expect(anyRl.line).toBe('/help');
  });

  it('supports shift+tab reverse navigation', () => {
    const { autocomplete, anyRl } = createHarness({
      line: '/h',
      commands: [
        { name: '/help' },
        { name: '/hello' },
      ],
    });

    autocomplete.onAcKeypress('', { name: 'tab' });
    autocomplete.onAcKeypress('', { name: 'tab', shift: true });
    expect(anyRl.line).toBe('/hello');
  });

  it('dismisses autocomplete on escape key', () => {
    const { autocomplete, writes } = createHarness({
      line: '/he',
      commands: [{ name: '/help' }],
    });

    autocomplete.onAcKeypress('', { name: 'tab' });
    const countBefore = writes.length;
    autocomplete.onAcKeypress('', { name: 'escape' });
    expect(writes.length).toBeGreaterThan(countBefore);
  });

  it('ignores keypress when state.isBusy is true or fixedInput is false', () => {
    const { autocomplete, state, writes } = createHarness({
      line: '/he',
      commands: [{ name: '/help' }],
    });

    state.isBusy = true;
    autocomplete.onAcKeypress('', { name: 'tab' });
    expect(writes).toHaveLength(0);
  });

  it('erases placeholder on printable keystroke when line is empty', () => {
    const { autocomplete, writes } = createHarness({
      line: '',
      placeholder: 'Type something...',
    });

    autocomplete.onAcKeypress('a', { name: 'a' });
    expect(writes).toContain('\x1b[0K');
  });

  it('schedules autocomplete update when typing in autocomplete context', () => {
    vi.useFakeTimers();
    const { autocomplete, anyRl } = createHarness({
      line: '/he',
      commands: [{ name: '/help' }],
    });

    autocomplete.onAcKeypress('l', { name: 'l' });
    expect(anyRl._refreshLine).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(anyRl._refreshLine).toHaveBeenCalled();
  });
});

