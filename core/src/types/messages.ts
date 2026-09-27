import type { ImageAttachment } from '../../../plugins/channels/contracts';

export type { ImageAttachment };

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
  /** See `ToolCall.extraContent`. */
  extraContent?: Record<string, unknown>;
}

export interface Message {
  role: MessageRole;
  content: string;
  images?: ImageAttachment[];
  tool_call_id?: string;
  tool_calls?: MessageToolCall[];
}