import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServiceFactory, type IDatabaseService } from '../../src/infrastructure/db-sqlite';
import { SessionManager } from '../../src/services/session-manager';
import { SessionContextFactory } from '../../src/services/agents/session-context';
import { MessageGateway } from '../../src/services/agents/message-gateway';
import { ErrandServiceFactory } from '../../src/services/errands';
import { OutboundMessageServiceFactory } from '../../src/services/outbound/message-service';
import { MessageRepositoryFactory } from '../../src/repositories/message';
import { ErrandRepositoryFactory } from '../../src/repositories/errand';
import { PromptRepository } from '../../src/repositories/prompt';
import { Negotiator, NegotiatorFactory } from '../../src/services/agents/sub-agents/negotiator/sub-agent';
import { ChannelsSingleton } from '../../src/channels';
import type { AIChatRequest } from '../../src/types/chat';
import type { ILogger } from '../../src/infrastructure/logger';
import { applyTestConfigDefaults } from '../helpers/test-config';
import { Message } from '../../src/entities/message';
import { SessionRepositoryFactory } from '../../src/repositories/session';
import { THIRD_PARTY_CONVERSATION_CONTEXT } from '../../src/constants';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('errand negotiation across contact and parent sessions', () => {
  let db: IDatabaseService | undefined;
  let tempDir: string | undefined;
  afterEach(async () => {
    // Let mocked outbound delivery settle its status writes before closing.
    await Promise.resolve();
    db?.close();
    db = undefined;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it('creates distinct children, keeps the parent open, and reloads their instructions and routing after restart', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'koris-errand-sessions-'));
    const filepath = join(tempDir, 'test.db');
    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    const logger: ILogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const channels = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(ChannelsSingleton, 'getExistingInstance').mockReturnValue(channels as never);
    const manager = new SessionManager(db);
    const parent = manager.getSessionService({ channel: 'web', peerId: 'web' }).getSession();
    const oldContact = manager.getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'delegated' }).getSession();
    const messageRepo = MessageRepositoryFactory.create(db);
    messageRepo.save(new Message({ sessionId: oldContact.id, role: 'assistant', content: 'Unrelated previous errand' }));
    const service = ErrandServiceFactory.create(logger, db, manager, OutboundMessageServiceFactory.create(logger, channels as never, db, manager));
    const first = service.create('Book a haircut', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'First opener');
    const second = service.create('Ask about parking', [{ channel: 'whatsapp', peerId: '555@s.whatsapp.net' }], parent.id, 'Second opener');
    const errandRepo = ErrandRepositoryFactory.create(db);
    const [firstId] = errandRepo.findTargets(first.id);
    const [secondId] = errandRepo.findTargets(second.id);
    expect(new Set([parent.id, oldContact.id, firstId, secondId]).size).toBe(4);
    expect(second.state).toBe('queued');
    for (const [id, errand] of [[firstId, first], [secondId, second]] as const) {
      const child = SessionRepositoryFactory.create(db).findById(id)!;
      expect(child.endedAt).toBeFalsy();
      expect(child.metadata).toEqual({ parentSessionId: parent.id, errandId: errand.id, instructions: THIRD_PARTY_CONVERSATION_CONTEXT });
      expect(child.metadata.instructions).toContain('Speaking To Someone Else On The Human');
    }
    expect(SessionRepositoryFactory.create(db).findById(parent.id)?.endedAt).toBeFalsy();
    expect(manager.getSessionService({ channel: 'web', peerId: 'web' }).getSession().id).toBe(parent.id);

    await service.approve(first.id);
    expect(messageRepo.getBySessionId(firstId).map((m) => m.content)).toEqual(['First opener']);
    expect(messageRepo.getBySessionId(secondId)).toEqual([]);
    expect(messageRepo.getBySessionId(oldContact.id).map((m) => m.content)).toEqual(['Unrelated previous errand']);
    expect(service.findActiveForPeer('whatsapp', '555@s.whatsapp.net')?.sessionId).toBe(firstId);

    // A persisted version marker proves the reopened negotiator reads the
    // session's instructions rather than only injecting the source constant.
    const savedInstructions = `${THIRD_PARTY_CONVERSATION_CONTEXT}\nSession-specific negotiation context.`;
    const firstSession = SessionRepositoryFactory.create(db).findById(firstId)!;
    SessionRepositoryFactory.create(db).update(firstId, { metadata: { ...firstSession.metadata, instructions: savedInstructions } });
    await Promise.resolve();
    db.close();
    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    const restartedManager = new SessionManager(db);
    const restarted = ErrandServiceFactory.create(logger, db, restartedManager, OutboundMessageServiceFactory.create(logger, channels as never, db, restartedManager));
    expect(restarted.findActiveForPeer('whatsapp', '555')?.sessionId).toBe(firstId);
    const prompts = { build: vi.fn().mockResolvedValue({ messages: [] }) };
    const completion = { complete: vi.fn().mockResolvedValue({ kind: 'message', text: '{"action":"continue","reply":"Which hours are available?"}' }) };
    const negotiator = new Negotiator(logger, db, restartedManager, completion as never, prompts);
    await negotiator.run({ errandId: first.id, sessionId: firstId, channel: 'whatsapp', peerMessage: 'Another time?', messageHistory: MessageRepositoryFactory.create(db).getBySessionId(firstId) });
    expect(prompts.build.mock.calls[0][0].extraSystemBlocks[0]).toBe(savedInstructions);
    await negotiator.composeResume({ errandId: first.id, sessionId: firstId, channel: 'whatsapp', goal: first.goal, answer: '11 please', messageHistory: [] });
    expect(prompts.build.mock.calls[1][0].extraSystemBlocks[0]).toBe(savedInstructions);

    restarted.resolve(first.id, 'Booked');
    expect(restarted.get(second.id)?.state).toBe('draft');
    await restarted.approve(second.id);
    expect(restarted.findActiveForPeer('whatsapp', '555')?.sessionId).toBe(secondId);
    expect(MessageRepositoryFactory.create(db).getBySessionId(secondId).map((m) => m.content)).toEqual(['Second opener']);
    expect(SessionRepositoryFactory.create(db).findById(parent.id)?.endedAt).toBeFalsy();
  });

  it('keeps the opener and follow-ups together, negotiates alternatives, and resumes only after parent approval', async () => {
    db = DatabaseServiceFactory.create({ filepath: ':memory:', verbose: false });
    const logger: ILogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sessions = new SessionManager(db);
    const parent = sessions.getSessionService({ channel: 'web', peerId: 'web' }).getSession();
    const channels = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(ChannelsSingleton, 'getExistingInstance').mockReturnValue(channels as never);
    const outbound = OutboundMessageServiceFactory.create(logger, channels as never, db, sessions);
    const errands = ErrandServiceFactory.create(logger, db, sessions, outbound);
    const messages = MessageRepositoryFactory.create(db);
    const goal = 'Book a haircut on Saturday at 10am; ask me before accepting another hour.';
    const opener = 'Hello! Could I book a haircut for Saturday at 10am on behalf of Alex?';
    const alternativeQuestion = 'What other hours are available on Saturday?';
    const clarification = 'Are those both on Saturday, and what is the price?';
    const approvalQuestion = 'Saturday at 10 is unavailable. They offered 11 or 14 for $25. Which hour works for you?';

    const requests: AIChatRequest[] = [];
    const responses = [
      opener,
      JSON.stringify({ action: 'continue', reply: alternativeQuestion, notes: 'Saturday 10 unavailable; need other hours. Principal must approve changes.' }),
      JSON.stringify({ action: 'continue', reply: clarification, notes: '10 rejected; contact offered 11 or 14. Need day and price, then principal approval.' }),
      JSON.stringify({ action: 'escalate', reply: 'I will check which time works and get back to you.', notes: 'Saturday 11 or 14 for $25; waiting for principal to choose.', detail: approvalQuestion }),
      'Alex approved Saturday at 11 for $25. Could you confirm that booking?',
      JSON.stringify({ action: 'resolved', reply: 'Thank you, see you then!', notes: 'Principal approved 11; contact confirmed booking.', detail: 'Haircut confirmed Saturday at 11 for $25.' }),
      JSON.stringify({ action: 'continue', reply: 'Just the haircut, thanks.', notes: 'Principal approved 11; contact confirmed booking. Waiting for principal confirmation.' }),
    ];
    const completion = {
      complete: vi.fn(async (request: AIChatRequest) => {
        requests.push(request);
        const text = responses.shift();
        if (!text) throw new Error('Unexpected extra LLM call');
        return { kind: 'message' as const, text, finishReason: 'stop' as const };
      }),
    };
    const prompts = new PromptRepository(
      { get: () => 'Unrelated personal context' },
      { getAll: () => [] } as never,
      { getRecent: () => [] } as never,
      { getRecent: () => [] } as never,
      { getAll: () => [], search: () => [] } as never,
      {} as never, logger,
    );
    const negotiator = new Negotiator(logger, db, sessions, completion as never, prompts);
    vi.spyOn(NegotiatorFactory, 'create').mockReturnValue(negotiator);
    const mainAgent = { run: vi.fn() };
    const gateway = new MessageGateway(
      logger, 'whatsapp', db, sessions, SessionContextFactory.create(logger, db, sessions),
      { persistConversation: vi.fn() } as never,
      mainAgent as never, { record: vi.fn() } as never, {} as never, negotiator,
    );

    const draft = await negotiator.composeOpener({ goal, channel: 'whatsapp', peerId: '555', originSessionId: parent.id });
    const errand = errands.create(goal, [{ channel: 'whatsapp', peerId: '555' }], parent.id, draft);
    await errands.approve(errand.id);
    const [delegatedId] = ErrandRepositoryFactory.create(db).findTargets(errand.id);
    expect(channels.sendMessage).toHaveBeenCalledWith('whatsapp', '555', opener);
    expect(messages.getBySessionId(delegatedId).map((m) => m.content)).toEqual([opener]);

    // The contact's inbound address differs from the bare address used to start
    // the errand. The gateway must reuse the matched session, not make a new one.
    const peer = (text: string) => gateway.handle(text, '555@s.whatsapp.net', { isTrustedSender: false });
    expect(await peer('10 is unavailable. Could you do another hour?')).toBe(alternativeQuestion);
    expect(requests[1].messages.map((m) => m.content)).toContain(opener);
    const followupPolicy = requests[1].messages[0].content;
    expect(followupPolicy).toContain(goal);
    expect(followupPolicy).toContain('Current Negotiation Turn');
    expect(followupPolicy).not.toContain('Errand Opening Message');
    expect(followupPolicy).not.toContain('Do not suggest topics or alternatives');
    expect(followupPolicy).not.toContain('Unrelated personal context');
    expect(errands.get(errand.id)?.state).toBe('awaiting_peer');

    expect(await peer('11 or 14.')).toBe(clarification);
    expect(requests[2].messages.map((m) => m.content)).toContain(alternativeQuestion);
    expect(requests[2].messages[0].content).toContain('Saturday 10 unavailable');
    await peer('Yes, both on Saturday, $25.');
    expect(requests[3].messages.map((m) => m.content)).toContain(clarification);
    expect(errands.get(errand.id)?.state).toBe('awaiting_principal');
    expect(errands.get(errand.id)?.pendingMessage).toBe(approvalQuestion);
    expect(messages.getBySessionId(parent.id)).toEqual([]);
    const negotiation = SessionRepositoryFactory.create(db).findLatestOpen({ channel: 'negotiator', peerId: errand.id, kind: 'user' });
    const parentNotices = messages.getBySessionId(negotiation!.id);
    expect(parentNotices).toHaveLength(1);
    expect(parentNotices[0].content).toContain(approvalQuestion);
    expect(parentNotices[0].content).not.toContain('/errand reply');

    const callsBeforePause = completion.complete.mock.calls.length;
    expect(await peer('14 is now taken, but 11 is still free.')).toBe('');
    expect(completion.complete).toHaveBeenCalledTimes(callsBeforePause);
    expect(errands.get(errand.id)?.state).toBe('awaiting_principal');
    expect(messages.getBySessionId(delegatedId).some((m) => m.content.includes('14 is now taken'))).toBe(true);

    await errands.resumeWithPrincipalAnswer(errand.id, '11 works for me; please book it.');
    expect(requests[4].messages[0].content).toContain(approvalQuestion);
    expect(requests[4].messages[0].content).toContain('11 works for me; please book it.');
    expect(requests[4].messages.map((m) => m.content)).toContain('14 is now taken, but 11 is still free.');
    expect(errands.get(errand.id)?.pendingMessage).toBeUndefined();
    expect(errands.get(errand.id)?.state).toBe('awaiting_peer');

    // The goal looks achieved: the thank-you is held until the principal confirms.
    expect(await peer('Confirmed for Saturday at 11, $25.')).toBe('');
    expect(channels.sendMessage).not.toHaveBeenCalledWith('whatsapp', '555', 'Thank you, see you then!');
    expect(errands.get(errand.id)).toMatchObject({
      state: 'awaiting_confirmation', pendingMessage: 'Haircut confirmed Saturday at 11 for $25.', closingReply: 'Thank you, see you then!',
    });
    expect(requests[5].messages[0].content).toContain('Principal answer: "11 works for me; please book it."');
    expect(requests[5].messages.map((m) => m.content)).toContain('Alex approved Saturday at 11 for $25. Could you confirm that booking?');
    expect(messages.getBySessionId(negotiation!.id).at(-1)?.content).toBe('🏁 Errand "' + goal + '" looks done: Haircut confirmed Saturday at 11 for $25.');

    // The contact writes while confirmation is pending: the Negotiator still replies, and it keeps waiting.
    expect(await peer('Anything else you need?')).toBe('Just the haircut, thanks.');
    expect(requests[6].messages[0].content).toContain('awaiting_confirmation');
    expect(errands.get(errand.id)?.state).toBe('awaiting_confirmation');

    // The principal confirms: the held thank-you goes out first, then the errand resolves.
    let finishDelivery!: () => void;
    const deliveryStarted = new Promise<void>((started) => {
      channels.sendMessage.mockImplementationOnce(() => {
        started();
        return new Promise<void>((resolve) => { finishDelivery = resolve; });
      });
    });
    const confirmation = errands.confirmResolution(errand.id);
    await deliveryStarted;
    expect(channels.sendMessage).toHaveBeenLastCalledWith('whatsapp', '555', 'Thank you, see you then!');
    expect(errands.get(errand.id)?.state).toBe('awaiting_confirmation');
    finishDelivery();
    expect(await confirmation).toMatchObject({ state: 'resolved', result: 'Haircut confirmed Saturday at 11 for $25.', closingReply: undefined });
    expect(messages.getBySessionId(delegatedId).filter((m) => m.content === 'Thank you, see you then!')).toHaveLength(1);
    expect(messages.getBySessionId(negotiation!.id).map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'assistant']);
    expect(messages.getBySessionId(negotiation!.id).at(-1)?.content).toContain('resolved: Haircut confirmed Saturday at 11');
    expect(messages.getBySessionId(parent.id)).toEqual([]);
    expect(db.get<{ total: number }>("SELECT COUNT(*) AS total FROM sessions WHERE kind = 'delegated'")?.total).toBe(1);
    expect(mainAgent.run).not.toHaveBeenCalled();
    expect(responses).toHaveLength(0);
  });

  it('preserves the configured negotiation history through the real prompt builder beyond 20 messages', async () => {
    applyTestConfigDefaults({ errandsHistoryLimit: 60 });
    const prompts = new PromptRepository(
      { get: () => '' }, { getAll: () => [] } as never,
      { getRecent: () => [] } as never, { getRecent: () => [] } as never,
      { getAll: () => [] } as never, {} as never,
      { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );
    const history = Array.from({ length: 65 }, (_, i) => ({ role: 'assistant' as const, content: `turn ${i}` }));
    const payload = await prompts.build({
      userMessage: 'latest counteroffer', channel: 'whatsapp', messageHistory: history,
      historyLimit: 60, toolsEnabled: false, learnedSkillsEnabled: false, includeMemory: false,
    });
    expect(payload.messages).toHaveLength(62);
    expect(payload.messages[1].content).toBe('turn 5');
    expect(payload.messages[payload.messages.length - 1].content).toBe('latest counteroffer');
  });

  it('keeps rapid negotiation messages in insertion order when timestamps are identical', () => {
    db = DatabaseServiceFactory.create({ filepath: ':memory:', verbose: false });
    const sessions = new SessionManager(db);
    const session = sessions.getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'delegated' }).getSession();
    const repository = MessageRepositoryFactory.create(db);
    for (const [index, content] of ['Can you do 10?', 'No, 11 instead.', 'Let me check 11.'].entries()) {
      repository.save(new Message({ sessionId: session.id, role: index === 1 ? 'user' : 'assistant', content, createdAt: '2026-09-12T12:00:00.000Z' }));
    }
    expect(repository.getBySessionId(session.id, 2).map((message) => message.content)).toEqual(['No, 11 instead.', 'Let me check 11.']);
  });
});
