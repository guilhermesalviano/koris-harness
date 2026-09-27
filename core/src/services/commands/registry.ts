/**
 * Single source of truth for the user-facing slash commands.
 *
 * `handleCommand` (the dispatcher), `isCommand` (recognition), `getAvailableCommands`
 * (channel completion) and the `/help` text are all derived from this list, so a
 * command is added or retired in exactly one place.
 *
 * Not to be confused with `plugins/tools/contracts.ts`'s `COMMANDS` extension
 * point, which registers the *AI agent's* tools.
 */

export type CommandChannel = 'tui' | 'web' | 'telegram' | 'whatsapp';

export interface CommandSpec {
  /** Canonical name, always slash-prefixed and lowercase, e.g. `/help`. */
  name: string;
  /** Extra names that resolve to the same handler. */
  aliases?: string[];
  /** One line shown in `/help`. Keep it free of `*` markers. */
  summary: string;
  /** Invocation shape shown in `/help`, e.g. `/usage [days|today]`. */
  usage?: string;
  /** Longer explanation shown by `/help <command>`. */
  details?: string;
  /** When set, only trusted senders may run it. */
  trusted?: boolean;
  /** Restrict listing to these channels. Omit to list everywhere. */
  channels?: CommandChannel[];
  /** Recognised and handled, but never listed. */
  hidden?: boolean;
}

export const SLASH_COMMANDS: readonly CommandSpec[] = [
  {
    name: '/help',
    summary: 'Show this help; `/help <command>` for detail on one command',
    usage: '/help [command]',
  },
  {
    name: '/status',
    summary: 'Connection, AI provider, model and session mode',
  },
  {
    name: '/usage',
    summary: 'Token-usage report from the audit log',
    usage: '/usage [days|today]',
    details:
      'Aggregates LLM calls, tool calls, tokens and wall-clock time. ' +
      '`/usage` is all-time, `/usage today` is since midnight, `/usage 7` is the last 7 days.',
  },
  {
    name: '/whoami',
    summary: 'How I see you: channel and access level',
  },
  {
    name: '/memory',
    summary: 'Show what earlier context I have summarised into this session',
  },
  {
    name: '/memories',
    summary: 'List the newest long-term memories the Summarizer has written',
    usage: '/memories [summary|fact|lesson|reminder] [count]',
    trusted: true,
    details:
      'Newest first, across every session. Filter by type and choose how many to show ' +
      '(default 10, at most 50), in either order: `/memories lesson 5`. ' +
      'Unlike /memory, which shows only the summary carried into this session.',
  },
  {
    name: '/clear',
    aliases: ['/reset'],
    summary: 'End this session and start a fresh, empty one (no summary kept)',
    details:
      'Unlike /compact, nothing is carried forward — use it to drop the current ' +
      'thread entirely and start over.',
  },
  {
    name: '/compact',
    summary: 'Summarise this session into memory, then start a fresh one seeded with the summary',
  },
  {
    name: '/mode',
    summary: 'Reply to this conversation as text or as voice notes',
    usage: '/mode [text|voice]',
    details:
      'In voice mode I answer with audio instead of text, for this conversation only ' +
      '(needs text-to-speech configured). `/mode` on its own reports the current setting.',
  },
  {
    name: '/allow',
    summary: 'Add a domain to allowed_domains so I can reach it',
    usage: '/allow <domain>',
    trusted: true,
  },
  {
    name: '/skills',
    summary: 'List loaded or remote skills, or download one from koris-hub',
    usage: '/skills [remote|download <name>]',
    details:
      'Shows every enabled skill and what it is for. In `skills.mode: "manual"` ' +
      'each one is callable as `/<name>`; in `auto` mode they are already part ' +
      'of my prompt and need no command. Use `/skills remote` to list skills ' +
      'available in koris-hub. Use `/skills download <name>` to install a skill.',
  },
  {
    name: '/tools',
    summary: 'List loaded or remote tools, or download one from koris-hub',
    usage: '/tools [remote|download <name>]',
    trusted: true,
    details:
      'Without arguments, lists all currently loaded tools. Use `/tools remote` to list ' +
      'tools available in koris-hub. Use `/tools download <name>` to install a tool.',
  },
  {
    name: '/channels',
    summary: 'List, download, configure and activate channels from koris-hub',
    usage: '/channels [remote|download <name>|activate <name> [key=value ...]|disable <name>]',
    trusted: true,
    details:
      'Without arguments, lists all installed channels and their status. ' +
      'Use `/channels remote` to list channels available in koris-hub. ' +
      'Use `/channels download <name>` to install one — it lands INACTIVE, because a channel ' +
      'cannot work before it is configured. ' +
      '`/channels activate <name>` then turns it on; if the channel declares a variable ' +
      'that is still unset it replies with which one and how to pass it, and changes nothing ' +
      'until you do (`/channels activate <name> key=value ...`). ' +
      '`/channels disable <name>` turns it back off. ' +
      '`enable` is an alias of `activate`, `pull` of `download`.',
  },
  {
    name: '/mcps',
    summary: 'List, download, configure and toggle MCP server plugins',
    usage: '/mcps [remote|download <name>|enable <name>|disable <name>]',
    trusted: true,
    details: 'MCP tools are namespaced by server and become available immediately after a server connects.',
  },
  {
    name: '/skill',
    summary: 'Load one skill\'s instructions for this message',
    usage: '/skill <name> [request]',
    trusted: true,
    details:
      'Only in `skills.mode: "manual"`, where skill documentation is kept out of ' +
      'the prompt until asked for. `/<skill-name> <request>` is the same thing in ' +
      'short form. `/help` lists the skills available as commands.',
  },
  {
    name: '/errand',
    summary: 'Start or manage a delegated conversation with someone else',
    usage: '/errand [<goal> with <contact> on <channel>|approve <id>|reply <id> <answer>|resolve <id>|retry <id>|close <id>|cancel <id>]',
    trusted: true,
    details:
      'Without arguments, lists errands started from this session. ' +
      '`/errand <goal> with <contact> on <channel>` stages a new errand as a draft — ' +
      'it does nothing until approved. `/errand approve <id>` sends the opening message ' +
      'and starts the negotiation; koris then drives it autonomously, escalating back to ' +
      'you when it needs your input. When the goal looks achieved it waits for you: ' +
      '`/errand resolve <id>` sends the closing message and resolves it, or `/errand reply <id> <more>` ' +
      'asks the contact for something more. `/errand close <id>` marks it ' +
      'resolved manually; `/errand cancel <id>` cancels it. `/errand retry <id>` retries a saved pending message only to targets that have not received it.',
  },
  {
    name: '/exit',
    aliases: ['/quit', '/bye'],
    summary: 'How to leave the session',
    channels: ['tui'],
  },
];

const BY_NAME: ReadonlyMap<string, CommandSpec> = new Map(
  SLASH_COMMANDS.flatMap((spec) => [
    [spec.name, spec] as const,
    ...(spec.aliases ?? []).map((alias) => [alias, spec] as const),
  ]),
);

/** The bare command token of a message, lowercased (`"/Usage 7"` → `"/usage"`). */
export function commandToken(message: string): string {
  return message.trim().toLowerCase().split(/\s+/, 1)[0] ?? '';
}

/** Resolve a name or alias (with or without leading slash) to its spec. */
export function findCommand(nameOrAlias: string): CommandSpec | undefined {
  const token = nameOrAlias.trim().toLowerCase();
  return BY_NAME.get(token.startsWith('/') ? token : `/${token}`);
}

/** Whether a message names a known command (canonical or alias). */
export function isKnownCommand(message: string): boolean {
  return BY_NAME.has(commandToken(message));
}

/** Canonical specs listable on a channel, in declaration order. */
export function listCommandsFor(channel: string): CommandSpec[] {
  return SLASH_COMMANDS.filter(
    (spec) => !spec.hidden && (!spec.channels || (spec.channels as string[]).includes(channel)),
  );
}
