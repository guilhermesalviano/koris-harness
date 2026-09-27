import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrandService } from '../../../../src/services/errands';
import { Errand } from '../../../../src/entities/errand';
import { THIRD_PARTY_CONVERSATION_CONTEXT } from '../../../../src/constants';
import { applyTestConfigDefaults } from '../../../helpers/test-config';
import { config } from '../../../../src/config';

const { mockComposeResume } = vi.hoisted(() => ({ mockComposeResume: vi.fn().mockResolvedValue('resumed reply') }));
vi.mock('../../../../src/services/agents/sub-agents/negotiator/sub-agent', () => ({
  NegotiatorFactory: {
    create: () => ({ composeResume: mockComposeResume }),
  },
}));

function makeDb() {
  return { transaction: vi.fn((fn: () => unknown) => fn()), run: vi.fn(), get: vi.fn(), query: vi.fn(() => []) };
}

function makeErrandRepo() {
  return {
    save: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findActiveBySessionId: vi.fn().mockReturnValue(null),
    findNextQueuedBySessionId: vi.fn().mockReturnValue(null),
    findActiveByPeer: vi.fn().mockReturnValue(null),
    findNextQueuedByPeer: vi.fn().mockReturnValue(null),
    findLatestResolvedByPeer: vi.fn().mockReturnValue(null),
    findByOriginSessionId: vi.fn().mockReturnValue([]),
    findAll: vi.fn().mockReturnValue([]),
    addTarget: vi.fn(),
    findTargets: vi.fn().mockReturnValue([]),
    countByState: vi.fn().mockReturnValue(0),
  };
}

function makeSessionRepo() {
  return {
    findById: vi.fn((id: string) => ({ id, channel: 'whatsapp', peerId: id, kind: 'delegated' })),
    findLatestOpen: vi.fn(),
    save: vi.fn(),
  };
}

function makeSessionManager() {
  return {
    getSessionService: vi.fn((key: { channel: string; peerId: string; kind?: string }) => ({
      getSession: () => ({ id: `session-${key.channel}-${key.peerId}` }),
    })),
    getSessionServiceById: vi.fn((id: string) => ({
      getSession: () => ({ id }),
      ensureActiveSession: () => ({ id }),
      updateCount: vi.fn(),
    })),
  };
}

function makeOutbound() {
  return { send: vi.fn().mockResolvedValue({ status: 'sent' }) };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeService(overrides: { now?: () => Date } = {}) {
  const db = makeDb();
  const errandRepo = makeErrandRepo();
  const sessionRepo = makeSessionRepo();
  const sessionManager = makeSessionManager();
  const outbound = makeOutbound();
  const logger = makeLogger();

  const service = new ErrandService(
    db as never,
    errandRepo as never,
    sessionRepo as never,
    sessionManager as never,
    outbound as never,
    logger as never,
    overrides.now,
  );

  return { service, db, errandRepo, sessionRepo, sessionManager, outbound, logger };
}

describe('ErrandService', () => {
  beforeEach(() => {
    applyTestConfigDefaults();
  });

  describe('create', () => {
    it('rejects a missing parent before saving the errand or creating child sessions', () => {
      const { service, sessionRepo, errandRepo } = makeService();
      sessionRepo.findById.mockReturnValue(null as never);

      expect(() => service.create('Book', [{ channel: 'telegram', peerId: '555' }], 'missing', 'Hello')).toThrow('Parent session not found');
      expect(errandRepo.save).not.toHaveBeenCalled();
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('deduplicates equivalent contact addresses into one child session', () => {
      const { service, sessionRepo, errandRepo } = makeService();

      service.create('Book', [{ channel: 'whatsapp', peerId: '555' }, { channel: 'whatsapp', peerId: '555@s.whatsapp.net' }], 'parent', 'Hello');

      expect(sessionRepo.save).toHaveBeenCalledTimes(1);
      expect(errandRepo.addTarget).toHaveBeenCalledTimes(1);
    });

    it('creates a fresh child session with the parent link and persisted instructions', () => {
      const { service, db, errandRepo, sessionRepo, sessionManager } = makeService();

      const errand = service.create('buy milk', [{ channel: 'whatsapp', peerId: '555' }], 'origin-1', 'hi, can you get milk?');

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(sessionManager.getSessionService).not.toHaveBeenCalled();
      expect(errand.state).toBe('draft');
      expect(errand.pendingMessage).toBe('hi, can you get milk?');
      expect(errandRepo.save).toHaveBeenCalledTimes(1);
      const child = sessionRepo.save.mock.calls[0][0];
      expect(child).toMatchObject({ channel: 'whatsapp', peerId: '555', kind: 'delegated', metadata: {
        parentSessionId: 'origin-1', errandId: errand.id, instructions: THIRD_PARTY_CONVERSATION_CONTEXT,
      } });
      expect(child.id).not.toBe('origin-1');
      expect(child.endedAt).toBeUndefined();
      expect(errandRepo.addTarget).toHaveBeenCalledWith(errand.id, child.id);
    });

    it('queues instead of drafting when the target session already has an active errand', () => {
      const { service, errandRepo } = makeService();
      errandRepo.findActiveByPeer.mockReturnValue({ errand: new Errand({ id: 'existing', goal: 'x', originSessionId: 'origin-0' }), sessionId: 'older-child' });

      const errand = service.create('buy milk', [{ channel: 'whatsapp', peerId: '555' }], 'origin-1', 'hi');

      expect(errand.state).toBe('queued');
    });

    it('rejects a target-less errand', () => {
      const { service } = makeService();
      expect(() => service.create('goal', [], 'origin-1', 'hi')).toThrow();
    });

    it('refuses to create past errands.max_concurrent', () => {
      applyTestConfigDefaults({ errandsMaxConcurrent: 2 });
      const { service, errandRepo } = makeService();
      errandRepo.countByState.mockImplementation((state: string) => (state === 'open' ? 2 : 0));

      expect(() => service.create('goal', [{ channel: 'whatsapp', peerId: '555' }], 'origin-1', 'hi')).toThrow(/Too many errands/);
    });
  });

  describe('approve', () => {
    it.each([undefined, '   '])('rejects an empty opener %j before preparing delivery', async (pendingMessage) => {
      const { service, errandRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'Book', originSessionId: 'parent', pendingMessage }));
      errandRepo.findTargets.mockReturnValue(['contact']);

      await expect(service.approve('e1')).rejects.toThrow('Cannot deliver an empty message');
      expect(outbound.send).not.toHaveBeenCalled();
      expect(errandRepo.update).not.toHaveBeenCalled();
    });

    it('sends the pending message to every target and moves to awaiting_peer', async () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      const draft = new Errand({ id: 'e1', goal: 'buy milk', state: 'draft', originSessionId: 'origin-1', pendingMessage: 'hi there' });
      errandRepo.findById.mockReturnValue(draft);
      errandRepo.findTargets.mockReturnValue(['target-session']);
      sessionRepo.findById.mockReturnValue({ id: 'target-session', channel: 'whatsapp', peerId: '555', kind: 'delegated' });

      errandRepo.update.mockImplementation((_id, patch) => {
        errandRepo.findById.mockReturnValue(new Errand({ ...errandRepo.findById('e1'), ...patch }));
      });
      const result = await service.approve('e1');

      expect(outbound.send).toHaveBeenCalledWith({ channel: 'whatsapp', target: '555', content: 'hi there', kind: 'delegated', sessionId: 'target-session' });
      expect(result.state).toBe('awaiting_peer');
      expect(errandRepo.update).toHaveBeenCalledWith('e1', expect.objectContaining({ state: 'awaiting_peer', pendingMessage: undefined }));
    });

    it('logs instead of failing when a notice cannot be delivered to a WhatsApp principal', async () => {
      const { service, errandRepo, sessionRepo, outbound, logger } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'buy milk', state: 'awaiting_peer', originSessionId: 'origin-1' }));
      sessionRepo.findById.mockReturnValue({ id: 'origin-1', channel: 'whatsapp', peerId: '999', kind: 'user' });
      outbound.send.mockRejectedValue(new Error('offline'));

      expect(service.escalate('e1', 'which brand?').state).toBe('awaiting_principal');
      await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('Could not deliver errand notice.'));
    });

    it('does not post the sent opener in the origin chat', async () => {
      const { service, db, errandRepo, sessionRepo } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'Pedir um lanche', state: 'draft', originSessionId: 'origin-1', pendingMessage: 'Oi! Um lanche?' }));
      errandRepo.findTargets.mockReturnValue(['target-session']);
      sessionRepo.findById.mockImplementation((id: string) => (id === 'origin-1'
        ? { id, channel: 'web', peerId: 'web', kind: 'user' }
        : { id, channel: 'whatsapp', peerId: '555', kind: 'delegated' }));
      errandRepo.update.mockImplementation((_id, patch) => {
        errandRepo.findById.mockReturnValue(new Errand({ ...errandRepo.findById('e1'), ...patch }));
      });

      await service.approve('e1');

      expect(db.run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'), expect.anything());
    });

    it('refuses to approve an errand that is not a draft', async () => {
      const { service, errandRepo } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'g', state: 'awaiting_peer', originSessionId: 'o1' }));

      await expect(service.approve('e1')).rejects.toThrow(/not awaiting approval/);
    });

    it('throws when the errand does not exist', async () => {
      const { service, errandRepo } = makeService();
      errandRepo.findById.mockReturnValue(null);

      await expect(service.approve('missing')).rejects.toThrow(/not found/);
    });
  });

  describe('recordPeerReply', () => {
    it('keeps the errand in awaiting_peer and updates notes', () => {
      const { service, errandRepo } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'g', state: 'awaiting_peer', originSessionId: 'o1' }));

      const result = service.recordPeerReply('e1', 'they said yes');

      expect(result.state).toBe('awaiting_peer');
      expect(result.notes).toBe('they said yes');
    });
  });

  describe('escalate', () => {
    it('moves to awaiting_principal and pushes a question into the origin session', () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'buy milk', state: 'open', originSessionId: 'origin-1' }));
      sessionRepo.findById.mockReturnValue({ id: 'origin-1', channel: 'whatsapp', peerId: '999', kind: 'user' });

      const result = service.escalate('e1', 'what brand do you want?');

      expect(result.state).toBe('awaiting_principal');
      expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'whatsapp',
        target: '999',
        content: expect.stringContaining('what brand do you want?'),
      }));
    });

    it('persists the plain question, without a reply command, in the errand\'s own negotiation session', () => {
      const { service, db, errandRepo, sessionRepo, sessionManager, outbound } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'buy milk', state: 'open', originSessionId: 'origin-1' }));
      sessionRepo.findById.mockReturnValue({ id: 'origin-1', channel: 'web', peerId: 'web', kind: 'user' });

      service.escalate('e1', 'what brand?');

      const negotiation = sessionRepo.save.mock.calls[0][0];
      expect(negotiation).toMatchObject({ channel: 'negotiator', peerId: 'e1', kind: 'user', metadata: { errandId: 'e1', parentSessionId: 'origin-1' } });
      expect(outbound.send).not.toHaveBeenCalled();
      expect(sessionManager.getSessionServiceById).not.toHaveBeenCalledWith('origin-1');
      expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'), [
        expect.any(String), negotiation.id, 'assistant',
        '❓ Errand "buy milk" needs your input: what brand?',
        null, null, expect.any(String), 'negotiator',
      ]);
    });
  });

  describe('resolve / fail / cancel', () => {
    const proposed = (patch: Partial<ConstructorParameters<typeof Errand>[0]> = {}) => new Errand({
      id: 'e1', goal: 'Book a haircut', state: 'awaiting_confirmation', originSessionId: 'parent',
      pendingMessage: 'Booked Saturday at 11', closingReply: 'Thank you!', ...patch,
    });
    const tracking = (errandRepo: ReturnType<typeof makeErrandRepo>, initial: Errand) => {
      errandRepo.findById.mockReturnValue(initial);
      errandRepo.update.mockImplementation((_id, patch) => {
        errandRepo.findById.mockReturnValue(new Errand({ ...errandRepo.findById('e1'), ...patch }));
      });
    };

    it('proposes a result: holds the closing reply, asks the principal, and sends nothing to the contact', () => {
      const { service, db, errandRepo, sessionRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'Book a haircut', state: 'awaiting_peer', originSessionId: 'origin-1' }));
      sessionRepo.findById.mockReturnValue({ id: 'origin-1', channel: 'web', peerId: 'web', kind: 'user' });
      sessionRepo.findLatestOpen.mockReturnValue({ id: 'negotiation-1', channel: 'negotiator', peerId: 'e1', kind: 'user' });

      const result = service.proposeResolution('e1', 'Booked Saturday at 11', 'Thank you!', 'contact confirmed');

      expect(result).toMatchObject({ state: 'awaiting_confirmation', pendingMessage: 'Booked Saturday at 11', closingReply: 'Thank you!', notes: 'contact confirmed' });
      expect(outbound.send).not.toHaveBeenCalled();
      expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'), [
        expect.any(String), 'negotiation-1', 'assistant', '🏁 Errand "Book a haircut" looks done: Booked Saturday at 11',
        null, null, expect.any(String), 'negotiator',
      ]);
    });

    it('confirming sends the held closing reply to every contact, then resolves with the proposed result', async () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      tracking(errandRepo, proposed());
      errandRepo.findTargets.mockReturnValue(['contact']);
      sessionRepo.findById.mockImplementation((id: string) => (id === 'contact'
        ? { id, channel: 'whatsapp', peerId: '555', kind: 'delegated' }
        : { id, channel: 'web', peerId: 'web', kind: 'user' }));

      const result = await service.confirmResolution('e1');

      expect(outbound.send).toHaveBeenCalledWith({ channel: 'whatsapp', target: '555', kind: 'delegated', sessionId: 'contact', content: 'Thank you!' });
      expect(result).toMatchObject({ state: 'resolved', result: 'Booked Saturday at 11', closingReply: undefined });
    });

    it('refuses to confirm an errand that is not waiting for confirmation', async () => {
      const { service, errandRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(proposed({ state: 'awaiting_peer' }));
      await expect(service.confirmResolution('e1')).rejects.toThrow('not waiting for your confirmation');
      expect(outbound.send).not.toHaveBeenCalled();
    });

    it('keeps waiting for confirmation when the closing reply fails delivery or a target is gone', async () => {
      const { service, errandRepo, outbound, sessionRepo } = makeService();
      errandRepo.findById.mockReturnValue(proposed());
      errandRepo.findTargets.mockReturnValue(['contact']);
      outbound.send.mockResolvedValue({ status: 'failed' });
      await expect(service.confirmResolution('e1')).rejects.toThrow('still waiting for your confirmation');
      expect(errandRepo.update).not.toHaveBeenCalled();

      sessionRepo.findById.mockReturnValue(null as never);
      await expect(service.confirmResolution('e1')).rejects.toThrow('target session not found');
      expect(errandRepo.update).not.toHaveBeenCalled();
    });

    it('does not resolve an errand cancelled while its closing reply was being delivered', async () => {
      const { service, errandRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(proposed());
      errandRepo.findTargets.mockReturnValue(['contact']);
      outbound.send.mockImplementationOnce(async () => {
        errandRepo.findById.mockReturnValue(proposed({ state: 'cancelled' }));
        return { status: 'sent' };
      });

      expect((await service.confirmResolution('e1')).state).toBe('cancelled');
      expect(errandRepo.update).not.toHaveBeenCalled();
    });

    it('keeps a proposed result waiting through small talk, and drops it when the Negotiator escalates', () => {
      const { service, errandRepo } = makeService();
      tracking(errandRepo, proposed());
      expect(service.recordPeerReply('e1', 'said thanks')).toMatchObject({ state: 'awaiting_confirmation', closingReply: 'Thank you!' });
      expect(service.escalate('e1', 'They now ask for a deposit. OK?')).toMatchObject({ state: 'awaiting_principal', closingReply: undefined });
    });

    it('resumes a proposed result with an extra requirement: sends it to the contact and waits on them again', async () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      tracking(errandRepo, proposed());
      errandRepo.findTargets.mockReturnValue(['contact']);
      sessionRepo.findById.mockImplementation((id: string) => ({ id, channel: 'whatsapp', peerId: '555', kind: 'delegated' }));

      const { errand } = await service.resumeWithPrincipalAnswer('e1', 'also a beard trim');

      expect(mockComposeResume).toHaveBeenCalledWith(expect.objectContaining({
        answer: 'also a beard trim', question: expect.stringContaining('Booked Saturday at 11'),
      }));
      expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({ target: '555', content: 'resumed reply' }));
      expect(errand).toMatchObject({ state: 'awaiting_peer', pendingMessage: undefined, closingReply: undefined });
    });

    it('resolve closes the errand, sets result and closedAt, and notifies the negotiation session', () => {
      const { service, db, errandRepo, sessionRepo } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'buy milk', state: 'awaiting_peer', originSessionId: 'origin-1' }));
      sessionRepo.findById.mockReturnValue({ id: 'origin-1', channel: 'web', peerId: 'web', kind: 'user' });
      sessionRepo.findLatestOpen.mockReturnValue({ id: 'negotiation-1', channel: 'negotiator', peerId: 'e1', kind: 'user' });

      const result = service.resolve('e1', 'they said yes, on the way');

      expect(result.state).toBe('resolved');
      expect(result.result).toBe('they said yes, on the way');
      expect(result.closedAt).toBeDefined();
      expect(sessionRepo.save).not.toHaveBeenCalled();
      expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'), [
        expect.any(String), 'negotiation-1', 'assistant',
        expect.stringContaining('resolved: they said yes, on the way'),
        null, null, expect.any(String), 'negotiator',
      ]);
    });

    it('fail closes the errand as failed with a reason', () => {
      const { service, errandRepo, sessionRepo } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'buy milk', state: 'awaiting_peer', originSessionId: 'origin-1' }));
      sessionRepo.findById.mockReturnValue({ id: 'origin-1', channel: 'web', peerId: 'web', kind: 'user' });

      const result = service.fail('e1', 'they refused');

      expect(result.state).toBe('failed');
      expect(result.result).toBe('they refused');
    });

    it('cancel closes the errand without a result and without notifying anyone', () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'buy milk', state: 'draft', originSessionId: 'origin-1' }));

      const result = service.cancel('e1');

      expect(result.state).toBe('cancelled');
      expect(outbound.send).not.toHaveBeenCalled();
      expect(sessionRepo.findById).not.toHaveBeenCalled();
    });

    it('promotes the oldest queued errand for a freed target session back to draft', () => {
      const { service, errandRepo } = makeService();
      const closing = new Errand({ id: 'e1', goal: 'buy milk', state: 'awaiting_peer', originSessionId: 'origin-1' });
      errandRepo.findById.mockReturnValue(closing);
      errandRepo.findTargets.mockImplementation((id: string) => (id === 'e1' ? ['target-session'] : ['target-session']));
      const queued = new Errand({ id: 'e2', goal: 'buy bread', state: 'queued', originSessionId: 'origin-2' });
      errandRepo.findNextQueuedByPeer.mockReturnValue(queued);
      errandRepo.findActiveByPeer.mockReturnValue(null);

      service.cancel('e1');

      expect(errandRepo.update).toHaveBeenCalledWith('e2', { state: 'draft' });
    });

    it('does not promote a queued errand while one of its OTHER targets is still active', () => {
      const { service, errandRepo } = makeService();
      const closing = new Errand({ id: 'e1', goal: 'buy milk', state: 'awaiting_peer', originSessionId: 'origin-1' });
      errandRepo.findById.mockReturnValue(closing);
      const queued = new Errand({ id: 'e2', goal: 'buy bread', state: 'queued', originSessionId: 'origin-2' });
      errandRepo.findTargets.mockImplementation((id: string) => {
        if (id === 'e1') return ['target-session'];
        if (id === 'e2') return ['target-session', 'other-target'];
        return [];
      });
      errandRepo.findNextQueuedByPeer.mockReturnValue(queued);
      errandRepo.findActiveByPeer.mockImplementation((_channel: string, peerIds: string[]) =>
        peerIds.includes('other-target') ? { errand: new Errand({ id: 'blocker', goal: 'g', originSessionId: 'o3' }), sessionId: 'blocker-child' } : null,
      );

      service.cancel('e1');

      expect(errandRepo.update).not.toHaveBeenCalledWith('e2', { state: 'draft' });
    });
  });

  describe('lazy expiry (hydrate)', () => {
    it('flips a stale in-flight errand to expired on read', () => {
      applyTestConfigDefaults({ errandsHardExpiryMs: 1000 });
      const now = () => new Date('2026-01-01T01:00:00.000Z');
      const { service, errandRepo } = makeService({ now });
      const stale = new Errand({
        id: 'e1',
        goal: 'g',
        state: 'awaiting_peer',
        originSessionId: 'o1',
        lastProgressAt: '2026-01-01T00:00:00.000Z',
      });
      errandRepo.findById.mockReturnValue(stale);

      const result = service.get('e1');

      expect(result?.state).toBe('expired');
      expect(errandRepo.update).toHaveBeenCalledWith('e1', expect.objectContaining({ state: 'expired' }));
    });

    it('leaves a fresh in-flight errand untouched', () => {
      applyTestConfigDefaults({ errandsHardExpiryMs: 60 * 60 * 1000 });
      const now = () => new Date('2026-01-01T00:00:30.000Z');
      const { service, errandRepo } = makeService({ now });
      const fresh = new Errand({
        id: 'e1',
        goal: 'g',
        state: 'awaiting_peer',
        originSessionId: 'o1',
        lastProgressAt: '2026-01-01T00:00:00.000Z',
      });
      errandRepo.findById.mockReturnValue(fresh);

      const result = service.get('e1');

      expect(result?.state).toBe('awaiting_peer');
      expect(errandRepo.update).not.toHaveBeenCalled();
    });

    it('never expires a draft, queued, or already-closed errand', () => {
      applyTestConfigDefaults({ errandsHardExpiryMs: 1 });
      const now = () => new Date('2026-01-01T05:00:00.000Z');
      const { service, errandRepo } = makeService({ now });

      for (const state of ['draft', 'queued', 'resolved', 'failed', 'cancelled'] as const) {
        errandRepo.update.mockClear();
        errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'g', state, originSessionId: 'o1', createdAt: '2026-01-01T00:00:00.000Z' }));
        service.get('e1');
        expect(errandRepo.update).not.toHaveBeenCalled();
      }
    });

    it('listAll and listByOrigin hydrate every result', () => {
      const now = () => new Date('2026-01-02T00:00:00.000Z');
      const { service, errandRepo } = makeService({ now });
      applyTestConfigDefaults({ errandsHardExpiryMs: 1000 });
      const stale = new Errand({ id: 'e1', goal: 'g', state: 'awaiting_peer', originSessionId: 'o1', createdAt: '2026-01-01T00:00:00.000Z' });
      errandRepo.findAll.mockReturnValue([stale]);
      errandRepo.findByOriginSessionId.mockReturnValue([stale]);

      expect(service.listAll()[0].state).toBe('expired');
      expect(service.listByOrigin('o1')[0].state).toBe('expired');
    });
  });

  describe('reopenForPeer', () => {
    const now = new Date('2026-09-13T12:00:00Z');
    const resolvedAgo = (ms: number) => new Errand({
      id: 'e1', goal: 'Pedir um lanche', state: 'resolved', originSessionId: 'o1',
      notes: 'X-tudo for 50', result: 'Order confirmed', closedAt: new Date(now.getTime() - ms).toISOString(),
    });

    it('reopens a recently resolved errand and asks the principal how to reply to the contact', () => {
      const { service, errandRepo } = makeService({ now: () => now });
      errandRepo.findLatestResolvedByPeer.mockReturnValue({ errand: resolvedAgo(60_000), sessionId: 'child' });
      errandRepo.findById.mockReturnValue(resolvedAgo(60_000));
      errandRepo.update.mockImplementation((_id, patch) => {
        errandRepo.findById.mockReturnValue(new Errand({ ...errandRepo.findById('e1'), ...patch }));
      });

      const reopened = service.reopenForPeer('whatsapp', '555@s.whatsapp.net', 'Can I add a drink?', ['141789856067723@lid']);

      expect(errandRepo.findLatestResolvedByPeer).toHaveBeenCalledWith('whatsapp', ['555@s.whatsapp.net', '555', '141789856067723@lid']);
      expect(reopened).toEqual({ errand: expect.objectContaining({ id: 'e1', state: 'awaiting_principal' }), sessionId: 'child' });
      expect(errandRepo.update).toHaveBeenCalledWith('e1', { closedAt: undefined, result: undefined, notes: 'X-tudo for 50\nResolved before: Order confirmed' });
      expect(reopened?.errand.pendingMessage).toBe('The contact wrote again after this errand was resolved: "Can I add a drink?". How should I reply?');
    });

    it('leaves the errand closed once it is older than the expiry window', () => {
      const { service, errandRepo } = makeService({ now: () => now });
      errandRepo.findLatestResolvedByPeer.mockReturnValue({ errand: resolvedAgo(config.ERRANDS.HARD_EXPIRY_MS + 1), sessionId: 'child' });
      expect(service.reopenForPeer('whatsapp', '555', 'hi')).toBeNull();
      expect(errandRepo.update).not.toHaveBeenCalled();
    });

    it('does not reopen while another errand with the contact is in flight, or when none was resolved', () => {
      const { service, errandRepo } = makeService({ now: () => now });
      errandRepo.findLatestResolvedByPeer.mockReturnValue({ errand: resolvedAgo(60_000), sessionId: 'child' });
      errandRepo.findActiveByPeer.mockReturnValue({ errand: new Errand({ id: 'e2', goal: 'x', state: 'draft', originSessionId: 'o1' }), sessionId: 'other' });
      expect(service.reopenForPeer('whatsapp', '555', 'hi')).toBeNull();
      expect(errandRepo.findLatestResolvedByPeer).not.toHaveBeenCalled();

      errandRepo.findActiveByPeer.mockReturnValue(null);
      errandRepo.findLatestResolvedByPeer.mockReturnValue(null);
      expect(service.reopenForPeer('whatsapp', '555', 'hi')).toBeNull();
      expect(errandRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('findActiveForPeer', () => {
    it('does not take over the contact conversation for an unapproved draft', () => {
      const { service, errandRepo } = makeService();
      errandRepo.findActiveByPeer.mockReturnValue({
        errand: new Errand({ id: 'e1', goal: 'haircut', state: 'draft', originSessionId: 'o1' }), sessionId: 'child',
      });
      expect(service.findActiveForPeer('whatsapp', '555')).toBeNull();
    });

    it('returns null without creating a session when no errand matches the contact', () => {
      const { service, errandRepo, sessionManager, sessionRepo } = makeService();
      expect(service.findActiveForPeer('whatsapp', '555')).toBeNull();
      expect(errandRepo.findActiveByPeer).toHaveBeenCalledWith('whatsapp', ['555', '555@s.whatsapp.net']);
      expect(sessionManager.getSessionService).not.toHaveBeenCalled();
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('returns the matched errand child rather than the latest session for the contact', () => {
      const { service, errandRepo, sessionRepo } = makeService();
      errandRepo.findActiveByPeer.mockReturnValue({
        errand: new Errand({ id: 'e1', goal: 'haircut', state: 'awaiting_peer', originSessionId: 'o1' }), sessionId: 'older-active-child',
      });
      expect(service.findActiveForPeer('whatsapp', '555@s.whatsapp.net')).toEqual({
        errand: expect.objectContaining({ id: 'e1' }), sessionId: 'older-active-child',
      });
      expect(errandRepo.findActiveByPeer).toHaveBeenCalledWith('whatsapp', ['555@s.whatsapp.net', '555']);
      expect(sessionRepo.findLatestOpen).not.toHaveBeenCalled();
    });

    it('matches a contact that replies under another address the channel reports (WhatsApp LID)', () => {
      const { service, errandRepo } = makeService();
      errandRepo.findActiveByPeer.mockReturnValue({
        errand: new Errand({ id: 'e1', goal: 'haircut', state: 'awaiting_peer', originSessionId: 'o1' }), sessionId: 'child',
      });
      expect(service.findActiveForPeer('whatsapp', '141789856067723@lid', ['555@s.whatsapp.net'])?.sessionId).toBe('child');
      expect(errandRepo.findActiveByPeer).toHaveBeenCalledWith('whatsapp', ['141789856067723@lid', '555@s.whatsapp.net', '555']);
    });
  });

  describe('resumeWithPrincipalAnswer', () => {
    it('does not send or reopen an errand cancelled while composing the approved reply', async () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'haircut', state: 'awaiting_principal', originSessionId: 'o1' }));
      errandRepo.findTargets.mockReturnValue(['target-1']);
      sessionRepo.findById.mockReturnValue({ id: 'target-1', channel: 'whatsapp', peerId: '555', kind: 'delegated' });
      mockComposeResume.mockImplementationOnce(async () => {
        errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'haircut', state: 'cancelled', originSessionId: 'o1' }));
        return 'Please book 11';
      });
      await expect(service.resumeWithPrincipalAnswer('e1', '11 works')).rejects.toThrow('changed while composing');
      expect(outbound.send).not.toHaveBeenCalled();
      expect(errandRepo.update).not.toHaveBeenCalled();
    });
    it('throws if errand is not awaiting_principal', async () => {
      const { service, errandRepo } = makeService();
      errandRepo.findById.mockReturnValue(new Errand({ id: 'e1', goal: 'g', state: 'awaiting_peer', originSessionId: 'o1' }));

      await expect(service.resumeWithPrincipalAnswer('e1', 'yes')).rejects.toThrow(/not awaiting your input/);
    });

    it('resumes the errand, drafts reply, and delivers to targets without notifying origin', async () => {
      const { service, errandRepo, sessionRepo, outbound } = makeService();
      errandRepo.findById.mockReturnValue(
        new Errand({ id: 'e1', goal: 'haircut', state: 'awaiting_principal', originSessionId: 'o1', notes: 'prev notes' }),
      );
      errandRepo.findTargets.mockReturnValue(['target-1']);
      sessionRepo.findById.mockImplementation((id: string) => {
        if (id === 'target-1') return { id: 'target-1', channel: 'whatsapp', peerId: '555', kind: 'delegated' };
        if (id === 'o1') return { id: 'o1', channel: 'whatsapp', peerId: '999', kind: 'user' };
        return null;
      });

      errandRepo.update.mockImplementation((_id, patch) => {
        errandRepo.findById.mockReturnValue(new Errand({ ...errandRepo.findById('e1'), ...patch }));
      });
      const result = await service.resumeWithPrincipalAnswer('e1', 'Saturday 10am is good');

      expect(result.errand.state).toBe('awaiting_peer');
      expect(result.reply).toBe('resumed reply');
      expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'whatsapp',
        target: '555',
        content: 'resumed reply',
      }));
      expect(outbound.send).not.toHaveBeenCalledWith(expect.objectContaining({ target: '999' }));
    });
  });
});
