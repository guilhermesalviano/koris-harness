import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiRequestError, cancelChat, checkHealth, streamChat } from './api';

describe('apps/web api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkHealth', () => {
    it('returns true when /health responds ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true } as Response);
      expect(await checkHealth()).toBe(true);
    });

    it('returns false when /health responds non-ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as Response);
      expect(await checkHealth()).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
      expect(await checkHealth()).toBe(false);
    });
  });

  describe('cancelChat', () => {
    it('sends POST to /api/chat/cancel with sessionId', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true } as Response);
      await cancelChat('sess-123');

      expect(fetchSpy).toHaveBeenCalledWith('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-123' }),
      });
    });

    it('silently ignores network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('aborted'));
      await expect(cancelChat('sess-123')).resolves.toBeUndefined();
    });
  });

  describe('apiRequest', () => {
    it.each([new Headers({ Authorization: 'Bearer token' }), { Authorization: 'Bearer token' }, [['Authorization', 'Bearer token']]])
      ('merges caller headers without losing the JSON content type', async (headers) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', {
          headers: { 'content-type': 'application/json' },
        }));
        await apiRequest('/settings', { headers: headers as HeadersInit });
        const sent = fetchSpy.mock.calls[0][1]!.headers as Headers;
        expect(sent.get('Authorization')).toBe('Bearer token');
        expect(sent.get('Content-Type')).toBe('application/json');
      });

    it('makes a JSON request and returns response payload', async () => {
      const mockHeaders = new Headers({ 'content-type': 'application/json' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => ({ status: 'ok', count: 5 }),
      } as Response);

      const res = await apiRequest<{ status: string; count: number }>('/stats');
      expect(res).toEqual({ status: 'ok', count: 5 });
    });

    it('throws ApiRequestError with message and details from response on failure', async () => {
      const mockHeaders = new Headers({ 'content-type': 'application/json' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: mockHeaders,
        json: async () => ({ error: 'Invalid input', details: ['field required'] }),
      } as Response);

      let caught: ApiRequestError | undefined;
      try {
        await apiRequest('/settings', { method: 'POST' });
      } catch (err) {
        caught = err as ApiRequestError;
      }

      expect(caught).toBeInstanceOf(ApiRequestError);
      expect(caught?.message).toBe('Invalid input');
      expect(caught?.details).toEqual(['field required']);
    });

    it('falls back to status code error message when body is empty or non-JSON', async () => {
      const mockHeaders = new Headers({ 'content-type': 'text/plain' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: mockHeaders,
      } as Response);

      await expect(apiRequest('/crash')).rejects.toThrow('Request failed (502)');
    });
  });

  describe('streamChat', () => {
    function makeStreamResponse(chunks: string[], ok = true, status = 200): Response {
      const encoder = new TextEncoder();
      let index = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index++]));
          } else {
            controller.close();
          }
        },
      });

      return {
        ok,
        status,
        body: stream,
      } as Response;
    }

    it('stops at DONE and releases an open response stream', async () => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data:{"type":"content_block_delta","delta":{"text":"Olá"}}\r\ndata: [DONE]\n'));
        },
        cancel,
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body));
      const onText = vi.fn();
      await streamChat('hi', null, [], vi.fn(), onText);
      expect(onText).toHaveBeenCalledWith('Olá');
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    });

    it('propagates callback errors and cancels the response', async () => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"ok"}}\n'));
        },
        cancel,
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body));
      await expect(streamChat('hi', null, [], vi.fn(), () => { throw new Error('callback failed'); }))
        .rejects.toThrow('callback failed');
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    });

    it('releases the reader after transport errors', async () => {
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('offline')); } });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body));
      await expect(streamChat('hi', null, [], vi.fn(), vi.fn())).rejects.toThrow('offline');
      expect(body.locked).toBe(false);
    });

    it('preserves UTF-8 bytes split across chunks and an unterminated final event', async () => {
      const bytes = new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"👋 olá"}}');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body));
      const onText = vi.fn();
      await streamChat('hi', null, [], vi.fn(), onText);
      expect(onText).toHaveBeenCalledWith('👋 olá');
      expect(body.locked).toBe(false);
    });

    it('surfaces server validation messages on HTTP errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"error":"too many images (max 10)"}', {
        status: 400, headers: { 'content-type': 'application/json' },
      }));
      await expect(streamChat('hi', null, [], vi.fn(), vi.fn())).rejects.toThrow('too many images (max 10)');
    });

    it('throws when the response is not ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(
        streamChat('hello', null, [], vi.fn(), vi.fn()),
      ).rejects.toThrow('API error 500');
    });

    it('throws when response body is missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      } as Response);

      await expect(
        streamChat('hello', null, [], vi.fn(), vi.fn()),
      ).rejects.toThrow('Empty response body');
    });

    it('parses SSE chunks and dispatches progress, session, mode, and text callbacks', async () => {
      const onStatus = vi.fn();
      const onText = vi.fn();
      const onSession = vi.fn();
      const onMode = vi.fn();

      const sseData = [
        'data: {"type":"progress","delta":{"status":"Thinking..."}}\n\n',
        'data: {"type":"session","sessionId":"sess-abc"}\n',
        'data: {"type":"mode","mode":"voice"}\n',
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":" world!"}}\n',
        'data: [DONE]\n',
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeStreamResponse(sseData));

      await streamChat(
        'hi',
        'sess-old',
        [{ data: 'base64img', mimeType: 'image/png' }],
        onStatus,
        onText,
        undefined,
        onSession,
        onMode,
      );

      expect(onStatus).toHaveBeenCalledWith('Thinking...');
      expect(onSession).toHaveBeenCalledWith('sess-abc');
      expect(onMode).toHaveBeenCalledWith('voice');
      expect(onText).toHaveBeenCalledWith('Hello');
      expect(onText).toHaveBeenCalledWith(' world!');
    });

    it('handles stream error events and malformed JSON lines', async () => {
      const onStatus = vi.fn();
      const onText = vi.fn();

      const sseData = [
        'event: ping\n', // non-data line
        'data: invalid-json-not-object\n', // malformed json
        'data: {"type":"error","error":{"message":"Context window exceeded"}}\n',
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeStreamResponse(sseData));

      await expect(
        streamChat('hi', null, [], onStatus, onText),
      ).rejects.toThrow('Context window exceeded');
    });
  });
});
