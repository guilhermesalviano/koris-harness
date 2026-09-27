import express, { type Request, type Response, type Application, type NextFunction } from 'express';
import { type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from '../config';
import { resolveConfigPaths } from '../config/helpers';
import { RESPONSE_ANCHOR, THINK_END, THINK_START } from '../constants/thinking';
import { ILogger } from '../infrastructure/logger';
import { healthCheck } from '../services/provider-health-service';
import { AIServiceError } from '../services/ai-completion-service';
import { IMessageGateway } from '../services/agents/message-gateway';
import type { ImageAttachment } from '../types/messages';
import { stripInternalStreamMarkers } from '../utils/stream-markers';
import { serverUrls } from '../utils/network';
import { IDatabaseService } from '../infrastructure/db-sqlite';
import { SessionRepositoryFactory } from '../repositories/session';
import { ISessionManager } from '../services/session-manager';
import { getAudioTranscriptionService } from '../services/audio/audio-transcription-service';
import { getSpeechSynthesisService } from '../services/audio/audio-synthesis-service';
import { AdminRouterFactory } from './admin';
import { activeRunsRegistry } from './active-runs';
import { requireAdminSecret } from './auth-middleware';
import { securityHeaders } from './security-headers';
import { createRateLimiter } from './rate-limiter';

interface WebServerHandle {
  start(): Promise<WebServerHandle>;
  stop(): Promise<void>;
  /** The port the HTTP server is actually bound to (0 until `start()` resolves). */
  readonly port: number;
}

/**
 * Optional listen overrides. When omitted the server binds `config.WEB_PORT` on
 * all interfaces, exactly as it always has. The desktop app passes
 * `{ host: '127.0.0.1', port: 0 }` to get an ephemeral loopback port.
 */
interface WebListenOptions {
  host?: string;
  port?: number;
}

type SseWriter = (payload: unknown) => void;

class IndexRouteHandler {
  private static readonly rateLimiter = createRateLimiter(60_000, 60, 'Too many requests to /. Please try again later.');

  constructor(
    private readonly publicDir: string,
    private readonly relativeFilePath: string = '/index.html',
  ) {}

  readonly handle = (req: Request, res: Response): void => {
    IndexRouteHandler.rateLimiter(req, res, () => {
      res.sendFile(path.join(this.publicDir, this.relativeFilePath));
    });
  };
}

class HealthRouteHandler {
  constructor(private readonly logger: ILogger) {}

  readonly handle = async (_: Request, res: Response): Promise<void> => {
    const { status, timestamp, details } = await healthCheck(this.logger);
    res.status(status === 'ok' ? 200 : 500).json({ status, timestamp, details });
  };
}

class ChatRouteHandler {
  // Tracks the number of open SSE connections per client IP to cap abuse.
  private static readonly activeSseByIp = new Map<string, number>();
  private static readonly MAX_SSE_PER_IP = 5;

  constructor(
    private readonly gateway: IMessageGateway,
    private readonly db?: IDatabaseService,
  ) {}

  private readResponseMode(sessionId: string | undefined): 'text' | 'voice' {
    if (!sessionId || !this.db) {
      return 'text';
    }
    try {
      const session = SessionRepositoryFactory.create(this.db).findById(sessionId);
      return session?.metadata?.responseMode === 'voice' ? 'voice' : 'text';
    } catch {
      return 'text';
    }
  }

  readonly handle = async (req: Request, res: Response): Promise<void> => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const images = this.parseImages(req.body?.images);
    if (!message && !images.length) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (images.length > 10) {
      res.status(400).json({ error: 'too many images (max 10)' });
      return;
    }

    // SSE concurrency cap per IP
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const activeSse = ChatRouteHandler.activeSseByIp.get(clientIp) ?? 0;
    if (activeSse >= ChatRouteHandler.MAX_SSE_PER_IP) {
      res.status(429).json({ error: 'Too many concurrent chat streams from this address.' });
      return;
    }
    ChatRouteHandler.activeSseByIp.set(clientIp, activeSse + 1);
    const releaseSlot = (): void => {
      const current = ChatRouteHandler.activeSseByIp.get(clientIp) ?? 1;
      if (current <= 1) {
        ChatRouteHandler.activeSseByIp.delete(clientIp);
      } else {
        ChatRouteHandler.activeSseByIp.set(clientIp, current - 1);
      }
    };

    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    let currentSessionId = sessionId;

    // The AI run is decoupled from the client connection: when the browser
    // disconnects (tab close/reload, navigating away) we keep processing so
    // the exchange is still persisted by the conversation worker. `clientClosed`
    // only stops further SSE writes.
    let clientClosed = false;

    const onClose = () => {
      clientClosed = true;
    };

    req.on('aborted', onClose);
    res.on('close', onClose);

    const runId = randomUUID();
    const abortController = new AbortController();
    if (sessionId) {
      activeRunsRegistry.start({
        id: runId,
        sessionId,
        question: message,
        startedAt: new Date().toISOString(),
        channel: 'web',
      });
      activeRunsRegistry.attachController(runId, abortController);
    }

    const writeSse = this.createSseWriter(res, () => clientClosed);
    this.setupSseHeaders(res);

    try {
      const result = await this.gateway.handle({ text: message, images }, 'web', {
        sessionId,
        runId,
        toolsEnabled: true,
        learnedSkillsEnabled: true,
        signal: abortController.signal,
        onProgress: (summary: string) => {
          if (clientClosed) {
            return;
          }

          writeSse({
            type: 'progress',
            delta: { status: summary },
          });
        },
        onSessionRotated: (newSessionId: string) => {
          currentSessionId = newSessionId;
          if (clientClosed) {
            return;
          }

          writeSse({ type: 'session', sessionId: newSessionId });
        },
      });

      await this.writeResponse(result, writeSse, () => clientClosed || res.writableEnded || res.destroyed);

      if (clientClosed) {
        return;
      }

      writeSse({ type: 'mode', mode: this.readResponseMode(currentSessionId) });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      if (clientClosed) {
        return;
      }

      const aborted = abortController.signal.aborted
        || (error instanceof AIServiceError && error.code === 'aborted');
      if (aborted) {
        writeSse({ type: 'cancelled' });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const payload = error instanceof AIServiceError
        ? error.toJSON()
        : { code: 'unknown' as const, message: error instanceof Error ? error.message : String(error) };
      writeSse({
        type: 'error',
        error: payload,
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } finally {
      activeRunsRegistry.finish(runId);
      releaseSlot();
      req.off('aborted', onClose);
      res.off('close', onClose);
    }
  };

  readonly cancel = async (req: Request, res: Response): Promise<void> => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    const cancelled = activeRunsRegistry.abortBySession(sessionId);
    res.json({ cancelled });
  };

  private createSseWriter(res: Response, isClosed: () => boolean): SseWriter {
    return (payload: unknown) => {
      if (isClosed() || res.writableEnded || res.destroyed) {
        return;
      }

      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
  }

  private parseImages(raw: unknown): ImageAttachment[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const images: ImageAttachment[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const { data, mimeType } = item as { data?: unknown; mimeType?: unknown };
      if (typeof data !== 'string' || !data) {
        continue;
      }
      images.push({
        data,
        ...(typeof mimeType === 'string' && mimeType ? { mimeType } : {}),
      });
    }
    return images;
  }

  private async writeResponse(
    result: unknown,
    writeSse: SseWriter,
    isClosed: () => boolean,
  ): Promise<void> {
    if (typeof result === 'string') {
      this.writeTextChunk(stripInternalStreamMarkers(result), writeSse);
      return;
    }

    if (!this.isAsyncIterable(result)) {
      this.writeTextChunk(String(result), writeSse);
      return;
    }

    let inThinking = false;

    for await (const chunk of result) {
      if (isClosed()) {
        return;
      }

      if (chunk === THINK_START) {
        inThinking = true;
        continue;
      }

      if (chunk === THINK_END) {
        inThinking = false;
        continue;
      }

      if (inThinking || chunk === RESPONSE_ANCHOR) {
        continue;
      }

      this.writeTextChunk(chunk, writeSse);
    }
  }

  private writeTextChunk(text: string, writeSse: SseWriter): void {
    if (!text) {
      return;
    }

    writeSse({
      type: 'content_block_delta',
      delta: { text },
    });
  }

  private isAsyncIterable(value: unknown): value is AsyncIterable<string> {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const maybe = value as { [Symbol.asyncIterator]?: unknown };
    return typeof maybe[Symbol.asyncIterator] === 'function';
  }

  private setupSseHeaders(res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }
}

class AudioTranscribeRouteHandler {
  constructor(private readonly logger: ILogger) {}

  readonly handle = async (req: Request, res: Response): Promise<void> => {
    let audioBuffer: Buffer | null = null;
    let mimeType: string | undefined;
    let filename: string | undefined;
    let language: string | undefined;

    if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
      const contentType = req.headers['content-type'];
      if (typeof contentType === 'string') {
        mimeType = contentType.split(';')[0].trim();
      }
    } else if (req.body && typeof req.body === 'object') {
      const body = req.body as { audio?: unknown; mimeType?: unknown; filename?: unknown; language?: unknown };
      if (typeof body.mimeType === 'string' && body.mimeType) {
        mimeType = body.mimeType;
      }
      if (typeof body.filename === 'string' && body.filename) {
        filename = body.filename;
      }
      if (typeof body.language === 'string' && body.language) {
        language = body.language;
      }
      if (typeof body.audio === 'string') {
        const audioStr = body.audio;
        if (audioStr.startsWith('data:')) {
          const match = audioStr.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            mimeType = mimeType || match[1];
            audioBuffer = Buffer.from(match[2], 'base64');
          } else {
            audioBuffer = Buffer.from(audioStr, 'base64');
          }
        } else {
          audioBuffer = Buffer.from(audioStr, 'base64');
        }
      }
    }

    if (typeof req.query?.mimeType === 'string' && !mimeType) {
      mimeType = req.query.mimeType;
    }
    if (typeof req.query?.filename === 'string' && !filename) {
      filename = req.query.filename;
    }
    if (typeof req.query?.language === 'string' && !language) {
      language = req.query.language;
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      res.status(400).json({ error: 'Audio data is required and must not be empty' });
      return;
    }

    try {
      const service = getAudioTranscriptionService(this.logger);
      const transcribeOpts: { mimeType?: string; filename?: string; language?: string } = { mimeType, filename };
      if (language !== undefined) {
        transcribeOpts.language = language;
      }
      const result = await service.transcribe(audioBuffer, transcribeOpts);
      if (result.error) {
        this.logger.warn(`[AudioTranscribeRouteHandler] Voice server failed or unreachable at ${config.AUDIO.STT.ENDPOINT}: ${result.error}`);
        const statusCode = result.error.includes('disabled') ? 400 : 500;
        res.status(statusCode).json({ error: result.error });
        return;
      }
      this.logger.info(`[AudioTranscribeRouteHandler] Connected to voice server (${config.AUDIO.STT.ENDPOINT}) - transcribed ${result.text.length} characters`);
      res.status(200).json({ text: result.text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AudioTranscribeRouteHandler] Audio transcription error: ${message}`);
      res.status(500).json({ error: message });
    }
  };
}

class SpeechSynthesizeRouteHandler {
  constructor(private readonly logger: ILogger) {}

  readonly handle = async (req: Request, res: Response): Promise<void> => {
    let text: string | undefined;
    let voice: string | undefined;

    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      const body = req.body as { text?: unknown; voice?: unknown };
      if (typeof body.text === 'string') {
        text = body.text;
      }
      if (typeof body.voice === 'string' && body.voice) {
        voice = body.voice;
      }
    }

    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Text is required and must not be empty' });
      return;
    }

    try {
      const service = getSpeechSynthesisService(this.logger);
      const result = await service.synthesize(text, voice ? { voice } : undefined);
      if (result.error || !result.audio) {
        const errorMsg = result.error || 'Audio synthesis produced no audio.';
        this.logger.warn(`[SpeechSynthesizeRouteHandler] Voice server failed or unreachable at ${config.AUDIO.TTS.ENDPOINT}: ${errorMsg}`);
        const statusCode = /disabled|exceeds maximum length/.test(errorMsg) ? 400 : 500;
        res.status(statusCode).json({ error: errorMsg });
        return;
      }
      this.logger.info(`[SpeechSynthesizeRouteHandler] Connected to voice server (${config.AUDIO.TTS.ENDPOINT}) - synthesized ${result.audio.length} bytes`);
      res.status(200).setHeader('Content-Type', result.contentType);
      res.send(result.audio);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SpeechSynthesizeRouteHandler] Audio synthesis error: ${message}`);
      res.status(500).json({ error: message });
    }
  };
}

class DashboardServer implements WebServerHandle {
  private server: Server | null = null;
  private boundPort = 0;

  constructor(
    private readonly logger: ILogger,
    private readonly gateway: IMessageGateway,
    private readonly db: IDatabaseService,
    private readonly sessionManager: ISessionManager,
    private readonly listen: WebListenOptions = {},
  ) {}

  get port(): number {
    return this.boundPort;
  }

  async start(): Promise<WebServerHandle> {
    const app = this.createApp();
    const requestedPort = this.listen.port ?? config.WEB_PORT;
    const { host } = this.listen;

    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : requestedPort;
        const urls = serverUrls(this.boundPort, host);
        this.logger.info(`Server running at ${urls.local}`);
        if (urls.lan.length > 0) {
          this.logger.info(`On your network: ${urls.lan.join(', ')}`);
        }
        this.logSetupInstructionsIfUnconfigured();
        resolve();
      };
      const server = host
        ? app.listen(requestedPort, host, onListening)
        : app.listen(requestedPort, onListening);
      server.once('error', reject);
      this.server = server;
    });

    return this;
  }

  private logSetupInstructionsIfUnconfigured(): void {
    const configured = resolveConfigPaths().some(existsSync);
    if (configured) {
      return;
    }

    this.logger.info(
      `No koris.json found yet — open http://localhost:${this.boundPort}/setup in your browser to finish setup, ` +
        'or run `pnpm onboard` for a CLI setup wizard instead.',
    );
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await DashboardServer.stopServer(this.server);
    this.server = null;
  }

  private static stopServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }

  createApp(): Application {
    const app = express();
    const publicDir = path.resolve(config.BASE_DIR, './dist-web');
    const indexHandler = new IndexRouteHandler(publicDir);
    const chatHandler = new ChatRouteHandler(this.gateway, this.db);
    const healthHandler = new HealthRouteHandler(this.logger);
    const audioTranscribeHandler = new AudioTranscribeRouteHandler(this.logger);
    const audioSpeakHandler = new SpeechSynthesizeRouteHandler(this.logger);
    const adminRouter = AdminRouterFactory.create(this.logger, this.db, this.gateway, this.sessionManager);

    // Security headers — applied to every response
    app.use(securityHeaders());

    // Body parsers (sized per endpoint group)
    app.use('/api/audio', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }));
    app.use('/api/audio', express.json({ limit: '25mb' }));
    app.use('/api/chat', express.json({ limit: '5mb' }));
    app.use('/api/admin', express.json({ limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.static(publicDir));

    // Auth guards — no-op when admin_secret is not set in koris.json
    app.use('/api/admin', requireAdminSecret());
    app.use('/api/chat', requireAdminSecret());
    app.use('/api/audio', requireAdminSecret());

    // Rate limiters
    const chatRateLimiter = createRateLimiter(60_000, 30, 'Too many chat requests. Please wait before sending another message.');
    const adminRateLimiter = createRateLimiter(60_000, 120, 'Too many admin requests. Please slow down.');
    app.use('/api/chat', chatRateLimiter);
    app.use('/api/admin', adminRateLimiter);

    app.post('/api/chat', chatHandler.handle);
    app.post('/api/chat/cancel', chatHandler.cancel);
    app.post('/api/audio/transcribe', audioTranscribeHandler.handle);
    app.post('/api/audio/speak', audioSpeakHandler.handle);
    app.use('/api/admin', adminRouter);
    app.get('/health', healthHandler.handle);

    // SPA fallback: any unmatched GET request (e.g. "/", "/admin", "/admin/sessions")
    // is served the same index.html so React Router can handle client-side routing.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') {
        next();
        return;
      }

      indexHandler.handle(req, res);
    });

    return app;
  }
}

class DashboardServerFactory {
  static create(
    logger: ILogger,
    gateway: IMessageGateway,
    db: IDatabaseService,
    sessionManager: ISessionManager,
    listen?: WebListenOptions,
  ): WebServerHandle {
    return new DashboardServer(logger, gateway, db, sessionManager, listen);
  }
}

function createApp(options: { logger: ILogger; gateway: IMessageGateway; db: IDatabaseService; sessionManager: ISessionManager }): Application {
  return new DashboardServer(options.logger, options.gateway, options.db, options.sessionManager).createApp();
}

function serveIndexHandler(publicDir: string) {
  return new IndexRouteHandler(publicDir).handle;
}

function createHealthHandler(logger: ILogger) {
  return new HealthRouteHandler(logger).handle;
}

function createChatHandler(gateway: IMessageGateway) {
  return new ChatRouteHandler(gateway).handle;
}

function createChatCancelHandler(gateway: IMessageGateway) {
  return new ChatRouteHandler(gateway).cancel;
}

function createAudioTranscribeHandler(logger: ILogger) {
  return new AudioTranscribeRouteHandler(logger).handle;
}

function createAudioSpeakHandler(logger: ILogger) {
  return new SpeechSynthesizeRouteHandler(logger).handle;
}

async function startWebServer(
  logger: ILogger,
  gateway: IMessageGateway,
  db: IDatabaseService,
  sessionManager: ISessionManager,
  listen?: WebListenOptions,
): Promise<WebServerHandle> {
  return new DashboardServer(logger, gateway, db, sessionManager, listen).start();
}

export {
  WebServerHandle,
  WebListenOptions,
  DashboardServerFactory,
  createApp,
  serveIndexHandler,
  createHealthHandler,
  createChatHandler,
  createChatCancelHandler,
  AudioTranscribeRouteHandler,
  createAudioTranscribeHandler,
  SpeechSynthesizeRouteHandler,
  createAudioSpeakHandler,
  startWebServer,
};
