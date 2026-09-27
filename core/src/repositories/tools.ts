import type { AIToolDefinition } from '../types/chat';
import type { ToolDefinition, ToolFilterOptions } from '../../../plugins/tools/contracts';
import { ToolPluginsSingleton } from '../services/tools/registry-singleton';

interface GetAllOptions {
  includeBeatTools?: boolean;
  trusted?: boolean;
  agentName?: string;
}

interface IToolsRepository {
  getAll(options?: GetAllOptions): AIToolDefinition[];
}

function toAIToolDefinition(def: ToolDefinition): AIToolDefinition {
  return {
    type: 'function',
    function: { name: def.name, description: def.schema.description, parameters: def.schema.parameters },
  };
}

/**
 * All tools live as plugins under `plugins/tools/`, registered into
 * `ToolPluginsSingleton` once at boot (`core/src/app.ts`). This class is the
 * seam `PromptRepository` depends on — it turns the collected
 * `ToolDefinition[]` into the `AIToolDefinition[]` schema array sent to the
 * AI provider, applying each definition's own `enabled(opts)` filter.
 */
class ToolsRepository implements IToolsRepository {

  getAll(options?: GetAllOptions): AIToolDefinition[] {
    const includeBeatTools = options?.includeBeatTools ?? true;
    const filterOptions: ToolFilterOptions = {
      trusted: options?.trusted ?? true,
      // Only the heartbeat sub-agent ever passes includeBeatTools: false (to
      // avoid a beat recursively scheduling more beats) — translated here so
      // the beat plugins' own enabled() can exclude themselves, without every
      // caller needing to know about the plugin-level agentName filter.
      agentName: options?.agentName ?? (includeBeatTools ? undefined : 'heartbeat'),
    };

    return ToolPluginsSingleton.getExistingInstance()
      .filter((def) => def.enabled(filterOptions))
      .map(toAIToolDefinition);
  }
}

class ToolsRepositoryFactory {
  static create(): ToolsRepository {
    return new ToolsRepository();
  }
}

export { IToolsRepository, ToolsRepository, ToolsRepositoryFactory };
