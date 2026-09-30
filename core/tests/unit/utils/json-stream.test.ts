import { describe, expect, it, vi } from 'vitest';
import { readJsonStream } from '../../../src/utils/json-stream';

async function collect(body: ReadableStream<Uint8Array>) {
  const chunks = [];
  for await (const chunk of readJsonStream(body, () => {})) chunks.push(chunk);
  return chunks;
}

describe('readJsonStream', () => {
  it('decodes UTF-8 split across chunks and the final unterminated line', async () => {
    const encoded = new TextEncoder().encode('{"text":"Olá 👋"}\r\ndata:{"text":"tail"}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect(await collect(body)).toEqual([{ text: 'Olá 👋' }, { text: 'tail' }]);
    expect(body.locked).toBe(false);
  });

  it('skips malformed and non-object JSON records', async () => {
    const body = new Response('event: ping\nnull\n[]\n42\ninvalid\ndata: {"text":"ok"}\n').body!;
    expect(await collect(body)).toEqual([{ text: 'ok' }]);
  });

  it('stops and cancels an open transport at the SSE completion marker', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"text":"ok"}\ndata: [DONE]\n'));
      },
      cancel,
    });
    expect(await collect(body)).toEqual([{ text: 'ok' }]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('cancels the transport when the consumer stops early', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"text":"ok"}\n'));
      },
      cancel,
    });
    for await (const _chunk of readJsonStream(body, () => {})) break;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('releases the lock and preserves the original transport error', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('offline')); } });
    await expect(collect(body)).rejects.toThrow('offline');
    expect(body.locked).toBe(false);
  });
});
