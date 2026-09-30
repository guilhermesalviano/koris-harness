export interface SseEvent {
  type: string;
  delta?: { status?: string; text?: string };
  error?: { code?: string; statusCode?: number; message: string };
  sessionId?: string;
  mode?: string;
}

export type OnStatus = (status: string) => void;
export type OnText = (text: string) => void;
export type OnSession = (sessionId: string) => void;
export type OnMode = (mode: 'text' | 'voice') => void;

/**
 * Consumes the `/api/chat` SSE stream, invoking callbacks for progress
 * status updates and content deltas as they arrive. When a sessionId is
 * provided the message is routed to that specific chat session.
 */
export async function streamChat(
  message: string,
  sessionId: string | null,
  images: { data: string; mimeType?: string }[],
  onStatus: OnStatus,
  onText: OnText,
  signal?: AbortSignal,
  onSession?: OnSession,
  onMode?: OnMode,
): Promise<void> {
  const payload: Record<string, unknown> = { message };
  if (sessionId) payload.sessionId = sessionId;
  if (images.length) payload.images = images;

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const body = await res.json?.().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : `API error ${res.status}`);
  }

  if (!res.body) {
    throw new Error('Empty response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;

  const handleLine = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return true;

    let parsed: SseEvent;
    try {
      parsed = JSON.parse(payload) as SseEvent;
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== 'object') return false;

    if (parsed.type === 'progress' && typeof parsed.delta?.status === 'string') {
      onStatus(parsed.delta.status);
    } else if (parsed.type === 'session' && typeof parsed.sessionId === 'string') {
      onSession?.(parsed.sessionId);
    } else if (parsed.type === 'mode' && (parsed.mode === 'text' || parsed.mode === 'voice')) {
      onMode?.(parsed.mode);
    } else if (parsed.type === 'error' && parsed.error) {
      throw new Error(parsed.error.message);
    } else if (parsed.type === 'content_block_delta' && typeof parsed.delta?.text === 'string') {
      onText(parsed.delta.text);
    }
    return false;
  };

  try {
    while (!ended) {
      const { done, value } = await reader.read();
      ended = done;
      buffer += decoder.decode(value, { stream: !done });

      let newlineIdx = buffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        if (handleLine(line)) return;
        newlineIdx = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) handleLine(buffer.replace(/\r$/, ''));
  } finally {
    try {
      if (!ended) await reader.cancel();
    } catch {
      // Preserve the original callback/transport error if cancellation fails.
    } finally {
      reader.releaseLock();
    }
  }
}

/** Asks the server to abort the in-progress AI run for a session. Best-effort. */
export async function cancelChat(sessionId: string): Promise<void> {
  try {
    await fetch('/api/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // best-effort — the local stream is already aborted by the caller
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export class ApiRequestError extends Error {
  details?: string[];
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers,
  });

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json().catch(() => ({})) : null;

  if (!res.ok) {
    const error = new ApiRequestError(
      (body && (body as { error?: string }).error) || `Request failed (${res.status})`,
    );
    const details = body && (body as { details?: unknown }).details;
    if (Array.isArray(details)) {
      error.details = details.filter((detail): detail is string => typeof detail === 'string');
    }
    throw error;
  }

  return body as T;
}
