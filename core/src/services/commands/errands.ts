import { DatabaseServiceFactory, IDatabaseService } from '../../infrastructure/db-sqlite';
import { LoggerFactory } from '../../infrastructure/logger';
import { ISessionManager, SessionManager } from '../session-manager';
import type { ILogger } from '../../infrastructure/logger';
import { buildErrandService, IErrandService } from '../errands';
import { startErrand } from '../errands/start';
import { ErrandRepositoryFactory } from '../../repositories/errand';
import { CHANNEL_TYPES } from '../../entities/channel';
import { formatCommandResult } from './format';
import type { CommandContext, CommandResult } from '../../types/commands';
import type { Errand } from '../../entities/errand';

interface CreateArgs {
  goal: string;
  peerId: string;
  channel: string;
}

// "<goal> with <peer> on <channel>": goal may contain spaces (and the word
// "with"), so the keywords anchor on the last four tokens. Tokenized instead
// of a single regex to avoid polynomial backtracking on user input.
function parseCreateArgs(rest: string): CreateArgs | null {
  // Captured separators keep the goal's original spacing: [tok, sep, tok, ...]
  const parts = rest.trim().split(/(\s+)/);
  // goal + "with" + peer + "on" + channel, each followed by a separator
  if (parts.length < 9) return null;
  const n = parts.length;
  const [withKeyword, peerId, onKeyword, channel] = [parts[n - 7], parts[n - 5], parts[n - 3], parts[n - 1]];
  if (withKeyword.toLowerCase() !== 'with' || onKeyword.toLowerCase() !== 'on') return null;
  return { goal: parts.slice(0, n - 8).join(''), peerId, channel };
}

interface ResolvedErrands {
  db: IDatabaseService;
  errandService: IErrandService;
  sessionManager: ISessionManager;
  logger: ILogger;
}

function resolveErrandService(logger = LoggerFactory.create()): ResolvedErrands | null {
  const db = DatabaseServiceFactory.create();
  const sessionManager = new SessionManager(db);
  const errandService = buildErrandService(logger, db, sessionManager);
  return errandService ? { db, errandService, sessionManager, logger } : null;
}

function formatErrand(errand: Errand, db: IDatabaseService): string {
  const targets = ErrandRepositoryFactory.create(db).findTargets(errand.id);
  const lines = [
    `[${errand.id}] ${errand.state} — ${errand.goal}`,
    `  targets: ${targets.length}`,
  ];
  if (errand.notes) lines.push(`  notes: ${errand.notes}`);
  if (errand.result) lines.push(`  result: ${errand.result}`);
  if (errand.pendingDelivery) {
    const sent = errand.pendingDelivery.targets.filter((target) => target.sentAt).length;
    lines.push(`  delivery: ${sent}/${errand.pendingDelivery.targets.length} sent`,
      `  ${errand.pendingDelivery.error ?? 'Delivery pending'}. Retry with /errand retry ${errand.id}`);
  }
  return lines.join('\n');
}

function listErrands(context: CommandContext): CommandResult {
  const resolved = resolveErrandService();
  if (!resolved) {
    return formatCommandResult('Errands are not available: no channel manager is running.', context.source);
  }

  const { db, errandService } = resolved;
  const errands = context.sessionId
    ? errandService.listByOrigin(context.sessionId)
    : errandService.listAll();

  if (errands.length === 0) {
    return formatCommandResult('No errands yet. Usage: /errand <goal> with <contact> on <channel>', context.source);
  }

  return formatCommandResult(errands.map((errand) => formatErrand(errand, db)).join('\n\n'), context.source);
}

async function createErrand(rest: string, context: CommandContext): Promise<CommandResult> {
  const args = parseCreateArgs(rest);
  if (!args) {
    return formatCommandResult('Usage: /errand <goal> with <contact> on <channel>', context.source);
  }

  const { goal, peerId, channel } = args;
  if (!(CHANNEL_TYPES as readonly string[]).includes(channel.toLowerCase())) {
    return formatCommandResult(`Unknown channel "${channel}". Must be one of: ${CHANNEL_TYPES.join(', ')}.`, context.source);
  }

  if (!context.sessionId) {
    return formatCommandResult('Cannot start an errand: no session to attribute it to.', context.source);
  }

  const resolved = resolveErrandService();
  if (!resolved) {
    return formatCommandResult('Errands are not available: no channel manager is running.', context.source);
  }

  const target = { channel: channel.toLowerCase(), peerId };

  try {
    const { errand, openingMessage } = await startErrand(resolved.logger, resolved.db, resolved.sessionManager, resolved.errandService, {
      goal,
      ...target,
      originSessionId: context.sessionId,
    });
    const staged = errand.state === 'draft'
      ? `Draft message to ${target.peerId}:\n"${openingMessage}"\n\nApprove with \`/errand approve ${errand.id}\` to send it.`
      : `Queued behind an existing errand with that contact — it will start once the other one closes.`;
    return formatCommandResult(`Errand [${errand.id}] created: "${errand.goal}".\n${staged}`, context.source);
  } catch (err) {
    return formatCommandResult(err instanceof Error ? err.message : String(err), context.source);
  }
}

async function runAction(
  context: CommandContext,
  id: string,
  verb: string,
  apply: (errandService: IErrandService, id: string) => Errand | Promise<Errand>,
): Promise<CommandResult> {
  if (!id) {
    return formatCommandResult(`Usage: /errand ${verb} <id>`, context.source);
  }

  const resolved = resolveErrandService();
  if (!resolved) {
    return formatCommandResult('Errands are not available: no channel manager is running.', context.source);
  }

  try {
    const errand = await apply(resolved.errandService, id);
    return formatCommandResult(`Errand [${errand.id}] is now "${errand.state}".`, context.source);
  } catch (err) {
    return formatCommandResult(err instanceof Error ? err.message : String(err), context.source);
  }
}

/**
 * `/errand` — delegated-conversation management, trusted senders only:
 * - `/errand` — list errands originating from this session
 * - `/errand <goal> with <contact> on <channel>` — create one (staged as a draft)
 * - `/errand approve <id>` — send the staged opener
 * - `/errand resolve <id>` — confirm a proposed result: send the closing message and resolve
 * - `/errand close <id>` — mark it resolved
 * - `/errand cancel <id>` — cancel it
 */
export async function handleErrandCommand(command: string, context: CommandContext): Promise<CommandResult> {
  if (!context.trusted) {
    return formatCommandResult('Only trusted senders can manage errands.', context.source);
  }

  const rest = command.trim().replace(/^\/errand\b/i, '').trim();

  if (!rest) {
    return listErrands(context);
  }

  const [subRaw, ...restParts] = rest.split(/\s+/);
  const sub = subRaw.toLowerCase();
  const arg = restParts.join(' ').trim();

  if (sub === 'approve') {
    return runAction(context, arg, 'approve', (svc, id) => svc.approve(id));
  }
  if (sub === 'retry') {
    return runAction(context, arg, 'retry', (svc, id) => svc.retryDelivery(id));
  }
  if (sub === 'reply' || sub === 'answer') {
    const [id, ...ansParts] = arg.split(/\s+/);
    const answerText = ansParts.join(' ').trim();
    if (!id || !answerText) {
      return formatCommandResult(`Usage: /errand ${sub} <id> <your message/answer>`, context.source);
    }
    const resolved = resolveErrandService();
    if (!resolved) {
      return formatCommandResult('Errands are not available: no channel manager is running.', context.source);
    }
    try {
      const result = await resolved.errandService.resumeWithPrincipalAnswer(id, answerText);
      return formatCommandResult(`Errand [${id}] resumed: sent "${result.reply}" to the contact. Status is now "waiting on them".`, context.source);
    } catch (err) {
      return formatCommandResult(err instanceof Error ? err.message : String(err), context.source);
    }
  }
  if (sub === 'resolve') {
    return runAction(context, arg, 'resolve', (svc, id) => svc.confirmResolution(id));
  }
  if (sub === 'close') {
    return runAction(context, arg, 'close', (svc, id) => svc.resolve(id, 'Closed by the principal.'));
  }
  if (sub === 'cancel') {
    return runAction(context, arg, 'cancel', (svc, id) => svc.cancel(id));
  }

  return createErrand(rest, context);
}
