import { describe, expect, it } from 'vitest';
import {
  buildUsageReport,
  effectiveInputTokens,
  effectiveOutputTokens,
  estimateTokens,
  usageFrom,
} from '../../../../src/services/usage/usage';
import { formatUsageReport } from '../../../../src/services/commands/usage';
import { UsageRow } from '../../../../src/repositories/audit-log';

function llmRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    id: 'l1',
    run_id: 'run-1',
    channel: 'telegram',
    type: 'llm',
    role: 'manager',
    agent_name: 'manager',
    input_tokens: 100,
    output_tokens: 50,
    duration_ms: 1000,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function toolRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    id: 't1',
    run_id: 'run-1',
    channel: 'telegram',
    type: 'tool',
    role: 'worker',
    agent_name: 'executorWorker',
    tool_name: 'curl-request',
    duration_ms: 200,
    created_at: '2026-01-01T00:00:10.000Z',
    ...overrides,
  };
}

describe('usage engine', () => {
  it('estimateTokens approximates chars / 4', () => {
    expect(estimateTokens(8)).toBe(2);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('effective tokens prefer real usage and fall back to estimates', () => {
    expect(effectiveInputTokens({ input_tokens: 200, prompt_length: 40 })).toBe(200);
    expect(effectiveInputTokens({ input_tokens: undefined, prompt_length: 40 })).toBe(10);
    expect(effectiveOutputTokens({ output_tokens: undefined, response_length: 16 })).toBe(4);
  });

  it('usageFrom returns undefined for all-time', () => {
    expect(usageFrom(null)).toBeUndefined();
  });

  it('usageFrom returns a date string for N days ago', () => {
    const from = usageFrom(7);
    expect(from).toBeDefined();
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('buildUsageReport totals llm and tool entries', () => {
    const report = buildUsageReport([llmRow(), toolRow()]);

    expect(report.total.calls).toBe(1);
    expect(report.total.toolCalls).toBe(1);
    expect(report.total.inputTokens).toBe(100);
    expect(report.total.outputTokens).toBe(50);
    expect(report.total.totalTokens).toBe(150);
    expect(report.total.durationMs).toBe(1200);
  });

  it('buildUsageReport attributes run tokens equally across tools', () => {
    const rows = [
      llmRow({ id: 'l1', run_id: 'run-1', input_tokens: 90, output_tokens: 10 }),
      toolRow({ id: 't1', run_id: 'run-1', tool_name: 'curl-request' }),
      toolRow({ id: 't2', run_id: 'run-1', tool_name: 'search_engine' }),
    ];

    const report = buildUsageReport(rows);

    expect(report.byTool['curl-request'].toolCalls).toBe(1);
    expect(report.byTool['curl-request'].inputTokens).toBe(45);
    expect(report.byTool['curl-request'].outputTokens).toBe(5);
    expect(report.byTool['search_engine'].inputTokens).toBe(45);
    expect(report.byTool['search_engine'].outputTokens).toBe(5);
  });

  it('buildUsageReport attributes tool-only runs with zero llm tokens', () => {
    const rows = [toolRow({ id: 't1', run_id: 'run-1', tool_name: 'curl-request' })];

    const report = buildUsageReport(rows);

    expect(report.total.toolCalls).toBe(1);
    expect(report.total.totalTokens).toBe(0);
    expect(report.byTool['curl-request'].totalTokens).toBe(0);
  });

  it('buildUsageReport falls back to char-based estimates', () => {
    const rows = [
      llmRow({ id: 'l1', run_id: 'run-1', input_tokens: undefined, output_tokens: undefined, prompt_length: 40, response_length: 8 }),
    ];

    const report = buildUsageReport(rows);

    expect(report.total.inputTokens).toBe(10);
    expect(report.total.outputTokens).toBe(2);
    expect(report.total.totalTokens).toBe(12);
  });

  it('buildUsageReport groups by agent and channel with tool counts', () => {
    const rows = [
      llmRow({ id: 'l1', run_id: 'run-1', channel: 'telegram', agent_name: 'manager' }),
      toolRow({ id: 't1', run_id: 'run-1', channel: 'web', agent_name: 'executorWorker' }),
    ];

    const report = buildUsageReport(rows);

    expect(report.byAgent['manager'].calls).toBe(1);
    expect(report.byAgent['executorWorker'].toolCalls).toBe(1);
    expect(report.byChannel['telegram'].calls).toBe(1);
    expect(report.byChannel['web'].toolCalls).toBe(1);
  });

  it('buildUsageReport maps unknown names and skips malformed tool_args', () => {
    const rows = [
      llmRow({ id: 'l1', run_id: 'run-1', channel: undefined, agent_name: undefined }),
      toolRow({ id: 't1', run_id: undefined, tool_name: undefined, tool_args: '{bad json' }),
    ];

    const report = buildUsageReport(rows);

    expect(report.byAgent['unknown'].calls).toBe(1);
    expect(report.byChannel['unknown'].calls).toBe(1);
    expect(report.byTool['unknown'].toolCalls).toBe(1);
  });

  it('formatUsageReport keeps markdown for telegram', () => {
    const report = buildUsageReport([llmRow(), toolRow()]);
    const text = formatUsageReport(report, 'telegram');

    expect(text).toContain('*Token Usage*');
    expect(text).toContain('*By Tool*');
    expect(text).toContain('tok');
  });

  it('formatUsageReport strips markdown for plain channels', () => {
    const report = buildUsageReport([llmRow()]);
    const text = formatUsageReport(report, 'web');

    expect(text).not.toContain('*');
    expect(text).toContain('Token Usage');
  });
});
