const SECRET_KEYS = new Set(['bottoken', 'apitoken', 'bearertoken', 'apikey', 'adminsecret', 'token', 'password']);

export function maskSecret(value: string): string {
  return value.length <= 4 ? '••••' : `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

/** Mask secrets consistently across uppercase, snake_case, and camelCase configs. */
export function maskDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEYS.has(key.replace(/[_-]/g, '').toLowerCase()) && typeof entry === 'string' && entry
        ? maskSecret(entry)
        : maskDeep(entry),
    ]));
  }
  return value;
}
