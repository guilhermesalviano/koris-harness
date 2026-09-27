import { describe, it, expect } from 'vitest';
import { camelToSnakeCase } from '../../../src/utils/fields';

describe('camelToSnakeCase', () => {
  it('converts camelCase to snake_case', () => {
    expect(camelToSnakeCase('myVariable')).toBe('my_variable');
  });

  it('converts PascalCase to snake_case', () => {
    expect(camelToSnakeCase('MyClass')).toBe('my_class');
  });

  it('handles already lowercase string', () => {
    expect(camelToSnakeCase('hello')).toBe('hello');
  });

  it('handles all uppercase acronym', () => {
    expect(camelToSnakeCase('myURLParser')).toBe('my_u_r_l_parser');
  });

  it('handles single word PascalCase', () => {
    expect(camelToSnakeCase('Hello')).toBe('hello');
  });

  it('handles multiple consecutive capitals', () => {
    expect(camelToSnakeCase('parseHTTP')).toBe('parse_h_t_t_p');
  });

  it('returns empty string unchanged', () => {
    expect(camelToSnakeCase('')).toBe('');
  });

  it('handles deeply nested camelCase', () => {
    expect(camelToSnakeCase('oneTwoThreeFour')).toBe('one_two_three_four');
  });
});
