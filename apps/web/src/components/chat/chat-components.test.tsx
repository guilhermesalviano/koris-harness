import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateSeparator } from './DateSeparator';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../../lib/chat-context';

describe('DateSeparator', () => {
  it('renders label with horizontal dividers', () => {
    const html = renderToStaticMarkup(<DateSeparator label="Today" />);
    expect(html).toContain('Today');
    expect(html).toContain('uppercase text-txt-3');
  });
});

describe('MessageBubble', () => {
  const baseUserMsg: ChatMessage = {
    id: 1,
    role: 'user',
    content: 'Hello assistant',
    timestamp: '10:00',
    at: Date.now(),
  };

  const baseAiMsg: ChatMessage = {
    id: 2,
    role: 'assistant',
    content: 'Hello human',
    timestamp: '10:01',
    at: Date.now(),
  };

  it('renders user bubble with text and timestamp', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={baseUserMsg}
        isLast={false}
        streaming={false}
        voiceMode={false}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(html).toContain('Hello assistant');
    expect(html).toContain('10:00');
    expect(html).toContain('bg-accent');
    expect(html).not.toContain('font-mono text-micro font-medium lowercase text-accent-2');
  });

  it('renders user bubble with images and missing image placeholders', () => {
    const userMsgWithImages: ChatMessage = {
      ...baseUserMsg,
      images: [{ data: 'abc==', mimeType: 'image/jpeg' }],
      missingImages: 1,
    };

    const html = renderToStaticMarkup(
      <MessageBubble
        message={userMsgWithImages}
        isLast={false}
        streaming={false}
        voiceMode={false}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(html).toContain('data:image/jpeg;base64,abc==');
    expect(html).toContain('This image was deleted');
  });

  it('renders assistant bubble with AI badge and markdown content', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={baseAiMsg}
        isLast={true}
        streaming={false}
        voiceMode={false}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(html).toContain('ai');
    expect(html).toContain('Hello human');
  });

  it('renders assistant pending state without content', () => {
    const pendingMsg: ChatMessage = {
      ...baseAiMsg,
      content: '',
      pending: true,
      status: 'Thinking…',
    };

    const html = renderToStaticMarkup(
      <MessageBubble
        message={pendingMsg}
        isLast={true}
        streaming={true}
        voiceMode={false}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(html).toContain('Thinking…');

    const pendingWithoutStatus: ChatMessage = {
      ...baseAiMsg,
      content: '',
      pending: true,
      status: undefined,
    };
    const htmlBlink = renderToStaticMarkup(
      <MessageBubble
        message={pendingWithoutStatus}
        isLast={true}
        streaming={true}
        voiceMode={false}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(htmlBlink).toContain('animate-blink');
  });

  it('renders error state with Resend button when isLast is true', () => {
    const errorMsg: ChatMessage = {
      ...baseAiMsg,
      error: true,
    };

    const html = renderToStaticMarkup(
      <MessageBubble
        message={errorMsg}
        isLast={true}
        streaming={false}
        voiceMode={false}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(html).toContain('border-danger');
    expect(html).toContain('Resend');
  });

  it('renders voice controls when voiceMode is active', () => {
    const htmlPlay = renderToStaticMarkup(
      <MessageBubble
        message={baseAiMsg}
        isLast={false}
        streaming={false}
        voiceMode={true}
        speakingId={null}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(htmlPlay).toContain('Play');

    const htmlPlaying = renderToStaticMarkup(
      <MessageBubble
        message={baseAiMsg}
        isLast={false}
        streaming={false}
        voiceMode={true}
        speakingId={baseAiMsg.id}
        loadingSpeakId={null}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(htmlPlaying).toContain('Stop');

    const htmlLoading = renderToStaticMarkup(
      <MessageBubble
        message={baseAiMsg}
        isLast={false}
        streaming={false}
        voiceMode={true}
        speakingId={null}
        loadingSpeakId={baseAiMsg.id}
        onSpeak={vi.fn()}
        onResend={vi.fn()}
        onPreviewImages={vi.fn()}
      />,
    );
    expect(htmlLoading).toContain('Loading…');
  });
});
