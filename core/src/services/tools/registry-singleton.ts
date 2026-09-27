import type { ToolDefinition } from '../../../../plugins/tools/contracts';

/**
 * Holds the `ToolDefinition[]` collected from `plugins/tools/` at boot
 * (`core/src/app.ts`'s `createCliRuntime()`), so the per-message factories
 * downstream (`AgnosticExecutionToolFactory.create()`,
 * `ToolsRepositoryFactory.create()`, `HeartbeatFactory.create()`) can read it
 * without threading a registry parameter through several layers of
 * per-message construction. Mirrors `ChannelsSingleton`/`HeartbeatSingleton`/
 * `SkillSyncSingleton` in `core/src/app.ts` — same "build once, read many
 * places" shape.
 */
class ToolPluginsSingleton {
  private static instance: ToolDefinition[] | undefined;

  static getInstance(definitions: ToolDefinition[]): ToolDefinition[] {
    if (!ToolPluginsSingleton.instance) {
      ToolPluginsSingleton.instance = definitions;
    }
    return ToolPluginsSingleton.instance;
  }

  static getExistingInstance(): ToolDefinition[] {
    return ToolPluginsSingleton.instance ?? [];
  }

  /**
   * Swaps the cached definitions wholesale. Used by `ToolSyncService`
   * (`tool-sync.ts`) after hot-loading a newly pulled tool plugin into the
   * live `PluginRegistry` — every reader here goes through
   * `getExistingInstance()` fresh per call, so this takes effect immediately
   * with no restart.
   */
  static replace(definitions: ToolDefinition[]): void {
    ToolPluginsSingleton.instance = definitions;
  }
}

export { ToolPluginsSingleton };
