import { describe, expect, it } from 'vitest';
import { assertNeverOutboundEvent, type ChannelCapabilities, type OutboundEvent } from './contracts';

// Demonstrates the exhaustive-switch pattern channels will use once they
// consume `OutboundEvent` (Phase 3/4) — asserts that every current variant
// is handled, and that an unhandled one hits `assertNeverOutboundEvent`
// rather than being silently dropped.
function describeEvent(event: OutboundEvent): string {
  switch (event.type) {
    case 'delta':
      return `delta:${event.text}`;
    case 'message':
      return `message:${event.text}`;
    case 'tool':
      return `tool:${event.name}:${event.status}`;
    case 'approval':
      return `approval:${event.id}:${event.prompt}:${event.options.join(',')}`;
    case 'attachment':
      return `attachment:${event.attachment.mimeType ?? 'unknown'}`;
    case 'error':
      return `error:${event.message}`;
    case 'turn_end':
      return 'turn_end';
    default:
      return assertNeverOutboundEvent(event);
  }
}

describe('contracts/OutboundEvent', () => {
  it('handles every current variant exhaustively', () => {
    expect(describeEvent({ type: 'delta', text: 'chunk' })).toBe('delta:chunk');
    expect(describeEvent({ type: 'message', text: 'hi' })).toBe('message:hi');
    expect(describeEvent({ type: 'tool', name: 'search', status: 'ok' })).toBe('tool:search:ok');
    expect(describeEvent({ type: 'approval', id: 'a1', prompt: 'Run it?', options: ['yes', 'no'] })).toBe(
      'approval:a1:Run it?:yes,no',
    );
    expect(describeEvent({ type: 'attachment', attachment: { data: 'x', mimeType: 'image/png' } })).toBe(
      'attachment:image/png',
    );
    expect(describeEvent({ type: 'error', message: 'boom' })).toBe('error:boom');
    expect(describeEvent({ type: 'turn_end' })).toBe('turn_end');
  });

  it('assertNeverOutboundEvent throws with the unhandled event in the message', () => {
    const bogus = { type: 'not-a-real-variant' } as unknown as never;

    expect(() => assertNeverOutboundEvent(bogus)).toThrow(/Unhandled OutboundEvent/);
  });
});

describe('contracts/ChannelCapabilities', () => {
  it('is a plain shape channels can declare without any runtime dependency', () => {
    const capabilities: ChannelCapabilities = {
      streaming: false,
      markdown: true,
      interactive: false,
      maxMessageChars: 4_096,
    };

    expect(capabilities.maxMessageChars).toBe(4_096);
  });
});
