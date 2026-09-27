import { config } from '../../config';
import { handleUsageCommand } from './usage';
import { handleSkillsCommand, isSkillCommand, listSkillCommands, resolveSkillCommand } from './skills';
import { handleToolsCommand } from './tools';
import { handleChannelsCommand } from './channels';
import { handleMcpsCommand } from './mcps';
import { handleErrandCommand } from './errands';
import { handleMemoriesCommand } from './memories';
import { formatCommandResult, formatMessage } from './format';
import { addAllowedDomain } from '../security/allowed-domains';
import {
  commandToken,
  findCommand,
  isKnownCommand,
  listCommandsFor,
} from './registry';
import type { CommandContext, CommandResult } from '../../types/commands';

export { SLASH_COMMANDS, findCommand, isKnownCommand } from './registry';
export type { CommandSpec, CommandChannel } from './registry';
export { handleSkillsCommand, isSkillCommand, listSkillCommands, listSkills, resolveSkillCommand } from './skills';
export { handleToolsCommand, listTools } from './tools';
export { handleChannelsCommand, listChannels, listInstalledChannelNames } from './channels';
export { handleMcpsCommand, listInstalledMcpNames } from './mcps';
export { handleErrandCommand } from './errands';
export { handleMemoriesCommand } from './memories';
export { formatCommandResult, formatMessage } from './format';

export async function handleCommand(command: string, context: CommandContext): Promise<CommandResult> {
  switch (commandToken(command)) {
    case '/help':
      return handleHelp(command, context);

    case '/status':
      return handleStatus(context);

    case '/usage':
      return handleUsageCommand(command, context);

    case '/whoami':
      return handleWhoami(context);

    case '/memory':
      return { action: 'memory', handled: true };

    case '/memories':
      return handleMemoriesCommand(command, context);

    case '/clear':
    case '/reset':
      return handleClear(context);

    case '/compact':
      return handleCompact(context);

    case '/mode':
      return handleMode(command);

    case '/allow':
      return handleAllow(command, context);

    case '/skills':
      return handleSkillsCommand(command, context);

    case '/tools':
      return handleToolsCommand(command, context);

    case '/channels':
      return handleChannelsCommand(command, context);

    case '/mcps':
      return handleMcpsCommand(command, context);

    case '/errand':
      return handleErrandCommand(command, context);

    case '/skill':
      return handleSkill(command, context);

    case '/exit':
    case '/quit':
    case '/bye':
      return handleExit(context);

    default: {
      const skill = resolveSkillCommand(command);
      if (skill) return runSkill(skill, context);

      return {
        response: formatMessage(
          `Unknown command: ${command}\nType /help for available commands`,
          context.source,
        ),
        action: 'none',
        handled: false,
      };
    }
  }
}

function handleSkill(command: string, context: CommandContext): CommandResult {
  if (config.SKILLS.MODE !== 'manual') {
    return formatCommandResult(
      'Skills are already loaded into my context on every message (skills.mode = "auto"). ' +
      'Switch skills.mode to "manual" to load them on demand instead.',
      context.source,
    );
  }

  const name = command.trim().split(/\s+/)[1];
  if (!name) {
    return formatCommandResult(
      `Usage: /skill <name> [request]\n\n${formatSkillList()}`,
      context.source,
    );
  }

  const skill = resolveSkillCommand(command);
  if (!skill) {
    return formatCommandResult(
      `No enabled skill named "${name}".\n\n${formatSkillList()}`,
      context.source,
    );
  }

  return runSkill(skill, context);
}

/**
 * Hand the turn to the agent with the skill's documentation injected. Skills
 * follow the same trust gate as the context-injected ones
 * (`learnedSkillsEnabled`), so an untrusted sender never reaches one.
 */
function runSkill(
  skill: { name: string; content: string; args: string },
  context: CommandContext,
): CommandResult {
  if (context.learnedSkillsEnabled === false) {
    return formatCommandResult('Skills are only available to trusted senders.', context.source);
  }

  return { action: 'skill', skill, handled: true };
}

function formatSkillList(): string {
  const skills = listSkillCommands();
  if (skills.length === 0) return 'No skills are enabled.';

  const rows = skills.map((skill) => `  /${skill.name}${skill.description ? ` — ${skill.description}` : ''}`);
  return `Skills:\n${rows.join('\n')}`;
}

function handleHelp(command: string, context: CommandContext): CommandResult {
  const arg = command.trim().split(/\s+/)[1];

  if (arg) {
    const spec = findCommand(arg);
    if (!spec) {
      return formatCommandResult(
        `Unknown command: ${arg}\nType /help for the full list.`,
        context.source,
      );
    }

    const lines = [`*${spec.name}*`, '', `  ${spec.summary}`];
    if (spec.usage) lines.push('', `  Usage: ${spec.usage}`);
    if (spec.aliases?.length) lines.push('', `  Aliases: ${spec.aliases.join(', ')}`);
    if (spec.trusted) lines.push('', '  Restricted to trusted senders.');
    if (spec.details) lines.push('', spec.details);
    return formatCommandResult(lines.join('\n'), context.source);
  }

  const rows = listableCommands(context.source).map((spec) => {
    const invocation = spec.usage ?? spec.name;
    return `${invocation.padEnd(20)} ${spec.summary}`;
  });

  const skillSection = config.SKILLS.MODE === 'manual' ? `\n\n${formatSkillList()}` : '';

  const message = `*Available Commands:*

${rows.join('\n')}${skillSection}

Send me any message to interact!`;

  return formatCommandResult(message, context.source);
}

function handleStatus(context: CommandContext): CommandResult {
  if (context.source === 'telegram') {
    return {
      response: `✅ *Bot Status*

• Connection: Active
• AI Provider: *${config.AI.MANAGER.PROVIDER}*
• Model: *${config.AI.MANAGER.MODEL}*
• Session mode: *${config.SESSION.SUMMARIZER_MODE}*`,
      action: 'none',
      handled: true,
    };
  }

  return {
    response: `Status:

  Connection:   Active
  AI Provider:  ${config.AI.MANAGER.PROVIDER}
  Model:        ${config.AI.MANAGER.MODEL}
  Base URL:     ${config.AI.MANAGER.BASE_URL}
  Session mode: ${config.SESSION.SUMMARIZER_MODE}`,
    action: 'none',
    handled: true,
  };
}

function handleWhoami(context: CommandContext): CommandResult {
  const access = context.trusted
    ? 'trusted — tools and learned skills enabled'
    : 'standard — chat only, tools disabled';

  const lines = [
    '*Who you are to me*',
    '',
    `  Channel: ${context.source}`,
    `  Access:  ${access}`,
  ];
  if (context.originId) lines.push(`  ID:      ${context.originId}`);

  return formatCommandResult(lines.join('\n'), context.source);
}

function handleClear(context: CommandContext): CommandResult {
  const response = context.source === 'telegram'
    ? '🗑️ Cleared. Starting a fresh session.'
    : 'Cleared. Starting a fresh session.';

  return { response, action: 'clear', handled: true };
}

function handleCompact(context: CommandContext): CommandResult {
  const response = context.source === 'telegram'
    ? '🗜️ Compacting session — starting a fresh one with a summary of what we covered.'
    : 'Compacting session — starting a fresh one with a summary of what we covered.';

  return { response, action: 'compact', handled: true };
}

function handleMode(command: string): CommandResult {
  const arg = command.trim().split(/\s+/)[1]?.toLowerCase();

  if (!arg) {
    return { action: 'mode', handled: true };
  }

  if (arg !== 'text' && arg !== 'voice') {
    return { response: 'Usage: /mode [text|voice]', action: 'none', handled: true };
  }

  return { action: 'mode', mode: arg, handled: true };
}

function handleAllow(command: string, context: CommandContext): CommandResult {
  const domain = command.trim().split(/\s+/)[1] ?? '';

  if (!context.trusted) {
    return formatCommandResult('Only trusted senders can change allowed_domains.', context.source);
  }

  if (!domain) {
    return formatCommandResult(
      'Usage: /allow <domain> — adds a domain to allowed_domains in koris.json so I can reach it.',
      context.source,
    );
  }

  const result = addAllowedDomain(domain);
  if (!result.ok) {
    return formatCommandResult(result.error, context.source);
  }

  const message = result.added
    ? `Added ${result.hostname} to allowed_domains. I can reach it now.`
    : `${result.hostname} is already in allowed_domains.`;
  return formatCommandResult(message, context.source);
}

function handleExit(context: CommandContext): CommandResult {
  const response = context.source === 'telegram'
    ? 'This bot stays running. Use /clear to start a fresh session.'
    : 'To leave koris, press Ctrl+C. Use /clear to start a fresh session.';

  return { response: formatMessage(response, context.source), action: 'none', handled: true };
}



/**
 * Whether a message names a command koris handles. Matches the known command
 * set (canonical names and aliases) rather than a bare leading slash, so an
 * unrecognised `/something` flows to the agent like any other message.
 */
export function isCommand(message: string): boolean {
  return isKnownCommand(message) || isSkillCommand(message);
}

/**
 * Specs listable on a channel, minus `/skill` when `skills.mode` is `auto`
 * (there is nothing to load on demand in that mode).
 */
function listableCommands(channel: string) {
  return listCommandsFor(channel).filter(
    (spec) => spec.name !== '/skill' || config.SKILLS.MODE === 'manual',
  );
}

/**
 * Flat list of command tokens (canonical names + aliases) listable on a
 * channel, for input completion.
 */
export function getAvailableCommands(channel: string): string[] {
  return [
    ...listableCommands(channel).flatMap((spec) => [spec.name, ...(spec.aliases ?? [])]),
    ...listSkillCommands().map((skill) => `/${skill.name}`),
  ];
}
