import pLimit from 'p-limit';
import { config } from '../../config';
import type { ILogger } from '../../infrastructure/logger';

export interface AudioTranscriptionResult {
  text: string;
  error?: string;
}

export interface TranscribeOptions {
  filename?: string;
  mimeType?: string;
  signal?: AbortSignal;
  language?: string;
}

export interface IAudioTranscriptionService {
  transcribe(
    audioBuffer: Buffer,
    options?: TranscribeOptions,
  ): Promise<AudioTranscriptionResult>;
}

export class AudioTranscriptionService implements IAudioTranscriptionService {
  private readonly limit = pLimit(1);
  private readonly logger?: ILogger;
  private readonly fetchFn: typeof fetch;

  constructor(logger?: ILogger, fetchFn: typeof fetch = globalThis.fetch) {
    this.logger = logger;
    this.fetchFn = fetchFn;
  }

  async transcribe(
    audioBuffer: Buffer,
    options?: TranscribeOptions,
  ): Promise<AudioTranscriptionResult> {
    if (!config.AUDIO.STT.ENABLED) {
      return { text: '', error: 'Audio transcription is disabled in config.' };
    }

    return this.limit(() => this.executeTranscription(audioBuffer, options));
  }

  private async executeTranscription(
    audioBuffer: Buffer,
    options?: TranscribeOptions,
  ): Promise<AudioTranscriptionResult> {
    const endpoint = config.AUDIO.STT.ENDPOINT;
    const timeoutMs = config.AUDIO.STT.TIMEOUT_MS;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const filename = options?.filename || 'audio.wav';
      const mimeType = options?.mimeType || 'audio/wav';
      const blob = new Blob([audioBuffer as any], { type: mimeType });

      const formData = new FormData();
      formData.append('file', blob, filename);

      const targetLanguage = options?.language !== undefined ? options.language : config.AUDIO.STT.LANGUAGE;
      if (targetLanguage && targetLanguage.toLowerCase() !== 'auto') {
        formData.append('language', targetLanguage);
      }

      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        body: formData,
        signal,
      });

      if (!response.ok) {
        let errorDetail = '';
        try {
          const bodyText = await response.text();
          if (bodyText) {
            errorDetail = `: ${bodyText}`;
          }
        } catch {
          // ignore error reading body
        }
        const errorMsg = `Audio transcription failed with HTTP status ${response.status} (${response.statusText})${errorDetail}`;
        this.logger?.error(`[AudioTranscriptionService] ${errorMsg}`);
        return { text: '', error: errorMsg };
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (jsonErr) {
        const errorMsg = `Failed to parse transcription response as JSON: ${(jsonErr as Error).message}`;
        this.logger?.error(`[AudioTranscriptionService] ${errorMsg}`);
        return { text: '', error: errorMsg };
      }

      if (
        typeof data !== 'object' ||
        data === null ||
        typeof (data as Record<string, unknown>).text !== 'string'
      ) {
        const errorMsg = 'Invalid transcription response format: missing "text" string in response.';
        this.logger?.error(`[AudioTranscriptionService] ${errorMsg}`);
        return { text: '', error: errorMsg };
      }

      this.logger?.info(`[AudioTranscriptionService] Connected to voice server at ${endpoint} - transcription successful`);
      return { text: (data as { text: string }).text };
    } catch (err: unknown) {
      const error = err as Error & { cause?: Error & { code?: string } };

      if (error.name === 'TimeoutError' || (timeoutSignal.aborted && !options?.signal?.aborted)) {
        const errorMsg = `Audio transcription request timed out after ${timeoutMs}ms.`;
        this.logger?.error(`[AudioTranscriptionService] ${errorMsg}`);
        return { text: '', error: errorMsg };
      }

      if (error.name === 'AbortError' || options?.signal?.aborted) {
        const errorMsg = 'Audio transcription request was aborted.';
        this.logger?.warn(`[AudioTranscriptionService] ${errorMsg}`);
        return { text: '', error: errorMsg };
      }

      const causeCode = error.cause?.code ? ` [${error.cause.code}]` : '';
      const causeMsg = error.cause?.message ? `: ${error.cause.message}` : '';
      const errorMsg = `Failed to connect to transcription service at ${endpoint}: ${error.message}${causeCode}${causeMsg}`;
      this.logger?.error(`[AudioTranscriptionService] ${errorMsg}`);
      return { text: '', error: errorMsg };
    }
  }
}

let singletonInstance: IAudioTranscriptionService | null = null;

export function getAudioTranscriptionService(logger?: ILogger): IAudioTranscriptionService {
  if (!singletonInstance) {
    singletonInstance = new AudioTranscriptionService(logger);
  }
  return singletonInstance;
}

export function resetAudioTranscriptionService(): void {
  singletonInstance = null;
}
