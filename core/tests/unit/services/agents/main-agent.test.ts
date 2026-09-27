import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainAgent } from '../../../../src/services/agents/main-agent';
import { RESTRICTED_EXECUTION_CONTRACT, SKILLS_AUTO_CLAUSE, TOOL_EXECUTION_CONTRACT } from '../../../../src/constants';
import { replacePlaceholders } from '../../../../src/utils/prompt';
import { config } from '../../../../src/config';
import type { ILogger } from '../../../../src/infrastructure/logger';
import type { Message } from '../../../../src/entities/message';

// The contract's skills clause is chosen by `skills.mode`; these expectations
// pin `auto` rather than inheriting the local koris.json.
const AUTO_MODE_CONTRACT = replacePlaceholders(TOOL_EXECUTION_CONTRACT, { v1: SKILLS_AUTO_CLAUSE });

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeMessageService(history: Message[] = [], sessionMetadata: Record<string, unknown> = {}) {
  return {
    getHistory: vi.fn().mockReturnValue(history),
    getSessionId: vi.fn().mockReturnValue('session-1'),
    getSessionMetadata: vi.fn().mockReturnValue(sessionMetadata),
    save: vi.fn(),
  };
}

function makeMainAgent(overrides: Partial<{
  chatComplete: ReturnType<typeof vi.fn>;
  pipelineExecute: ReturnType<typeof vi.fn>;
}> = {}) {
  const logger = makeLogger();
  const chatComplete = overrides.chatComplete ?? vi.fn().mockResolvedValue({ kind: 'message', text: 'done' });
  const pipelineExecute = overrides.pipelineExecute ?? vi.fn().mockResolvedValue('tool result');

  const mainAgent = new MainAgent(
    logger,
    { complete: chatComplete } as never,
    { enqueue: vi.fn() } as never,
    { execute: pipelineExecute } as never,
  );

  return { mainAgent, logger, chatComplete, pipelineExecute };
}

describe('MainAgent', () => {
  const originalSkillsMode = config.SKILLS.MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    (config.SKILLS as { MODE: string }).MODE = 'auto';
  });

  afterEach(() => {
    (config.SKILLS as { MODE: string }).MODE = originalSkillsMode;
  });

  it('returns a direct message response from chat completion', async () => {
    const { mainAgent, pipelineExecute } = makeMainAgent({
      chatComplete: vi.fn().mockResolvedValue({ kind: 'message', text: 'hello user' }),
    });
    const message = makeMessageService();

    const result = await mainAgent.run({
      userMessage: 'hello',
      channel: 'tui',
      message: message as never,
    });

    expect(result).toBe('hello user');
    expect(pipelineExecute).not.toHaveBeenCalled();
  });

  it('delegates tool-call responses to the pipeline', async () => {
    const toolCalls = [{ name: 'execute_command', arguments: { command: 'ls' } }];
    const { mainAgent, pipelineExecute } = makeMainAgent({
      chatComplete: vi.fn().mockResolvedValue({ kind: 'tool_calls', calls: toolCalls }),
      pipelineExecute: vi.fn().mockResolvedValue('listed files'),
    });
    const message = makeMessageService([{ role: 'user', content: 'list files' } as Message]);
    const onProgress = vi.fn();
    const controller = new AbortController();

    const result = await mainAgent.run({
      userMessage: 'list files',
      channel: 'tui',
      message: message as never,
      options: { onProgress, signal: controller.signal },
    });

    expect(pipelineExecute).toHaveBeenCalledWith(
      toolCalls,
      'list files',
      [{ role: 'user', content: 'list files' }],
      expect.objectContaining({
        channel: 'tui',
        message,
        onProgress,
        signal: controller.signal,
        initiatedBy: 'manager',
      }),
    );
    expect(result).toBe('listed files');
  });

  it('uses logger.info as the default onProgress callback', async () => {
    const toolCalls = [{ name: 'execute_command', arguments: { command: 'pwd' } }];
    const { mainAgent, logger, pipelineExecute } = makeMainAgent({
      chatComplete: vi.fn().mockResolvedValue({ kind: 'tool_calls', calls: toolCalls }),
    });
    const message = makeMessageService();

    await mainAgent.run({
      userMessage: 'where am I',
      channel: 'tui',
      message: message as never,
    });

    const ctx = pipelineExecute.mock.calls[0][3] as { onProgress: (progress: string) => void };
    ctx.onProgress('iteration 1');
    expect(logger.info).toHaveBeenCalledWith('iteration 1');
  });

  it('passes the runId through to chat completion', async () => {
    const { mainAgent, chatComplete } = makeMainAgent();
    const message = makeMessageService();

    await mainAgent.run({
      userMessage: 'hello',
      channel: 'tui',
      message: message as never,
      options: { runId: 'run-123' },
    });

    expect(chatComplete).toHaveBeenCalledWith(
      'hello',
      'tui',
      expect.objectContaining({ runId: 'run-123' }),
      [],
      'session-1',
      [AUTO_MODE_CONTRACT],
      undefined,
      undefined,
    );
  });

  it('uses restricted contract when tools are disabled', async () => {
    const { mainAgent, chatComplete } = makeMainAgent();
    const message = makeMessageService();

    await mainAgent.run({
      userMessage: 'search latest news',
      channel: 'whatsapp',
      message: message as never,
      options: { toolsEnabled: false, learnedSkillsEnabled: false },
    });

    expect(chatComplete).toHaveBeenCalledWith(
      'search latest news',
      'whatsapp',
      expect.objectContaining({ toolsEnabled: false, learnedSkillsEnabled: false }),
      [],
      'session-1',
      [RESTRICTED_EXECUTION_CONTRACT],
      undefined,
      undefined,
    );
  });

  it('injects the compact summary as an extra system block when present', async () => {
    const { mainAgent, chatComplete } = makeMainAgent();
    const message = makeMessageService([], { compactSummary: 'Discussed the roadmap.' });

    await mainAgent.run({
      userMessage: 'what were we saying',
      channel: 'tui',
      message: message as never,
    });

    expect(chatComplete).toHaveBeenCalledWith(
      'what were we saying',
      'tui',
      undefined,
      [],
      'session-1',
      [AUTO_MODE_CONTRACT, '# Resumed From Previous Session\nDiscussed the roadmap.'],
      undefined,
      undefined,
    );
  });

  it('does not inject an extra block when there is no compact summary', async () => {
    const { mainAgent, chatComplete } = makeMainAgent();
    const message = makeMessageService();

    await mainAgent.run({
      userMessage: 'hello',
      channel: 'tui',
      message: message as never,
    });

    expect(chatComplete).toHaveBeenCalledWith(
      'hello',
      'tui',
      undefined,
      [],
      'session-1',
      [AUTO_MODE_CONTRACT],
      undefined,
      undefined,
    );
  });
});
