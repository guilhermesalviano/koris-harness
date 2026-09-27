import { UsageRow } from '../../repositories/audit-log';
import { formatISO } from '../../utils/date';

const TOKENS_PER_CHAR = 4;

export interface UsageStats {
  calls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
}

export interface UsageReport {
  days: number | null;
  total: UsageStats;
  byAgent: Record<string, UsageStats>;
  byChannel: Record<string, UsageStats>;
  byTool: Record<string, UsageStats>;
}

export function estimateTokens(chars?: number | null): number {
  if (!chars || chars <= 0) return 0;
  return Math.max(1, Math.round(chars / TOKENS_PER_CHAR));
}

export function effectiveInputTokens(row: Pick<UsageRow, 'input_tokens' | 'prompt_length'>): number {
  return row.input_tokens ?? estimateTokens(row.prompt_length);
}

export function effectiveOutputTokens(row: Pick<UsageRow, 'output_tokens' | 'response_length'>): number {
  return row.output_tokens ?? estimateTokens(row.response_length);
}

export function usageFrom(days: number | null): string | undefined {
  if (days === null) return undefined;

  const date = new Date();
  if (days === 0) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return formatISO(startOfToday);
  }

  date.setDate(date.getDate() - days);
  return formatISO(date);
}

export function buildUsageReport(rows: UsageRow[], days: number | null = null): UsageReport {
  const total = emptyStats();
  const byAgent: Record<string, UsageStats> = {};
  const byChannel: Record<string, UsageStats> = {};
  const byTool: Record<string, UsageStats> = {};
  const toolByRun = new Map<string, Set<string>>();
  const runTokens = new Map<string, { input: number; output: number; duration: number }>();

  for (const row of rows) {
    if (row.type === 'llm') {
      const input = effectiveInputTokens(row);
      const output = effectiveOutputTokens(row);

      total.calls += 1;
      total.inputTokens += input;
      total.outputTokens += output;
      total.totalTokens += input + output;
      total.durationMs += row.duration_ms;

      addLlm(byAgent, row.agent_name ?? 'unknown', input, output, row.duration_ms);
      addLlm(byChannel, row.channel ?? 'unknown', input, output, row.duration_ms);

      if (row.run_id) {
        const cur = runTokens.get(row.run_id) ?? { input: 0, output: 0, duration: 0 };
        cur.input += input;
        cur.output += output;
        cur.duration += row.duration_ms;
        runTokens.set(row.run_id, cur);
      }
      continue;
    }

    total.toolCalls += 1;
    total.durationMs += row.duration_ms;

    const tool = row.tool_name ?? 'unknown';
    const toolStats = byTool[tool] ?? emptyStats();
    toolStats.toolCalls += 1;
    toolStats.durationMs += row.duration_ms;
    byTool[tool] = toolStats;

    addTool(byAgent, row.agent_name ?? 'unknown', row.duration_ms);
    addTool(byChannel, row.channel ?? 'unknown', row.duration_ms);

    if (row.run_id) {
      let set = toolByRun.get(row.run_id);
      if (!set) {
        set = new Set();
        toolByRun.set(row.run_id, set);
      }
      set.add(tool);
    }
  }

  for (const [runId, tokens] of runTokens) {
    const toolSet = toolByRun.get(runId);
    if (toolSet && toolSet.size > 0) {
      const inputShare = Math.round(tokens.input / toolSet.size);
      const outputShare = Math.round(tokens.output / toolSet.size);
      const durationShare = Math.round(tokens.duration / toolSet.size);
      for (const tool of toolSet) {
        const stats = byTool[tool]!;
        stats.inputTokens += inputShare;
        stats.outputTokens += outputShare;
        stats.totalTokens += inputShare + outputShare;
        stats.durationMs += durationShare;
      }
    }
  }

  return { days, total, byAgent, byChannel, byTool };
}

function emptyStats(): UsageStats {
  return { calls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0 };
}

function addLlm(
  map: Record<string, UsageStats>,
  key: string,
  input: number,
  output: number,
  durationMs: number,
): void {
  const stats = map[key] ?? emptyStats();
  stats.calls += 1;
  stats.inputTokens += input;
  stats.outputTokens += output;
  stats.totalTokens += input + output;
  stats.durationMs += durationMs;
  map[key] = stats;
}

function addTool(map: Record<string, UsageStats>, key: string, durationMs: number): void {
  const stats = map[key] ?? emptyStats();
  stats.toolCalls += 1;
  stats.durationMs += durationMs;
  map[key] = stats;
}
