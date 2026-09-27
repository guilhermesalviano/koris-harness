export type NegotiatorAction = 'continue' | 'escalate' | 'resolved' | 'failed';

export interface NegotiatorVerdict {
  action: NegotiatorAction;
  reply: string;
  notes?: string;
  detail?: string;
}

const NEGOTIATOR_ACTIONS = new Set<NegotiatorAction>(['continue', 'escalate', 'resolved', 'failed']);

function isNegotiatorAction(value: string): value is NegotiatorAction {
  return NEGOTIATOR_ACTIONS.has(value as NegotiatorAction);
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function parseNegotiatorResponse(text: string): NegotiatorVerdict | null {
  const parsed = tryParseJson(text);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (typeof record.action !== 'string' || !isNegotiatorAction(record.action)) return null;
    for (const field of ['reply', 'notes', 'detail']) {
      if (record[field] !== undefined && typeof record[field] !== 'string') return null;
    }
    const action = record.action;
    const reply = typeof record.reply === 'string' ? record.reply.trim() : '';
    const notes = typeof record.notes === 'string' ? record.notes.trim() : undefined;
    const detail = typeof record.detail === 'string' ? record.detail.trim() : undefined;
    return { action, reply, notes, detail };
  }

  return null;
}
