import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { DatabaseServiceFactory } from '../../infrastructure/db-sqlite';
import { PluginSettingsRepositoryFactory } from '../../repositories/plugin-settings';
import {
  isChannelLiveStarted,
  loadChannelConfig,
  reprimeChannelRuntime,
  startChannelLive,
  writeChannelConfigPatch,
} from '../../dashboard/live-channel-runtime';
import { registerPulledChannel } from '../plugins/channel-install';
import { ChannelsSingleton } from '../../channels';
import { fetchChannelCatalog, listMissing, pullEntry, type ChannelConfigField } from '../../../../scripts/hub-sync';
import { formatActivatePrompt, missingRequiredFields, parseActivateArgs, unsetOptionalFields } from './channel-activation';
import type { CommandContext, CommandResult } from '../../types/commands';
import { formatCommandResult } from './format';

export interface ChannelCommandSummary {
  name: string;
  enabled: boolean;
  running: boolean;
}

export function listInstalledChannelNames(baseDir: string = config.BASE_DIR): string[] {
  const channelsDir = path.join(baseDir, 'plugins', 'channels');
  if (!existsSync(channelsDir)) {
    return [];
  }
  try {
    return readdirSync(channelsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function listChannels(baseDir: string = config.BASE_DIR): ChannelCommandSummary[] {
  const entries = listInstalledChannelNames(baseDir);
  if (entries.length === 0) {
    return [];
  }

  let db;
  try {
    db = DatabaseServiceFactory.create();
  } catch {
    db = undefined;
  }
  const pluginSettingsRepo = db ? PluginSettingsRepositoryFactory.create(db) : undefined;

  return entries.map((name) => {
    let enabled = false;
    try {
      enabled = pluginSettingsRepo?.getEnabled('channels', name) ?? false;
    } catch {
      enabled = false;
    }
    const running = isChannelLiveStarted(name);
    return { name, enabled, running };
  });
}

/**
 * The channel's post-activation note from the hub catalog (WhatsApp's QR
 * pairing, for instance) — the one thing the user still has to do by hand.
 * Silent when koris-hub is unreachable; it's a nicety, not a gate.
 */
async function activationHint(slug: string): Promise<string | undefined> {
  try {
    const catalog = await fetchChannelCatalog({ baseDir: config.BASE_DIR, slugs: [slug] });
    return catalog.find((entry) => entry.slug === slug)?.hints?.pairing;
  } catch {
    return undefined;
  }
}

export async function handleChannelsCommand(command: string, context: CommandContext): Promise<CommandResult> {
  if (context.trusted === false) {
    return formatCommandResult('Channels are only available to trusted senders.', context.source);
  }

  const rawArgs = command.trim().split(/\s+/).slice(1);
  const sub = rawArgs[0]?.toLowerCase();

  const isRemote = sub === 'remote' || sub === 'available' || (sub === 'list' && rawArgs[1]?.toLowerCase() === 'remote');
  const isLocal = !sub || sub === 'local' || (sub === 'list' && rawArgs[1]?.toLowerCase() !== 'remote');
  const isPull = sub === 'pull' || sub === 'download' || sub === 'install';
  // `enable` is an alias, not a second command: turning a channel on and
  // configuring it are the same act, and splitting them is what let a channel
  // be switched on with no config at all.
  const isActivate = sub === 'activate' || sub === 'enable' || sub === 'configure' || sub === 'setup';
  const isDisable = sub === 'disable' || sub === 'deactivate';

  if (isLocal) {
    const channels = listChannels();
    if (channels.length === 0) {
      return formatCommandResult(
        'No channels are installed.\nUse `/channels remote` to see channels available for download.',
        context.source,
      );
    }

    const rows = channels.map((channel) => {
      const statusParts: string[] = [channel.enabled ? 'enabled' : 'disabled'];
      if (channel.running) statusParts.push('running');
      return `  ${channel.name.padEnd(24)} [${statusParts.join(', ')}]`;
    });

    const message =
      `*Channels* (${channels.length})\n\n${rows.join('\n')}\n\n` +
      'Use `/channels remote` to see channels available in koris-hub.\n' +
      'Use `/channels download <name>` to install one, then `/channels activate <name>`.';
    return formatCommandResult(message, context.source);
  }

  if (isRemote) {
    try {
      const missing = await listMissing({ baseDir: config.BASE_DIR });
      const channels = missing.filter((item) => item.family === 'channel');

      if (channels.length === 0) {
        return formatCommandResult(
          'No new remote channels available in koris-hub. All channels are already installed.',
          context.source,
        );
      }

      const rows = channels.map((c) => `  ${c.slug.padEnd(24)} ${c.summary ?? ''}`.trimEnd());
      const message =
        `*Available Remote Channels* (${channels.length})\n\n${rows.join('\n')}\n\n` +
        'Use `/channels download <name>` to install a channel.';
      return formatCommandResult(message, context.source);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to reach koris-hub: ${errorMsg}`, context.source);
    }
  }

  if (isPull) {
    const remaining = rawArgs.slice(1);
    const force = remaining.includes('--force');
    const slug = remaining.find((arg) => arg !== '--force')?.toLowerCase();

    if (!slug) {
      return formatCommandResult(
        'Missing channel name.\n\nUsage: /channels download <name> [--force]\nUse `/channels remote` to see available channels.',
        context.source,
      );
    }

    try {
      await pullEntry(slug, { baseDir: config.BASE_DIR, family: 'channel', force });
      // Installed inactive on purpose — see `registerPulledChannel`.
      registerPulledChannel(slug, PluginSettingsRepositoryFactory.create(DatabaseServiceFactory.create()));
      return formatCommandResult(
        `Downloaded channel "${slug}" — installed but inactive.\n\n` +
        `Next: run \`/channels activate ${slug}\`. It switches the channel on, and if the ` +
        `channel still needs a variable it replies with exactly which one and how to pass it ` +
        `(\`/channels activate ${slug} key=value\`).\n` +
        `You can also configure it in the web dashboard, or edit plugins/channels/${slug}/config.yml directly.`,
        context.source,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to download channel "${slug}": ${errorMsg}`, context.source);
    }
  }

  if (isActivate) {
    const slug = rawArgs[1]?.toLowerCase();
    if (!slug) {
      return formatCommandResult(
        'Missing channel name.\n\nUsage: /channels activate <name> [key=value ...]\nUse `/channels` to see installed channels.',
        context.source,
      );
    }

    if (!listInstalledChannelNames().includes(slug)) {
      return formatCommandResult(
        `Channel "${slug}" is not installed.\nRun \`/channels download ${slug}\` first.`,
        context.source,
      );
    }

    let fields: ChannelConfigField[] = [];
    try {
      const catalog = await fetchChannelCatalog({ baseDir: config.BASE_DIR, slugs: [slug] });
      fields = catalog.find((entry) => entry.slug === slug)?.configFields ?? [];
    } catch {
      // koris-hub unreachable: fall back to activating with whatever is on
      // disk rather than blocking the user behind a network hiccup.
      fields = [];
    }

    const current = loadChannelConfig(slug) ?? {};
    const answers = parseActivateArgs(rawArgs.slice(2), fields);

    if (answers.invalid.length > 0 || answers.unknownKeys.length > 0) {
      const problems = [
        ...answers.invalid.map((arg) => `  "${arg}" is not a key=value pair`),
        ...answers.unknownKeys.map((key) => `  "${key}" is not a variable of ${slug}`),
      ];
      return formatCommandResult(
        `${problems.join('\n')}\n\n${formatActivatePrompt(slug, fields, current)}`,
        context.source,
      );
    }

    const merged = { ...current, ...answers.values };

    // The only thing that stops activation: a variable the channel declares
    // required and nobody has supplied — not here, not in its config.yml. Ask
    // for exactly those, and change nothing until they arrive.
    const missing = missingRequiredFields(fields, merged);
    if (missing.length > 0) {
      return formatCommandResult(
        formatActivatePrompt(slug, fields, merged, { missingOnly: missing }),
        context.source,
      );
    }

    try {
      if (Object.keys(answers.values).length > 0) {
        writeChannelConfigPatch(slug, answers.values);
        reprimeChannelRuntime(slug);
      }

      const db = DatabaseServiceFactory.create();
      PluginSettingsRepositoryFactory.create(db).setEnabled('channels', slug, true);

      const deps = ChannelsSingleton.getExistingInstance()?.runtimeDeps;
      if (deps) startChannelLive(slug, deps.logger, deps.gateway);

      const saved = Object.keys(answers.values);
      const lines = [`Channel "${slug}" is now active.`];
      if (saved.length > 0) lines.push(`Saved: ${saved.join(', ')}.`);
      lines.push(deps
        ? 'It is starting now — check the server log if it does not come up.'
        : 'It will start on the next restart.');

      const pairing = await activationHint(slug);
      if (pairing) lines.push('', pairing);

      // Optional variables stay discoverable without a separate "show me the
      // form" command: name the ones still unset right where the user is.
      const optional = unsetOptionalFields(fields, merged);
      if (optional.length > 0) {
        lines.push(
          '',
          `Optional, still unset: ${optional.map((field) => field.name).join(', ')}.`,
          `Set any of them with \`/channels activate ${slug} <key>=<value>\`.`,
        );
      }

      lines.push('', `Run \`/channels disable ${slug}\` to turn it back off.`);

      return formatCommandResult(lines.join('\n'), context.source);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to activate channel "${slug}": ${errorMsg}`, context.source);
    }
  }

  if (isDisable) {
    const slug = rawArgs[1]?.toLowerCase();
    if (!slug) {
      return formatCommandResult(
        `Missing channel name.\n\nUsage: /channels ${sub} <name>`,
        context.source,
      );
    }

    const channels = listChannels();
    const existing = channels.find((c) => c.name === slug);
    if (!existing) {
      return formatCommandResult(
        `Channel "${slug}" is not installed locally.\nUse \`/channels remote\` to check available channels.`,
        context.source,
      );
    }

    try {
      const db = DatabaseServiceFactory.create();
      PluginSettingsRepositoryFactory.create(db).setEnabled('channels', slug, false);
      ChannelsSingleton.getExistingInstance()?.stopChannel(slug);

      return formatCommandResult(
        `Channel "${slug}" is now disabled.\nRun \`/channels activate ${slug}\` to turn it back on.`,
        context.source,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to update channel "${slug}": ${errorMsg}`, context.source);
    }
  }

  return formatCommandResult(
    'Usage: /channels [remote | download <name> [--force] | activate <name> [key=value ...] | disable <name>]\n\n' +
    '  /channels                          — List installed channels\n' +
    '  /channels remote                   — List channels available in koris-hub\n' +
    '  /channels download <name>          — Install a channel (it lands inactive)\n' +
    '  /channels activate <name>          — Turn it on, or say which variable is missing\n' +
    '  /channels activate <name> k=v ...  — Set variables, then turn it on\n' +
    '  /channels disable <name>           — Turn a channel off\n\n' +
    '`enable` is an alias of `activate`; `pull` of `download`.',
    context.source,
  );
}
