/**
 * Converts a camelCase or PascalCase string to snake_case.
 */
export function camelToSnakeCase(str: string): string {
  return str
    // 1. Find all uppercase letters and replace them with an underscore + lowercase
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    // 2. Remove a leading underscore just in case the original string was PascalCase (e.g., "MyClass")
    .replace(/^_/, '');
}