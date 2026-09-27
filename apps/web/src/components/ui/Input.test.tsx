import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input, Select, Textarea, fieldBase } from './Input';

describe('Input', () => {
  it('exports fieldBase styling', () => {
    expect(fieldBase).toContain('rounded-control');
    expect(fieldBase).toContain('text-body');
  });

  it('renders input with default and invalid states', () => {
    const valid = renderToStaticMarkup(<Input placeholder="Type here" />);
    expect(valid).toContain('placeholder="Type here"');
    expect(valid).not.toContain('aria-invalid');

    const invalid = renderToStaticMarkup(<Input invalid />);
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('border-danger');
  });
});

describe('Textarea', () => {
  it('renders textarea with default and custom rows', () => {
    const def = renderToStaticMarkup(<Textarea defaultValue="Notes" />);
    expect(def).toContain('rows="4"');
    expect(def).toContain('Notes</textarea>');

    const custom = renderToStaticMarkup(<Textarea rows={8} invalid />);
    expect(custom).toContain('rows="8"');
    expect(custom).toContain('aria-invalid="true"');
  });
});

describe('Select', () => {
  it('renders select with options and background styling', () => {
    const html = renderToStaticMarkup(
      <Select defaultValue="one">
        <option value="one">Option 1</option>
        <option value="two">Option 2</option>
      </Select>,
    );
    expect(html).toContain('<select');
    expect(html).toContain('Option 1');
    expect(html).toContain('background-image:url(&quot;data:image/svg+xml');
  });

  it('renders select with invalid ring', () => {
    const html = renderToStaticMarkup(<Select invalid />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-danger');
  });
});
