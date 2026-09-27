import pLimit from "p-limit";
import { AgnosticExecutionToolFactory, IAgnosticExecutionTool } from "../tools";
import type { ILogger } from "../../infrastructure/logger";
import type { ToolCall, ToolExecutionContext, ToolResult } from "../../types/tools";
import { IAuditService, AuditServiceFactory } from "../audit/audit-service";
import { AuditLogTool } from "../../entities/audit-log";
import { generateId } from "../../utils/generate-id";

// ToolAuditContext is the same shape tools receive at execution time (ToolExecutionContext) —
// kept as a distinct name here since this module's role is audit/dispatch, not tool definitions.
export type ToolAuditContext = ToolExecutionContext;

interface IToolsQueue {
  handle(
    tools: ToolCall[],
    signal: AbortSignal,
    audit?: ToolAuditContext,
  ): Promise<ToolResult[]>;
}

class ToolsQueue implements IToolsQueue {
  private readonly auditService: IAuditService;

  constructor(
    private logger: ILogger,
    private agnosticExecutionTool: IAgnosticExecutionTool,
    private maxWorkers: number = 2,
    auditService?: IAuditService,
  ) {
    this.auditService = auditService ?? AuditServiceFactory.create(logger);
  }

  async handle(
    tools: ToolCall[],
    signal: AbortSignal,
    audit?: ToolAuditContext,
  ): Promise<ToolResult[]> {
    const limit = pLimit(this.maxWorkers);

    const promises = tools.map((tool) =>
      limit(async () => {
        if (signal.aborted) {
          throw new Error('Tool execution aborted');
        }

        const startedAt = Date.now();

        try {
          const result = await this.agnosticExecutionTool.handle(this.logger, tool, audit);
          result.toolCallId = tool.id;
          this.recordToolAudit(tool, result, Date.now() - startedAt, audit);
          return result;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error('Tool execution failed', { toolName: tool.name, error: errorMsg });
          const result = {
            toolName: tool.name,
            success: false,
            error: errorMsg,
            toolCallId: tool.id,
          } as ToolResult;
          this.recordToolAudit(tool, result, Date.now() - startedAt, audit);
          return result;
        }
      })
    );

    const results = await Promise.all(promises);

    this.logger.info('Tools completed', { count: results.length });

    return results;
  }

  private recordToolAudit(
    tool: ToolCall,
    result: ToolResult,
    durationMs: number,
    audit?: ToolAuditContext,
  ): void {
    const entry: AuditLogTool = {
      id: generateId(),
      type: 'tool',
      role: 'worker',
      agentName: audit?.agentName,
      runId: audit?.runId,
      sessionId: audit?.sessionId,
      channel: audit?.channel,
      toolName: tool.name,
      toolArgs: JSON.stringify(tool.arguments),
      success: result.success,
      response: result.success ? result.result : result.error,
      durationMs,
      status: result.success ? 'success' : 'error',
      errorMessage: result.success ? undefined : result.error,
      createdAt: new Date(),
    };

    this.auditService.record(entry);
  }
}

class ToolsQueueFactory {
  static create(logger: ILogger, maxWorkers: number = 2): ToolsQueue {
    const agnosticExecutionTool = AgnosticExecutionToolFactory.create();
    return new ToolsQueue(logger, agnosticExecutionTool, maxWorkers);
  }
}

export { IToolsQueue, ToolsQueue, ToolsQueueFactory };
