import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrandPendingMessage } from './ErrandsPage';

describe('errand pending information', () => {
  it('shows the exact draft before approval', () => {
    const html = renderToStaticMarkup(createElement(ErrandPendingMessage, {
      errand: { state: 'draft', pendingMessage: 'Could you book Saturday at 10?', delivery: null },
    }));
    expect(html).toContain('Message to send');
    expect(html).toContain('Could you book Saturday at 10?');
  });

  it('shows the question that the principal must answer', () => {
    const html = renderToStaticMarkup(createElement(ErrandPendingMessage, {
      errand: { state: 'awaiting_principal', pendingMessage: 'Would 11 or 14 work?', delivery: null },
    }));
    expect(html).toContain('Question awaiting your answer');
    expect(html).toContain('Would 11 or 14 work?');
  });

  it('explains partial delivery and retry without presenting it as completed', () => {
    const html = renderToStaticMarkup(createElement(ErrandPendingMessage, {
      errand: { state: 'draft', pendingMessage: 'Hello', delivery: { type: 'opener', sent: 1, total: 2, error: 'Channel offline' } },
    }));
    expect(html).toContain('Channel offline');
    expect(html).toContain('1/2 contacts received the message');
    expect(html).toContain('only to the remaining contacts');
  });
});
