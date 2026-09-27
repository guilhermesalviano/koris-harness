import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Segmented } from './Segmented';

const OPTIONS = [
  { value: 'tab1', label: 'Tab 1', icon: <span>Icon1</span>, badge: '3' },
  { value: 'tab2', label: 'Tab 2' },
  { value: 'tab3', label: 'Tab 3' },
] as const;

function renderAndCapture(props: any) {
  let captured: any;
  function Wrapper() {
    captured = Segmented(props);
    return captured;
  }
  renderToStaticMarkup(<Wrapper />);
  return captured;
}

describe('Segmented', () => {
  it('renders tab list with options and selected state', () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      <Segmented
        options={OPTIONS}
        value="tab1"
        onChange={onChange}
        label="Test tabs"
        panelId={(val) => `panel-${val}`}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Test tabs"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="panel-tab1"');
    expect(html).toContain('Tab 1');
    expect(html).toContain('Icon1');
    expect(html).toContain('3');
    expect(html).toContain('Tab 2');
    expect(html).toContain('aria-selected="false"');
  });

  it('handles keyboard navigation across options', () => {
    const onChange = vi.fn();
    const element = renderAndCapture({
      options: OPTIONS,
      value: 'tab1',
      onChange,
      label: 'Navigation',
    });

    const onKeyDown = element.props.onKeyDown;
    expect(typeof onKeyDown).toBe('function');

    // ArrowRight -> tab2
    const preventDefault1 = vi.fn();
    onKeyDown({ key: 'ArrowRight', preventDefault: preventDefault1 });
    expect(preventDefault1).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('tab2');

    // ArrowDown -> tab2
    onChange.mockClear();
    const preventDefault2 = vi.fn();
    onKeyDown({ key: 'ArrowDown', preventDefault: preventDefault2 });
    expect(onChange).toHaveBeenCalledWith('tab2');

    // ArrowLeft from tab1 -> wraps to tab3
    onChange.mockClear();
    const preventDefault3 = vi.fn();
    onKeyDown({ key: 'ArrowLeft', preventDefault: preventDefault3 });
    expect(onChange).toHaveBeenCalledWith('tab3');

    // ArrowUp from tab1 -> wraps to tab3
    onChange.mockClear();
    const preventDefault4 = vi.fn();
    onKeyDown({ key: 'ArrowUp', preventDefault: preventDefault4 });
    expect(onChange).toHaveBeenCalledWith('tab3');

    // End -> tab3
    onChange.mockClear();
    const preventDefault5 = vi.fn();
    onKeyDown({ key: 'End', preventDefault: preventDefault5 });
    expect(onChange).toHaveBeenCalledWith('tab3');

    // Home -> tab1
    onChange.mockClear();
    const preventDefault6 = vi.fn();
    onKeyDown({ key: 'Home', preventDefault: preventDefault6 });
    expect(onChange).toHaveBeenCalledWith('tab1');

    // Unrelated key does nothing
    onChange.mockClear();
    const preventDefaultOther = vi.fn();
    onKeyDown({ key: 'Tab', preventDefault: preventDefaultOther });
    expect(preventDefaultOther).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('handles unknown value gracefully in keyboard handler', () => {
    const onChange = vi.fn();
    const element = renderAndCapture({
      options: OPTIONS,
      value: 'unknown' as any,
      onChange,
      label: 'Navigation',
    });

    const onKeyDown = element.props.onKeyDown;
    const preventDefault = vi.fn();
    onKeyDown({ key: 'ArrowRight', preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
