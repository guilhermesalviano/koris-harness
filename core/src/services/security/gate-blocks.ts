import type { AuditLogFilters, IAuditLogRepository } from '../../repositories/audit-log';
import { blockedHostnameFromGateError, extractHostname, isDomainGateError } from './gate';

export interface GateBlock {
  domain: string;
  toolName: string | null;
  at: string;
}

/** Best-effort hostname from an audited tool call's serialized `url` argument. */
function domainFromToolArgs(toolArgs: string | undefined): string | null {
  if (!toolArgs) return null;
  try {
    const parsed = JSON.parse(toolArgs) as Record<string, unknown>;
    const url = typeof parsed.url === 'string' ? parsed.url : '';
    return url ? extractHostname(url) : null;
  } catch {
    return null;
  }
}

/**
 * Scans recent failed tool-call audit rows for domain-gate blocks whose host is
 * not (yet) in the allowlist. Scope with `sessionId` and/or `runId`.
 */
export function findGateBlocks(
  auditRepo: Pick<IAuditLogRepository, 'findAll'>,
  opts: { sessionId?: string; runId?: string; allowed: string[]; limit?: number },
): GateBlock[] {
  if (!opts.sessionId && !opts.runId) return [];

  const filters: AuditLogFilters = { type: 'tool', status: 'error' };
  if (opts.sessionId) filters.sessionId = opts.sessionId;
  if (opts.runId) filters.runId = opts.runId;

  const rows = auditRepo.findAll({ limit: opts.limit ?? 25, offset: 0, filters });
  const allowed = new Set(opts.allowed);
  const seen = new Set<string>();
  const blocks: GateBlock[] = [];

  for (const row of rows) {
    if (!isDomainGateError(row.error_message)) continue;
    const domain =
      (row.error_message ? blockedHostnameFromGateError(row.error_message) : null) ??
      domainFromToolArgs(row.tool_args);
    if (!domain || allowed.has(domain) || seen.has(domain)) continue;
    seen.add(domain);
    blocks.push({ domain, toolName: row.tool_name ?? null, at: row.created_at });
  }

  return blocks;
}

/**
 * User-facing note appended to a channel reply when a tool call was refused by
 * the domain gate, telling the user how to allow the domain from the chat.
 */
export function formatGateBlockNotice(blocks: GateBlock[]): string {
  if (blocks.length === 0) return '';

  const lines =
    blocks.length === 1
      ? [
          `⚠️ I couldn't reach \`${blocks[0].domain}\` — it's not in \`allowed_domains\` in koris.json.`,
          `Reply \`/allow ${blocks[0].domain}\` to add it.`,
        ]
      : [
          "⚠️ I couldn't reach some sites — these domains aren't in `allowed_domains` in koris.json:",
          ...blocks.map((b) => `• \`${b.domain}\` — reply \`/allow ${b.domain}\``),
        ];

  return lines.join('\n');
}
