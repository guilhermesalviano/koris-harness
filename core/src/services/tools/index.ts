import { ToolCall, ToolExecutionContext, ToolResult } from '../../types/tools';
import { ILogger } from '../../infrastructure/logger';
import { ToolPluginsSingleton } from './registry-singleton';

interface IAgnosticExecutionTool {
  handle(logger: ILogger, toolCall: ToolCall, context?: ToolExecutionContext): Promise<ToolResult>;
}

/**
 * All 11 tools now live as plugins under `plugins/tools/`, registered into
 * `ToolPluginsSingleton` once at boot (`core/src/app.ts`). This class is the
 * seam `ToolsQueue` (the LLM tool-call dispatch path) and the heartbeat
 * sub-agent depend on — a plain name lookup against the collected
 * `ToolDefinition[]`.
 */
class AgnosticExecutionTool implements IAgnosticExecutionTool {
  async handle(logger: ILogger, toolCall: ToolCall, context?: ToolExecutionContext): Promise<ToolResult> {
    const { name, arguments: args } = toolCall;
    logger.debug('Executing tool', {
      toolName: name,
      args,
    });

    try {
      const plugin = ToolPluginsSingleton.getExistingInstance().find((def) => def.name === name);
      if (plugin && plugin.enabled({ trusted: true })) {
        return await plugin.handler(logger, args, context);
      }

      return {
        toolName: name,
        success: false,
        error: `Unknown tool: ${name}`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Tool execution error', { toolName: name, error: errorMsg });
      return {
        toolName: name,
        success: false,
        error: errorMsg,
      };
    }
  }
}

class AgnosticExecutionToolFactory {
  static create(): AgnosticExecutionTool {
    return new AgnosticExecutionTool();
  }
}

export { IAgnosticExecutionTool, AgnosticExecutionTool, AgnosticExecutionToolFactory };
