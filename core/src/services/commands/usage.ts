import { DatabaseServiceFactory } from '../../infrastructure/db-sqlite';
import { AuditLogRepositoryFactory } from '../../repositories/audit-log';
import { buildUsageReport, usageFrom, UsageReport, UsageStats } from '../usage/usage';
import type { CommandContext, CommandResult } from '../../types/commands';

export function handleUsageCommand(command: string, context: CommandContext): CommandResult {
  const args = command.split(/\s+/).slice(1);
  const report = computeUsageReport(args);
  return {
    response: formatUsageReport(report, context.source),
    action: 'none',
    handled: true,
  };
}

export function computeUsageReport(args: string[]): UsageReport {
  let days: number | null = null;

  const arg = args.find((a) => a.trim().length > 0);
  if (arg) {
    const lower = arg.toLowerCase();
    if (lower === 'today') {
      days = 0;
    } else {
      const parsed = Number.parseInt(lower, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        days = parsed;
      }
    }
  }

  const rows = AuditLogRepositoryFactory.create(DatabaseServiceFactory.create()).usage({ from: usageFrom(days) });
  return buildUsageReport(rows, days);
}

export function formatUsageReport(report: UsageReport, source: string): string {
  const message = buildUsageText(report);
  return source === 'telegram' ? message : message.replace(/\*/g, '');
}

function buildUsageText(report: UsageReport): string {
  const period = report.days === 0
    ? 'today'
    : report.days !== null
      ? `last ${report.days} days`
      : 'all-time';

  const lines: string[] = [];
  lines.push(`*Token Usage* (${period})`, '');

  const total = report.total;
  lines.push('*Totals*');
  lines.push(`  LLM calls:  ${total.calls}`);
  lines.push(`  Tool calls: ${total.toolCalls}`);
  lines.push(`  Tokens:     ${formatTokens(total.totalTokens)} (in ${formatTokens(total.inputTokens)} / out ${formatTokens(total.outputTokens)})`);
  lines.push(`  Time:       ${formatDuration(total.durationMs)}`, '');

  lines.push('*By Agent*');
  pushBreakdown(lines, report.byAgent, 'agent');
  lines.push('');

  lines.push('*By Channel*');
  pushBreakdown(lines, report.byChannel, 'channel');
  lines.push('');

  lines.push('*By Tool*');
  pushBreakdown(lines, report.byTool, 'tool');

  return lines.join('\n');
}

function pushBreakdown(lines: string[], stats: Record<string, UsageStats>, kind: string): void {
  const entries = Object.entries(stats)
    .sort((a, b) => b[1].totalTokens + b[1].durationMs - (a[1].totalTokens + a[1].durationMs))
    .slice(0, 8);

  if (entries.length === 0) {
    lines.push('  No data');
    return;
  }

  for (const [name, stat] of entries) {
    const label = statDescription(stat, kind);
    lines.push(`  ${name}: ${formatTokens(stat.totalTokens)} (${label})`);
  }
}

function statDescription(stat: UsageStats, kind: string): string {
  if (kind === 'tool') {
    return `${stat.toolCalls} call${stat.toolCalls === 1 ? '' : 's'}`;
  }
  if (kind === 'skill') {
    return `${stat.calls} run${stat.calls === 1 ? '' : 's'}`;
  }
  const llm = `${stat.calls} llm call${stat.calls === 1 ? '' : 's'}`;
  const tools = `${stat.toolCalls} tool call${stat.toolCalls === 1 ? '' : 's'}`;
  return `${llm}, ${tools}`;
}

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString('en-US')} tok`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}