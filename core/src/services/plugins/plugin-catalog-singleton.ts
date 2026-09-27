import type { PluginIdentity } from './plugin-enablement';

/**
 * Holds the `{family, name}[]` identities of every plugin registered at boot
 * (`core/src/app.ts`'s `createCliRuntime()`), captured before `buildRegistry()`
 * discards `Plugin.name`. Mirrors `ToolPluginsSingleton`
 * (`core/src/services/tools/registry-singleton.ts`) — "build once, read many
 * places" — so the admin API can list every plugin without rescanning
 * `plugins/*` per request.
 */
class PluginCatalogSingleton {
  private static instance: PluginIdentity[] | undefined;

  static getInstance(identities: PluginIdentity[]): PluginIdentity[] {
    if (!PluginCatalogSingleton.instance) {
      PluginCatalogSingleton.instance = identities;
    }
    return PluginCatalogSingleton.instance;
  }

  static getExistingInstance(): PluginIdentity[] {
    return PluginCatalogSingleton.instance ?? [];
  }

  /**
   * Adds identities discovered after boot (`ToolSyncService` hot-loading a
   * newly pulled tool) to the cached catalog, so the admin "Installed" list
   * and enablement resolution see it immediately.
   */
  static append(identities: PluginIdentity[]): void {
    const current = PluginCatalogSingleton.instance ?? [];
    const exists = (id: PluginIdentity) => current.some((c) => c.family === id.family && c.name === id.name);
    const newItems = identities.filter((id) => !exists(id));
    PluginCatalogSingleton.instance = [...current, ...newItems];
  }
}

export { PluginCatalogSingleton };
