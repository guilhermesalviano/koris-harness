import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../../src/config';
import {
  AudioTranscriptionService,
  getAudioTranscriptionService,
  resetAudioTranscriptionService,
} from '../../src/services/audio/audio-transcription-service';

describe('AudioTranscriptionService', () => {
  beforeEach(() => {
    config.AUDIO.STT.ENABLED = false;
    config.AUDIO.STT.ENDPOINT = 'http://127.0.0.1:6006/v1/audio/transcriptions';
    config.AUDIO.STT.LANGUAGE = 'auto';
    config.AUDIO.STT.TIMEOUT_MS = 30000;
    resetAudioTranscriptionService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('disabled state', () => {
    it('returns error and empty text when disabled in config without calling fetch', async () => {
      config.AUDIO.STT.ENABLED = false;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('fake-audio-data'));

      expect(result).toEqual({
        text: '',
        error: 'Audio transcription is disabled in config.',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('successful transcription', () => {
    it('successfully sends multipart form-data and returns transcribed text', async () => {
      config.AUDIO.STT.ENABLED = true;
      config.AUDIO.STT.ENDPOINT = 'http://127.0.0.1:6006/v1/audio/transcriptions';
      config.AUDIO.STT.LANGUAGE = 'auto';

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;

      const fetchMock = vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
        capturedUrl = url;
        capturedOptions = opts;
        return new Response(JSON.stringify({ text: 'Hello, world!' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const audioBuffer = Buffer.from('riff-wave-data');
      const result = await service.transcribe(audioBuffer, {
        filename: 'test.wav',
        mimeType: 'audio/wav',
      });

      expect(result).toEqual({ text: 'Hello, world!' });
      expect(capturedUrl).toBe('http://127.0.0.1:6006/v1/audio/transcriptions');
      expect(capturedOptions?.method).toBe('POST');
      expect(capturedOptions?.body).toBeInstanceOf(FormData);

      const formData = capturedOptions?.body as FormData;
      const fileBlob = formData.get('file') as Blob;
      expect(fileBlob).toBeDefined();
      expect(fileBlob.type).toBe('audio/wav');
      expect(formData.get('language')).toBeNull();
    });

    it('appends language parameter if config language is not auto and uses default filename/mimetype', async () => {
      config.AUDIO.STT.ENABLED = true;
      config.AUDIO.STT.LANGUAGE = 'pt';

      let capturedFormData: FormData | undefined;
      const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedFormData = opts.body as FormData;
        return new Response(JSON.stringify({ text: 'Olá mundo' }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('audio-bytes'));

      expect(result).toEqual({ text: 'Olá mundo' });
      expect(capturedFormData?.get('language')).toBe('pt');
      const fileBlob = capturedFormData?.get('file') as Blob;
      expect(fileBlob).toBeDefined();
    });

    it('allows overriding configured language via options.language (including auto)', async () => {
      config.AUDIO.STT.ENABLED = true;
      config.AUDIO.STT.LANGUAGE = 'pt';

      let capturedFormData: FormData | undefined;
      const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedFormData = opts.body as FormData;
        return new Response(JSON.stringify({ text: 'Multilingual result' }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();

      // Overriding pt with auto should omit the language field
      await service.transcribe(Buffer.from('audio-bytes'), { language: 'auto' });
      expect(capturedFormData?.get('language')).toBeNull();

      // Overriding with specific language code
      await service.transcribe(Buffer.from('audio-bytes'), { language: 'es' });
      expect(capturedFormData?.get('language')).toBe('es');
    });
  });

  describe('server error / 500 response', () => {
    it('returns error message when server returns non-200 response', async () => {
      config.AUDIO.STT.ENABLED = true;

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('Model failed to process audio', {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('corrupt-audio'));

      expect(result.text).toBe('');
      expect(result.error).toContain('500');
      expect(result.error).toContain('Internal Server Error');
      expect(result.error).toContain('Model failed to process audio');
    });
  });

  describe('connection failure / offline sidecar', () => {
    it('gracefully catches network connection failure (ECONNREFUSED) when sidecar is offline', async () => {
      config.AUDIO.STT.ENABLED = true;

      const connError = new TypeError('fetch failed');
      (connError as unknown as { cause: { code: string; errno: number; message: string } }).cause = Object.assign(
        new Error('connect ECONNREFUSED 127.0.0.1:6006'),
        {
          code: 'ECONNREFUSED',
          errno: -111,
        },
      );

      const fetchMock = vi.fn().mockRejectedValue(connError);
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('test-audio'));

      expect(result.text).toBe('');
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Failed to connect to transcription service');
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('gracefully handles other network errors', async () => {
      config.AUDIO.STT.ENABLED = true;

      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('test-audio'));

      expect(result.text).toBe('');
      expect(result.error).toContain('Failed to connect to transcription service');
      expect(result.error).toContain('Network error');
    });
  });

  describe('serialization queue', () => {
    it('strictly serializes concurrent transcription requests using p-limit(1)', async () => {
      config.AUDIO.STT.ENABLED = true;

      let activeCount = 0;
      let maxActiveCount = 0;
      const executionOrder: number[] = [];

      const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);

        const formData = opts.body as FormData;
        const file = formData.get('file') as File;
        const id = Number(file?.name ?? '0');

        await new Promise((resolve) => setTimeout(resolve, 25));
        executionOrder.push(id);

        activeCount--;
        return new Response(JSON.stringify({ text: `Result ${id}` }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();

      const p1 = service.transcribe(Buffer.from('a1'), { filename: '1' });
      const p2 = service.transcribe(Buffer.from('a2'), { filename: '2' });
      const p3 = service.transcribe(Buffer.from('a3'), { filename: '3' });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(maxActiveCount).toBe(1);
      expect(executionOrder).toEqual([1, 2, 3]);
      expect(r1.text).toBe('Result 1');
      expect(r2.text).toBe('Result 2');
      expect(r3.text).toBe('Result 3');
    });
  });

  describe('timeout handling', () => {
    it('gracefully handles timeout when request exceeds TIMEOUT_MS', async () => {
      config.AUDIO.STT.ENABLED = true;
      config.AUDIO.STT.TIMEOUT_MS = 1000;

      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';

      const fetchMock = vi.fn().mockRejectedValue(timeoutError);
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('audio'));

      expect(result.text).toBe('');
      expect(result.error).toContain('timed out');
      expect(result.error).toContain('1000ms');
    });

    it('gracefully handles AbortError when signal is aborted', async () => {
      config.AUDIO.STT.ENABLED = true;

      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';

      const fetchMock = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      controller.abort();

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('audio'), {
        signal: controller.signal,
      });

      expect(result.text).toBe('');
      expect(result.error).toContain('aborted');
    });
  });

  describe('malformed response handling', () => {
    it('handles malformed JSON response', async () => {
      config.AUDIO.STT.ENABLED = true;

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('invalid-non-json', { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('audio'));

      expect(result.text).toBe('');
      expect(result.error).toContain('Failed to parse transcription response as JSON');
    });

    it('handles response JSON missing text field', async () => {
      config.AUDIO.STT.ENABLED = true;

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ other_key: 123 }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService();
      const result = await service.transcribe(Buffer.from('audio'));

      expect(result.text).toBe('');
      expect(result.error).toContain('missing "text" string in response');
    });
  });

  describe('singleton getter and reset', () => {
    it('getAudioTranscriptionService returns singleton instance and reset creates fresh instance', () => {
      resetAudioTranscriptionService();
      const s1 = getAudioTranscriptionService();
      const s2 = getAudioTranscriptionService();
      expect(s1).toBe(s2);

      resetAudioTranscriptionService();
      const s3 = getAudioTranscriptionService();
      expect(s3).not.toBe(s1);
    });
  });

  describe('logger integration', () => {
    it('logs errors using provided logger', async () => {
      config.AUDIO.STT.ENABLED = true;

      const logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const fetchMock = vi.fn().mockResolvedValue(
        new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const service = new AudioTranscriptionService(logger);
      await service.transcribe(Buffer.from('audio'));

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('502'),
      );
    });
  });
});
