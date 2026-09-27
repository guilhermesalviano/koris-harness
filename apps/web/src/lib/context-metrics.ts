export interface ContextUsage {
  used: number;
  limit: number;
  threshold: number;
}

export function computeContextMetrics(usage: ContextUsage | null) {
  if (!usage || usage.limit <= 0) return null;
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  const over = usage.threshold > 0 && usage.used >= usage.threshold;
  const near = !over && usage.threshold > 0 && usage.used >= usage.threshold * 0.85;
  const fill = over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-accent';
  const label = over ? 'text-red-400' : near ? 'text-amber-400' : '';
  return { pct, over, near, fill, label };
}
