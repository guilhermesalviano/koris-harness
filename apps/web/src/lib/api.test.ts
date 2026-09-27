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
