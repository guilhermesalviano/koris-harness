import { stripInternalStreamMarkers } from '../utils/stream-markers';
import { splitMessage, type ChannelCapabilities } from '../../../plugins/channels/contracts';

export { splitMessage };

/**
 * `resolveResponse` already buffers a response fully before a channel ever
 * sees it — today that's every channel's only option, since nothing in the
 * pipeline produces per-delta `OutboundEvent`s yet (see FINDINGS.md §3.7).
 * This is the capability-driven decision point Phase 3/4 hook real streaming
 * into: once a channel's `ChannelCapabilities.streaming` is true and the
 * pipeline emits real deltas, this is where "buffer instead of stream" stops
 * being unconditional and starts being a per-channel choice.
 */
export async function resolveResponse(response: unknown): Promise<string> {
  if (typeof response === 'string') {
    return stripInternalStreamMarkers(response);
  }

  if (isAsyncIterable(response)) {
    let out = '';
    for await (const chunk of response) {
      out += chunk;
    }
    return stripInternalStreamMarkers(out);
  }

  return String(response);
}

/**
 * Chunks `text` using a channel's own declared `maxMessageChars` instead of
 * a hardcoded limit. Both plugins currently call `splitMessage` directly
 * with their own local constant (`TELEGRAM_MESSAGE_LIMIT`/`WHATSAPP_MESSAGE_LIMIT`,
 * both 4000 today) — this is additive plumbing for Phase 3/4 to migrate onto,
 * not a change to either plugin's current chunking behavior.
 */
export function splitForCapabilities(text: string, capabilities: Pick<ChannelCapabilities, 'maxMessageChars'>): string[] {
  return splitMessage(text, capabilities.maxMessageChars);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { [Symbol.asyncIterator]?: unknown };
  return typeof maybe[Symbol.asyncIterator] === 'function';
}