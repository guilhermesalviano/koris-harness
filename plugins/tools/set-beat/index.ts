import type { ILogger, IHeartbeatGateway, Plugin, ToolPluginContext, ToolResult } from '../contracts';
import { COMMANDS } from '../contracts';
import { defineTool } from '../define-tool';
import { getRequiredStringArg, getOptionalStringArg, getOptionalBooleanArg, isAllowedValue } from '../runtime';
import { hasSpecificHour, isEveryMinute, isOneTimeCron, isValidCronExpression } from '../cron';

export const TOOL_NAME = 'set_beat' as const;

const BEAT_TYPES = ['reminder', 'scheduled_beat'] as const;
const CHANNEL_TYPES = ['telegram', 'whatsapp'] as const;

export async function setBeat(
  logger: ILogger,
  args: Record<string, unknown>,
  heartbeats: IHeartbeatGateway,
): Promise<ToolResult> {
  const beat = getRequiredStringArg(args, 'beat');
  const cronExpression = getRequiredStringArg(args, 'cron_expression');
  const rawType = getOptionalStringArg(args, 'type') ?? 'reminder';
  const rawChannel = getOptionalStringArg(args, 'channel');
  const rawTarget = getOptionalStringArg(args, 'target');
  const recurring = getOptionalBooleanArg(args, 'recurring', false);

  if (!beat) {
    return { toolName: TOOL_NAME, success: false, error: 'Missing required parameter: beat' };
  }

  if (!cronExpression) {
    return { toolName: TOOL_NAME, success: false, error: 'Missing required parameter: cron_expression' };
  }

  if (!isAllowedValue(rawType, BEAT_TYPES)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `Invalid parameter: type. Must be one of: ${BEAT_TYPES.join(', ')}.`,
    };
  }

  if (rawChannel && !isAllowedValue(rawChannel, CHANNEL_TYPES)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `Invalid parameter: channel. Must be one of: ${CHANNEL_TYPES.join(', ')}.`,
    };
  }

  if ((rawChannel && !rawTarget) || (!rawChannel && rawTarget)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'Parameters "channel" and "target" must be provided together.',
    };
  }

  if (!isValidCronExpression(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `Invalid cron expression: "${cronExpression}". Expected 5-field standard cron format (e.g. "0 9 * * 1" for every Monday at 9am).`,
    };
  }

  if (isEveryMinute(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'Beats that run every minute are not allowed. Please provide a less frequent schedule.',
    };
  }

  if (!hasSpecificHour(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: 'No specific hour was provided for an every-minute schedule. Ask the user what hour they want this beat to run (e.g. "* 9 * * *" for every minute during 9am).',
    };
  }

  if (!recurring && !isOneTimeCron(cronExpression)) {
    return {
      toolName: TOOL_NAME,
      success: false,
      error: `"${cronExpression}" repeats, but this beat is one-time (recurring is false). Pin the exact minute, hour, day-of-month and month and leave day-of-week as "*" (e.g. "30 9 15 6 *"), computed from the current date/time. If the user explicitly asked for a repeating schedule (every day/week/month/year), call again with recurring: true.`,
    };
  }

  try {
    const heartbeat = heartbeats.create({
      beat,
      type: rawType,
      cronExpression: cronExpression.trim(),
      channel: rawChannel ?? undefined,
      target: rawTarget ?? undefined,
      runOnce: !recurring,
    });
    heartbeats.reschedule();

    logger.info('Beat saved', { id: heartbeat.id, beat, type: rawType, cronExpression, recurring, channel: rawChannel, target: rawTarget });

    return {
      toolName: TOOL_NAME,
      success: true,
      result: JSON.stringify(heartbeat),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('set_beat failed', { error: errorMsg });
    return { toolName: TOOL_NAME, success: false, error: errorMsg };
  }
}

export function create(context: ToolPluginContext): Plugin {
  return {
    name: 'set-beat',
    setup(registry) {
      const definition = defineTool({
        name: TOOL_NAME,
        description:
          'Schedule an action to happen at a specific time (a "beat") — for reminders that message the user, but also for background tasks. Use this whenever the user asks to be reminded, notified, alerted or pinged later (e.g. "remind me…", "me lembra…", "me avisa…") or asks the agent to do something at a later time ("me avise amanhã para…", "amanhã me cobra remarcar a consulta"). When the beat fires the agent is not invoked to generate anything on the spot: for "reminder" beats your job is to write the final message text that will be delivered by another code execution; for "scheduled_beat" beats you define the task/tool call to be executed. It is the only tool that makes the agent act on its own on schedule. Tools that add items to external todo/task lists (e.g. `*__create_todo`) do NOT notify the user nor get executed by the agent; use those only when the user explicitly asks to add a task/todo to that list. DEFAULT BEHAVIOR: when the user does not ask for repetition, create a one-time beat (recurring: false, the default): work out the target date/time from the current date/time in the session context (e.g. "tomorrow at 9" → the day and month of tomorrow) and pin the exact minute, hour, day-of-month and month. It fires once and is then deleted. Only when the user explicitly asks for a repeating schedule ("every day", "every Monday", "every month", "every year", "todo dia"…) set recurring: true — recurring beats keep firing indefinitely, year after year.',
        parameters: {
          beat: {
            type: 'string',
            required: true,
            description: 'What to deliver or run when the beat fires. For "reminder": the exact final message text to show the user (e.g. "Alimentar os cachorros"), since the agent will not be invoked to compose it at delivery time. For "scheduled_beat": the task or tool call to execute (e.g. an instruction describing the job for the scheduled run).',
          },
          type: {
            type: 'string',
            enum: ['reminder', 'scheduled_beat'],
            description: 'Type of the beat (optional, defaults to "reminder"): "reminder" for one-time or recurring beats that deliver a message to the user, "scheduled_beat" for automated background beats that run a task/tool call (e.g. querying something and reporting back).',
          },
          recurring: {
            type: 'boolean',
            description: 'Optional, defaults to false (one-time: fires once at the pinned date/time, then is deleted). Set true ONLY when the user explicitly asks for repetition (daily, weekly, monthly, yearly…); the beat then keeps firing on every cron match, every year, until deleted.',
          },
          cron_expression: {
            type: 'string',
            required: true,
            description:
              'Standard 5-field cron expression. Format: "minute hour day-of-month month day-of-week". ' +
              'One-time (recurring: false, the default): pin minute, hour, day-of-month and month to single numbers and leave day-of-week as "*", derived from the current date/time (e.g. "30 9 15 6 *" = June 15th at 9:30am; a date already past this year fires next year). ' +
              'Recurring (recurring: true, only when the user explicitly asks): ' +
              '"0 9 * * *" (every day at 9am), "0 9 * * 1" (every Monday at 9am), "0 8 1 * *" (1st of every month at 8am), "0 9 25 12 *" (every year on December 25th at 9am), "*/30 * * * *" (every 30 min).',
          },
          channel: {
            type: 'string',
            enum: CHANNEL_TYPES,
            description: 'Optional: channel to use instead of the current chat, if this beat should notify a different chat. Must be provided together with target.',
          },
          target: {
            type: 'string',
            description: 'Optional: recipient address (Telegram chat id or WhatsApp JID) to use instead of the current chat. Must be provided together with channel.',
          },
        },
        handler: (logger, args) => setBeat(logger, args, context.heartbeats),
        // Excludes the heartbeat sub-agent to avoid a beat recursively scheduling more beats.
        enabled: (opts) => opts.trusted && opts.agentName !== 'heartbeat' && context.pluginEnablement.isEnabled('set-beat'),
      });
      registry.extend(COMMANDS, definition);
    },
  };
}
