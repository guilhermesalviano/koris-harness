import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useChat } from '../lib/chat-context';
import { computeContextMetrics, type ContextUsage } from '../lib/context-metrics';

/**
 * Context-usage bar reflecting the estimated tokens used for the opened session
 * versus its context window; turns amber near the auto-compact threshold, red past it.
 */
export default function ContextBar({
  streaming: propStreaming,
  sessionId: propSessionId,
  className = '',
}: {
  streaming?: boolean;
  sessionId?: string | null;
  className?: string;
} = {}) {
  const chat = useChat();
  const streaming = propStreaming ?? chat.streaming;
  const sessionId = propSessionId !== undefined ? propSessionId : chat.activeSessionId;

  const [usage, setUsage] = useState<ContextUsage | null>(null);

  const refresh = useCallback(async (sid: string | null) => {
    try {
      const query = sid ? `?sessionId=${encodeURIComponent(sid)}` : '';
      setUsage(await apiRequest<ContextUsage>(`/chat/context${query}`));
    } catch {
      // keep the last reading — the bar just goes stale until the next turn
    }
  }, []);

  // Refresh on mount, when the opened chat changes, and whenever a turn finishes.
  useEffect(() => {
    if (!streaming) void refresh(sessionId);
  }, [streaming, sessionId, refresh]);

  const metrics = computeContextMetrics(usage);
  if (!metrics || !usage) return null;

  const { pct, fill, label } = metrics;

  return (
    <div
      className={`font-mono text-[10px] text-txt-3 ${className}`}
      title={`Context ~${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens`}
    >
      <div className="flex items-center justify-between pb-1">
        <span>Session context</span>
        <span className={label}>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-4">
        <div className={`h-full rounded-full transition-all duration-500 ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[9px] text-txt-3">
        <span>{usage.used.toLocaleString()} tokens</span>
        <span>{usage.limit.toLocaleString()} max</span>
      </div>
    </div>
  );
}
