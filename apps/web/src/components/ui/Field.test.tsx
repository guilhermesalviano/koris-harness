import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Field } from './Field';

describe('Field', () => {
  it('renders label and wires id to input', () => {
    const html = renderToStaticMarkup(
      <Field label="Username">
        {({ id, invalid, describedBy }) => (
          <input id={id} aria-invalid={invalid} aria-describedby={describedBy} />
        )}
      </Field>,
    );
    expect(html).toContain('<label');
    expect(html).toContain('Username</label>');
    expect(html).toContain('<input');
    expect(html).toContain('aria-invalid="false"');
  });

  it('renders hint and wires describedBy', () => {
    const html = renderToStaticMarkup(
      <Field label="Email" hint="Your primary contact">
        {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
      </Field>,
    );
    expect(html).toContain('Your primary contact');
    expect(html).toContain('-hint"');
  });

  it('renders error and wires role="alert"', () => {
    const html = renderToStaticMarkup(
      <Field label="Password" error="Too short">
        {({ id, invalid, describedBy }) => (
          <input id={id} aria-invalid={invalid} aria-describedby={describedBy} />
        )}
      </Field>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Too short');
    expect(html).toContain('aria-invalid="true"');
  });

  it('supports hideLabel', () => {
    const html = renderToStaticMarkup(
      <Field label="Search" hideLabel>
        {({ id }) => <input id={id} />}
      </Field>,
    );
    expect(html).toContain('sr-only');
  });
});
