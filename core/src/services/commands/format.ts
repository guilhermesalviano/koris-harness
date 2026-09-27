import type { CommandResult } from '../../types/commands';

export function formatMessage(message: string, channel: string): string {
  // Telegram uses Markdown, TUI uses plain text
  if (channel === 'telegram') {
    return message;
  }
  return message.replace(/\*/g, '');
}

export function formatCommandResult(message: string, channel: string): CommandResult {
  return {
    response: formatMessage(message, channel),
    action: 'none',
    handled: true,
  };
}
