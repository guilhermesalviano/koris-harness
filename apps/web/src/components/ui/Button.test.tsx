import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from './Button';

describe('Button', () => {
  it('renders with default props', () => {
    const html = renderToStaticMarkup(<Button>Click me</Button>);
    expect(html).toContain('Click me');
    expect(html).toContain('type="button"');
    expect(html).toContain('bg-bg-3'); // secondary variant
  });

  it('renders all variants and sizes', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'subtle'] as const;
    const sizes = ['sm', 'md', 'lg'] as const;

    for (const variant of variants) {
      for (const size of sizes) {
        const html = renderToStaticMarkup(
          <Button variant={variant} size={size}>{`${variant}-${size}`}</Button>,
        );
        expect(html).toContain(`${variant}-${size}`);
      }
    }
  });

  it('renders iconLeft and iconRight when not loading', () => {
    const html = renderToStaticMarkup(
      <Button iconLeft={<span id="left">L</span>} iconRight={<span id="right">R</span>}>
        Text
      </Button>,
    );
    expect(html).toContain('id="left"');
    expect(html).toContain('id="right"');
  });

  it('renders spinner and hides icons when loading', () => {
    const html = renderToStaticMarkup(
      <Button
        loading
        iconLeft={<span id="left">L</span>}
        iconRight={<span id="right">R</span>}
      >
        Loading text
      </Button>,
    );
    expect(html).toContain('animate-spin');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('id="left"');
    expect(html).not.toContain('id="right"');
  });

  it('renders disabled state', () => {
    const html = renderToStaticMarkup(<Button disabled>Disabled</Button>);
    expect(html).toContain('disabled=""');
  });
});

describe('IconButton', () => {
  it('renders square button with aria-label', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Close dialog" size="sm" variant="ghost">
        <span>X</span>
      </IconButton>,
    );
    expect(html).toContain('aria-label="Close dialog"');
    expect(html).toContain('h-7 w-7');
  });

  it('supports md and lg sizes', () => {
    const md = renderToStaticMarkup(
      <IconButton aria-label="Icon" size="md">M</IconButton>,
    );
    expect(md).toContain('h-9 w-9');

    const lg = renderToStaticMarkup(
      <IconButton aria-label="Icon" size="lg">L</IconButton>,
    );
    expect(lg).toContain('h-11 w-11');
  });
});
