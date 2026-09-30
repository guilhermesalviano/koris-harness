/** Read NDJSON or single-line SSE JSON, including chunks split inside UTF-8. */
export async function* readJsonStream<T extends object>(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void,
  { stopOnDone = true }: { stopOnDone?: boolean } = {},
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;

  const parseLine = (line: string): T | null | 'done' => {
    const trimmed = line.trim();
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (payload === '[DONE]') return 'done';
    if (!payload) return null;
    try {
      const parsed: unknown = JSON.parse(payload);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null;
    } catch {
      return null;
    }
  };

  try {
    while (!ended) {
      const { value, done } = await reader.read();
      ended = done;
      if (value?.length) onChunk();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (done && buffer) lines.push(buffer);
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed === 'done') {
          if (stopOnDone) return;
          continue;
        }
        if (parsed) yield parsed;
      }
    }
  } finally {
    // A finish marker or a caller breaking out of the generator can leave an
    // HTTP response open. Cancel it before releasing the reader lock.
    try {
      if (!ended) await reader.cancel();
    } catch {
      // The transport may already have aborted or errored.
    } finally {
      reader.releaseLock();
    }
  }
}
