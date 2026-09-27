import { handleCommand, isCommand } from '../commands';
import { previewMessage, toSafeMessage } from '../../utils/message';
import { config } from '../../config';
import { AIServiceError } from '../ai-completion-service';
import { findGateBlocks, formatGateBlockNotice } from '../security/gate-blocks';
import { AuditLogRepositoryFactory, type IAuditLogRepository } from '../../repositories/audit-log';
import { ILogger } from '../../infrastructure/logger';
import { IDatabaseService } from '../../infrastructure/db-sqlite';
import { ISessionManager } from '../session-manager';
import { IMainAgent, MainAgentFactory } from './main-agent';
import { ProcessedMessage, ProcessOptions } from '../../types/agents';
import { ImageAttachment } from '../../types/messages';
import { generateId } from '../../utils/generate-id';
import { carryForwardMetadata } from '../../utils/session';
import { replacePlaceholders } from '../../utils/prompt';
import { SKILL_INVOCATION_PROMPT } from '../../constants';
import { ISessionContextFactory, SessionContextFactory, SessionContext } from './session-context';
import { SessionKey } from '../../types/session';
import { IBackgroundDispatcher, BackgroundDispatcherFactory } from './background-dispatcher';
import { shouldAutoCompact } from './context-budget';
import { IChannelService, ChannelServiceFactory } from '../channel-service';
import type { InboundInput, IMessageGateway, StickerReference } from '../../../../plugins/channels/contracts';
import { buildErrandService } from '../errands';
import { formatOpenErrandsBlock } from '../errands/prompt';
import { runErrandOperation } from '../errands/operations';
import { CHANNEL_TYPES } from '../../entities/channel';
import { Negotiator, NegotiatorFactory } from './sub-agents/negotiator/sub-agent';

export type { InboundInput, IMessageGateway };

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

// User-facing explanation shown when a manual-mode session is auto-compacted.
const COMPACTION_NOTICE = {
  proactive: "This conversation got long enough to crowd the model's context window, so I summarized what we've covered into memory and started a fresh session. Nothing is lost — carry on.",
  reactive: "The conversation outgrew the model's context limit, so I summarized this session into memory, started a fresh one, and I'm retrying your last message now.",
} as const;

function normalizeInput(input: InboundInput): { text: string; images?: ImageAttachment[]; stickers?: StickerReference[] } {
  if (typeof input === 'string') {
    return { text: input };
  }
  if (input == null || typeof input !== 'object') {
    return { text: '' };
  }
  return { text: input.text, images: input.images, stickers: input.stickers };
}

class MessageGateway implements IMessageGateway {
  constructor(
    private logger: ILogger,
    private channel: string,
    private db: IDatabaseService,
    private sessionManager: ISessionManager,
    private sessionContextFactory: ISessionContextFactory,
    private backgroundDispatcher: IBackgroundDispatcher,
    private mainAgent: IMainAgent,
    private channelService: IChannelService,
    private auditRepo: IAuditLogRepository,
    private negotiator: Negotiator,
  ) {}

  async handle(input: InboundInput, originId: string, options?: ProcessOptions): Promise<ProcessedMessage> {
    const { text, images, stickers } = normalizeInput(input);
    const safeMessage = toSafeMessage(text);
    const channel = options?.channel ?? this.channel;

    this.logger.info(`Processing message from ${channel} (origin: ${originId}): "${previewMessage(safeMessage)}"${images?.length ? ` with ${images.length} image(s)` : ''}`);

    // An approved errand owns the contact conversation regardless of whether
    // that contact is also trusted. Trusted slash commands still belong to
    // their user session; web/TUI requests without channel trust stay there too.
    // The contact may reply under a different address than the errand was sent
    // to (WhatsApp LID vs phone number), so the channel's aliases count too.
    const routesErrands = options?.isTrustedSender !== undefined
      && (!isCommand(safeMessage) || options.isTrustedSender === false);
    const errandService = routesErrands ? buildErrandService(this.logger, this.db, this.sessionManager) : null;
    const activeErrand = errandService?.findActiveForPeer(channel, originId, options?.peerAliases) ?? null;
    // An untrusted contact writing after their errand was resolved reopens it
    // and escalates to the principal; trusted senders keep their own session.
    const reopenedErrand = !activeErrand && options?.isTrustedSender === false
      ? errandService?.reopenForPeer(channel, originId, safeMessage, options.peerAliases) ?? null
      : null;
    const delegated = activeErrand ?? reopenedErrand;

    const origin: SessionKey = delegated
      ? { channel, peerId: originId, kind: 'delegated' }
      : { channel, peerId: originId, kind: 'user' };
    const { sessionService, messageService, memoryService } = this.sessionContextFactory.resolve(origin, delegated?.sessionId ?? options?.sessionId);

    this.channelService.record(channel, originId);

    const sessionCtx: SessionContext = { sessionService, messageService, memoryService };

    if (reopenedErrand) {
      // Nothing goes back to the contact until the principal answers the escalation.
      return runErrandOperation(reopenedErrand.errand.id, async () => {
        messageService.save({ role: 'user', content: safeMessage, images });
        return '';
      });
    }

    if (activeErrand) {
      // Delegated turn: the negotiator drives it end to end — commands and
      // tools are never dispatched for a contact's delegated message. Read and
      // persist within the queue so the next turn sees the preceding exchange.
      return runErrandOperation(activeErrand.errand.id, async () => {
        const messageHistory = messageService.getHistory();
        messageService.save({ role: 'user', content: safeMessage, images });
        const result = await this.negotiator.run({
          errandId: activeErrand.errand.id,
          sessionId: sessionService.getSession().id,
          channel,
          peerMessage: safeMessage,
          peerImages: images,
          messageHistory,
        });
        if (result.reply) messageService.save({ role: 'assistant', content: result.reply });
        return result.reply;
      });
    }

    let agentMessage = safeMessage;
    let skillBlocks: string[] | undefined;

    if (isCommand(safeMessage)) {
      const commandResult = await handleCommand(safeMessage, {
        source: channel,
        trusted: !!options?.toolsEnabled,
        learnedSkillsEnabled: options?.learnedSkillsEnabled,
        originId,
        sessionId: sessionService.getSession().id,
      });

      // A skill command is the one command that does not answer the turn: it
      // loads that skill's documentation, then falls through to the agent.
      const skillCommand = commandResult.action === 'skill' ? commandResult.skill : undefined;

      if (skillCommand) {
        agentMessage = skillCommand.args || `Run the "${skillCommand.name}" skill.`;
        skillBlocks = [replacePlaceholders(SKILL_INVOCATION_PROMPT, {
          v1: skillCommand.name,
          v2: skillCommand.content,
        })];
      } else if (commandResult.action === 'compact') {
        return this.handleCompact(sessionCtx, channel, commandResult.response || '', options);
      } else if (commandResult.action === 'clear') {
        return this.handleClear(sessionCtx, safeMessage, images, channel, commandResult.response || '', options);
      } else if (commandResult.action === 'memory') {
        return this.handleMemory(sessionCtx, safeMessage, images, channel);
      } else if (commandResult.action === 'mode') {
        return this.handleMode(sessionCtx, safeMessage, images, channel, commandResult.mode);
      } else {
        const response = commandResult.response || '';
        this.backgroundDispatcher.persistConversation({
          sessionId: sessionService.getSession().id,
          ask: safeMessage,
          askImages: images,
          answer: response,
          channel,
        });
        return response;
      }
    }

    const runId = options?.runId ?? generateId();
    const errandBlock = options?.toolsEnabled ? this.openErrandsBlock(sessionService.getSession().id, channel) : null;
    const promptBlocks = [...(skillBlocks ?? []), ...(errandBlock ? [errandBlock] : [])];
    const turnOptions = { ...options, runId, ...(promptBlocks.length ? { skillBlocks: promptBlocks } : {}) };

    // Manual-mode safety valve (proactive): if the session is near the manager's
    // context window, summarize it into memory and start fresh before this turn.
    if (
      config.SESSION.SUMMARIZER_MODE === 'manual' &&
      shouldAutoCompact(messageService.getHistory(), metadataString(messageService.getSessionMetadata(), 'compactSummary'))
    ) {
      this.logger.info(`Context near limit on ${channel} — auto-compacting manual-mode session before turn`);
      options?.onProgress?.(`🗜️ ${COMPACTION_NOTICE.proactive}`);
      await this.compactAndRotate(sessionCtx, channel, options);
    }

    let response: ProcessedMessage | undefined;
    let compactedOnce = false;
    while (response === undefined) {
      try {
        response = await this.mainAgent.run({
          userMessage: agentMessage,
          channel,
          message: messageService,
          images,
          stickers,
          target: originId,
          options: turnOptions,
        });
      } catch (err) {
        // Manual-mode safety valve (reactive): a context-length overflow →
        // compact, rotate and retry the turn once on the fresh session.
        if (
          err instanceof AIServiceError &&
          err.code === 'context_length' &&
          config.SESSION.SUMMARIZER_MODE === 'manual' &&
          !compactedOnce &&
          messageService.getHistory().length > 0
        ) {
          compactedOnce = true;
          this.logger.warn(`Context overflow on ${channel} turn — auto-compacting and retrying once`);
          options?.onProgress?.(`🗜️ ${COMPACTION_NOTICE.reactive}`);
          await this.compactAndRotate(sessionCtx, channel, options);
          continue;
        }

        // A provider error (auth, rate limit, unavailable, …) is still an outcome:
        // persist the turn so it survives a reload and the web can offer "Resend".
        if (err instanceof AIServiceError && err.code !== 'aborted') {
          this.logger.warn(`Provider error on ${channel} turn (${err.code}): ${err.message}`);
          this.backgroundDispatcher.persistConversation({
            sessionId: messageService.getSessionId(),
            ask: safeMessage,
            askImages: images,
            answer: err.message,
            answerErrorCode: err.code,
            channel,
          });
        }
        throw err;
      }
    }

    this.logger.info(`Processed message from ${channel}: "${previewMessage(safeMessage)}" => "${previewMessage(response)}"`);

    const sessionId = messageService.getSessionId();
    const finalResponse = this.appendGateBlockNotice(response, runId, channel);

    this.backgroundDispatcher.persistConversation({ sessionId, ask: safeMessage, askImages: images, answer: finalResponse, channel });
    this.backgroundDispatcher.summarizeConversation({
      sessionId,
      ask: safeMessage,
      answer: response,
      channel,
      memoryService,
    });

    return finalResponse;
  }

  // When a tool call this turn was refused by the domain gate, tell the user
  // which domain and how to allow it. The web UI has its own banner for this
  // (GET /api/admin/chat/gate-blocks), so it's skipped here; streaming
  // responses (non-string) are skipped too.
  private appendGateBlockNotice(response: string, runId: string, channel: string): string {
    if (channel === 'web' || typeof response !== 'string') {
      return response;
    }

    try {
      const blocks = findGateBlocks(this.auditRepo, { runId, allowed: config.ALLOWED_DOMAINS });
      if (blocks.length === 0) {
        return response;
      }

      const notice = formatGateBlockNotice(blocks);
      this.logger.info(`Domain-gate notice added for ${blocks.map((b) => b.domain).join(', ')}`);
      return response ? `${response}\n\n${notice}` : notice;
    } catch (err) {
      this.logger.warn('Failed to build domain-gate notice', {
        error: err instanceof Error ? err.message : String(err),
      });
      return response;
    }
  }

  // Lets the Orchestrator map a plain "yes" to the right errand tool. Errands
  // only run with a channel manager, so there is nothing to list without one.
  // Questions only reach a WhatsApp/Telegram principal in this chat; on web they
  // are answered from the Negotiator page, so the Orchestrator does not see them.
  private openErrandsBlock(sessionId: string, channel: string): string | null {
    try {
      const errands = buildErrandService(this.logger, this.db, this.sessionManager)?.listByOrigin(sessionId) ?? [];
      return formatOpenErrandsBlock(errands, { includeQuestions: (CHANNEL_TYPES as readonly string[]).includes(channel) });
    } catch (err) {
      this.logger.warn('Failed to list open errands for the prompt', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async handleCompact(
    ctx: SessionContext,
    channel: string,
    confirmation: string,
    options?: ProcessOptions,
  ): Promise<ProcessedMessage> {
    if (ctx.messageService.getHistory().length === 0) {
      return 'Nothing to compact yet.';
    }

    await this.compactAndRotate(ctx, channel, options);

    // Seed the fresh session with just the confirmation line so the new chat
    // opens with a marker instead of a blank history. The `/compact` command
    // itself is never persisted, and the compacted session keeps its own
    // history untouched (the carried summary lives in session metadata).
    ctx.messageService.save({ role: 'assistant', content: confirmation });

    return confirmation;
  }

  // `/clear`: drop the current thread entirely — rotate into a fresh, empty
  // session with no summary carried forward. The command exchange is recorded
  // against the old session so the new one starts clean.
  private handleClear(
    ctx: SessionContext,
    safeMessage: string,
    images: ImageAttachment[] | undefined,
    channel: string,
    confirmation: string,
    options?: ProcessOptions,
  ): ProcessedMessage {
    if (ctx.messageService.getHistory().length === 0) {
      return 'This session is already empty.';
    }

    const clearedSessionId = ctx.sessionService.getSession().id;
    this.backgroundDispatcher.persistConversation({
      sessionId: clearedSessionId,
      ask: safeMessage,
      askImages: images,
      answer: confirmation,
      channel,
    });

    ctx.sessionService.forceRotate('clear', carryForwardMetadata(ctx.sessionService.getSession().metadata));
    const freshSessionId = ctx.sessionService.getSession().id;
    options?.onSessionRotated?.(freshSessionId);
    this.logger.info(`Cleared session ${clearedSessionId} → ${freshSessionId} (${channel})`);

    return confirmation;
  }

  // `/mode [text|voice]`: read or set this conversation's reply format. The
  // flag lives in session metadata and is carried through `/clear` and
  // `/compact` rotation so it survives history resets.
  private handleMode(
    ctx: SessionContext,
    safeMessage: string,
    images: ImageAttachment[] | undefined,
    channel: string,
    mode: 'text' | 'voice' | undefined,
  ): ProcessedMessage {
    const current = metadataString(ctx.sessionService.getSession().metadata, 'responseMode') === 'voice'
      ? 'voice'
      : 'text';

    let response: string;
    if (!mode) {
      response = `Reply mode is "${current}". Use /mode voice or /mode text to change it.`;
    } else {
      ctx.sessionService.updateMetadata({ responseMode: mode });
      response = `Reply mode set to "${mode}".`;
      if (mode === 'voice' && !config.AUDIO.TTS.ENABLED) {
        response += ' Note: text-to-speech is disabled in config, so replies stay text until it is enabled.';
      }
    }

    this.backgroundDispatcher.persistConversation({
      sessionId: ctx.sessionService.getSession().id,
      ask: safeMessage,
      askImages: images,
      answer: response,
      channel,
    });

    return response;
  }

  // `/memory`: surface the summary a prior `/compact` (or the auto-compaction
  // valve) seeded into this session, so compaction is not a black box.
  private handleMemory(
    ctx: SessionContext,
    safeMessage: string,
    images: ImageAttachment[] | undefined,
    channel: string,
  ): ProcessedMessage {
    const summary = metadataString(ctx.messageService.getSessionMetadata(), 'compactSummary');
    const response = summary
      ? `Summary carried into this session:\n\n${summary}`
      : "Nothing summarized into this session yet — it hasn't been compacted.";

    this.backgroundDispatcher.persistConversation({
      sessionId: ctx.sessionService.getSession().id,
      ask: safeMessage,
      askImages: images,
      answer: response,
      channel,
    });

    return response;
  }

  // Summarize the current session into a memory and rotate into a fresh one
  // seeded with that summary. Shared by `/compact` and the manual-mode
  // auto-compaction safety valve. No-op (no rotation) when there is nothing to
  // compact.
  private async compactAndRotate(
    { sessionService, messageService, memoryService }: SessionContext,
    channel: string,
    options?: ProcessOptions,
  ): Promise<{ compactedSessionId: string; rotated: boolean }> {
    const history = messageService.getHistory();
    const compactedSessionId = sessionService.getSession().id;
    if (history.length === 0) return { compactedSessionId, rotated: false };

    const result = await this.backgroundDispatcher.compactConversation({
      sessionId: compactedSessionId,
      messages: history,
      channel,
      memoryService,
    });

    const carried = carryForwardMetadata(sessionService.getSession().metadata);
    const rotateMetadata = {
      ...carried,
      ...(result ? { compactSummary: result.content } : {}),
    };
    sessionService.forceRotate('compact', rotateMetadata);
    options?.onSessionRotated?.(sessionService.getSession().id);
    this.logger.info(`Compacted session ${compactedSessionId} → ${sessionService.getSession().id} (${channel})`);
    return { compactedSessionId, rotated: true };
  }
}

class MessageGatewayFactory {
  static create(logger: ILogger, channel: string, db: IDatabaseService, sessionManager: ISessionManager): MessageGateway {
    const sessionContextFactory = SessionContextFactory.create(logger, db, sessionManager);
    const backgroundDispatcher = BackgroundDispatcherFactory.create(logger, db, sessionManager);
    const mainAgent = MainAgentFactory.create(logger);
    const channelService = ChannelServiceFactory.create(db);
    const auditRepo = AuditLogRepositoryFactory.create(db);
    const negotiator = NegotiatorFactory.create(logger, db, sessionManager);

    return new MessageGateway(logger, channel, db, sessionManager, sessionContextFactory, backgroundDispatcher, mainAgent, channelService, auditRepo, negotiator);
  }
}

export { MessageGateway, MessageGatewayFactory }
