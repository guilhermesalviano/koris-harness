import type { CommandResult } from '../../types/commands';

export function formatMessage(message: string, _channel: string): string {
  return message.replace(/\*/g, '');
}

export function formatCommandResult(message: string, channel: string): CommandResult {
  return {
    response: formatMessage(message, channel),
    action: 'none',
    handled: true,
  };
}
