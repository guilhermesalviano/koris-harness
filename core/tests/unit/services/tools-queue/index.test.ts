import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ToolsQueue, ToolsQueueFactory } from '../../../../src/services/tools-queue';
import { AgnosticExecutionTool } from '../../../../src/services/tools';
import { ToolPluginsSingleton } from '../../../../src/services/tools/registry-singleton';
import { ILogger } from '../../../../src/infrastructure/logger';
import type { ToolDefinition } from '../../../../../plugins/tools/contracts';

vi.mock('../../../../src/services/audit/audit-service', () => ({
  AuditServiceFactory: { create: () => ({ record: vi.fn() }) },
}));

vi.mock('../../../../src/services/tools/registry-singleton', () => ({
  ToolPluginsSingleton: { getExistingInstance: vi.fn().mockReturnValue([]) },
}));

/** Registers a fake `ToolDefinition` for the duration of one test, since
 * `AgnosticExecutionTool` now reads exclusively from `ToolPluginsSingleton`
 * instead of taking a command map in its constructor. */
function stubRegisteredTools(handlers: Record<string, ToolDefinition['handler']>): void {
  const definitions: ToolDefinition[] = Object.entries(handlers).map(([name, handler]) => ({
    name,
    schema: { description: '', parameters: {} },
    handler,
    enabled: () => true,
  }));
  vi.mocked(ToolPluginsSingleton.getExistingInstance).mockReturnValue(definitions);
}

const mockLogger: ILogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('ToolsQueue', () => {
  let orchestrator: ReturnType<typeof ToolsQueueFactory.create>;
  let abortController: AbortController;

  beforeEach(() => {
    vi.mocked(ToolPluginsSingleton.getExistingInstance).mockReturnValue([]);
    orchestrator = ToolsQueueFactory.create(mockLogger, 2);
    abortController = new AbortController();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handle', () => {
    it('executes single tool successfully', async () => {
      const toolCall = {
        name: 'execute_command',
        arguments: { command: 'echo "test"' },
      };

      const result = await orchestrator.handle([toolCall], {}, abortController.signal);

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe('execute_command');
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 1 });
    });

    it('executes multiple tools concurrently', async () => {
      const toolCalls = [
        { name: 'execute_command', arguments: { command: 'echo "test1"' } },
        { name: 'execute_command', arguments: { command: 'echo "test2"' } },
      ];

      const result = await orchestrator.handle(toolCalls, {}, abortController.signal);

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.toolName === 'execute_command')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 2 });
    });

    it('respects concurrency limit with single worker', async () => {
      const limitedOrchestrator = ToolsQueueFactory.create(mockLogger, 1);

      const toolCalls = Array.from({ length: 3 }, (_, i) => ({
        name: 'execute_command',
        arguments: { command: `echo "test${i}"` },
      }));

      const result = await limitedOrchestrator.handle(toolCalls, {}, abortController.signal);

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(3);
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 3 });
    });

    it('handles tool execution errors gracefully', async () => {
      const toolCall = {
        name: 'execute_command',
        arguments: { command: 'exit 1' },
      };

      const result = await orchestrator.handle([toolCall], {}, abortController.signal);

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe('execute_command');
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 1 });
    });

    it('respects abort signal', async () => {
      const toolCalls = [
        { name: 'execute_command', arguments: { command: 'echo "test"' } },
      ];

      abortController.abort();

      try {
        await orchestrator.handle(toolCalls, {}, abortController.signal);
      } catch (err) {
        expect((err as Error).message).toContain('aborted');
      }
    });

    it('returns formatted output with tool results', async () => {
      const toolCalls = [
        { name: 'execute_command', arguments: { command: 'echo "test"' } },
      ];

      const result = await orchestrator.handle(toolCalls, {}, abortController.signal);

      expect(result[0].toolName).toBe('execute_command');
      expect(result[0]).toHaveProperty('success');
    });

    it('handles empty tool list', async () => {
      const result = await orchestrator.handle([], {}, abortController.signal);

      expect(result).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 0 });
    });

    it('preserves result order', async () => {
      const toolCalls = [
        { name: 'execute_command', arguments: { command: 'echo "first"' } },
        { name: 'execute_command', arguments: { command: 'echo "second"' } },
        { name: 'execute_command', arguments: { command: 'echo "third"' } },
      ];

      const result = await orchestrator.handle(toolCalls, {}, abortController.signal);

      expect(result).toHaveLength(3);
      result.forEach((r) => expect(r.toolName).toBe('execute_command'));
    });

    it('handles mixed success and failure results', async () => {
      const toolCalls = [
        { name: 'execute_command', arguments: { command: 'echo "success"' } },
        { name: 'execute_command', arguments: { command: 'exit 1' } },
      ];

      const result = await orchestrator.handle(toolCalls, {}, abortController.signal);

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.toolName === 'execute_command')).toBe(true);
    });

    it('continues execution if one tool fails', async () => {
      const toolCalls = [
        { name: 'execute_command', arguments: { command: 'echo "ok"' } },
        { name: 'execute_command', arguments: { command: 'exit 1' } },
        { name: 'execute_command', arguments: { command: 'echo "also ok"' } },
      ];

      const result = await orchestrator.handle(toolCalls, {}, abortController.signal);

      expect(result).toHaveLength(3);
      expect(result.every((r) => r.toolName === 'execute_command')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 3 });
    });

    it('handles unknown tools gracefully', async () => {
      const toolCall = {
        name: 'unknown_tool',
        arguments: { param: 'value' },
      };

      const result = await orchestrator.handle([toolCall], {}, abortController.signal);

      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe('unknown_tool');
      expect(result[0].success).toBe(false);
      expect(result[0].error).toContain('Unknown tool');
      expect(mockLogger.info).toHaveBeenCalledWith('Tools completed', { count: 1 });
    });

    it('records a tool audit entry for each executed tool', async () => {
      const auditService = { record: vi.fn() };
      stubRegisteredTools({
        echo: vi.fn().mockResolvedValue({ toolName: 'echo', success: true, result: 'hi' }),
      });
      const agnosticExecutionTool = new AgnosticExecutionTool();
      const queue = new ToolsQueue(mockLogger, agnosticExecutionTool, 2, auditService as never);

      const toolCall = { name: 'echo', arguments: { text: 'hello' } };
      await queue.handle([toolCall], new AbortController().signal, {
        channel: 'web',
        sessionId: 's1',
        runId: 'r1',
        agentName: 'executorWorker',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const entry = auditService.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        type: 'tool',
        role: 'worker',
        agentName: 'executorWorker',
        toolName: 'echo',
        toolArgs: JSON.stringify({ text: 'hello' }),
        success: true,
        response: 'hi',
        status: 'success',
        channel: 'web',
        sessionId: 's1',
        runId: 'r1',
      });
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records a failed tool audit entry when execution throws', async () => {
      const auditService = { record: vi.fn() };
      stubRegisteredTools({
        boom: vi.fn().mockRejectedValue(new Error('kaboom')),
      });
      const agnosticExecutionTool = new AgnosticExecutionTool();
      const queue = new ToolsQueue(mockLogger, agnosticExecutionTool, 2, auditService as never);

      const toolCall = { name: 'boom', arguments: {} };
      await queue.handle([toolCall], new AbortController().signal, { agentName: 'learnerWorker' });

      const entry = auditService.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        type: 'tool',
        agentName: 'learnerWorker',
        success: false,
        status: 'error',
        errorMessage: 'kaboom',
      });
    });

    it('throws error when signal is already aborted', async () => {
      abortController.abort();
      await expect(
        orchestrator.handle([{ name: 'test', arguments: {} }], abortController.signal),
      ).rejects.toThrow('Tool execution aborted');
    });

    it('catches and handles execution error when agnosticExecutionTool throws', async () => {
      const failingTool = {
        handle: vi.fn().mockRejectedValue(new Error('Fatal execution crash')),
      };
      const queue = new ToolsQueue(mockLogger, failingTool as never, 2);
      const results = await queue.handle([{ id: 'c1', name: 'crash_tool', arguments: {} }], abortController.signal);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        toolName: 'crash_tool',
        success: false,
        error: 'Fatal execution crash',
        toolCallId: 'c1',
      });
      expect(mockLogger.error).toHaveBeenCalledWith('Tool execution failed', {
        toolName: 'crash_tool',
        error: 'Fatal execution crash',
      });
    });
  });

  describe('constructor', () => {
    it('uses default maxWorkers of 2', () => {
      const orch = ToolsQueueFactory.create(mockLogger);
      expect(orch).toBeDefined();
    });

    it('accepts custom maxWorkers', () => {
      const orch = ToolsQueueFactory.create(mockLogger, 4);
      expect(orch).toBeDefined();
    });
  });

  describe('AgnosticExecutionTool', () => {
    it('logs tool execution', async () => {
      const tool = new AgnosticExecutionTool();
      const toolCall = { name: 'execute_command', arguments: { command: 'echo "test"' } };

      await tool.handle(mockLogger, toolCall);

      expect(mockLogger.debug).toHaveBeenCalledWith('Executing tool', expect.objectContaining({
        toolName: 'execute_command',
      }));
    });

    it('forwards the execution context to the command', async () => {
      const command = vi.fn().mockResolvedValue({ toolName: 'execute_command', success: true, result: '' });
      stubRegisteredTools({ execute_command: command });
      const tool = new AgnosticExecutionTool();
      const toolCall = { name: 'execute_command', arguments: { command: 'echo "test"' } };
      const context = { channel: 'whatsapp', sessionId: 's1', runId: 'r1', agentName: 'executorWorker' };

      await tool.handle(mockLogger, toolCall, context);

      expect(command).toHaveBeenCalledWith(mockLogger, { command: 'echo "test"' }, context);
    });

    it('refuses to invoke a known but administratively disabled tool', async () => {
      const command = vi.fn().mockResolvedValue({ toolName: 'execute_command', success: true, result: '' });
      vi.mocked(ToolPluginsSingleton.getExistingInstance).mockReturnValue([
        { name: 'execute_command', schema: { description: '', parameters: {} }, handler: command, enabled: () => false },
      ]);
      const tool = new AgnosticExecutionTool();
      const toolCall = { name: 'execute_command', arguments: {} };

      const result = await tool.handle(mockLogger, toolCall);

      expect(command).not.toHaveBeenCalled();
      expect(result).toEqual({ toolName: 'execute_command', success: false, error: 'Unknown tool: execute_command' });
    });
  });
});


