import type { IDatabaseService } from '../../infrastructure/db-sqlite';
import type { ILogger } from '../../infrastructure/logger';
import type { Errand } from '../../entities/errand';
import type { ISessionManager } from '../session-manager';
import type { IErrandService } from './index';
import { NegotiatorFactory } from '../agents/sub-agents/negotiator/sub-agent';

export interface StartErrandInput {
  goal: string;
  channel: string;
  peerId: string;
  originSessionId: string;
}

/**
 * Has the Negotiator draft the opening message, then stages the errand as a
 * draft (or queued, when that contact is already busy). Nothing is sent until
 * the errand is approved. Shared by the `/errand` command and the errand tools.
 */
export async function startErrand(
  logger: ILogger,
  db: IDatabaseService,
  sessionManager: ISessionManager,
  errandService: IErrandService,
  input: StartErrandInput,
): Promise<{ errand: Errand; openingMessage: string }> {
  const goal = input.goal.trim();
  const negotiator = NegotiatorFactory.create(logger, db, sessionManager);
  const openingMessage = await negotiator.composeOpener({
    goal,
    channel: input.channel,
    peerId: input.peerId,
    originSessionId: input.originSessionId,
  });
  const errand = errandService.create(goal, [{ channel: input.channel, peerId: input.peerId }], input.originSessionId, openingMessage);
  return { errand, openingMessage };
}
