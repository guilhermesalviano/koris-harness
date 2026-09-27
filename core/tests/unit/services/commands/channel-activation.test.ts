import { describe, it, expect } from 'vitest';
import {
  formatActivatePrompt,
  missingRequiredFields,
  parseActivateArgs,
  unsetOptionalFields,
} from '../../../../src/services/commands/channel-activation';
import type { ChannelConfigField } from '../../../../../scripts/hub-sync';

const TELEGRAM_FIELDS: ChannelConfigField[] = [
  { name: 'bot_token', label: 'Bot Token', type: 'password', required: true, placeholder: '123456789:AA...' },
  { name: 'whitelist', label: 'Whitelist (comma-separated chat IDs)', type: 'text', placeholder: '123456,789012' },
  {
    name: 'allow_unlisted_senders',
    label: 'Allow unlisted senders',
    type: 'boolean',
    description: 'Reply to senders not on the whitelist, as untrusted.',
  },
];

describe('parseActivateArgs', () => {
  it('reads key=value pairs and coerces to the declared type', () => {
    const parsed = parseActivateArgs(
      ['bot_token=123:AA', 'whitelist=1,2', 'allow_unlisted_senders=true'],
      TELEGRAM_FIELDS,
    );

    expect(parsed.values).toEqual({
      bot_token: '123:AA',
      whitelist: '1,2',
      allow_unlisted_senders: true,
    });
    expect(parsed.invalid).toEqual([]);
    expect(parsed.unknownKeys).toEqual([]);
  });

  it('treats anything but true/yes/1 as false for a boolean', () => {
    const parsed = parseActivateArgs(['allow_unlisted_senders=false'], TELEGRAM_FIELDS);
    expect(parsed.values.allow_unlisted_senders).toBe(false);
  });

  it('keeps a value containing = intact (tokens and URLs)', () => {
    const parsed = parseActivateArgs(['bot_token=abc=def=='], TELEGRAM_FIELDS);
    expect(parsed.values.bot_token).toBe('abc=def==');
  });

  it('strips surrounding quotes', () => {
    const parsed = parseActivateArgs(['whitelist="1,2,3"'], TELEGRAM_FIELDS);
    expect(parsed.values.whitelist).toBe('1,2,3');
  });

  it('coerces a number field, leaving unparseable input as text to be reported', () => {
    const fields: ChannelConfigField[] = [{ name: 'port', label: 'Port', type: 'number' }];
    expect(parseActivateArgs(['port=8080'], fields).values.port).toBe(8080);
    expect(parseActivateArgs(['port=nope'], fields).values.port).toBe('nope');
  });

  it('separates malformed args from unknown variable names', () => {
    const parsed = parseActivateArgs(['garbage', '=leading', '--defaults', 'nope=1'], TELEGRAM_FIELDS);

    expect(parsed.invalid).toEqual(['garbage', '=leading', '--defaults']);
    expect(parsed.unknownKeys).toEqual(['nope']);
    expect(parsed.values).toEqual({});
  });
});

describe('missingRequiredFields', () => {
  it('reports a required field that is unset', () => {
    expect(missingRequiredFields(TELEGRAM_FIELDS, {}).map((f) => f.name)).toEqual(['bot_token']);
  });

  it('treats an empty or whitespace-only string as unset', () => {
    expect(missingRequiredFields(TELEGRAM_FIELDS, { bot_token: '   ' })).toHaveLength(1);
  });

  it('is satisfied by a value already in config.yml', () => {
    expect(missingRequiredFields(TELEGRAM_FIELDS, { bot_token: '123:AA' })).toEqual([]);
  });

  it('never blocks on optional fields, however many are unset', () => {
    const optionalOnly = TELEGRAM_FIELDS.filter((f) => !f.required);
    expect(missingRequiredFields(optionalOnly, {})).toEqual([]);
  });
});

describe('unsetOptionalFields', () => {
  it('names optional fields with no value, so they stay discoverable after activation', () => {
    expect(unsetOptionalFields(TELEGRAM_FIELDS, {}).map((f) => f.name))
      .toEqual(['whitelist', 'allow_unlisted_senders']);
  });

  it('drops the ones already configured, and never reports a required field', () => {
    expect(unsetOptionalFields(TELEGRAM_FIELDS, { whitelist: '1,2' }).map((f) => f.name))
      .toEqual(['allow_unlisted_senders']);
    expect(unsetOptionalFields(TELEGRAM_FIELDS, {}).some((f) => f.required)).toBe(false);
  });
});

describe('formatActivatePrompt', () => {
  it('lists every variable with its requirement, type and current value', () => {
    const prompt = formatActivatePrompt('telegram', TELEGRAM_FIELDS, { whitelist: '123' });


    expect(prompt).toContain('bot_token');
    expect(prompt).toContain('required');
    expect(prompt).toContain('whitelist');
    expect(prompt).toContain('"123"');
    expect(prompt).toContain('not set');
    expect(prompt).toContain('/channels activate telegram');
  });

  it('never echoes a password back into the transcript', () => {
    const prompt = formatActivatePrompt('telegram', TELEGRAM_FIELDS, { bot_token: 'super-secret' });

    expect(prompt).not.toContain('super-secret');
    expect(prompt).toContain('••• (set)');
  });

  it('narrows to what is still missing when asked', () => {
    const missing = missingRequiredFields(TELEGRAM_FIELDS, {});
    const prompt = formatActivatePrompt('telegram', TELEGRAM_FIELDS, {}, { missingOnly: missing });

    expect(prompt).toContain('needs 1 more variable before it can be activated');
    expect(prompt).toContain('bot_token');
    expect(prompt).not.toContain('allow_unlisted_senders');
  });

  it('handles a channel with no configuration at all', () => {
    const prompt = formatActivatePrompt('webhook', [], {});

    expect(prompt).toContain('no configuration variables');
    expect(prompt).toContain('/channels activate webhook');
  });
});
