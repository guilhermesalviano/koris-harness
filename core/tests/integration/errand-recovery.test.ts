import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseServiceFactory, type IDatabaseService } from '../../src/infrastructure/db-sqlite';
import { SessionManager } from '../../src/services/session-manager';
import { SessionRepositoryFactory } from '../../src/repositories/session';
import { ErrandRepositoryFactory } from '../../src/repositories/errand';
import { MessageRepositoryFactory } from '../../src/repositories/message';
import { MessageServiceFactory } from '../../src/services/message-service';
import { ErrandServiceFactory } from '../../src/services/errands';
import { OutboundMessageServiceFactory } from '../../src/services/outbound/message-service';
import { Negotiator, NegotiatorFactory } from '../../src/services/agents/sub-agents/negotiator/sub-agent';
import { MessageGateway } from '../../src/services/agents/message-gateway';
import { SessionContextFactory } from '../../src/services/agents/session-context';
import { ChannelHandler, ChannelsSingleton } from '../../src/channels';
import { applyTestConfigDefaults } from '../helpers/test-config';
import { AdminRouterFactory } from '../../src/dashboard/admin';

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('errand recovery and privacy', () => {
  let db: IDatabaseService;
  let directory: string | undefined;

  afterEach(async () => {
    await Promise.resolve();
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
    vi.restoreAllMocks();
  });

  function setup(filepath = ':memory:') {
    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    const manager = new SessionManager(db);
    const channels = { sendMessage: vi.fn(async (_channel: string, _peer: string, _content: string) => {}) };
    vi.spyOn(ChannelsSingleton, 'getExistingInstance').mockReturnValue(channels as never);
    const service = ErrandServiceFactory.create(logger, db, manager,
      OutboundMessageServiceFactory.create(logger, channels as never, db, manager));
    const parent = manager.getSessionService({ channel: 'web', peerId: 'web' }).getSession();
    return { manager, channels, service, parent,
      errands: ErrandRepositoryFactory.create(db), messages: MessageRepositoryFactory.create(db) };
  }

  function messagesIn(sessionId: string): number {
    return MessageRepositoryFactory.create(db).getBySessionId(sessionId, 100).length;
  }

  function gateway(manager: SessionManager, text: string) {
    const completion = { complete: vi.fn().mockResolvedValue({ kind: 'message', text }) };
    const prompts = { build: vi.fn().mockResolvedValue({ messages: [] }) };
    const negotiator = new Negotiator(logger, db, manager, completion as never, prompts);
    const mainAgent = { run: vi.fn() };
    const result = new MessageGateway(logger, 'whatsapp', db, manager,
      SessionContextFactory.create(logger, db, manager), { persistConversation: vi.fn(), summarizeConversation: vi.fn() } as never,
      mainAgent as never, { record: vi.fn() } as never, {} as never, negotiator);
    return { gateway: result, completion, prompts, mainAgent };
  }

  it('keeps private principal instructions local when resume composition fails', async () => {
    const { manager, service, parent, channels } = setup();
    const errand = service.create('Negotiate a price', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'What is the price?');
    await service.approve(errand.id);
    service.escalate(errand.id, 'What should I offer?');
    channels.sendMessage.mockClear();
    const negotiator = new Negotiator(logger, db, manager,
      { complete: vi.fn().mockRejectedValue(new Error('provider unavailable')) } as never,
      { build: vi.fn().mockResolvedValue({ messages: [] }) });
    vi.spyOn(NegotiatorFactory, 'create').mockReturnValue(negotiator);
    await expect(service.resumeWithPrincipalAnswer(errand.id, 'Offer 80; private ceiling 100, do not reveal it.'))
      .rejects.toThrow('Nothing was sent');
    expect(channels.sendMessage).not.toHaveBeenCalled();
    expect(service.get(errand.id)).toMatchObject({ state: 'awaiting_principal', pendingMessage: 'What should I offer?' });
    expect(service.get(errand.id)?.pendingDelivery).toBeUndefined();
  });

  it('persists incoming text but sends nothing for a malformed verdict, including through the channel handler', async () => {
    const { manager, service, parent, channels, messages, errands } = setup();
    const errand = service.create('Negotiate', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Hello');
    await service.approve(errand.id);
    const before = service.get(errand.id);
    const runtime = gateway(manager, '{"action":"continue","reply":"Offer 80?","notes":"Private ceiling 100"');
    const reply = { sendText: vi.fn(), sendError: vi.fn() };
    const handler = new ChannelHandler({ channel: 'whatsapp', gateway: runtime.gateway, reply });
    await handler.handle('555', { text: 'What is the budget?', isTrustedSender: false, isGroup: false, mentionsBot: false });
    expect(reply.sendText).not.toHaveBeenCalled();
    expect(reply.sendError).not.toHaveBeenCalled();
    expect(channels.sendMessage).toHaveBeenCalledTimes(1);
    expect(service.get(errand.id)).toEqual(before);
    expect(messages.getBySessionId(errands.findTargets(errand.id)[0])).toHaveLength(2);
    expect(runtime.mainAgent.run).not.toHaveBeenCalled();
  });

  it.each([undefined, { compactSummary: 'Earlier conversation' }])('keeps late notices in the negotiation session, out of the Orchestrator, after rotation with %j', (metadata) => {
    const { manager, service, parent, messages } = setup();
    const errand = service.create('Book a haircut', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Hello');
    const fresh = manager.getSessionServiceById(parent.id).forceRotate('clear', metadata);
    service.escalate(errand.id, 'Is 11 okay?');
    expect(manager.getSessionServiceById(parent.id).getSession().id).toBe(parent.id);
    expect(messages.getBySessionId(parent.id)).toEqual([]);
    expect(messages.getBySessionId(fresh.id)).toEqual([]);
    const negotiation = SessionRepositoryFactory.create(db).findLatestOpen({ channel: 'negotiator', peerId: errand.id, kind: 'user' });
    expect(negotiation?.metadata).toMatchObject({ errandId: errand.id, parentSessionId: parent.id });
    expect(messages.getBySessionId(negotiation!.id).map((message) => message.content)).toEqual([expect.stringContaining('Is 11 okay?')]);
    manager.getSessionServiceById(fresh.id);
    SessionRepositoryFactory.create(db).deleteById(fresh.id);
    manager.invalidate(fresh.id);
    expect(() => manager.getSessionServiceById(fresh.id)).toThrow('Session not found');
    expect(manager.getSessionServiceById(parent.id).getSession().id).toBe(parent.id);
  });

  it('waits for opener delivery, rejects overlapping approval, and queues contact replies behind delivery', async () => {
    const { manager, service, parent, channels, errands, messages } = setup();
    const errand = service.create('Book a haircut', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Is 10 available?');
    const started = deferred();
    const finish = deferred();
    channels.sendMessage.mockImplementationOnce(async () => { started.resolve(); await finish.promise; });
    const approval = service.approve(errand.id);
    await started.promise;
    expect(service.get(errand.id)?.state).toBe('draft');
    expect(service.findActiveForPeer('whatsapp', '555')?.errand.id).toBe(errand.id);
    const another = ErrandServiceFactory.create(logger, db, manager,
      OutboundMessageServiceFactory.create(logger, channels as never, db, manager));
    await expect(another.approve(errand.id)).rejects.toThrow('busy');
    const runtime = gateway(manager, '{"action":"continue","reply":"What other times work?"}');
    const peer = runtime.gateway.handle('10 is unavailable', '555', { isTrustedSender: false });
    await Promise.resolve();
    expect(runtime.completion.complete).not.toHaveBeenCalled();
    expect(messages.getBySessionId(errands.findTargets(errand.id)[0])).toEqual([]);
    finish.resolve();
    await approval;
    expect(await peer).toBe('What other times work?');
    expect(runtime.prompts.build.mock.calls[0][0].messageHistory[0].content).toBe('Is 10 available?');
    expect(service.get(errand.id)?.pendingDelivery).toBeUndefined();
  });

  it('retries a partially delivered opener after restart without resending to a successful target', async () => {
    directory = mkdtempSync(join(tmpdir(), 'koris-recovery-'));
    const filepath = join(directory, 'test.db');
    const { service, parent, channels, messages, errands } = setup(filepath);
    const errand = service.create('Ask for availability', [
      { channel: 'whatsapp', peerId: '555' }, { channel: 'whatsapp', peerId: '666' },
    ], parent.id, 'Are you available?');
    channels.sendMessage.mockRejectedValueOnce(new Error('offline'));
    await expect(service.approve(errand.id)).rejects.toThrow('/errand retry');
    const failedPeer = channels.sendMessage.mock.calls[0][1];
    const pending = service.get(errand.id)!;
    expect(pending.state).toBe('draft');
    expect(pending.pendingMessage).toBe('Are you available?');
    expect(pending.pendingDelivery?.targets.filter((target) => target.sentAt)).toHaveLength(1);
    expect(errands.findTargets(errand.id).flatMap((id) => messages.getBySessionId(id))).toHaveLength(1);
    db.close();
    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    const manager = new SessionManager(db);
    const restarted = ErrandServiceFactory.create(logger, db, manager,
      OutboundMessageServiceFactory.create(logger, channels as never, db, manager));
    channels.sendMessage.mockClear();
    await expect(restarted.retryDelivery(errand.id)).resolves.toMatchObject({ state: 'awaiting_peer', pendingDelivery: undefined });
    expect(channels.sendMessage).toHaveBeenCalledExactlyOnceWith('whatsapp', failedPeer, 'Are you available?');
    await expect(restarted.retryDelivery(errand.id)).rejects.toThrow('no retryable delivery');
  });

  it('retries a prepared resume without regenerating or replacing the principal answer', async () => {
    const { manager, service, parent, channels, messages, errands } = setup();
    const errand = service.create('Book a haircut', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Is 10 available?');
    await service.approve(errand.id);
    service.escalate(errand.id, 'Would 11 work?');
    const composeResume = vi.fn().mockResolvedValue('Please book 11.');
    vi.spyOn(NegotiatorFactory, 'create').mockReturnValue({ composeResume } as never);
    channels.sendMessage.mockRejectedValueOnce(new Error('offline'));
    await expect(service.resumeWithPrincipalAnswer(errand.id, '11 works')).rejects.toThrow('/errand retry');
    expect(service.get(errand.id)).toMatchObject({ state: 'awaiting_principal', pendingMessage: 'Would 11 work?' });
    expect(messages.getBySessionId(errands.findTargets(errand.id)[0]).map((message) => message.content)).toEqual(['Is 10 available?']);
    await expect(service.resumeWithPrincipalAnswer(errand.id, 'Actually 12')).rejects.toThrow('prepared message');
    const another = ErrandServiceFactory.create(logger, db, new SessionManager(db),
      OutboundMessageServiceFactory.create(logger, channels as never, db, manager));
    await another.retryDelivery(errand.id);
    expect(composeResume).toHaveBeenCalledTimes(1);
    expect(channels.sendMessage.mock.calls.slice(-2).map((call) => call[2])).toEqual(['Please book 11.', 'Please book 11.']);
    expect(service.get(errand.id)?.notes).toBe('Principal answer: "11 works"');
    expect(messages.getBySessionId(parent.id).filter((message) => message.content.includes('resumed.'))).toHaveLength(0);
  });

  it('stops further targets after cancellation during delivery and rejects terminal retries', async () => {
    const { service, parent, channels } = setup();
    const errand = service.create('Ask for availability', [
      { channel: 'whatsapp', peerId: '555' }, { channel: 'whatsapp', peerId: '666' },
    ], parent.id, 'Hello');
    channels.sendMessage.mockImplementationOnce(async () => { service.cancel(errand.id); });
    await expect(service.approve(errand.id)).rejects.toThrow('changed during delivery');
    expect(channels.sendMessage).toHaveBeenCalledTimes(1);
    expect(service.get(errand.id)).toMatchObject({ state: 'cancelled', pendingDelivery: undefined });
    await expect(service.retryDelivery(errand.id)).rejects.toThrow('no retryable delivery');
  });

  it('expires stale errands before capacity and contention checks and promotes queued work', async () => {
    applyTestConfigDefaults({ errandsMaxConcurrent: 3 });
    const { service, parent, errands } = setup();
    const first = service.create('First', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'First');
    await service.approve(first.id);
    const queued = service.create('Queued', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Second');
    errands.update(first.id, { lastProgressAt: '2020-01-01T00:00:00.000Z' });
    applyTestConfigDefaults({ errandsMaxConcurrent: 2 });
    const fresh = service.create('Other target', [{ channel: 'whatsapp', peerId: '777' }], parent.id, 'Hello');
    expect(fresh.state).toBe('draft');
    expect(errands.findById(first.id)?.state).toBe('expired');
    expect(errands.findById(queued.id)?.state).toBe('draft');
    expect(service.listAll('awaiting_peer')).toEqual([]);
  });

  it('adds the pending delivery column to an existing database without losing errands', () => {
    directory = mkdtempSync(join(tmpdir(), 'koris-delivery-migration-'));
    const filepath = join(directory, 'test.db');
    const { service, parent } = setup(filepath);
    const errand = service.create('Keep me', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Hello');
    db.exec('ALTER TABLE errands DROP COLUMN pending_delivery');
    db.close();
    for (let i = 0; i < 2; i++) {
      db = DatabaseServiceFactory.create({ filepath, verbose: false });
      expect(ErrandRepositoryFactory.create(db).findById(errand.id)?.goal).toBe('Keep me');
      expect(db.query('PRAGMA table_info(errands)').some((column) => column.name === 'pending_delivery')).toBe(true);
      if (i === 0) db.close();
    }
  });

  it('invalidates all aliases to a deleted rotated session', () => {
    const { manager, parent } = setup();
    const rotated = manager.getSessionServiceById(parent.id).forceRotate('clear');
    manager.getSessionServiceById(rotated.id);
    SessionRepositoryFactory.create(db).deleteById(rotated.id);
    manager.invalidate(rotated.id);
    const original = manager.getSessionServiceById(parent.id);
    MessageServiceFactory.create(db, original).save({ role: 'assistant', content: 'Original notice' });
    expect(original.getSession().id).toBe(parent.id);
    expect(() => manager.getSessionServiceById(rotated.id)).toThrow('Session not found');
  });

  it('opens a negotiation session on approval that collects notices and answers, sent to a WhatsApp principal and listed by the admin API', async () => {
    const { manager, service, channels, messages } = setup();
    const principal = manager.getSessionService({ channel: 'whatsapp', peerId: '999' }).getSession();
    const errand = service.create('Book a haircut', [{ channel: 'whatsapp', peerId: '555' }], principal.id, 'Is 10 available?');
    const sessions = SessionRepositoryFactory.create(db);
    const key = { channel: 'negotiator', peerId: errand.id, kind: 'user' as const };
    expect(sessions.findLatestOpen(key)).toBeNull();

    await service.approve(errand.id);
    const negotiation = sessions.findLatestOpen(key)!;
    expect(negotiation.metadata).toEqual({ errandId: errand.id, parentSessionId: principal.id });
    expect(messages.getBySessionId(negotiation.id)).toEqual([]);

    service.escalate(errand.id, 'Would 11 work?');
    await Promise.resolve();
    const noticesRouter = AdminRouterFactory.create(logger, db, {} as never, manager);
    const noticesLayer = noticesRouter.stack.find((item) => item.route?.path === '/agents/negotiator/notices' && item.route.methods.get);
    const waiting = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await noticesLayer!.route.stack[0].handle({ params: {}, query: {} }, waiting, vi.fn());
    expect(waiting.json.mock.calls[0][0].pending).toEqual([
      { errandId: errand.id, goal: 'Book a haircut', kind: 'question', question: 'Would 11 work?', askedAt: expect.any(String) },
    ]);
    expect(channels.sendMessage).toHaveBeenLastCalledWith('whatsapp', '999', expect.stringContaining('Would 11 work?'));
    await vi.waitFor(() => expect(messages.getBySessionId(negotiation.id)).toHaveLength(1));
    vi.spyOn(NegotiatorFactory, 'create').mockReturnValue({ composeResume: vi.fn().mockResolvedValue('Please book 11.') } as never);
    await service.resumeWithPrincipalAnswer(errand.id, '11 works');
    expect(messages.getBySessionId(principal.id)).toEqual([]);
    expect(messages.getBySessionId(negotiation.id).map((message) => [message.role, message.content])).toEqual([
      ['assistant', expect.stringContaining('Would 11 work?')],
      ['user', '11 works'],
    ]);

    const router = AdminRouterFactory.create(logger, db, {} as never, manager);
    const layer = router.stack.find((item) => item.route?.path === '/agents/negotiator/notices' && item.route.methods.get);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await layer!.route.stack[0].handle({ params: {}, query: {} }, res, vi.fn());
    expect(res.json.mock.calls[0][0]).toMatchObject({
      messages: [
        { role: 'assistant', content: expect.stringContaining('Would 11 work?'), errandId: errand.id },
        { role: 'user', content: '11 works', errandId: errand.id },
      ],
      pending: [],
      nextCursor: null,
    });
  });

  it('reopens a resolved errand when its contact writes again, asks the principal, and resumes with their answer', async () => {
    const { manager, service, parent, channels, errands, messages } = setup();
    const errand = service.create('Order lunch', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Can I order a sandwich?');
    await service.approve(errand.id);
    service.resolve(errand.id, 'Sandwich ordered');
    const contactSession = errands.findTargets(errand.id)[0];
    channels.sendMessage.mockClear();

    const runtime = gateway(manager, '{"action":"continue","reply":"unused"}');
    expect(await runtime.gateway.handle('Do you want a drink too?', '555', { isTrustedSender: false })).toBe('');

    expect(service.get(errand.id)).toMatchObject({
      state: 'awaiting_principal', result: undefined, closedAt: undefined,
      notes: 'Resolved before: Sandwich ordered',
      pendingMessage: 'The contact wrote again after this errand was resolved: "Do you want a drink too?". How should I reply?',
    });
    expect(messages.getBySessionId(contactSession).map((message) => message.content)).toEqual(['Can I order a sandwich?', 'Do you want a drink too?']);
    const negotiation = SessionRepositoryFactory.create(db).findLatestOpen({ channel: 'negotiator', peerId: errand.id, kind: 'user' })!;
    expect(messages.getBySessionId(negotiation.id).at(-1)?.content).toContain('Do you want a drink too?');
    expect(channels.sendMessage).not.toHaveBeenCalled();
    expect(runtime.completion.complete).not.toHaveBeenCalled();
    expect(runtime.mainAgent.run).not.toHaveBeenCalled();

    // A second message while the principal decides is only recorded.
    expect(await runtime.gateway.handle('Hello?', '555', { isTrustedSender: false })).toBe('');
    expect(service.get(errand.id)?.state).toBe('awaiting_principal');

    vi.spyOn(NegotiatorFactory, 'create').mockReturnValue({ composeResume: vi.fn().mockResolvedValue('Yes, a juice please.') } as never);
    await service.resumeWithPrincipalAnswer(errand.id, 'yes, a juice');
    expect(channels.sendMessage).toHaveBeenCalledExactlyOnceWith('whatsapp', '555', 'Yes, a juice please.');
    expect(service.get(errand.id)?.state).toBe('awaiting_peer');
  });

  it('keeps an old resolved errand closed and lets a trusted sender reach their own session', async () => {
    const { manager, service, parent, errands } = setup();
    const errand = service.create('Order lunch', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Hi');
    await service.approve(errand.id);
    service.resolve(errand.id, 'Done');
    const runtime = gateway(manager, '{"action":"continue","reply":"unused"}');
    runtime.mainAgent.run.mockResolvedValue('Hi there');

    await runtime.gateway.handle('hello', '555', { isTrustedSender: true });
    expect(service.get(errand.id)?.state).toBe('resolved');
    expect(runtime.mainAgent.run).toHaveBeenCalledTimes(1);

    errands.update(errand.id, { closedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
    await runtime.gateway.handle('hello again', '555', { isTrustedSender: false });
    expect(service.get(errand.id)?.state).toBe('resolved');
    expect(runtime.mainAgent.run).toHaveBeenCalledTimes(2);
  });

  it('changes the errands fingerprint on every status or message change, even without a notice', async () => {
    const { manager, service, parent, errands } = setup();
    const router = AdminRouterFactory.create(logger, db, {} as never, manager);
    const layer = router.stack.find((item) => item.route?.path === '/agents/negotiator/notices' && item.route.methods.get);
    const version = async () => {
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await layer!.route.stack[0].handle({ params: {}, query: {} }, res, vi.fn());
      return res.json.mock.calls[0][0].errandsVersion as string;
    };

    const empty = await version();
    const errand = service.create('Order lunch', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Can I order a sandwich?');
    const drafted = await version();
    expect(drafted).not.toBe(empty);
    expect(await version()).toBe(drafted);

    await service.approve(errand.id);
    const contacted = await version();
    expect(contacted).not.toBe(drafted);

    const runtime = gateway(manager, '{"action":"continue","reply":"Great, thanks!"}');
    await runtime.gateway.handle('Sure, what would you like?', '555', { isTrustedSender: false });
    expect(service.get(errand.id)?.state).toBe('awaiting_peer');
    expect(messagesIn(errands.findTargets(errand.id)[0])).toBeGreaterThan(1);
    expect(await version()).not.toBe(contacted);
  });

  it('lists, closes and cancels errands through the admin API, and fingerprints a partial delivery', async () => {
    const { manager, service, parent, channels } = setup();
    const first = service.create('Order lunch', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Can I order a sandwich?');
    const second = service.create('Book a haircut', [{ channel: 'whatsapp', peerId: '777' }], parent.id, 'Is 10 free?');
    const router = AdminRouterFactory.create(logger, db, {} as never, manager);
    const call = async (path: string, method: 'get' | 'post', params: Record<string, string> = {}, body: unknown = undefined) => {
      const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await layer!.route.stack[0].handle({ params, query: {}, body }, res, vi.fn());
      return res;
    };
    const fingerprint = async () => (await call('/agents/negotiator/notices', 'get')).json.mock.calls[0][0].errandsVersion as string;

    const listed = (await call('/errands', 'get')).json.mock.calls[0][0];
    expect(listed.items.map((item: { id: string }) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(listed.items[0].targets).toEqual([expect.objectContaining({ channel: 'whatsapp', kind: 'delegated' })]);

    const beforeDelivery = await fingerprint();
    channels.sendMessage.mockRejectedValueOnce(new Error('offline'));
    await expect(service.approve(first.id)).rejects.toThrow('Message delivery failed');
    expect(await fingerprint()).not.toBe(beforeDelivery);

    const closed = await call('/errands/:id/close', 'post', { id: first.id }, { result: 'Ordered by phone' });
    expect(closed.json.mock.calls[0][0]).toMatchObject({ state: 'resolved', result: 'Ordered by phone' });
    const cancelled = await call('/errands/:id/cancel', 'post', { id: second.id });
    expect(cancelled.json.mock.calls[0][0]).toMatchObject({ state: 'cancelled' });
    expect((await call('/errands/:id/cancel', 'post', { id: 'missing' })).status).toHaveBeenCalledWith(400);
  });

  it('confirms a proposed result through the admin API and lists it as a pending confirmation', async () => {
    const { manager, service, parent, channels } = setup();
    const errand = service.create('Order lunch', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Can I order a sandwich?');
    await service.approve(errand.id);
    service.proposeResolution(errand.id, 'Sandwich ordered for noon', 'Obrigado!');
    const router = AdminRouterFactory.create(logger, db, {} as never, manager);
    const call = async (path: string, method: 'get' | 'post') => {
      const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await layer!.route.stack[0].handle({ params: { id: errand.id }, query: {} }, res, vi.fn());
      return res;
    };

    const notices = await call('/agents/negotiator/notices', 'get');
    expect(notices.json.mock.calls[0][0].pending).toEqual([
      { errandId: errand.id, goal: 'Order lunch', kind: 'confirmation', question: 'Sandwich ordered for noon', askedAt: expect.any(String) },
    ]);
    channels.sendMessage.mockClear();

    const confirmed = await call('/errands/:id/confirm', 'post');
    expect(confirmed.status).not.toHaveBeenCalled();
    expect(confirmed.json.mock.calls[0][0]).toMatchObject({ state: 'resolved', result: 'Sandwich ordered for noon' });
    expect(channels.sendMessage).toHaveBeenCalledExactlyOnceWith('whatsapp', '555', 'Obrigado!');
    expect((await call('/errands/:id/confirm', 'post')).status).toHaveBeenCalledWith(400);
  });

  it('returns the images a contact sent in the errand transcript', async () => {
    const { manager, service, parent } = setup();
    const errand = service.create('Order lunch', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Can I see the menu?');
    await service.approve(errand.id);
    const runtime = gateway(manager, '{"action":"continue","reply":"Thanks, I will pick one."}');
    const menu = { data: 'bWVudQ==', mimeType: 'image/jpeg' };
    await runtime.gateway.handle({ text: 'Here it is', images: [menu] }, '555', { isTrustedSender: false });
    expect(runtime.prompts.build.mock.calls[0][0]).toMatchObject({ images: [menu] });

    const router = AdminRouterFactory.create(logger, db, {} as never, manager);
    const layer = router.stack.find((item) => item.route?.path === '/errands/:id/transcript' && item.route.methods.get);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await layer!.route.stack[0].handle({ params: { id: errand.id }, query: {} }, res, vi.fn());
    const { messages: transcript } = res.json.mock.calls[0][0];
    expect(transcript.find((message: { content: string }) => message.content === 'Here it is')).toMatchObject({ role: 'user', images: [menu] });
    expect(transcript.find((message: { content: string }) => message.content === 'Can I see the menu?')).not.toHaveProperty('images');
  });

  it('exposes failure and retry through the admin API without exposing internal delivery instructions', async () => {
    const { manager, service, parent, channels } = setup();
    const errand = service.create('Book', [{ channel: 'whatsapp', peerId: '555' }], parent.id, 'Can you book 10?');
    const router = AdminRouterFactory.create(logger, db, {} as never, manager);
    const request = async (path: string, method: 'get' | 'post') => {
      const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await layer!.route.stack[0].handle({ params: { id: errand.id }, query: {} }, res, vi.fn());
      return res;
    };
    channels.sendMessage.mockRejectedValueOnce(new Error('Channel offline'));
    const failed = await request('/errands/:id/approve', 'post');
    expect(failed.status).toHaveBeenCalledWith(400);
    const detail = await request('/errands/:id', 'get');
    expect(detail.json.mock.calls[0][0]).toMatchObject({
      state: 'draft', pendingMessage: 'Can you book 10?',
      delivery: { type: 'opener', sent: 0, total: 1, error: 'Channel offline' },
    });
    expect(detail.json.mock.calls[0][0]).not.toHaveProperty('pendingDelivery');
    const retry = await request('/errands/:id/retry', 'post');
    expect(retry.json.mock.calls[0][0]).toMatchObject({ state: 'awaiting_peer', delivery: null, pendingMessage: null });
    expect(channels.sendMessage).toHaveBeenCalledTimes(2);
    const duplicate = await request('/errands/:id/retry', 'post');
    expect(duplicate.status).toHaveBeenCalledWith(400);
    expect(channels.sendMessage).toHaveBeenCalledTimes(2);
  });
});
