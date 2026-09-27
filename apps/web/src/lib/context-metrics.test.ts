import { describe, expect, it } from 'vitest';
import { computeContextMetrics, type ContextUsage } from './context-metrics';

describe('computeContextMetrics', () => {
  it('returns null when usage is null or limit is non-positive', () => {
    expect(computeContextMetrics(null)).toBeNull();
    expect(computeContextMetrics({ used: 0, limit: 0, threshold: 0 })).toBeNull();
    expect(computeContextMetrics({ used: 100, limit: -1, threshold: 1000 })).toBeNull();
  });

  it('calculates standard percentage and accent color when below threshold', () => {
    const usage: ContextUsage = { used: 2000, limit: 16000, threshold: 14000 };
    const metrics = computeContextMetrics(usage);
    expect(metrics).not.toBeNull();
    expect(metrics?.pct).toBe(13); // 2000 / 16000 = 12.5% -> 13%
    expect(metrics?.over).toBe(false);
    expect(metrics?.near).toBe(false);
    expect(metrics?.fill).toBe('bg-accent');
    expect(metrics?.label).toBe('');
  });

  it('turns amber when near the auto-compact threshold (>= 85% of threshold)', () => {
    const usage: ContextUsage = { used: 8600, limit: 16000, threshold: 10000 };
    const metrics = computeContextMetrics(usage);
    expect(metrics).not.toBeNull();
    expect(metrics?.over).toBe(false);
    expect(metrics?.near).toBe(true);
    expect(metrics?.fill).toBe('bg-amber-500');
    expect(metrics?.label).toBe('text-amber-400');
  });

  it('turns red when exceeding the auto-compact threshold', () => {
    const usage: ContextUsage = { used: 10500, limit: 16000, threshold: 10000 };
    const metrics = computeContextMetrics(usage);
    expect(metrics).not.toBeNull();
    expect(metrics?.over).toBe(true);
    expect(metrics?.near).toBe(false);
    expect(metrics?.fill).toBe('bg-red-500');
    expect(metrics?.label).toBe('text-red-400');
  });

  it('caps percentage at 100%', () => {
    const usage: ContextUsage = { used: 20000, limit: 16000, threshold: 14000 };
    const metrics = computeContextMetrics(usage);
    expect(metrics?.pct).toBe(100);
  });
});
