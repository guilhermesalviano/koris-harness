import { Transform } from 'stream';

export function createInputFilter(handlers: {
  line(dir: 'up' | 'down'): void;
  page(dir: 'up' | 'down'): void;
}): Transform {
  let pending = '';

  const decodeWheel = (rawBtn: number): 'up' | 'down' | undefined => {
    const btn = rawBtn >= 96 ? rawBtn - 32 : rawBtn;
    if (btn === 64) return 'up';
    if (btn === 65) return 'down';
    return undefined;
  };

  const t = new Transform({
    transform(chunk, _enc, cb) {
      pending += chunk.toString('latin1');

      const pushText = (value: string) => {
        if (value.length > 0) {
          this.push(Buffer.from(value, 'latin1'));
        }
      };

      while (pending.length > 0) {
        const idxSgr = pending.indexOf('\x1b[<');
        const idxX10 = pending.indexOf('\x1b[M');
        const idxUp = pending.indexOf('\x1b[A');
        const idxDown = pending.indexOf('\x1b[B');
        const idxPgUp = pending.indexOf('\x1b[5~');
        const idxPgDown = pending.indexOf('\x1b[6~');

        const indices = [idxSgr, idxX10, idxUp, idxDown, idxPgUp, idxPgDown].filter((index) => index !== -1);
        const start = indices.length > 0 ? Math.min(...indices) : -1;

        if (start === -1) {
          pushText(pending);
          pending = '';
          break;
        }

        if (start > 0) {
          pushText(pending.slice(0, start));
          pending = pending.slice(start);
        }

        if (pending.startsWith('\x1b[A')) {
          handlers.line('up');
          pending = pending.slice(3);
          continue;
        }

        if (pending.startsWith('\x1b[B')) {
          handlers.line('down');
          pending = pending.slice(3);
          continue;
        }

        if (pending.startsWith('\x1b[5~')) {
          handlers.page('up');
          pending = pending.slice(4);
          continue;
        }

        if (pending.startsWith('\x1b[6~')) {
          handlers.page('down');
          pending = pending.slice(4);
          continue;
        }

        if (pending.startsWith('\x1b[<')) {
          const match = pending.match(/^\x1b\[<([0-9]+);([0-9]+);([0-9]+)([mM])/);
          if (!match) break;

          const dir = decodeWheel(Number(match[1]));
          if (dir) handlers.line(dir);
          pending = pending.slice(match[0].length);
          continue;
        }

        if (pending.startsWith('\x1b[M')) {
          if (pending.length < 6) break;

          const cbByte = pending.charCodeAt(3) - 32;
          const dir = decodeWheel(cbByte);
          if (dir) handlers.line(dir);
          pending = pending.slice(6);
          continue;
        }

        const urxvtMatch = pending.match(/^\x1b\[([0-9]+);([0-9]+);([0-9]+)([mM])/);
        if (urxvtMatch) {
          const dir = decodeWheel(Number(urxvtMatch[1]));
          if (dir) handlers.line(dir);
          pending = pending.slice(urxvtMatch[0].length);
          continue;
        }

        pushText(pending.slice(0, 1));
        pending = pending.slice(1);
      }

      cb();
    },
    flush(cb) {
      if (pending.length > 0) {
        this.push(Buffer.from(pending, 'latin1'));
      }
      pending = '';
      cb();
    },
  });

  const anyTransform = t as Transform & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };

  anyTransform.isTTY = Boolean((process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY);
  anyTransform.setRawMode = (mode: boolean) => {
    (process.stdin as NodeJS.ReadStream & { setRawMode?: (enabled: boolean) => void }).setRawMode?.(mode);
  };

  return t;
}