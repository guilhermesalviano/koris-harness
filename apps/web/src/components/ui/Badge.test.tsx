import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders with default props', () => {
    const html = renderToStaticMarkup(<Badge>Active</Badge>);
    expect(html).toContain('Active');
    expect(html).toContain('font-mono');
    expect(html).toContain('border-subtle bg-bg-3 text-txt-2');
    expect(html).not.toContain('rounded-full bg-current');
  });

  it('renders all tones', () => {
    const tones = ['neutral', 'accent', 'success', 'danger', 'warn', 'info'] as const;
    for (const tone of tones) {
      const html = renderToStaticMarkup(<Badge tone={tone}>{tone}</Badge>);
      expect(html).toContain(tone);
    }
  });

  it('renders leading dot when dot is true', () => {
    const html = renderToStaticMarkup(<Badge dot>Live</Badge>);
    expect(html).toContain('rounded-full bg-current');
  });

  it('omits font-mono when mono is false', () => {
    const html = renderToStaticMarkup(<Badge mono={false}>Sans</Badge>);
    expect(html).not.toContain('font-mono');
  });
});
