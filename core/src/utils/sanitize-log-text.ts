export function sanitizeLogText(input: string): string {
  return input
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }

  return sanitizeMetaValue(meta, new WeakSet<object>()) as Record<string, unknown>;
}

function findJsonRegions(input: string): Array<{ start: number; end: number }> {
  const regions: Array<{ start: number; end: number }> = [];
  let jsonStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (jsonStart === -1) {
      if (ch === '{' || ch === '[') {
        jsonStart = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const candidate = input.slice(jsonStart, i + 1);
        try {
          JSON.parse(candidate);
          regions.push({ start: jsonStart, end: i + 1 });
        } catch {
          // not valid JSON, keep scanning for the next candidate
        }
        jsonStart = -1;
      }
    }
  }

  return regions;
}

function sanitizeLogTextPreservingJson(input: string): string {
  const regions = findJsonRegions(input);
  if (regions.length === 0) {
    return sanitizeLogText(input);
  }

  let result = '';
  let cursor = 0;
  for (const region of regions) {
    result += sanitizeLogText(input.slice(cursor, region.start));
    result += input.slice(region.start, region.end);
    cursor = region.end;
  }
  result += sanitizeLogText(input.slice(cursor));
  return result;
}

function sanitizeMetaValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return sanitizeLogTextPreservingJson(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: sanitizeLogText(value.name),
      message: sanitizeLogText(value.message),
      stack: value.stack ? sanitizeLogText(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetaValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const sanitized: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(value)) {
      sanitized[key] = sanitizeMetaValue(nested, seen);
    }

    seen.delete(value);
    return sanitized;
  }

  if (typeof value === 'symbol' || typeof value === 'function' || typeof value === 'bigint') {
    return sanitizeLogText(String(value));
  }

  return value;
}