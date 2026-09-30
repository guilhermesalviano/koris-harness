import { describe, expect, it } from 'vitest';
import { maskDeep } from '../../../src/dashboard/secrets';

describe('maskDeep', () => {
  it('masks settings, GitHub, and nested plugin credentials without mutating them', () => {
    const config = {
      ADMIN_SECRET: 'admin-secret',
      GITHUB: { TOKEN: 'github-secret', OWNER: 'owner' },
      providers: [{ api_token: 'api-secret', bearerToken: 'token', API_KEY: 'key' }],
      empty: { TOKEN: '' },
    };
    expect(maskDeep(config)).toEqual({
      ADMIN_SECRET: 'ad••••et',
      GITHUB: { TOKEN: 'gi••••et', OWNER: 'owner' },
      providers: [{ api_token: 'ap••••et', bearerToken: 'to••••en', API_KEY: '••••' }],
      empty: { TOKEN: '' },
    });
    expect(config.GITHUB.TOKEN).toBe('github-secret');
  });
});
