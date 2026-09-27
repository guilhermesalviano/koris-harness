import { describe, expect, it, vi } from 'vitest';

import { createInputFilter } from './input-filter';

async function collectFilterOutput(chunks: string[]) {
  const line = vi.fn<(dir: 'up' | 'down') => void>();
  const page = vi.fn<(dir: 'up' | 'down') => void>();
  const filter = createInputFilter({ line, page });
  const output: string[] = [];

  filter.on('data', (chunk: Buffer) => {
    output.push(chunk.toString('latin1'));
  });

  for (const chunk of chunks) {
    filter.write(Buffer.from(chunk, 'latin1'));
  }

  filter.end();
  await new Promise<void>((resolve) => filter.once('finish', () => resolve()));

  return {
    output: output.join(''),
    line,
    page,
    filter: filter as typeof filter & { isTTY?: boolean; setRawMode?: (mode: boolean) => void },
  };
}

describe('createInputFilter', () => {
  it('passes through plain text while intercepting line and page navigation keys', async () => {
    const result = await collectFilterOutput(['hello', '\x1b[A', '\x1b[B', '\x1b[5~', '\x1b[6~', '!']);

    expect(result.output).toBe('hello!');
    expect(result.line.mock.calls).toEqual([['up'], ['down']]);
    expect(result.page.mock.calls).toEqual([['up'], ['down']]);
  });

  it('handles SGR mouse wheel sequences that arrive across multiple chunks', async () => {
    const result = await collectFilterOutput(['a', '\x1b[<64;10', ';20M', 'b']);

    expect(result.output).toBe('ab');
    expect(result.line).toHaveBeenCalledWith('up');
  });

  it('flushes incomplete escape sequences as text on stream end', async () => {
    const result = await collectFilterOutput(['x', '\x1b[<64;1']);

    expect(result.output).toBe('x\x1b[<64;1');
    expect(result.line).not.toHaveBeenCalled();
    expect(result.page).not.toHaveBeenCalled();
  });

  it('handles SGR wheel down and high rawBtn values', async () => {
    // 65 -> down, 96 (>=96) -> 64 (up), 97 -> 65 (down), 100 -> undefined
    const result = await collectFilterOutput([
      '\x1b[<65;5;5M',
      '\x1b[<96;5;5M',
      '\x1b[<97;5;5M',
      '\x1b[<100;5;5M',
    ]);

    expect(result.line.mock.calls).toEqual([['down'], ['up'], ['down']]);
  });

  it('handles X10 mouse reporting sequences and incomplete buffers', async () => {
    // X10 format: \x1b[M + cb + cx + cy (6 bytes total)
    // cbByte = code - 32. If code = 64 + 32 = 96, btn = 64 -> 'up'
    // If code = 65 + 32 = 97, btn = 65 -> 'down'
    const upChar = String.fromCharCode(64 + 32);
    const downChar = String.fromCharCode(65 + 32);
    const otherChar = String.fromCharCode(10 + 32);

    const result = await collectFilterOutput([
      `\x1b[M${upChar}!!`,
      `\x1b[M${downChar}!!`,
      `\x1b[M${otherChar}!!`,
      '\x1b[M12', // incomplete, length < 6 -> breaks and flushes on end
    ]);

    expect(result.line.mock.calls).toEqual([['up'], ['down']]);
    expect(result.output).toBe('\x1b[M12');
  });



  it('exposes tty metadata from process.stdin', async () => {
    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const originalSetRawMode = process.stdin.setRawMode;
    const setRawMode = vi.fn();

    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    });
    process.stdin.setRawMode = setRawMode;

    try {
      const { filter } = await collectFilterOutput(['ok']);

      expect(filter.isTTY).toBe(true);
      filter.setRawMode?.(true);
      expect(setRawMode).toHaveBeenCalledWith(true);
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
      } else {
        Object.defineProperty(process.stdin, 'isTTY', {
          configurable: true,
          value: undefined,
        });
      }
      process.stdin.setRawMode = originalSetRawMode;
    }
  });
});
