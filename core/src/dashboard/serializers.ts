import type { Message } from '../entities/message';
import type { Session } from '../entities/session';
import type { Memory } from '../entities/memory';
import type { AuditLogRow } from '../repositories/audit-log';
import { SESSION_START_REASONS, type SessionStartReason } from '../types/session';

export function toMessageJson(m: Message) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    senderAgentId: m.senderAgentId,
    images: m.images,
    missingImages: m.missingImages,
    errorCode: m.errorCode,
    createdAt: m.createdAt,
  };
}

export function toSessionJson(session: Session) {
  return {
    id: session.id,
    channel: session.channel,
    peerId: session.peerId,
    kind: session.kind,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messageCount,
    metadata: session.metadata,
  };
}

export function toMemoryJson(memory: Memory) {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    importance: memory.importance,
    tags: memory.tags,
    createdAt: memory.createdAt,
  };
}

export function sessionStartReason(session: Session): SessionStartReason | null {
  const value = session.metadata.startReason;
  return SESSION_START_REASONS.includes(value as SessionStartReason) ? (value as SessionStartReason) : null;
}

export function previewText(value: string | null, maxLength = 120): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

export function toAuditJson(row: AuditLogRow) {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    channel: row.channel,
    type: row.type,
    role: row.role,
    agentName: row.agent_name,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    promptPreview: previewText(row.prompt ?? null),
    promptLength: row.prompt_length,
    response: row.response,
    responsePreview: previewText(row.response ?? null),
    responseLength: row.response_length,
    finishReason: row.finish_reason,
    toolCalls: row.tool_calls,
    toolsEnabled: row.tools_enabled == null ? undefined : row.tools_enabled === 1,
    toolName: row.tool_name,
    toolArgs: row.tool_args,
    success: row.success == null ? undefined : row.success === 1,
    durationMs: row.duration_ms,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}
