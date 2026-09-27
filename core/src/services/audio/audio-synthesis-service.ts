import pLimit from 'p-limit';
import { config } from '../../config';
import type { ILogger } from '../../infrastructure/logger';

export interface AudioSynthesisResult {
  audio: Buffer | null;
  contentType: string;
  seconds?: number;
  error?: string;
}

export interface SynthesizeOptions {
  voice?: string;
  format?: 'wav' | 'ogg';
  signal?: AbortSignal;
}

export interface ISpeechSynthesisService {
  synthesize(
    text: string,
    options?: SynthesizeOptions,
  ): Promise<AudioSynthesisResult>;
}

export class AudioSynthesisService implements ISpeechSynthesisService {
  private readonly limit = pLimit(1);
  private readonly logger?: ILogger;
  private readonly fetchFn: typeof fetch;

  constructor(logger?: ILogger, fetchFn: typeof fetch = globalThis.fetch) {
    this.logger = logger;
    this.fetchFn = fetchFn;
  }

  async synthesize(
    text: string,
    options?: SynthesizeOptions,
  ): Promise<AudioSynthesisResult> {
    if (!config.AUDIO.TTS.ENABLED) {
      return { audio: null, contentType: '', error: 'Audio synthesis is disabled in config.' };
    }

    if (typeof text !== 'string' || !text.trim()) {
      return { audio: null, contentType: '', error: 'Text is required for speech synthesis.' };
    }

    const maxChars = config.AUDIO.TTS.MAX_INPUT_CHARS;
    if (text.length > maxChars) {
      return {
        audio: null,
        contentType: '',
        error: `Text exceeds maximum length of ${maxChars} characters.`,
      };
    }

    return this.limit(() => this.executeSynthesis(text, options));
  }

  private async executeSynthesis(
    text: string,
    options?: SynthesizeOptions,
  ): Promise<AudioSynthesisResult> {
    const endpoint = config.AUDIO.TTS.ENDPOINT;
    const timeoutMs = config.AUDIO.TTS.TIMEOUT_MS;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const format = options?.format ?? 'wav';
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          voice: options?.voice || config.AUDIO.TTS.VOICE,
          speed: config.AUDIO.TTS.SPEED,
          response_format: format,
        }),
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
        const errorMsg = `Audio synthesis failed with HTTP status ${response.status} (${response.statusText})${errorDetail}`;
        this.logger?.error(`[AudioSynthesisService] ${errorMsg}`);
        return { audio: null, contentType: '', error: errorMsg };
      }

      const arrayBuffer = await response.arrayBuffer();
      const audio = Buffer.from(arrayBuffer);
      if (audio.length === 0) {
        const errorMsg = 'Audio synthesis response was empty.';
        this.logger?.error(`[AudioSynthesisService] ${errorMsg}`);
        return { audio: null, contentType: '', error: errorMsg };
      }

      const contentType = response.headers.get('content-type') || (format === 'ogg' ? 'audio/ogg' : 'audio/wav');
      const durationHeader = Number(response.headers.get('x-audio-duration-seconds'));
      const seconds = Number.isFinite(durationHeader) && durationHeader > 0 ? durationHeader : undefined;
      this.logger?.info(`[AudioSynthesisService] Connected to voice server at ${endpoint} - synthesis successful (${audio.length} bytes)`);
      return { audio, contentType, seconds };
    } catch (err: unknown) {
      const error = err as Error & { cause?: Error & { code?: string } };

      if (error.name === 'TimeoutError' || (timeoutSignal.aborted && !options?.signal?.aborted)) {
        const errorMsg = `Audio synthesis request timed out after ${timeoutMs}ms.`;
        this.logger?.error(`[AudioSynthesisService] ${errorMsg}`);
        return { audio: null, contentType: '', error: errorMsg };
      }

      if (error.name === 'AbortError' || options?.signal?.aborted) {
        const errorMsg = 'Audio synthesis request was aborted.';
        this.logger?.warn(`[AudioSynthesisService] ${errorMsg}`);
        return { audio: null, contentType: '', error: errorMsg };
      }

      const causeCode = error.cause?.code ? ` [${error.cause.code}]` : '';
      const causeMsg = error.cause?.message ? `: ${error.cause.message}` : '';
      const errorMsg = `Failed to connect to synthesis service at ${endpoint}: ${error.message}${causeCode}${causeMsg}`;
      this.logger?.error(`[AudioSynthesisService] ${errorMsg}`);
      return { audio: null, contentType: '', error: errorMsg };
    }
  }
}

let singletonInstance: ISpeechSynthesisService | null = null;

export function getSpeechSynthesisService(logger?: ILogger): ISpeechSynthesisService {
  if (!singletonInstance) {
    singletonInstance = new AudioSynthesisService(logger);
  }
  return singletonInstance;
}

export function resetSpeechSynthesisService(): void {
  singletonInstance = null;
}
