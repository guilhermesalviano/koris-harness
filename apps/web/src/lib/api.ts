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
    throw new Error(`API error ${res.status}`);
  }

  if (!res.body) {
    throw new Error('Empty response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamError: Error | null = null;

  const handleLine = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return;

    try {
      const parsed = JSON.parse(payload) as SseEvent;

      if (parsed.type === 'progress' && parsed.delta?.status) {
        onStatus(parsed.delta.status);
        return;
      }

      if (parsed.type === 'session' && parsed.sessionId) {
        onSession?.(parsed.sessionId);
        return;
      }

      if (parsed.type === 'mode' && (parsed.mode === 'text' || parsed.mode === 'voice')) {
        onMode?.(parsed.mode);
        return;
      }

      if (parsed.type === 'error' && parsed.error) {
        streamError = new Error(parsed.error.message);
        return;
      }

      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        onText(parsed.delta.text);
      }
    } catch {
      // skip malformed SSE lines
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
      buffer = buffer.slice(newlineIdx + 1);
      handleLine(line);
      newlineIdx = buffer.indexOf('\n');
    }

    if (done) break;
  }

  const tail = (buffer + decoder.decode()).replace(/\r$/, '');
  if (tail.trim()) {
    handleLine(tail);
  }

  if (streamError) {
    throw streamError;
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
  const res = await fetch(`/api/admin${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json().catch(() => ({})) : null;

  if (!res.ok) {
    const error = new ApiRequestError(
      (body && (body as { error?: string }).error) || `Request failed (${res.status})`,
    );
    const details = body && (body as { details?: unknown }).details;
    if (Array.isArray(details)) {
      error.details = details as string[];
    }
    throw error;
  }

  return body as T;
}
