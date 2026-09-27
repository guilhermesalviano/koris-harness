import type { ErrandRecord, IErrandsGateway, ILogger, Plugin, ToolExecutionContext, ToolPluginContext, ToolResult } from '../contracts';
import { COMMANDS } from '../contracts';
import { defineTool } from '../define-tool';
import { getOptionalStringArg, getRequiredStringArg, isAllowedValue } from '../runtime';

export const TOOL_NAMES = {
  start: 'start_errand',
  approve: 'approve_errand',
  answer: 'answer_errand',
  resolve: 'resolve_errand',
  list: 'list_errands',
  close: 'close_errand',
  cancel: 'cancel_errand',
} as const;

type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];
type ErrandHandler = (logger: ILogger, args: Record<string, unknown>, context: ToolExecutionContext | undefined, errands: IErrandsGateway) => Promise<ToolResult>;

const CHANNEL_TYPES = ['telegram', 'whatsapp'] as const;
/** Fixed lead-in before the Negotiator page URL; a plain URL is clickable on the web chat and on WhatsApp/Telegram alike. */
const FOLLOW_TEXT = 'follow details on ';
const CLOSED_STATES = ['resolved', 'failed', 'cancelled', 'expired'];
/** A pending question, or extra requirements for a proposed result. */
const ANSWERABLE = ['awaiting_principal', 'awaiting_confirmation'];

const STATUS: Record<string, string> = {
  draft: 'draft awaiting approval',
  queued: 'queued behind another errand with the same contact',
  open: 'in progress',
  awaiting_peer: 'waiting on the contact',
  awaiting_principal: 'waiting on the human\'s answer',
  awaiting_confirmation: 'goal looks achieved, waiting for the human to confirm',
  resolved: 'resolved',
  failed: 'failed',
  cancelled: 'cancelled',
  expired: 'expired',
};

const status = (errand: ErrandRecord) => STATUS[errand.state] ?? errand.state;

function describe(errand: ErrandRecord): string {
  const lines = [`- [${errand.id}] ${status(errand)} — ${errand.goal}`];
  if (errand.deliveryIncomplete) lines.push(`  Delivery incomplete: ${errand.deliveryError ?? 'not every contact received the message yet'}`);
  else if (errand.pendingMessage && errand.state === 'awaiting_principal') lines.push(`  Pending question: ${errand.pendingMessage}`);
  else if (errand.pendingMessage && errand.state === 'awaiting_confirmation') lines.push(`  Proposed result: ${errand.pendingMessage}`);
  else if (errand.pendingMessage && ['draft', 'queued'].includes(errand.state)) lines.push(`  Draft opener: ${errand.pendingMessage}`);
  if (errand.notes) lines.push(`  Notes: ${errand.notes}`);
  if (errand.result) lines.push(`  Result: ${errand.result}`);
  return lines.join('\n');
}

/**
 * Chooses the errand a tool call refers to among this chat's errands. The id
 * is optional so a plain "yes" works: with exactly one candidate it is used;
 * with several the model gets the list back and must ask the human which.
 */
export function pickErrand(
  errands: readonly ErrandRecord[],
  errandId: string | null,
  matches: (errand: ErrandRecord) => boolean,
  what: string,
): { errand: ErrandRecord } | { error: string } {
  if (errandId) {
    const errand = errands.find((item) => item.id === errandId);
    if (!errand) return { error: `No errand "${errandId}" was started from this chat.` };
    return matches(errand) ? { errand } : { error: `Errand ${errandId} is ${status(errand)}, not ${what}.` };
  }
  const candidates = errands.filter(matches);
  if (candidates.length === 1) return { errand: candidates[0] };
  if (candidates.length === 0) return { error: `No errand in this chat is ${what}.` };
  return {
    error: `Several errands in this chat are ${what}. Ask the human which one they mean, then call again with its errandId:\n${candidates.map(describe).join('\n')}`,
  };
}

function withErrands(
  name: ToolName,
  run: (args: Record<string, unknown>, sessionId: string, errands: IErrandsGateway, context: ToolExecutionContext) => Promise<string>,
): ErrandHandler {
  return async (logger, args, context, errands) => {
    if (!context?.sessionId) {
      return { toolName: name, success: false, error: 'Errand tools need the current chat session.' };
    }
    try {
      return { toolName: name, success: true, result: await run(args, context.sessionId, errands, context) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`${name} failed`, { error });
      return { toolName: name, success: false, error };
    }
  };
}

function requireArg(args: Record<string, unknown>, key: string): string {
  const value = getRequiredStringArg(args, key);
  if (!value) throw new Error(`Missing required parameter: ${key}`);
  return value;
}

function choose(errands: readonly ErrandRecord[], args: Record<string, unknown>, matches: (errand: ErrandRecord) => boolean, what: string): ErrandRecord {
  const picked = pickErrand(errands, getOptionalStringArg(args, 'errandId') || null, matches, what);
  if ('error' in picked) throw new Error(picked.error);
  return picked.errand;
}

/** WhatsApp numbers are stored as bare digits so replies match the errand; JIDs and Telegram ids pass through. */
export function normalizeContact(channel: string, contact: string): string {
  return channel === 'whatsapp' && !contact.includes('@') ? contact.replace(/\D/g, '') : contact;
}

export const startErrand = withErrands(TOOL_NAMES.start, async (args, sessionId, errands, context) => {
  const goal = requireArg(args, 'goal');
  const contact = requireArg(args, 'contact');
  const explicit = getOptionalStringArg(args, 'channel')?.toLowerCase();
  if (explicit && !isAllowedValue(explicit, CHANNEL_TYPES)) {
    throw new Error(`Unknown channel "${explicit}". Must be one of: ${CHANNEL_TYPES.join(', ')}.`);
  }
  const current = context.channel ?? '';
  const channel = explicit || (isAllowedValue(current, CHANNEL_TYPES) ? current : null);
  if (!channel) throw new Error('Missing parameter: channel. Ask the human whether to reach the contact on WhatsApp or Telegram.');
  const peerId = normalizeContact(channel, contact);
  if (!peerId) throw new Error(`"${contact}" is not a valid ${channel} contact.`);

  const { errand, openingMessage } = await errands.start({ goal, channel, peerId, originSessionId: sessionId });
  if (errand.state === 'queued') {
    return `Errand ${errand.id} is queued: another errand with ${peerId} is still running, so it starts once that one closes. Its draft opener is: "${openingMessage}"`;
  }
  return `Errand ${errand.id} staged; nothing has been sent yet. Show the human this draft opener exactly and ask whether to send it. Do not call ${TOOL_NAMES.approve} until they agree in a later message: "${openingMessage}"`;
});

export const approveErrand = withErrands(TOOL_NAMES.approve, async (args, sessionId, errands) => {
  const errand = choose(errands.listForSession(sessionId), args, (item) => item.deliveryIncomplete || item.state === 'draft', 'ready to send');
  const updated = errand.deliveryIncomplete ? await errands.retry(errand.id) : await errands.approve(errand.id);
  if (updated.deliveryIncomplete) {
    return `Errand "${errand.goal}": the message still did not reach every contact (${updated.deliveryError ?? 'delivery pending'}). It can be retried later.`;
  }
  if (errand.state === 'draft') {
    return `Errand "${errand.goal}": the Negotiator sent the opener to the contact. Reply with exactly this line and nothing else — untranslated, with the URL as plain text: ${FOLLOW_TEXT}${errands.followUrl()}`;
  }
  return `Errand "${errand.goal}": message sent to the contact. Status: ${status(updated)}.`;
});

export const answerErrand = withErrands(TOOL_NAMES.answer, async (args, sessionId, errands) => {
  const answer = requireArg(args, 'answer');
  const errand = choose(errands.listForSession(sessionId), args, (item) => ANSWERABLE.includes(item.state), 'waiting on the human\'s answer');
  if (errand.deliveryIncomplete) {
    throw new Error(`Errand "${errand.goal}" still has a message that did not reach every contact. Call ${TOOL_NAMES.approve} to retry it before answering.`);
  }
  const { errand: updated, reply } = await errands.answer(errand.id, answer);
  return `Errand "${errand.goal}": the Negotiator sent the contact "${reply}". Status: ${status(updated)}.`;
});

export const resolveErrand = withErrands(TOOL_NAMES.resolve, async (args, sessionId, errands) => {
  const errand = choose(errands.listForSession(sessionId), args, (item) => item.state === 'awaiting_confirmation', 'waiting for the human to confirm its result');
  const updated = await errands.confirm(errand.id);
  return `Errand "${errand.goal}": the Negotiator sent its closing message to the contact. Status: ${status(updated)}.`;
});

export const listErrands = withErrands(TOOL_NAMES.list, async (_args, sessionId, errands) => {
  const all = errands.listForSession(sessionId);
  return all.length ? all.map(describe).join('\n') : 'No errands were started from this chat.';
});

export const closeErrand = withErrands(TOOL_NAMES.close, async (args, sessionId, errands) => {
  const errand = choose(errands.listForSession(sessionId), args, (item) => !CLOSED_STATES.includes(item.state), 'still open');
  const updated = await errands.close(errand.id, getRequiredStringArg(args, 'result') ?? 'Closed by the principal.');
  return `Errand "${errand.goal}" is now ${status(updated)}.`;
});

export const cancelErrand = withErrands(TOOL_NAMES.cancel, async (args, sessionId, errands) => {
  const errand = choose(errands.listForSession(sessionId), args, (item) => !CLOSED_STATES.includes(item.state), 'still open');
  const updated = await errands.cancel(errand.id);
  return `Errand "${errand.goal}" is now ${status(updated)}.`;
});

const ERRAND_ID = {
  type: 'string',
  description: 'Errand id. Omit it when only one errand in this chat fits; the tool reports the candidates when several do.',
} as const;

export function create(context: ToolPluginContext): Plugin {
  return {
    name: 'errands',
    setup(registry) {
      const enabled = (opts: { trusted: boolean }) => opts.trusted && context.pluginEnablement.isEnabled('errands');
      const handler = (run: ErrandHandler) => (logger: ILogger, args: Record<string, unknown>, execContext?: ToolExecutionContext) => run(logger, args, execContext, context.errands);
      const tools = [
        defineTool({
          name: TOOL_NAMES.start,
          description:
            'Start an errand: the Negotiator talks to a contact on WhatsApp or Telegram on the human\'s behalf until the goal is done ' +
            '(book, ask, confirm, negotiate…). Stages a draft opener only — nothing is sent until the human approves it with ' +
            `${TOOL_NAMES.approve}. After calling, show the draft to the human and ask whether to send it.`,
          parameters: {
            goal: { type: 'string', required: true, description: 'What the errand must achieve, with every constraint the human gave (dates, limits, preferences), in the human\'s language.' },
            contact: { type: 'string', required: true, description: 'Who to talk to: a WhatsApp phone number with country code (e.g. "5511999998888") or JID, or a Telegram chat id.' },
            channel: { type: 'string', enum: [...CHANNEL_TYPES], description: 'Channel to reach the contact on. Optional when chatting from WhatsApp or Telegram (the same channel is used); required otherwise.' },
          },
          handler: handler(startErrand),
          enabled,
        }),
        defineTool({
          name: TOOL_NAMES.approve,
          description:
            'Send an errand\'s staged message to the contact: the draft opener the human just approved ("send it", "yes", "sim", "ok"), ' +
            `or a message whose delivery did not finish. Never call it in the same turn as ${TOOL_NAMES.start}.`,
          parameters: { errandId: ERRAND_ID },
          handler: handler(approveErrand),
          enabled,
        }),
        defineTool({
          name: TOOL_NAMES.answer,
          description:
            'Answer a question an errand escalated to the human — even a short "yes", "no" or "sim" — or pass on something more an errand ' +
            'with a proposed result still needs. Pass their answer as written; the Negotiator turns it into the reply to the contact and carries on.',
          parameters: {
            answer: { type: 'string', required: true, description: 'The human\'s answer, as written.' },
            errandId: ERRAND_ID,
          },
          handler: handler(answerErrand),
          enabled,
        }),
        defineTool({
          name: TOOL_NAMES.resolve,
          description:
            'Confirm the result of an errand whose goal looks achieved and is waiting for the human\'s confirmation ("pode fechar", "ok", "yes"). ' +
            `Sends the Negotiator's closing message to the contact and resolves the errand. If the human wants something more instead, call ${TOOL_NAMES.answer}.`,
          parameters: { errandId: ERRAND_ID },
          handler: handler(resolveErrand),
          enabled,
        }),
        defineTool({
          name: TOOL_NAMES.list,
          description: 'List the errands started from this chat with their status, pending question or draft, notes and result.',
          handler: handler(listErrands),
          enabled,
        }),
        defineTool({
          name: TOOL_NAMES.close,
          description: 'REQUIRES CONFIRMATION. Mark an open errand as resolved — the goal was reached, or the human wants to stop and keep the outcome.',
          parameters: {
            errandId: ERRAND_ID,
            result: { type: 'string', description: 'Short outcome to record. Defaults to "Closed by the principal."' },
          },
          handler: handler(closeErrand),
          enabled,
        }),
        defineTool({
          name: TOOL_NAMES.cancel,
          description: 'REQUIRES CONFIRMATION. Cancel an open errand; the Negotiator stops replying to the contact.',
          parameters: { errandId: ERRAND_ID },
          handler: handler(cancelErrand),
          enabled,
        }),
      ];
      for (const tool of tools) registry.extend(COMMANDS, tool);
    },
  };
}
