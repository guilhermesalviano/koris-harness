import type { ILogger, IHeartbeatGateway, Plugin, ToolPluginContext, ToolResult } from '../contracts';
import { COMMANDS } from '../contracts';
import { defineTool } from '../define-tool';
import { getOptionalStringArg, getRequiredStringArg, isAllowedValue } from '../runtime';
import { hasSpecificHour, isEveryMinute, isOneTimeCron, isValidCronExpression } from '../cron';

export const TOOL_NAME = 'update_beat' as const;

const BEAT_TYPES = ['reminder', 'scheduled_beat'] as const;
const CHANNEL_TYPES = ['telegram', 'whatsapp'] as const;

function normalizeOptional(args: Record<string, unknown>, key: string): string | null | undefined {
  const value = getOptionalStringArg(args, key);
  if (value === null) return undefined;
  return value.length > 0 ? value : null;
}

export async function updateBeat(
  logger: ILogger,
  args: Record<string, unknown>,
  heartbeats: IHeartbeatGateway,
): Promise<ToolResult> {
  const id = getRequiredStringArg(args, 'id');

  if (!id) {
    return { toolName: TOOL_NAME, success: false, error: 'Missing required parameter: id' };
  }

  const beat = getOptionalStringArg(args, 'beat') ?? undefined;
  const cronExpression = getOptionalStringArg(args, 'cron_expression') ?? undefined;
  const rawType = getOptionalStringArg(args, 'type') ?? undefined;
  const channel = normalizeOptional(args, 'channel');
  const target = normalizeOptional(args, 'target');
  const recurring = typeof args.recurring === 'boolean' ? args.recurring : undefined;

  if (!beat && !cronExpression && !rawType && channel === undefined && target === undefined && recurring === undefined) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'At least one of "beat", "type", "cron_expression", "recurring", "channel", or "target" must be provided.',
    };
  }

  if (rawType && !isAllowedValue(rawType, BEAT_TYPES)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `Invalid type: "${rawType}". Must be one of: ${BEAT_TYPES.join(', ')}.`,
    };
  }

  if (channel && !isAllowedValue(channel, CHANNEL_TYPES)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `Invalid channel: "${channel}". Must be one of: ${CHANNEL_TYPES.join(', ')}.`,
    };
  }

  if ((channel && !target) || (!channel && target)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'Parameters "channel" and "target" must be provided together.',
    };
  }

  if (cronExpression && !isValidCronExpression(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `Invalid cron expression: "${cronExpression}". Expected 5-field standard cron format (e.g. "0 9 * * 1" for every Monday at 9am).`,
    };
  }

  if (cronExpression && isEveryMinute(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'Beats that run every minute are not allowed. Please provide a less frequent schedule.',
    };
  }

  if (cronExpression && !hasSpecificHour(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'No specific hour was provided for an every-minute schedule. Ask the user what hour they want this beat to run (e.g. "* 9 * * *" for every minute during 9am).',
    };
  }

  try {
    const existing = heartbeats.getById(id);
    if (!existing) {
      return { toolName: TOOL_NAME, success: false, error: `Beat not found: ${id}` };
    }

    const runOnce = recurring === undefined ? existing.runOnce : !recurring;
    const effectiveCron = cronExpression ?? existing.cronExpression;
    if (runOnce && !isOneTimeCron(effectiveCron)) {
      return {
        toolName: TOOL_NAME,
        success: false,
        error: `"${effectiveCron}" repeats, but this beat is one-time. Pin the exact minute, hour, day-of-month and month and leave day-of-week as "*" (e.g. "30 9 15 6 *"), computed from the current date/time. If the user explicitly asked for a repeating schedule (every day/week/month/year), call again with recurring: true.`,
      };
    }

    const updated = heartbeats.update(id, {
      beat,
      type: rawType,
      cronExpression: cronExpression?.trim(),
      channel,
      target,
      runOnce: recurring === undefined ? undefined : !recurring,
    });
    heartbeats.reschedule();

    logger.info('Beat updated', { id });

    return {
      toolName: TOOL_NAME,
      success: true,
      result: JSON.stringify(updated),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('update_beat failed', { error: errorMsg });
    return { toolName: TOOL_NAME, success: false, error: errorMsg };
  }
}

export function create(context: ToolPluginContext): Plugin {
  return {
    name: 'update-beat',
    setup(registry) {
      const definition = defineTool({
        name: TOOL_NAME,
        description: 'Update an existing beat. Call this when the user wants to change the description, type, or schedule of a beat. Use list_beats first if the ID is not known. A one-time beat (runOnce: true in list_beats) keeps a pinned date unless you also pass recurring: true.',
        parameters: {
          id: { type: 'string', required: true, description: 'The UUID of the beat to update.' },
          beat: { type: 'string', description: 'New description for the beat (optional).' },
          type: {
            type: 'string',
            enum: ['reminder', 'scheduled_beat'],
            description: 'New type for the beat (optional): "reminder" or "scheduled_beat".',
          },
          cron_expression: {
            type: 'string',
            description: 'New 5-field cron expression for the schedule (optional). One-time beats need a pinned date (e.g. "30 9 15 6 *" = June 15th at 9:30am, derived from the current date/time). Recurring examples: "0 9 * * *" (daily at 9am), "0 9 * * 1" (every Monday at 9am), "0 9 25 12 *" (every year on December 25th).',
          },
          recurring: {
            type: 'boolean',
            description: 'Optional. true turns the beat into a recurring one (keeps firing every year until deleted); false turns it into a one-time beat (fires once at its pinned date, then is deleted). Omit to keep the current behavior.',
          },
          channel: {
            type: 'string',
            enum: CHANNEL_TYPES,
            description: 'New channel for the beat (optional), if it should notify a different chat. Must be provided together with target.',
          },
          target: {
            type: 'string',
            description: 'New recipient address (Telegram chat id or WhatsApp JID) for the beat (optional). Must be provided together with channel.',
          },
        },
        handler: (logger, args) => updateBeat(logger, args, context.heartbeats),
        enabled: (opts) => opts.trusted && opts.agentName !== 'heartbeat' && context.pluginEnablement.isEnabled('update-beat'),
      });
      registry.extend(COMMANDS, definition);
    },
  };
}
