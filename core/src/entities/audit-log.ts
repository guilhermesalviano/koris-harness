import { AIFinishReason } from "../types/chat";

export type AuditType = 'llm' | 'tool';
export type AuditStatus = 'success' | 'error';
export type AuditRole = 'manager' | 'worker';

interface AuditLogBase {
  id: string;
  runId?: string;
  sessionId?: string;
  channel?: string;
  role: AuditRole;
  agentName?: string;
  createdAt: Date;
}

export interface AuditLogLlm extends AuditLogBase {
  type: 'llm';
  provider: string;
  model?: string;
  prompt: string;
  promptLength?: number;
  response?: string;
  responseLength?: number;
  finishReason?: AIFinishReason;
  toolCalls: number;
  toolsEnabled?: boolean;
  durationMs: number;
  status: AuditStatus;
  errorCode?: string;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AuditLogTool extends AuditLogBase {
  type: 'tool';
  toolName: string;
  toolArgs?: string;
  success: boolean;
  response?: string;
  durationMs: number;
  status: AuditStatus;
  errorMessage?: string;
}

export type AuditLog = AuditLogLlm | AuditLogTool;
