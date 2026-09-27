class ExtensionPoint<T> {
  declare protected readonly _type: T;
  constructor(readonly id: string) {}
}

class PluginRegistry {
  private readonly store = new Map<string, unknown[]>();

  /**
   * Registers `value` under `point` and returns a disposer that removes
   * exactly this registration (a later `collect()` call will no longer
   * include it). Existing callers that discard the return value are
   * unaffected — this was previously `void`.
   *
   * This only removes the *declaration* from the registry — it has no
   * concept of a "running instance" (the registry is dependency-free plugin
   * infra shared by any extension point, not channels specifically). For a
   * channel that has already been started, stopping its live socket/poller
   * is `ChannelsManager`'s job (see `core/src/channels/index.ts`'s
   * `stopChannel`), which holds the actual stop function `start()` returned.
   */
  extend<T>(point: ExtensionPoint<T>, value: T): () => void {
    const existing = this.store.get(point.id);
    if (existing) {
      (existing as T[]).push(value);
    } else {
      this.store.set(point.id, [value]);
    }

    return () => {
      const values = this.store.get(point.id) as T[] | undefined;
      if (!values) return;
      const index = values.indexOf(value);
      if (index !== -1) values.splice(index, 1);
    };
  }

  collect<T>(point: ExtensionPoint<T>): T[] {
    const values = this.store.get(point.id) as T[] | undefined;
    return values ? [...values] : [];
  }
}

interface Plugin {
  name: string;
  setup(registry: PluginRegistry): void;
}

/** Builds one registry from a flat list of plugins, regardless of which family (channels, tools, ...) they came from. */
function buildRegistry(plugins: Plugin[]): PluginRegistry {
  const registry = new PluginRegistry();
  for (const plugin of plugins) {
    plugin.setup(registry);
  }
  return registry;
}

export { ExtensionPoint, PluginRegistry, buildRegistry };
export type { Plugin };
