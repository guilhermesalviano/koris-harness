import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUsageCommand, computeUsageReport, formatUsageReport } from '../../../../src/services/commands/usage';
import type { UsageRow } from '../../../../src/repositories/audit-log';

const mockUsageRows: UsageRow[] = [];

vi.mock('../../../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: {
    create: vi.fn(() => ({})),
  },
}));

vi.mock('../../../../src/repositories/audit-log', () => ({
  AuditLogRepositoryFactory: {
    create: vi.fn(() => ({
      usage: vi.fn(() => mockUsageRows),
    })),
  },
}));

describe('services/commands/usage', () => {
  beforeEach(() => {
    mockUsageRows.length = 0;
  });

  describe('computeUsageReport', () => {
    it('handles "today" argument', () => {
      const report = computeUsageReport(['today']);
      expect(report.days).toBe(0);
    });

    it('handles numeric days argument', () => {
      const report = computeUsageReport(['7']);
      expect(report.days).toBe(7);
    });

    it('handles invalid or non-positive arguments', () => {
      const report1 = computeUsageReport(['invalid']);
      expect(report1.days).toBeNull();

      const report2 = computeUsageReport(['-5']);
      expect(report2.days).toBeNull();

      const report3 = computeUsageReport([]);
      expect(report3.days).toBeNull();
    });
  });

  describe('handleUsageCommand and formatUsageReport', () => {
    it('formats all-time report for non-telegram source', () => {
      const result = handleUsageCommand('/usage', { source: 'tui', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.action).toBe('none');
      expect(result.response).toContain('Token Usage (all-time)');
      expect(result.response).not.toContain('*');
    });

    it('preserves markdown asterisks for telegram source', () => {
      const result = handleUsageCommand('/usage today', { source: 'telegram', trusted: true });
      expect(result.handled).toBe(true);
      expect(result.response).toContain('*Token Usage* (today)');
      expect(result.response).toContain('*Totals*');
    });

    it('formats breakdown for agents, channels, and tools with durations and singular/plural', () => {
      mockUsageRows.push(
        {
          id: 1,
          type: 'llm',
          session_id: 's1',
          origin_id: 'o1',
          channel: 'web',
          agent_name: 'main',
          input_tokens: 100,
          output_tokens: 50,
          prompt_length: 400,
          response_length: 200,
          duration_ms: 3661000, // 1h 1m 1s
          created_at: '2026-01-01T00:00:00Z',
          run_id: 'r1',
        },
        {
          id: 2,
          type: 'tool',
          session_id: 's1',
          origin_id: 'o1',
          channel: 'web',
          agent_name: 'main',
          tool_name: 'search',
          input_tokens: 0,
          output_tokens: 0,
          prompt_length: 0,
          response_length: 0,
          duration_ms: 7200000, // exactly 2h
          created_at: '2026-01-01T00:00:05Z',
          run_id: 'r1',
        },
        {
          id: 3,
          type: 'llm',
          session_id: 's2',
          origin_id: 'o2',
          channel: 'cli',
          agent_name: 'worker',
          input_tokens: 10,
          output_tokens: 5,
          prompt_length: 40,
          response_length: 20,
          duration_ms: 120000, // 2m
          created_at: '2026-01-01T00:00:10Z',
        }
      );

      const result = handleUsageCommand('/usage 3', { source: 'telegram', trusted: true });
      expect(result.response).toContain('*Token Usage* (last 3 days)');
      expect(result.response).toContain('main:');
      expect(result.response).toContain('search:');
      expect(result.response).toContain('web:');
    });

    it('formats breakdown with "No data" when categories are empty', () => {
      const formatted = formatUsageReport(
        {
          days: null,
          total: { calls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 5000 },
          byAgent: {},
          byChannel: {},
          byTool: {},
        },
        'tui'
      );
      expect(formatted).toContain('No data');
      expect(formatted).toContain('Time:       5s');
    });
  });
});
