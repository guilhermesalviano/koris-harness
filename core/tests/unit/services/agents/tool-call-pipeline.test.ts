import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCallPipeline } from '../../../../src/services/agents/tool-call-pipeline';
import type { Message } from '../../../../src/entities/message';
import type { LoopContext } from '../../../../src/types/context';

function makeContext(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    channel: 'tui',
    toolsQueue: { handle: vi.fn() } as never,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...overrides,
  };
}

function makePipeline(overrides: Partial<{
  executorRun: ReturnType<typeof vi.fn>;
}> = {}) {
  const executorRun = overrides.executorRun ?? vi.fn().mockResolvedValue('tool result');

  const pipeline = new ToolCallPipeline(
    { run: executorRun } as never,
  );

  return { pipeline, executorRun };
}

describe('ToolCallPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes tool calls through the executor worker', async () => {
    const toolCalls = [{ name: 'execute_command', arguments: { command: 'ls' } }];
    const { pipeline, executorRun } = makePipeline({
      executorRun: vi.fn().mockResolvedValue('listed files'),
    });
    const onProgress = vi.fn();

    const result = await pipeline.execute(
      toolCalls,
      'list files',
      [{ role: 'user', content: 'list files' } as Message],
      makeContext({ onProgress }),
    );

    expect(executorRun).toHaveBeenCalledWith({
      toolCalls,
      userMessage: 'list files',
      messageHistory: [{ role: 'user', content: 'list files' }],
      ctx: expect.objectContaining({ channel: 'tui', onProgress }),
    });
    expect(result).toBe('listed files');
    expect(onProgress).toHaveBeenCalledWith(
      `Execution phase: ${toolCalls.length} tool(s) - execute_command`,
    );
  });

  it('returns an empty string when there are no tool calls', async () => {
    const { pipeline, executorRun } = makePipeline();
    const onProgress = vi.fn();

    const result = await pipeline.execute([], 'noop', [], makeContext({ onProgress }));

    expect(result).toBe('');
    expect(executorRun).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith('No tools to execute');
  });
});