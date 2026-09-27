import { describe, it, expect } from 'vitest';
import { channelDownloadedMessage, pullSuccessMessage } from './marketplace-messages';

describe('pullSuccessMessage', () => {
  it('tells the user a channel is inactive and needs configuring, never that it is active', () => {
    const message = pullSuccessMessage('channel', 'WhatsApp');

    expect(message).toContain('inactive');
    expect(message).toContain('Channels');
    expect(message).not.toContain('active within');
  });

  it('keeps the enabled-on-pull wording for MCP servers', () => {
    expect(pullSuccessMessage('mcp', 'Coredash')).toContain('enabled');
  });

  it.each(['tool', 'skill'] as const)('keeps the auto-activate wording for %s', (family) => {
    expect(pullSuccessMessage(family, 'Read Url')).toContain('active within a few seconds');
  });

  it('names the pulled entry in every family', () => {
    for (const family of ['channel', 'mcp', 'tool', 'skill'] as const) {
      expect(pullSuccessMessage(family, 'Weather')).toContain('"Weather"');
    }
  });
});

describe('channelDownloadedMessage', () => {
  it('points at the config below and the Activate step, without claiming it is running', () => {
    const message = channelDownloadedMessage('Telegram');

    expect(message).toContain('Telegram');
    expect(message).toContain('inactive');
    expect(message).toContain('Activate');
  });
});
