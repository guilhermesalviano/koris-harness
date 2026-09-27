import { describe, it, expect, vi } from 'vitest';
import { SerialAIProvider } from '../../../../src/services/providers/serial-provider';
import { SerialQueue } from '../../../../src/services/providers/serial-queue';
import type { AIProvider } from '../../../../src/types/chat';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeInnerProvider(overrides?: Partial<AIProvider>): AIProvider {
  return {
    name: 'test',
    complete: vi.fn(async () => ({ kind: 'message', text: 'ok', finishReason: 'stop' })),
    chat: vi.fn(async () => 'ok'),
    chatStream: vi.fn(async function* () { yield 'ok'; }),
    embed: vi.fn(async () => []),
    healthCheck: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('SerialAIProvider', () => {
  it('exposes the inner provider name', () => {
    const serial = new SerialAIProvider(makeInnerProvider(), new SerialQueue());
    expect(serial.name).toBe('test');
  });

  it('serializes concurrent complete calls so only one runs at a time', async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const started: string[] = [];

    const inner = makeInnerProvider({
      complete: vi.fn(async (request) => {
        const label = request.messages[0].content;
        started.push(label);
        await (label === 'first' ? firstGate : secondGate).promise;
        return { kind: 'message', text: label, finishReason: 'stop' };
      }),
    });

    const serial = new SerialAIProvider(inner, new SerialQueue());

    const first = serial.complete({ messages: [{ role: 'user', content: 'first' }] });
    const second = serial.complete({ messages: [{ role: 'user', content: 'second' }] });

    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(['first']);
    expect(inner.complete).toHaveBeenCalledTimes(1);

    firstGate.resolve();
    await first;
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(['first', 'second']);

    secondGate.resolve();
    const secondResult = await second;
    expect(secondResult.kind).toBe('message');
  });

  it('holds the lock across a chatStream so other calls wait until it drains', async () => {
    const gate = deferred();
    const events: string[] = [];

    const inner = makeInnerProvider({
      complete: vi.fn(async () => {
        events.push('complete');
        return { kind: 'message', text: 'ok', finishReason: 'stop' };
      }),
      chatStream: vi.fn(async function* () {
        events.push('stream:start');
        yield 'a';
        await gate.promise;
        yield 'b';
      }),
    });

    const serial = new SerialAIProvider(inner, new SerialQueue());

    const streamDone = (async () => {
      const chunks: string[] = [];
      for await (const chunk of serial.chatStream({ messages: [] })) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['stream:start']);

    const completePromise = serial.complete({ messages: [{ role: 'user', content: 'x' }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['stream:start']);

    gate.resolve();
    const chunks = await streamDone;
    const result = await completePromise;

    expect(chunks).toEqual(['a', 'b']);
    expect(events).toEqual(['stream:start', 'complete']);
    expect(result.kind).toBe('message');
  });

  it('serializes embed calls', async () => {
    const started: string[] = [];
    const firstGate = deferred();
    const inner = makeInnerProvider({
      embed: vi.fn(async (text: string) => {
        started.push(text);
        await firstGate.promise;
        return [];
      }),
    });

    const serial = new SerialAIProvider(inner, new SerialQueue());
    const first = serial.embed('a');
    const second = serial.embed('b');

    await Promise.resolve();
    expect(started).toEqual(['a']);

    firstGate.resolve();
    await first;
    await second;
    expect(started).toEqual(['a', 'b']);
  });

  it('passes healthCheck through without queueing', async () => {
    const inner = makeInnerProvider({ healthCheck: vi.fn(async () => ({ ok: false, detail: 'down' })) });
    const serial = new SerialAIProvider(inner, new SerialQueue());
    const health = await serial.healthCheck();
    expect(health).toEqual({ ok: false, detail: 'down' });
  });

  it('runs higher-priority tasks ahead of pending lower-priority ones', async () => {
    const started: string[] = [];
    const lowGate = deferred();
    const highGate = deferred();

    const low = makeInnerProvider({
      complete: vi.fn(async (request) => {
        started.push(request.messages[0].content);
        await lowGate.promise;
        return { kind: 'message', text: 'low', finishReason: 'stop' };
      }),
    });
    const high = makeInnerProvider({
      complete: vi.fn(async (request) => {
        started.push(request.messages[0].content);
        await highGate.promise;
        return { kind: 'message', text: 'high', finishReason: 'stop' };
      }),
    });

    const queue = new SerialQueue();
    const lowSerial = new SerialAIProvider(low, queue, 0);
    const highSerial = new SerialAIProvider(high, queue, 1);

    const lowTask = lowSerial.complete({ messages: [{ role: 'user', content: 'low' }] });
    const highTask = highSerial.complete({ messages: [{ role: 'user', content: 'high' }] });

    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(['high']);

    highGate.resolve();
    await highTask;
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(['high', 'low']);

    lowGate.resolve();
    await lowTask;
    expect(started).toEqual(['high', 'low']);
  });

  it('holds back background tasks until the queue is idle for the grace period', async () => {
    const started: string[] = [];
    const queue = new SerialQueue(50);
    const interactive = new SerialAIProvider(
      makeInnerProvider({
        complete: vi.fn(async (request) => {
          started.push(request.messages[0].content);
          return { kind: 'message', text: 'ok', finishReason: 'stop' };
        }),
      }),
      queue,
      1,
    );
    const background = new SerialAIProvider(
      makeInnerProvider({
        complete: vi.fn(async (request) => {
          started.push(request.messages[0].content);
          return { kind: 'message', text: 'bg', finishReason: 'stop' };
        }),
      }),
      queue,
      0,
    );

    await interactive.complete({ messages: [{ role: 'user', content: 'interactive' }] });
    expect(started).toEqual(['interactive']);

    const bgTask = background.complete({ messages: [{ role: 'user', content: 'background' }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(['interactive']);

    await new Promise((resolve) => setTimeout(resolve, 120));
    await bgTask;

    expect(started).toEqual(['interactive', 'background']);
  });

  it('exposes a snapshot of the running and queued tasks', async () => {
    const queue = new SerialQueue(0);
    const running = new SerialAIProvider(
      makeInnerProvider({
        complete: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { kind: 'message', text: 'ok', finishReason: 'stop' };
        }),
      }),
      queue,
      1,
      'manager',
    );
    const queued = new SerialAIProvider(
      makeInnerProvider({
        complete: vi.fn(async () => ({ kind: 'message', text: 'bg', finishReason: 'stop' })),
      }),
      queue,
      0,
      'worker:background',
    );

    const runningTask = running.complete({ messages: [] });
    await Promise.resolve();
    await Promise.resolve();

    const queuedTask = queued.complete({ messages: [] });
    await Promise.resolve();
    await Promise.resolve();

    let snap = queue.snapshot();
    expect(snap.running.map((t) => t.label)).toEqual(['manager']);
    expect(snap.running[0].eligible).toBe(true);
    expect(snap.queued.map((t) => t.label)).toEqual(['worker:background']);
    expect(snap.queued[0].eligible).toBe(true);

    await runningTask;
    await queuedTask;

    snap = queue.snapshot();
    expect(snap.running).toEqual([]);
    expect(snap.queued).toEqual([]);
  });
});
