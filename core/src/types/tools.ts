import type { ILogger } from "../infrastructure/logger";
import type { StickerReference } from "../../../plugins/channels/contracts";

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque provider data that must be sent back with this call on the next
   * turn (OpenAI-compat `extra_content`, e.g. Gemini's `thought_signature`). */
  extraContent?: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
  toolCallId?: string;
  /**
   * Set on a successful result when the tool's user-facing effect is already fully
   * delivered by the tool itself. The executor loop skips its post-tool synthesis
   * call entirely when every result in a batch is silent and successful.
   */
  silent?: boolean;
}

export interface ToolExecutionContext {
  channel?: string;
  sessionId?: string;
  runId?: string;
  agentName?: string;
  stickers?: StickerReference[];
  target?: string;
}

export type CommandFn = (
  logger: ILogger,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<ToolResult>;

export interface AIAgentRequest {
  model?: string;
}
