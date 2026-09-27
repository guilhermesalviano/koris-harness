import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../../src/config';
import {
  AudioSynthesisService,
  getSpeechSynthesisService,
  resetSpeechSynthesisService,
} from '../../src/services/audio/audio-synthesis-service';

function wavResponse(bytes = Buffer.from('RIFFfake-wave'), status = 200): Response {
  return new Response(bytes, {
    status,
    headers: { 'Content-Type': 'audio/wav' },
  });
}

describe('AudioSynthesisService', () => {
  beforeEach(() => {
    config.AUDIO.TTS.ENABLED = false;
    config.AUDIO.TTS.ENDPOINT = 'http://127.0.0.1:6006/v1/audio/speech';
    config.AUDIO.TTS.VOICE = 'en_US-lessac-medium';
    config.AUDIO.TTS.SPEED = 1.0;
    config.AUDIO.TTS.MAX_INPUT_CHARS = 5000;
    config.AUDIO.TTS.TIMEOUT_MS = 30000;
    resetSpeechSynthesisService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('disabled state', () => {
    it('returns error without calling fetch when disabled in config', async () => {
      config.AUDIO.TTS.ENABLED = false;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hello world');

      expect(result).toEqual({
        audio: null,
        contentType: '',
        error: 'Audio synthesis is disabled in config.',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    it('rejects empty text without calling fetch', async () => {
      config.AUDIO.TTS.ENABLED = true;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('   ');

      expect(result.audio).toBeNull();
      expect(result.error).toContain('Text is required');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects text longer than MAX_INPUT_CHARS without calling fetch', async () => {
      config.AUDIO.TTS.ENABLED = true;
      config.AUDIO.TTS.MAX_INPUT_CHARS = 10;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('this text is definitely longer than ten');

      expect(result.audio).toBeNull();
      expect(result.error).toContain('exceeds maximum length of 10');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('successful synthesis', () => {
    it('POSTs JSON with input/voice/speed and returns audio buffer + content type', async () => {
      config.AUDIO.TTS.ENABLED = true;
      config.AUDIO.TTS.SPEED = 1.25;

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;

      const fetchMock = vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
        capturedUrl = url;
        capturedOptions = opts;
        return wavResponse(Buffer.from('RIFF....WAVEdata'));
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hello from koris');

      expect(result.error).toBeUndefined();
      expect(Buffer.isBuffer(result.audio)).toBe(true);
      expect(result.audio?.toString()).toBe('RIFF....WAVEdata');
      expect(result.contentType).toBe('audio/wav');
      expect(capturedUrl).toBe('http://127.0.0.1:6006/v1/audio/speech');
      expect(capturedOptions?.method).toBe('POST');

      const body = JSON.parse(capturedOptions?.body as string);
      expect(body.input).toBe('Hello from koris');
      expect(body.voice).toBe('en_US-lessac-medium');
      expect(body.speed).toBe(1.25);
    });

    it('honours a per-call voice override', async () => {
      config.AUDIO.TTS.ENABLED = true;

      let capturedBody: Record<string, unknown> | undefined;
      const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return wavResponse();
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      await service.synthesize('Hi', { voice: 'en_GB-alba-medium' });

      expect(capturedBody?.voice).toBe('en_GB-alba-medium');
    });

    it('requests ogg and reports the duration header when format is "ogg"', async () => {
      config.AUDIO.TTS.ENABLED = true;

      let capturedBody: Record<string, unknown> | undefined;
      const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = JSON.parse(opts.body as string);
        return new Response(Buffer.from('OggS...opus'), {
          status: 200,
          headers: { 'Content-Type': 'audio/ogg', 'X-Audio-Duration-Seconds': '3.5' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hi there', { format: 'ogg' });

      expect(capturedBody?.response_format).toBe('ogg');
      expect(result.contentType).toBe('audio/ogg');
      expect(result.seconds).toBe(3.5);
      expect(result.audio?.toString()).toBe('OggS...opus');
    });

    it('treats an empty-body 200 response as an error', async () => {
      config.AUDIO.TTS.ENABLED = true;

      const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.alloc(0), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hi');

      expect(result.audio).toBeNull();
      expect(result.error).toContain('empty');
    });
  });

  describe('server error / non-200 response', () => {
    it('returns error message with status and body detail', async () => {
      config.AUDIO.TTS.ENABLED = true;

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('voice not found', { status: 503, statusText: 'Service Unavailable' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hi');

      expect(result.audio).toBeNull();
      expect(result.error).toContain('503');
      expect(result.error).toContain('Service Unavailable');
      expect(result.error).toContain('voice not found');
    });
  });

  describe('connection failure / offline sidecar', () => {
    it('catches ECONNREFUSED when the sidecar is offline', async () => {
      config.AUDIO.TTS.ENABLED = true;

      const connError = new TypeError('fetch failed');
      (connError as unknown as { cause: { code: string; message: string } }).cause = Object.assign(
        new Error('connect ECONNREFUSED 127.0.0.1:6006'),
        { code: 'ECONNREFUSED' },
      );

      const fetchMock = vi.fn().mockRejectedValue(connError);
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hi');

      expect(result.audio).toBeNull();
      expect(result.error).toContain('Failed to connect to synthesis service');
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('timeout handling', () => {
    it('reports a timeout when the request exceeds TIMEOUT_MS', async () => {
      config.AUDIO.TTS.ENABLED = true;
      config.AUDIO.TTS.TIMEOUT_MS = 1000;

      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';

      const fetchMock = vi.fn().mockRejectedValue(timeoutError);
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hi');

      expect(result.audio).toBeNull();
      expect(result.error).toContain('timed out');
      expect(result.error).toContain('1000ms');
    });

    it('reports an abort when the caller signal is aborted', async () => {
      config.AUDIO.TTS.ENABLED = true;

      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';

      const fetchMock = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      controller.abort();

      const service = new AudioSynthesisService();
      const result = await service.synthesize('Hi', { signal: controller.signal });

      expect(result.audio).toBeNull();
      expect(result.error).toContain('aborted');
    });
  });

  describe('serialization queue', () => {
    it('strictly serializes concurrent synthesis requests using p-limit(1)', async () => {
      config.AUDIO.TTS.ENABLED = true;

      let activeCount = 0;
      let maxActiveCount = 0;
      const executionOrder: number[] = [];

      const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        const id = Number(JSON.parse(opts.body as string).input);
        await new Promise((resolve) => setTimeout(resolve, 25));
        executionOrder.push(id);
        activeCount--;
        return wavResponse(Buffer.from(`wav-${id}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService();

      const [r1, r2, r3] = await Promise.all([
        service.synthesize('1'),
        service.synthesize('2'),
        service.synthesize('3'),
      ]);

      expect(maxActiveCount).toBe(1);
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(r1.audio?.toString()).toBe('wav-1');
      expect(r2.audio?.toString()).toBe('wav-2');
      expect(r3.audio?.toString()).toBe('wav-3');
    });
  });

  describe('singleton getter and reset', () => {
    it('returns a singleton and reset creates a fresh instance', () => {
      resetSpeechSynthesisService();
      const s1 = getSpeechSynthesisService();
      const s2 = getSpeechSynthesisService();
      expect(s1).toBe(s2);

      resetSpeechSynthesisService();
      const s3 = getSpeechSynthesisService();
      expect(s3).not.toBe(s1);
    });
  });

  describe('logger integration', () => {
    it('logs errors using the provided logger', async () => {
      config.AUDIO.TTS.ENABLED = true;

      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioSynthesisService(logger);
      await service.synthesize('Hi');

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('502'));
    });
  });
});
