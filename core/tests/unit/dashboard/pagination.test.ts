import { describe, expect, it } from 'vitest';
import { queryInteger } from '../../../src/dashboard/pagination';

describe('queryInteger', () => {
  it.each([undefined, '', 'Infinity', 'NaN', '2.5', ['2'], { value: '2' }, true, '9007199254740992'])
    ('uses the default for invalid integer query %j', (value) => {
      expect(queryInteger(value, 20, 1, 200)).toBe(20);
    });

  it('clamps valid integers to the endpoint bounds', () => {
    expect(queryInteger('500', 20, 1, 200)).toBe(200);
    expect(queryInteger('-1', 20, 1, 200)).toBe(1);
    expect(queryInteger('25', 20, 1, 200)).toBe(25);
    expect(queryInteger('0', 0, 0)).toBe(0);
  });
});
