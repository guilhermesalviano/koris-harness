import { IDatabaseService } from "../../../../infrastructure/db-sqlite";
import type { ILogger } from "../../../../infrastructure/logger";
import { IPromptRepository, PromptRepositoryFactory } from "../../../../repositories/prompt";
import { getAIProvider } from "../../../providers";
import { AICompletionService, IAICompletionService } from "../../../ai-completion-service";
import { NEGOTIATOR_INSTRUCTIONS, NEGOTIATOR_IMAGE_INSTRUCTION, ERRAND_ACTION_FOLLOWUPS, ERRAND_FOLLOWUP_CONTEXT, ERRAND_OPENER_INSTRUCTIONS, ERRAND_RESUME_INSTRUCTIONS, THIRD_PARTY_CONVERSATION_CONTEXT } from "../../../../constants";
import { config } from "../../../../config";
import { replacePlaceholders } from "../../../../utils/prompt";
import { parseNegotiatorResponse } from "../../../../utils/negotiator-response";
import { ISessionManager } from "../../../session-manager";
import { buildErrandService } from "../../../errands";
import type { Message } from "../../../../entities/message";
import type { ImageAttachment } from "../../../../types/messages";

export interface NegotiatorTurnProps {
  errandId: string;
  sessionId: string;
  channel: string;
  peerMessage: string;
  /** Images attached to (or quoted by) the contact's latest message. */
  peerImages?: ImageAttachment[];
  messageHistory: Message[];
}

export interface NegotiatorOpenerProps {
  goal: string;
  channel: string;
  peerId: string;
  originSessionId: string;
}

export interface NegotiatorResumeProps {
  errandId: string;
  goal: string;
  notes?: string;
  answer: string;
  question?: string;
  channel: string;
  sessionId: string;
  messageHistory: Message[];
}

export interface NegotiatorTurnResult {
  reply: string;
  applied: 'continue' | 'escalate' | 'resolved' | 'failed' | 'skipped';
}

const OPENER_REQUEST = 'Write the opening message now.';

class Negotiator {
  constructor(
    private logger: ILogger,
    private db: IDatabaseService,
    private sessionManager: ISessionManager,
    private completionService: IAICompletionService,
    private promptRepository: IPromptRepository,
  ) {}

  private sessionInstructions(sessionId: string): string {
    const session = this.sessionManager.getSessionServiceById(sessionId).getSession();
    const instructions = session.metadata.instructions;
    // Older sessions predate persisted instructions; retain their existing
    // behavior without mixing their historical transcripts into a new errand.
    return typeof instructions === 'string' && instructions.trim() ? instructions : THIRD_PARTY_CONVERSATION_CONTEXT;
  }

  async composeOpener(props: NegotiatorOpenerProps): Promise<string> {
    const instructions = replacePlaceholders(ERRAND_OPENER_INSTRUCTIONS, {
      v1: props.goal,
      v2: props.peerId,
      v3: props.channel,
    });

    try {
      const payload = await this.promptRepository.build({
        userMessage: OPENER_REQUEST,
        channel: props.channel,
        toolsEnabled: false,
        learnedSkillsEnabled: false,
        includeMemory: false,
        extraSystemBlocks: [THIRD_PARTY_CONVERSATION_CONTEXT, instructions],
      });

      const response = await this.completionService.complete(payload, {
        audit: { sessionId: props.originSessionId, channel: props.channel },
      });

      const text = response.kind === 'message' ? response.text.trim() : '';
      if (text) return text;
      this.logger.warn('Negotiator: opener composition returned no text, falling back to the raw goal');
    } catch (err) {
      this.logger.warn(`Negotiator: opener composition failed, falling back to the raw goal: ${err instanceof Error ? err.message : String(err)}`);
    }

    return props.goal;
  }

  async composeResume(props: NegotiatorResumeProps): Promise<string> {
    const instructions = replacePlaceholders(ERRAND_RESUME_INSTRUCTIONS, {
      v1: props.goal,
      v2: props.notes || '(none yet)',
      v3: props.answer,
      v4: props.question || '(see conversation and notes)',
    });

    try {
      const payload = await this.promptRepository.build({
        userMessage: `Continue the conversation given the principal's answer: "${props.answer}"`,
        channel: props.channel,
        messageHistory: props.messageHistory,
        historyLimit: config.ERRANDS.HISTORY_LIMIT,
        systemPrompt: '',
        includeGlobalContext: false,
        toolsEnabled: false,
        learnedSkillsEnabled: false,
        includeMemory: false,
        sessionId: props.sessionId,
        extraSystemBlocks: [this.sessionInstructions(props.sessionId), instructions],
      });

      const response = await this.completionService.complete(payload, {
        audit: { sessionId: props.sessionId, channel: props.channel, runId: props.errandId },
      });

      const text = response.kind === 'message' ? response.text.trim() : '';
      if (text) return text;
    } catch {
      this.logger.warn('Negotiator: resume composition failed');
    }

    throw new Error('Could not prepare the reply. Nothing was sent; the errand is still awaiting your input. Please try again.');
  }

  async run(props: NegotiatorTurnProps): Promise<NegotiatorTurnResult> {
    const errandService = buildErrandService(this.logger, this.db, this.sessionManager);
    if (!errandService) {
      this.logger.warn('Negotiator: errands are unavailable (no channel manager is running)');
      return { reply: '', applied: 'skipped' };
    }

    const errand = errandService.get(props.errandId);
    if (!errand) {
      this.logger.warn(`Negotiator: errand ${props.errandId} not found`);
      return { reply: '', applied: 'skipped' };
    }

    // A further message from the contact is not principal approval. Keep it in
    // the transcript (the gateway persists it), but do not restart a paused or
    // closed negotiation, or send anything before the opener is approved.
    if (errand.pendingDelivery || !['open', 'awaiting_peer', 'awaiting_confirmation'].includes(errand.state)) {
      return { reply: '', applied: 'skipped' };
    }

    const instructions = replacePlaceholders(NEGOTIATOR_INSTRUCTIONS, {
      v1: errand.goal,
      v2: errand.notes || '(none yet)',
    });
    const lastReply = [...props.messageHistory].reverse().find((message) => message.role === 'assistant' && message.content.trim());
    const followupContext = replacePlaceholders(ERRAND_FOLLOWUP_CONTEXT, {
      v1: errand.state,
      v2: lastReply?.content || '(unavailable; continue from the goal, notes and contact reply without repeating the opener)',
      v3: new Date().toISOString(),
    });

    const payload = await this.promptRepository.build({
      userMessage: props.peerMessage,
      images: props.peerImages,
      imageInstruction: NEGOTIATOR_IMAGE_INSTRUCTION,
      channel: props.channel,
      messageHistory: props.messageHistory,
      historyLimit: config.ERRANDS.HISTORY_LIMIT,
      systemPrompt: '',
      includeGlobalContext: false,
      toolsEnabled: false,
      learnedSkillsEnabled: false,
      includeMemory: false,
      sessionId: props.sessionId,
      extraSystemBlocks: [this.sessionInstructions(props.sessionId), instructions, followupContext],
    });

    const response = await this.completionService.complete(payload, {
      audit: { sessionId: props.sessionId, channel: props.channel, runId: errand.id },
    });

    const verdict = response.kind === 'message'
      ? parseNegotiatorResponse(response.text)
      : null;
    if (!verdict) {
      this.logger.warn('Negotiator: invalid verdict; no reply sent or state changed');
      return { reply: '', applied: 'skipped' };
    }

    // The principal may have cancelled/closed the errand during this LLM call.
    const latest = errandService.get(props.errandId);
    if (!latest || latest.state !== errand.state) return { reply: '', applied: 'skipped' };

    const reply = verdict.reply || ERRAND_ACTION_FOLLOWUPS[verdict.action] || '';

    switch (verdict.action) {
      case 'escalate':
        errandService.escalate(errand.id, verdict.detail || 'The negotiator needs your input.', verdict.notes);
        break;
      case 'resolved':
        // The closing message is held until the principal confirms the result.
        errandService.proposeResolution(errand.id, verdict.detail || verdict.reply || 'Resolved.', reply, verdict.notes);
        return { reply: '', applied: 'resolved' };
      case 'failed':
        errandService.fail(errand.id, verdict.detail || verdict.reply || 'Failed.', verdict.notes);
        break;
      case 'continue':
      default:
        errandService.recordPeerReply(errand.id, verdict.notes);
        break;
    }

    return { reply, applied: verdict.action };
  }
}

class NegotiatorFactory {
  static create(logger: ILogger, db: IDatabaseService, sessionManager: ISessionManager): Negotiator {
    const embedProvider = getAIProvider(logger, 'embed');
    const promptRepository = PromptRepositoryFactory.create(db, logger, embedProvider);
    const completionService = new AICompletionService(
      () => getAIProvider(logger, 'worker', { background: true }),
      logger,
      { role: 'worker', agentName: 'negotiator' },
    );
    return new Negotiator(logger, db, sessionManager, completionService, promptRepository);
  }
}

export { Negotiator, NegotiatorFactory };
