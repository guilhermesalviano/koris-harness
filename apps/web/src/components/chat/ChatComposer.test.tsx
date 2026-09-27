import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../ProviderPicker', () => ({
  default: () => <div data-testid="provider-picker">ProviderPicker</div>,
}));

import {
  ChatComposer,
  computeCanSend,
  filterImageFiles,
  handleComposerKeyDown,
  handleComposerPaste,
  handleComposerDrop,
  handleComposerFileInput,
} from './ChatComposer';
import { imageSrc, readFileAsAttachment } from './shared';
import type { ImageAttachment } from '../../lib/types';

describe('ChatComposer Rendering', () => {
  const dummyAttachments: ImageAttachment[] = [
    { data: 'base64image1', mimeType: 'image/png' },
    { data: 'base64image2', mimeType: 'image/jpeg' },
  ];

  it('renders textarea with placeholder, value, and shortcuts hint', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        input="Hello world"
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('Hello world');
    expect(html).toContain('placeholder="Ask something…"');
    expect(html).toContain('↵ send · ⇧↵ newline');
    expect(html).toContain('ProviderPicker');
  });

  it('renders custom placeholder when provided', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        input=""
        placeholder="Type a message..."
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(html).toContain('placeholder="Type a message..."');
  });

  it('renders attach and mic buttons with proper titles', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        input=""
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        onOpenAudioModal={vi.fn()}
      />,
    );

    expect(html).toContain('title="Attach image"');
    expect(html).toContain('title="Record voice note &amp; sound recognition"');
  });

  it('disables action buttons when streaming', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        input="some prompt"
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        streaming={true}
      />,
    );

    expect(html).toContain('title="Stop generating"');
    expect(html).not.toContain('title="Send message"');
  });

  it('renders send button in enabled and disabled states based on canSend', () => {
    const htmlDisabled = renderToStaticMarkup(
      <ChatComposer
        input=""
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        canSend={false}
      />,
    );
    expect(htmlDisabled).toContain('title="Send message"');
    expect(htmlDisabled).toContain('disabled=""');

    const htmlEnabled = renderToStaticMarkup(
      <ChatComposer
        input="valid text"
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        canSend={true}
      />,
    );
    expect(htmlEnabled).toContain('title="Send message"');
    expect(htmlEnabled).not.toContain('disabled=""');
  });

  it('falls back to internal canSend calculation when canSend is undefined', () => {
    const htmlEmpty = renderToStaticMarkup(
      <ChatComposer
        input="   "
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(htmlEmpty).toContain('title="Send message"');
    expect(htmlEmpty).toContain('disabled=""');

    const htmlWithAttachments = renderToStaticMarkup(
      <ChatComposer
        input=""
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        attachments={dummyAttachments}
      />,
    );
    expect(htmlWithAttachments).toContain('title="Send message"');
    expect(htmlWithAttachments).not.toContain('disabled=""');
  });

  it('renders attachment previews with remove buttons', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        input=""
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        attachments={dummyAttachments}
      />,
    );

    expect(html).toContain('data:image/png;base64,base64image1');
    expect(html).toContain('data:image/jpeg;base64,base64image2');
    expect(html).toContain('title="Remove image"');
    expect(html).toContain('alt="attachment 1"');
    expect(html).toContain('alt="attachment 2"');
  });

  it('displays character counter and highlights warning when near limit', () => {
    const shortInput = 'abc';
    const htmlShort = renderToStaticMarkup(
      <ChatComposer
        input={shortInput}
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        maxChars={100}
      />,
    );
    expect(htmlShort).toContain('>3<');
    expect(htmlShort).not.toContain('text-amber-500');

    const longInput = 'a'.repeat(90);
    const htmlLong = renderToStaticMarkup(
      <ChatComposer
        input={longInput}
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        maxChars={100}
      />,
    );
    expect(htmlLong).toContain('>90<');
    expect(htmlLong).toContain('text-amber-500');
  });
});

describe('ChatComposer Logic & Branch Tests', () => {
  describe('computeCanSend', () => {
    it('honours explicit canSend boolean override', () => {
      expect(computeCanSend(true, true, '', 0)).toBe(true);
      expect(computeCanSend(false, false, 'hello', 1)).toBe(false);
    });

    it('blocks sending when streaming is true', () => {
      expect(computeCanSend(undefined, true, 'hello', 0)).toBe(false);
      expect(computeCanSend(undefined, true, '', 2)).toBe(false);
    });

    it('allows sending when input is non-empty or attachments are present', () => {
      expect(computeCanSend(undefined, false, 'hello', 0)).toBe(true);
      expect(computeCanSend(undefined, false, '   ', 1)).toBe(true);
      expect(computeCanSend(undefined, false, '', 1)).toBe(true);
    });

    it('disallows sending when both input and attachments are empty', () => {
      expect(computeCanSend(undefined, false, '', 0)).toBe(false);
      expect(computeCanSend(undefined, false, '   ', 0)).toBe(false);
    });
  });

  describe('filterImageFiles', () => {
    it('filters only files with image/ mime type', () => {
      const png = new File(['png'], 'a.png', { type: 'image/png' });
      const jpg = new File(['jpg'], 'b.jpg', { type: 'image/jpeg' });
      const txt = new File(['txt'], 'c.txt', { type: 'text/plain' });
      const pdf = new File(['pdf'], 'd.pdf', { type: 'application/pdf' });

      const filtered = filterImageFiles([png, txt, jpg, pdf]);
      expect(filtered).toEqual([png, jpg]);
    });

    it('returns empty array when no images are present', () => {
      const txt = new File(['txt'], 'c.txt', { type: 'text/plain' });
      expect(filterImageFiles([txt])).toEqual([]);
      expect(filterImageFiles([])).toEqual([]);
    });
  });

  describe('handleComposerKeyDown', () => {
    it('submits on Enter without shift when canSend is true', () => {
      const onSubmit = vi.fn();
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'Enter', shiftKey: false, preventDefault },
        true,
        false,
        onSubmit,
      );
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('prevents default on Enter without shift but does not submit when canSend is false', () => {
      const onSubmit = vi.fn();
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'Enter', shiftKey: false, preventDefault },
        false,
        false,
        onSubmit,
      );
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('allows newline on Shift+Enter without preventing default or submitting', () => {
      const onSubmit = vi.fn();
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'Enter', shiftKey: true, preventDefault },
        true,
        false,
        onSubmit,
      );
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('cancels streaming on Escape when streaming is true', () => {
      const onCancel = vi.fn();
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'Escape', preventDefault },
        false,
        true,
        vi.fn(),
        onCancel,
      );
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not cancel streaming on Escape when streaming is false', () => {
      const onCancel = vi.fn();
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'Escape', preventDefault },
        false,
        false,
        vi.fn(),
        onCancel,
      );
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('handles Escape when streaming is true but onCancelStreaming is omitted', () => {
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'Escape', preventDefault },
        false,
        true,
        vi.fn(),
        undefined,
      );
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it('ignores other keys', () => {
      const onSubmit = vi.fn();
      const preventDefault = vi.fn();
      handleComposerKeyDown(
        { key: 'a', preventDefault },
        true,
        false,
        onSubmit,
      );
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('handleComposerPaste', () => {
    it('does nothing when clipboard has no files', () => {
      const onAdd = vi.fn();
      const preventDefault = vi.fn();
      handleComposerPaste({ clipboardData: null, preventDefault }, onAdd);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();

      handleComposerPaste({ clipboardData: { files: [] }, preventDefault }, onAdd);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('does nothing when clipboard has non-image files', () => {
      const onAdd = vi.fn();
      const preventDefault = vi.fn();
      const txt = new File(['text'], 'note.txt', { type: 'text/plain' });
      handleComposerPaste({ clipboardData: { files: [txt] }, preventDefault }, onAdd);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('prevents default and adds images when clipboard has images', () => {
      const onAdd = vi.fn();
      const preventDefault = vi.fn();
      const png = new File(['img'], 'photo.png', { type: 'image/png' });
      const txt = new File(['text'], 'note.txt', { type: 'text/plain' });
      handleComposerPaste({ clipboardData: { files: [png, txt] }, preventDefault }, onAdd);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledWith([png]);
    });
  });

  describe('handleComposerDrop', () => {
    it('prevents default and stops propagation even with no files', () => {
      const onAdd = vi.fn();
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      handleComposerDrop({ dataTransfer: null, preventDefault, stopPropagation }, onAdd);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(stopPropagation).toHaveBeenCalledTimes(1);
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('adds images when present in dataTransfer', () => {
      const onAdd = vi.fn();
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const png = new File(['img'], 'photo.png', { type: 'image/png' });
      const txt = new File(['text'], 'note.txt', { type: 'text/plain' });
      handleComposerDrop({ dataTransfer: { files: [png, txt] }, preventDefault, stopPropagation }, onAdd);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(stopPropagation).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledWith([png]);
    });
  });

  describe('handleComposerFileInput', () => {
    it('does nothing when files is empty or null', () => {
      const onAdd = vi.fn();
      handleComposerFileInput(null, onAdd);
      handleComposerFileInput(undefined, onAdd);
      handleComposerFileInput([], onAdd);
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('calls onAddFiles with filtered images', () => {
      const onAdd = vi.fn();
      const png = new File(['img'], 'photo.png', { type: 'image/png' });
      const txt = new File(['text'], 'note.txt', { type: 'text/plain' });
      handleComposerFileInput([png, txt], onAdd);
      expect(onAdd).toHaveBeenCalledWith([png]);
    });

    it('does not call onAddFiles if no images are selected', () => {
      const onAdd = vi.fn();
      const txt = new File(['text'], 'note.txt', { type: 'text/plain' });
      handleComposerFileInput([txt], onAdd);
      expect(onAdd).not.toHaveBeenCalled();
    });
  });
});

describe('shared.ts branches (imageSrc & readFileAsAttachment)', () => {
  it('handles imageSrc with and without mimeType', () => {
    expect(imageSrc({ data: 'abc' })).toBe('data:image/png;base64,abc');
    expect(imageSrc({ data: 'xyz', mimeType: 'image/webp' })).toBe('data:image/webp;base64,xyz');
  });

  it('reads file using arrayBuffer and btoa fallback when FileReader is undefined', async () => {
    const origFileReader = globalThis.FileReader;
    // @ts-expect-error test branch
    delete globalThis.FileReader;

    try {
      const file = new File(['fallback-test'], 'test.png', { type: 'image/png' });
      const attachment = await readFileAsAttachment(file);
      expect(attachment.mimeType).toBe('image/png');
      expect(typeof attachment.data).toBe('string');
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });

  it('reads file with FileReader when FileReader is defined', async () => {
    class MockFileReader {
      onload: (() => void) | null = null;
      onerror: ((err: any) => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        setTimeout(() => {
          this.result = 'data:image/png;base64,mocked-base64';
          this.onload?.();
        }, 0);
      }
    }

    const origFileReader = globalThis.FileReader;
    // @ts-expect-error test mock
    globalThis.FileReader = MockFileReader;

    try {
      const file = new File(['content'], 'pic.png', { type: 'image/png' });
      const attachment = await readFileAsAttachment(file);
      expect(attachment.data).toBe('mocked-base64');
      expect(attachment.mimeType).toBe('image/png');
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });

  it('handles FileReader result without comma separator and errors', async () => {
    class MockNoCommaReader {
      onload: (() => void) | null = null;
      onerror: ((err: any) => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        setTimeout(() => {
          this.result = 'raw-base64-without-comma';
          this.onload?.();
        }, 0);
      }
    }

    const origFileReader = globalThis.FileReader;
    // @ts-expect-error test mock
    globalThis.FileReader = MockNoCommaReader;

    try {
      const file = new File(['content'], 'pic.png', { type: 'image/png' });
      const attachment = await readFileAsAttachment(file);
      expect(attachment.data).toBe('raw-base64-without-comma');
    } finally {
      globalThis.FileReader = origFileReader;
    }

    class MockErrorReader {
      onload: (() => void) | null = null;
      onerror: ((err: any) => void) | null = null;
      readAsDataURL() {
        setTimeout(() => {
          this.onerror?.(new Error('Read failed'));
        }, 0);
      }
    }

    // @ts-expect-error test mock
    globalThis.FileReader = MockErrorReader;
    try {
      const file = new File(['content'], 'pic.png', { type: 'image/png' });
      await expect(readFileAsAttachment(file)).rejects.toThrow('Read failed');
    } finally {
      globalThis.FileReader = origFileReader;
    }
  });
});
