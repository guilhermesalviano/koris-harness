import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutorWorker } from '../../../../src/services/workers/executor-worker';
import { EXECUTOR_SYNTHESIS_RULES } from '../../../../src/constants';
import type { ILogger } from '../../../../src/infrastructure/logger';
import type { LoopContext } from '../../../../src/types/context';
import type { ToolCall } from '../../../../src/types/tools';
import type { Message } from '../../../../src/entities/message';

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeContext(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    channel: 'tui',
    toolsQueue: { handle: vi.fn().mockResolvedValue([{ success: true, toolName: 'execute_command', result: 'done', toolCallId: 'call_1' }]) } as never,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...overrides,
  };
}

function makeWorker(overrides: Partial<{
  workerComplete: ReturnType<typeof vi.fn>;
  managerComplete: ReturnType<typeof vi.fn>;
}> = {}) {
  const workerComplete = overrides.workerComplete ?? vi.fn().mockResolvedValue({ kind: 'message', text: 'worker answer' });
  const managerComplete = overrides.managerComplete ?? vi.fn().mockResolvedValue({ kind: 'message', text: 'manager answer' });

  const executor = new ExecutorWorker(
    makeLogger(),
    'executorWorker',
    { complete: workerComplete } as never,
    { complete: managerComplete } as never,
  );

  return { executor, workerComplete, managerComplete };
}

const toolCalls: ToolCall[] = [{ id: 'call_1', name: 'execute_command', arguments: { command: 'ls' } }];

describe('ExecutorWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the manager chat service for manager-initiated flows', async () => {
    const { executor, workerComplete, managerComplete } = makeWorker();

    const result = await executor.run({
      toolCalls,
      userMessage: 'list files',
      messageHistory: [{ role: 'user', content: 'list files' } as Message],
      ctx: makeContext({ initiatedBy: 'manager' }),
    });

    expect(result).toBe('manager answer');
    expect(managerComplete).toHaveBeenCalled();
    expect(workerComplete).not.toHaveBeenCalled();
  });

  it('uses the manager chat service when no initiator is set', async () => {
    const { executor, workerComplete, managerComplete } = makeWorker();

    await executor.run({
      toolCalls,
      userMessage: 'list files',
      messageHistory: [],
      ctx: makeContext(),
    });

    expect(managerComplete).toHaveBeenCalled();
    expect(workerComplete).not.toHaveBeenCalled();
  });

  it('uses the worker chat service for heartbeat-initiated flows', async () => {
    const { executor, workerComplete, managerComplete } = makeWorker();

    const result = await executor.run({
      toolCalls,
      userMessage: 'send status',
      messageHistory: [],
      ctx: makeContext({ channel: 'background', initiatedBy: 'heartbeat' }),
    });

    expect(result).toBe('worker answer');
    expect(workerComplete).toHaveBeenCalled();
    expect(managerComplete).not.toHaveBeenCalled();
  });

  it('uses the worker chat service for summarizer-initiated flows', async () => {
    const { executor, workerComplete, managerComplete } = makeWorker();

    await executor.run({
      toolCalls,
      userMessage: 'summarize',
      messageHistory: [],
      ctx: makeContext({ channel: 'background', initiatedBy: 'summarizer' }),
    });

    expect(workerComplete).toHaveBeenCalled();
    expect(managerComplete).not.toHaveBeenCalled();
  });

  it('passes the user message and tool messages to the selected chat service', async () => {
    const { executor, managerComplete } = makeWorker();

    await executor.run({
      toolCalls,
      userMessage: 'list files',
      messageHistory: [{ role: 'user', content: 'list files' } as Message],
      ctx: makeContext({ initiatedBy: 'manager' }),
    });

    expect(managerComplete).toHaveBeenCalledWith(
      'list files',
      'tui',
      undefined,
      [{ role: 'user', content: 'list files' }],
      undefined,
      [EXECUTOR_SYNTHESIS_RULES],
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', function: { name: 'execute_command', arguments: { command: 'ls' } } }],
        },
        { role: 'tool', content: 'Tool: execute_command, Result: done', tool_call_id: 'call_1' },
      ],
      undefined,
    );
  });

  it('carries each tool call\'s provider extra content into the follow-up assistant message', async () => {
    const { executor, managerComplete } = makeWorker();
    const extraContent = { google: { thought_signature: 'sig-abc' } };

    await executor.run({
      toolCalls: [{ ...toolCalls[0], extraContent }],
      userMessage: 'list files',
      messageHistory: [],
      ctx: makeContext({ initiatedBy: 'manager' }),
    });

    const toolMessages = managerComplete.mock.calls[0][6];
    expect(toolMessages[0].tool_calls[0]).toMatchObject({ id: 'call_1', extraContent });
  });

  it('recurses when the chat service returns more tool calls', async () => {
    const { executor, managerComplete } = makeWorker({
      managerComplete: vi.fn()
        .mockResolvedValueOnce({ kind: 'tool_calls', calls: toolCalls })
        .mockResolvedValueOnce({ kind: 'message', text: 'final answer' }),
    });

    const result = await executor.run({
      toolCalls,
      userMessage: 'list files',
      messageHistory: [],
      ctx: makeContext({ initiatedBy: 'manager' }),
    });

    expect(result).toBe('final answer');
    expect(managerComplete).toHaveBeenCalledTimes(2);
  });

  it('skips the synthesis call when every tool result is silent and successful', async () => {
    const { executor, workerComplete, managerComplete } = makeWorker();

    const result = await executor.run({
      toolCalls,
      userMessage: 'send the sticker',
      messageHistory: [],
      ctx: makeContext({
        initiatedBy: 'manager',
        toolsQueue: {
          handle: vi.fn().mockResolvedValue([
            { success: true, toolName: 'send_sticker', silent: true, result: '{}', toolCallId: 'call_1' },
          ]),
        } as never,
      }),
    });

    expect(result).toBe('');
    expect(managerComplete).not.toHaveBeenCalled();
    expect(workerComplete).not.toHaveBeenCalled();
  });

  it('still runs the synthesis call when a batch mixes a silent and a non-silent result', async () => {
    const { executor, managerComplete } = makeWorker();

    const result = await executor.run({
      toolCalls,
      userMessage: 'send the sticker and a message',
      messageHistory: [],
      ctx: makeContext({
        initiatedBy: 'manager',
        toolsQueue: {
          handle: vi.fn().mockResolvedValue([
            { success: true, toolName: 'send_sticker', silent: true, result: '{}', toolCallId: 'call_1' },
            { success: true, toolName: 'send_message', result: 'sent', toolCallId: 'call_2' },
          ]),
        } as never,
      }),
    });

    expect(result).toBe('manager answer');
    expect(managerComplete).toHaveBeenCalled();
  });

  it('still runs the synthesis call when a silent tool fails', async () => {
    const { executor, managerComplete } = makeWorker();

    const result = await executor.run({
      toolCalls,
      userMessage: 'send the sticker',
      messageHistory: [],
      ctx: makeContext({
        initiatedBy: 'manager',
        toolsQueue: {
          handle: vi.fn().mockResolvedValue([
            { success: false, toolName: 'send_sticker', silent: true, error: 'boom', toolCallId: 'call_1' },
          ]),
        } as never,
      }),
    });

    expect(result).toBe('manager answer');
    expect(managerComplete).toHaveBeenCalled();
  });

  it('returns a warning when the max iteration count is reached', async () => {
    const { executor, workerComplete, managerComplete } = makeWorker();

    const result = await executor.run({
      toolCalls,
      userMessage: 'loop',
      messageHistory: [],
      ctx: makeContext({ initiatedBy: 'manager' }),
      iteration: 10,
      maxIterations: 10,
    });

    expect(result).toContain('Maximum tool execution iterations');
    expect(managerComplete).not.toHaveBeenCalled();
    expect(workerComplete).not.toHaveBeenCalled();
  });
});