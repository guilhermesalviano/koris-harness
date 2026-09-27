import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleErrandCommand } from '../../../../src/services/commands/errands';
import { buildErrandService } from '../../../../src/services/errands';
import { DatabaseServiceFactory } from '../../../../src/infrastructure/db-sqlite';
import { Errand } from '../../../../src/entities/errand';
import type { CommandContext } from '../../../../src/types/commands';

const { service, composeOpener, findTargets } = vi.hoisted(() => ({
  service: {
    listByOrigin: vi.fn(), listAll: vi.fn(), create: vi.fn(), approve: vi.fn(),
    retryDelivery: vi.fn(), resolve: vi.fn(), cancel: vi.fn(), resumeWithPrincipalAnswer: vi.fn(), confirmResolution: vi.fn(),
  },
  composeOpener: vi.fn(),
  findTargets: vi.fn(),
}));

vi.mock('../../../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: { create: vi.fn(() => ({})) },
}));
vi.mock('../../../../src/services/errands', () => ({ buildErrandService: vi.fn() }));
vi.mock('../../../../src/services/agents/sub-agents/negotiator/sub-agent', () => ({
  NegotiatorFactory: { create: () => ({ composeOpener }) },
}));
vi.mock('../../../../src/repositories/errand', () => ({
  ErrandRepositoryFactory: { create: () => ({ findTargets }) },
}));

const context: CommandContext = { source: 'web', trusted: true, sessionId: 'parent' };
const draft = new Errand({ id: 'e1', goal: 'Book a haircut', originSessionId: 'parent' });

describe('errand command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildErrandService).mockReturnValue(service as never);
    service.listByOrigin.mockReturnValue([]);
    service.listAll.mockReturnValue([]);
    service.create.mockReturnValue(draft);
    findTargets.mockReturnValue(['contact']);
    composeOpener.mockResolvedValue('Is Saturday available?');
  });

  it.each([false, undefined])('rejects senders with trust %s before accessing errands', async (trusted) => {
    const result = await handleErrandCommand('/errand approve e1', { ...context, trusted });
    expect(result).toMatchObject({ handled: true, response: 'Only trusted senders can manage errands.' });
    expect(DatabaseServiceFactory.create).not.toHaveBeenCalled();
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('confirms a proposed result with /errand resolve', async () => {
    service.confirmResolution.mockResolvedValue(new Errand({ ...draft, state: 'resolved' }));
    const result = await handleErrandCommand('/errand resolve e1', context);
    expect(service.confirmResolution).toHaveBeenCalledExactlyOnceWith('e1');
    expect(result.response).toBe('Errand [e1] is now "resolved".');
    expect((await handleErrandCommand('/errand resolve', context)).response).toBe('Usage: /errand resolve <id>');
  });

  it('lists only the invoking session and explains how to create the first errand', async () => {
    const result = await handleErrandCommand(' /ERRAND ', context);
    expect(service.listByOrigin).toHaveBeenCalledExactlyOnceWith('parent');
    expect(service.listAll).not.toHaveBeenCalled();
    expect(result.response).toContain('No errands yet. Usage: /errand');
  });

  it('lists all errands without a session and includes available notes and results', async () => {
    service.listAll.mockReturnValue([draft, new Errand({
      ...draft, id: 'e2', state: 'resolved', notes: 'Approved Saturday', result: 'Booked at 11',
    })]);
    const result = await handleErrandCommand('/errand', { ...context, sessionId: undefined });
    expect(service.listAll).toHaveBeenCalledExactlyOnceWith();
    expect(service.listByOrigin).not.toHaveBeenCalled();
    expect(result.response).toBe('[e1] draft — Book a haircut\n  targets: 1\n\n[e2] resolved — Book a haircut\n  targets: 1\n  notes: Approved Saturday\n  result: Booked at 11');
    expect(findTargets).toHaveBeenCalledWith('e1');
    expect(findTargets).toHaveBeenCalledWith('e2');
  });

  it.each([undefined, 'Channel offline'])('shows partial delivery and retry guidance with error %s', async (error) => {
    service.listByOrigin.mockReturnValue([new Errand({ ...draft, pendingDelivery: {
      id: 'delivery-1', type: 'opener', content: 'Hello', error,
      targets: [{ sessionId: 'one', sentAt: '2026-09-12T12:00:00Z' }, { sessionId: 'two' }],
    } })]);
    const result = await handleErrandCommand('/errand', context);
    expect(result.response).toContain('delivery: 1/2 sent');
    expect(result.response).toContain(`${error ?? 'Delivery pending'}. Retry with /errand retry e1`);
  });

  it.each(['/errand', '/errand Book with 555 on whatsapp', '/errand approve e1', '/errand reply e1 Yes'])(
    'reports unavailable channels for %s', async (command) => {
      vi.mocked(buildErrandService).mockReturnValue(null);
      const result = await handleErrandCommand(command, context);
      expect(result.response).toBe('Errands are not available: no channel manager is running.');
      expect(composeOpener).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(service.approve).not.toHaveBeenCalled();
      expect(service.resumeWithPrincipalAnswer).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Book a haircut', context, 'Usage: /errand <goal> with <contact> on <channel>'],
    ['Book with 555 on unknown', context, 'Unknown channel "unknown"'],
    ['Book with 555 on whatsapp', { ...context, sessionId: undefined }, 'no session to attribute it to'],
  ])('validates creation input %s before composing or saving', async (input, commandContext, message) => {
    const result = await handleErrandCommand(`/errand ${input}`, commandContext);
    expect(result.response).toContain(message);
    expect(composeOpener).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('stages a composed opener with approval instructions and normalizes channel casing', async () => {
    const result = await handleErrandCommand('/errand Book a haircut with 555 on WHATSAPP', context);
    expect(composeOpener).toHaveBeenCalledExactlyOnceWith({
      goal: 'Book a haircut', channel: 'whatsapp', peerId: '555', originSessionId: 'parent',
    });
    expect(service.create).toHaveBeenCalledExactlyOnceWith('Book a haircut', [{ channel: 'whatsapp', peerId: '555' }], 'parent', 'Is Saturday available?');
    expect(result.response).toContain('Draft message to 555:\n"Is Saturday available?"');
    expect(result.response).toContain('/errand approve e1');
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('keeps "with" inside the goal and anchors on the trailing keywords', async () => {
    await handleErrandCommand('/errand Ask about the meeting with Bob with 555 on whatsapp', context);
    expect(composeOpener).toHaveBeenCalledExactlyOnceWith({
      goal: 'Ask about the meeting with Bob', channel: 'whatsapp', peerId: '555', originSessionId: 'parent',
    });
  });

  it('rejects malformed input with many spaces without backtracking blowup', async () => {
    const started = Date.now();
    const result = await handleErrandCommand(`/errand a${' '.repeat(50_000)}with`, context);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.response).toContain('Usage: /errand <goal> with <contact> on <channel>');
  });

  it('explains contention when the new errand is queued', async () => {
    service.create.mockReturnValueOnce(new Errand({ ...draft, state: 'queued' }));
    const result = await handleErrandCommand('/errand Book a haircut with 555 on whatsapp', context);
    expect(result.response).toContain('Queued behind an existing errand');
    expect(result.response).not.toContain('/errand approve');
  });

  it.each([new Error('Cannot create errand'), 'Cannot create errand'])('reports creation failures: %s', async (error) => {
    service.create.mockImplementationOnce(() => { throw error; });
    const result = await handleErrandCommand('/errand Book with 555 on whatsapp', context);
    expect(result.response).toBe('Cannot create errand');
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('does not create an errand if composing the opener fails', async () => {
    composeOpener.mockRejectedValueOnce(new Error('Provider unavailable'));
    const result = await handleErrandCommand('/errand Book with 555 on whatsapp', context);
    expect(result.response).toBe('Provider unavailable');
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    ['approve', 'approve', 'awaiting_peer'], ['retry', 'retryDelivery', 'awaiting_peer'],
    ['close', 'resolve', 'resolved'], ['cancel', 'cancel', 'cancelled'],
  ] as const)('applies %s and reports the resulting state', async (verb, method, state) => {
    service[method].mockResolvedValueOnce(new Errand({ ...draft, state }));
    const result = await handleErrandCommand(`/errand ${verb.toUpperCase()} e1`, context);
    expect(service[method].mock.calls).toEqual([method === 'resolve' ? ['e1', 'Closed by the principal.'] : ['e1']]);
    expect(result.response).toBe(`Errand [e1] is now "${state}".`);
  });

  it.each(['approve', 'retry', 'close', 'cancel'])('requires an ID for %s', async (verb) => {
    const result = await handleErrandCommand(`/errand ${verb}`, context);
    expect(result.response).toBe(`Usage: /errand ${verb} <id>`);
    expect(buildErrandService).not.toHaveBeenCalled();
  });

  it.each([new Error('Delivery failed; retry e1'), 'Delivery failed; retry e1'])('reports action failures: %s', async (error) => {
    service.approve.mockRejectedValueOnce(error);
    const result = await handleErrandCommand('/errand approve e1', context);
    expect(result.response).toBe('Delivery failed; retry e1');
    expect(result.response).not.toContain('is now');
  });

  it.each(['reply', 'answer'])('resumes via %s with the full principal answer', async (verb) => {
    service.resumeWithPrincipalAnswer.mockResolvedValueOnce({ errand: draft, reply: 'Please book Saturday at 11.' });
    const result = await handleErrandCommand(`/errand ${verb} e1 Saturday at 11 works`, context);
    expect(service.resumeWithPrincipalAnswer).toHaveBeenCalledExactlyOnceWith('e1', 'Saturday at 11 works');
    expect(result.response).toBe('Errand [e1] resumed: sent "Please book Saturday at 11." to the contact. Status is now "waiting on them".');
  });

  it.each(['reply', 'reply e1', 'answer', 'answer e1'])('requires an ID and answer for %s', async (input) => {
    const result = await handleErrandCommand(`/errand ${input}`, context);
    expect(result.response).toContain('<id> <your message/answer>');
    expect(service.resumeWithPrincipalAnswer).not.toHaveBeenCalled();
    expect(buildErrandService).not.toHaveBeenCalled();
  });

  it.each([new Error('Nothing was sent'), 'Nothing was sent'])('reports resume failures without claiming delivery: %s', async (error) => {
    service.resumeWithPrincipalAnswer.mockRejectedValueOnce(error);
    const result = await handleErrandCommand('/errand reply e1 Yes', context);
    expect(result.response).toBe('Nothing was sent');
  });
});
