import { describe, expect, it, vi } from 'vitest';
import { applyChannelOverrides, ChannelsManager, ChannelsSingleton, type ChannelDefinition } from '../../../src/channels';
import { ADAPTERS } from '../../../../plugins/channels/contracts';
import { PluginRegistry } from '../../../../plugins/registry';

function createLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  };
}

describe('channels', () => {
  it('uses injected channel plugins', async () => {
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const definition: ChannelDefinition = {
      name: 'telegram',
      enabled: () => true,
      start,
      sendMessage,
    };
    const logger = createLogger();
    const agent = { handle: vi.fn() };
    const channels = new ChannelsManager(logger, agent, [definition]);

    channels.startAll();
    await channels.sendMessage('telegram', '123', 'hello');
    channels.stopAll();

    expect(start).toHaveBeenCalledWith(logger, agent);
    expect(sendMessage).toHaveBeenCalledWith(logger, '123', 'hello');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('delegates sendSticker to the channel definition', async () => {
    const sendSticker = vi.fn().mockResolvedValue(undefined);
    const definition: ChannelDefinition = {
      name: 'whatsapp',
      enabled: () => true,
      start: vi.fn(),
      sendSticker,
    };
    const logger = createLogger();
    const agent = { handle: vi.fn() };
    const channels = new ChannelsManager(logger, agent, [definition]);

    await channels.sendSticker('whatsapp', '123', { data: 'aGVsbG8=', mimeType: 'image/webp' });

    expect(sendSticker).toHaveBeenCalledWith(logger, '123', { data: 'aGVsbG8=', mimeType: 'image/webp' });
  });

  it('rejects sendSticker when the channel does not support it', async () => {
    const definition: ChannelDefinition = {
      name: 'telegram',
      enabled: () => true,
      start: vi.fn(),
    };
    const channels = new ChannelsManager(createLogger(), { handle: vi.fn() }, [definition]);

    await expect(
      channels.sendSticker('telegram', '123', { data: 'aGVsbG8=' }),
    ).rejects.toThrow('does not support sending stickers');
  });

  // Characterizes FINDINGS.md §3.2: `getInstance` only constructs on the
  // first call — every later call silently ignores the `channels` argument
  // and returns the original instance. Not a bug in the one production call
  // site (core/src/app.ts calls it once), but worth pinning down before
  // Phase 5 adds a `resetForTesting()` escape hatch.
  it('ignores channels passed to getInstance after the first construction', async () => {
    const logger = createLogger();
    const agent = { handle: vi.fn() };
    const first: ChannelDefinition = { name: 'telegram', enabled: () => true, start: vi.fn() };
    const second: ChannelDefinition = { name: 'whatsapp', enabled: () => true, start: vi.fn() };

    const a = ChannelsSingleton.getInstance(logger, agent, [first]);
    const b = ChannelsSingleton.getInstance(logger, agent, [second]);

    expect(b).toBe(a);
    await expect(b.sendMessage('whatsapp', '123', 'hi')).rejects.toThrow('Unknown channel: whatsapp');
    expect(ChannelsSingleton.getExistingInstance()).toBe(a);
  });

  it('resetForTesting clears the singleton so the next getInstance call reconstructs it', () => {
    const logger = createLogger();
    const agent = { handle: vi.fn() };
    const first = ChannelsSingleton.getInstance(logger, agent, []);

    ChannelsSingleton.resetForTesting();
    const second = ChannelsSingleton.getInstance(logger, agent, []);

    expect(second).not.toBe(first);
  });

  it('stopChannel stops and fully removes one channel, leaving others running', async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const a: ChannelDefinition = { name: 'telegram', enabled: () => true, start: () => stopA, sendMessage: vi.fn() };
    const b: ChannelDefinition = { name: 'whatsapp', enabled: () => true, start: () => stopB, sendMessage: vi.fn() };
    const channels = new ChannelsManager(createLogger(), { handle: vi.fn() }, [a, b]);
    channels.startAll();

    channels.stopChannel('telegram');

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).not.toHaveBeenCalled();
    await expect(channels.sendMessage('telegram', '123', 'hi')).rejects.toThrow('Unknown channel: telegram');
    await channels.sendMessage('whatsapp', '123', 'hi'); // still works
    expect(b.sendMessage).toHaveBeenCalledWith(expect.anything(), '123', 'hi');
  });

  it('stopChannel on an already-stopped/never-started channel is a safe no-op beyond removal', () => {
    const definition: ChannelDefinition = { name: 'telegram', enabled: () => true, start: vi.fn() };
    const channels = new ChannelsManager(createLogger(), { handle: vi.fn() }, [definition]);

    expect(() => channels.stopChannel('telegram')).not.toThrow();
    expect(() => channels.stopChannel('does-not-exist')).not.toThrow();
  });

  // The plan's literal ask: "register -> unregister -> no open handles."
  // Registration lives in `PluginRegistry` (a declaration store); the actual
  // running handle (the stop function) lives in `ChannelsManager` once
  // `startAll()` has run. Exercising both together end-to-end:
  it('register -> unregister leaves no running channel and no open handle', () => {
    const registry = new PluginRegistry();
    const stop = vi.fn();
    const definition: ChannelDefinition = { name: 'telegram', enabled: () => true, start: () => stop };

    const unregister = registry.extend(ADAPTERS, definition);
    const channels = new ChannelsManager(createLogger(), { handle: vi.fn() }, registry.collect(ADAPTERS));
    channels.startAll();

    unregister(); // removes the declaration from the registry
    channels.stopChannel(definition.name); // stops the running instance + drops it from the manager

    expect(stop).toHaveBeenCalledTimes(1); // the "handle" (whatever stop() closed over) is gone
    expect(registry.collect(ADAPTERS)).toEqual([]); // and nothing would re-register it on a future boot
  });
});

describe('applyChannelOverrides', () => {
  function makeChannel(name: string, defaultEnabled: boolean): ChannelDefinition {
    return { name, enabled: () => defaultEnabled, start: vi.fn() };
  }

  it('returns channels unchanged when there is no matching override', () => {
    const telegram = makeChannel('telegram', true);
    const result = applyChannelOverrides([telegram], {});

    expect(result[0].enabled()).toBe(true);
  });

  it('overrides enabled=true down to false', () => {
    const telegram = makeChannel('telegram', true);
    const [result] = applyChannelOverrides([telegram], { telegram: { enabled: false } });

    expect(result.enabled()).toBe(false);
  });

  it('overrides enabled=false up to true', () => {
    const whatsapp = makeChannel('whatsapp', false);
    const [result] = applyChannelOverrides([whatsapp], { whatsapp: { enabled: true } });

    expect(result.enabled()).toBe(true);
  });

  it('only touches the channel named in the override, leaving others alone', () => {
    const telegram = makeChannel('telegram', true);
    const whatsapp = makeChannel('whatsapp', true);
    const result = applyChannelOverrides([telegram, whatsapp], { telegram: { enabled: false } });

    expect(result.find((c) => c.name === 'telegram')?.enabled()).toBe(false);
    expect(result.find((c) => c.name === 'whatsapp')?.enabled()).toBe(true);
  });

  it('preserves the rest of the ChannelDefinition (sendMessage, start, etc.)', () => {
    const sendMessage = vi.fn();
    const telegram: ChannelDefinition = { name: 'telegram', enabled: () => true, start: vi.fn(), sendMessage };
    const [result] = applyChannelOverrides([telegram], { telegram: { enabled: false } });

    expect(result.sendMessage).toBe(sendMessage);
    expect(result.start).toBe(telegram.start);
  });
});
