import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrandRecord, IErrandsGateway, ILogger, ToolDefinition, ToolPluginContext } from '../contracts';
import type { PluginRegistry } from '../../registry';
import {
  TOOL_NAMES, answerErrand, approveErrand, cancelErrand, closeErrand, create, listErrands, normalizeContact, pickErrand, resolveErrand, startErrand,
} from './index';

const logger: ILogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
const chat = { sessionId: 'chat-1', channel: 'web' };

function errand(patch: Partial<ErrandRecord> = {}): ErrandRecord {
  return {
    id: 'e1', goal: 'Book a class', state: 'awaiting_principal', originSessionId: 'chat-1',
    pendingMessage: 'Wednesday instead?', deliveryIncomplete: false, createdAt: '2026-09-13T10:00:00Z', ...patch,
  };
}

function gateway(errands: ErrandRecord[] = [errand()]): { [K in keyof IErrandsGateway]: ReturnType<typeof vi.fn> } & IErrandsGateway {
  return {
    listForSession: vi.fn().mockReturnValue(errands),
    start: vi.fn().mockResolvedValue({ errand: errand({ id: 'new', state: 'draft' }), openingMessage: 'Hi! Is Friday free?' }),
    approve: vi.fn().mockResolvedValue(errand({ state: 'awaiting_peer' })),
    retry: vi.fn().mockResolvedValue(errand({ state: 'awaiting_peer' })),
    answer: vi.fn().mockResolvedValue({ errand: errand({ state: 'awaiting_peer' }), reply: 'Perfeito, quarta então!' }),
    confirm: vi.fn().mockResolvedValue(errand({ state: 'resolved' })),
    close: vi.fn().mockResolvedValue(errand({ state: 'resolved' })),
    cancel: vi.fn().mockResolvedValue(errand({ state: 'cancelled' })),
    followUrl: vi.fn().mockReturnValue('http://koris.local:3000/admin/agents/negotiator'),
  } as never;
}

describe('pickErrand', () => {
  const waiting = (item: ErrandRecord) => item.state === 'awaiting_principal';

  it('uses the only matching errand when no id is given', () => {
    expect(pickErrand([errand(), errand({ id: 'e2', state: 'resolved' })], null, waiting, 'waiting')).toEqual({ errand: errand() });
  });

  it('asks for an id, listing the candidates, when several match', () => {
    const picked = pickErrand([errand(), errand({ id: 'e2', goal: 'Buy milk' })], null, waiting, 'waiting');
    expect(picked).toEqual({ error: expect.stringContaining('Ask the human which one') });
    expect((picked as { error: string }).error).toContain('[e2]');
  });

  it('explains when nothing matches, the id is not from this chat, or the errand is in another state', () => {
    expect(pickErrand([], null, waiting, 'waiting')).toEqual({ error: 'No errand in this chat is waiting.' });
    expect(pickErrand([errand()], 'other', waiting, 'waiting')).toEqual({ error: 'No errand "other" was started from this chat.' });
    expect(pickErrand([errand({ state: 'open' })], 'e1', waiting, 'waiting')).toEqual({ error: 'Errand e1 is in progress, not waiting.' });
  });
});

describe('errand tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to run without a chat session', async () => {
    const errands = gateway();
    const result = await answerErrand(logger, { answer: 'yes' }, undefined, errands);
    expect(result).toMatchObject({ success: false, error: 'Errand tools need the current chat session.' });
    expect(errands.listForSession).not.toHaveBeenCalled();
  });

  it('answers the single pending question with a plain "yes"', async () => {
    const errands = gateway([errand(), errand({ id: 'e2', state: 'awaiting_peer' })]);
    const result = await answerErrand(logger, { answer: 'sim' }, chat, errands);
    expect(errands.listForSession).toHaveBeenCalledWith('chat-1');
    expect(errands.answer).toHaveBeenCalledExactlyOnceWith('e1', 'sim');
    expect(result).toMatchObject({ success: true, result: expect.stringContaining('"Perfeito, quarta então!"') });
  });

  it('asks to retry delivery before answering an errand whose message did not go out', async () => {
    const errands = gateway([errand({ deliveryIncomplete: true })]);
    const result = await answerErrand(logger, { answer: 'yes' }, chat, errands);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining(TOOL_NAMES.approve) });
    expect(errands.answer).not.toHaveBeenCalled();
  });

  it('returns gateway failures as tool errors', async () => {
    const errands = gateway();
    errands.answer.mockRejectedValue(new Error('This errand is busy.'));
    expect(await answerErrand(logger, { answer: 'yes' }, chat, errands)).toMatchObject({ success: false, error: 'This errand is busy.' });
  });

  it('approves a draft, and retries an incomplete delivery instead of approving it', async () => {
    const draft = gateway([errand({ state: 'draft', pendingMessage: 'Hi!' })]);
    expect(await approveErrand(logger, {}, chat, draft)).toMatchObject({ success: true, result: expect.stringContaining('sent the opener') });
    expect(draft.approve).toHaveBeenCalledWith('e1');
    expect(draft.retry).not.toHaveBeenCalled();

    const stuck = gateway([errand({ state: 'draft', deliveryIncomplete: true })]);
    await approveErrand(logger, { errandId: 'e1' }, chat, stuck);
    expect(stuck.retry).toHaveBeenCalledWith('e1');
    expect(stuck.approve).not.toHaveBeenCalled();
  });

  it('starts an errand on the current messaging channel with a normalized WhatsApp number', async () => {
    const errands = gateway();
    const result = await startErrand(logger, { goal: 'Book a class', contact: '+55 (11) 99999-8888' }, { sessionId: 'chat-1', channel: 'whatsapp' }, errands);
    expect(errands.start).toHaveBeenCalledWith({ goal: 'Book a class', channel: 'whatsapp', peerId: '5511999998888', originSessionId: 'chat-1' });
    expect(result).toMatchObject({ success: true });
  });

  it('only stages the opener and has the Orchestrator ask the human to approve it', async () => {
    const errands = gateway();
    const result = await startErrand(logger, { goal: 'Pedir um lanche', contact: '5511948449969', channel: 'whatsapp' }, chat, errands);
    expect(errands.approve).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, result: expect.stringContaining('ask whether to send it') });
    expect(result.result).toContain('"Hi! Is Friday free?"');
    expect(result.result).not.toContain('follow details on');
  });

  it('shares the follow link once the approved opener is sent', async () => {
    const errands = gateway([errand({ state: 'draft', pendingMessage: 'Hi!' })]);
    const result = await approveErrand(logger, {}, chat, errands);
    expect(result).toMatchObject({ success: true, result: expect.stringMatching(/follow details on http:\/\/koris\.local:3000\/admin\/agents\/negotiator$/) });
  });

  it('does not share the follow link when retrying a reply to the contact', async () => {
    const errands = gateway([errand({ state: 'awaiting_principal', deliveryIncomplete: true })]);
    const result = await approveErrand(logger, {}, chat, errands);
    expect(errands.retry).toHaveBeenCalledWith('e1');
    expect(result.result).not.toContain('follow details on');
  });

  it('reports an approved opener that failed to send', async () => {
    const errands = gateway([errand({ state: 'draft', pendingMessage: 'Hi!' })]);
    errands.approve.mockRejectedValue(new Error('WhatsApp is disconnected'));
    expect(await approveErrand(logger, {}, chat, errands)).toMatchObject({ success: false, error: 'WhatsApp is disconnected' });
  });

  it('needs an explicit, known channel outside WhatsApp and Telegram chats', async () => {
    const errands = gateway();
    expect(await startErrand(logger, { goal: 'Book', contact: '555' }, chat, errands)).toMatchObject({ success: false, error: expect.stringContaining('channel') });
    expect(await startErrand(logger, { goal: 'Book', contact: '555', channel: 'email' }, chat, errands)).toMatchObject({ success: false, error: expect.stringContaining('Unknown channel') });
    expect(errands.start).not.toHaveBeenCalled();
    await startErrand(logger, { goal: 'Book', contact: '12345', channel: 'Telegram' }, chat, errands);
    expect(errands.start).toHaveBeenCalledWith(expect.objectContaining({ channel: 'telegram', peerId: '12345' }));
  });

  it('lists, closes and cancels this chat\'s errands', async () => {
    const errands = gateway([errand(), errand({ id: 'e2', goal: 'Buy milk', state: 'resolved', result: 'Bought' })]);
    const list = await listErrands(logger, {}, chat, errands);
    expect(list.result).toContain('Pending question: Wednesday instead?');
    expect(list.result).toContain('Result: Bought');

    await closeErrand(logger, {}, chat, errands);
    expect(errands.close).toHaveBeenCalledWith('e1', 'Closed by the principal.');
    await closeErrand(logger, { result: 'Booked Wednesday' }, chat, errands);
    expect(errands.close).toHaveBeenLastCalledWith('e1', 'Booked Wednesday');
    await cancelErrand(logger, {}, chat, errands);
    expect(errands.cancel).toHaveBeenCalledWith('e1');
    expect(await cancelErrand(logger, { errandId: 'e2' }, chat, errands)).toMatchObject({ success: false });
  });

  it('confirms the only proposed result, and passes extra requirements for it through answer_errand', async () => {
    const proposed = errand({ id: 'p1', state: 'awaiting_confirmation', pendingMessage: 'Booked Saturday at 11' });
    const errands = gateway([proposed, errand({ id: 'e2', state: 'awaiting_peer' })]);

    const resolved = await resolveErrand(logger, {}, chat, errands);
    expect(errands.confirm).toHaveBeenCalledExactlyOnceWith('p1');
    expect(resolved).toMatchObject({ success: true, result: expect.stringContaining('closing message') });

    await answerErrand(logger, { answer: 'also a beard trim' }, chat, errands);
    expect(errands.answer).toHaveBeenCalledWith('p1', 'also a beard trim');

    const list = await listErrands(logger, {}, chat, errands);
    expect(list.result).toContain('Proposed result: Booked Saturday at 11');

    const none = gateway([errand({ state: 'awaiting_peer' })]);
    expect(await resolveErrand(logger, {}, chat, none)).toMatchObject({ success: false });
    expect(none.confirm).not.toHaveBeenCalled();
  });

  it('keeps JIDs and Telegram ids as given', () => {
    expect(normalizeContact('whatsapp', '141789856067723@lid')).toBe('141789856067723@lid');
    expect(normalizeContact('telegram', '-100123')).toBe('-100123');
  });
});

describe('create', () => {
  function register(trusted: boolean, enabledPlugin = true) {
    const extend = vi.fn();
    const context = { errands: gateway(), pluginEnablement: { isEnabled: vi.fn().mockReturnValue(enabledPlugin) } } as unknown as ToolPluginContext;
    create(context).setup({ extend } as unknown as PluginRegistry);
    const tools = extend.mock.calls.map(([, tool]) => tool as ToolDefinition);
    return { tools, enabled: tools.map((tool) => tool.enabled({ trusted })), context };
  }

  it('registers every errand tool for trusted senders only, behind the errands plugin switch', () => {
    const { tools, enabled, context } = register(true);
    expect(tools.map((tool) => tool.name)).toEqual(Object.values(TOOL_NAMES));
    expect(enabled.every(Boolean)).toBe(true);
    expect(context.pluginEnablement.isEnabled).toHaveBeenCalledWith('errands');
    expect(register(false).enabled.some(Boolean)).toBe(false);
    expect(register(true, false).enabled.some(Boolean)).toBe(false);
  });

  it('marks destructive tools as requiring confirmation', () => {
    const { tools } = register(true);
    const confirmed = tools.filter((tool) => tool.schema.description.startsWith('REQUIRES CONFIRMATION')).map((tool) => tool.name);
    expect(confirmed).toEqual([TOOL_NAMES.close, TOOL_NAMES.cancel]);
  });

  it('routes handlers through the context gateway', async () => {
    const { tools, context } = register(true);
    const answer = tools.find((tool) => tool.name === TOOL_NAMES.answer)!;
    await answer.handler(logger, { answer: 'yes' }, chat);
    expect(context.errands.answer).toHaveBeenCalledWith('e1', 'yes');
  });
});
