export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Merge objects without mutating inputs; arrays and scalars replace the base. */
export function mergeConfigPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = Object.prototype.hasOwnProperty.call(result, key) ? result[key] : undefined;
    // Define data properties explicitly so a JSON/YAML __proto__ key cannot
    // invoke Object.prototype's setter or become an inherited config value.
    Object.defineProperty(result, key, {
      value: isPlainObject(value) && isPlainObject(previous)
        ? mergeConfigPatch(previous, value)
        : value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
