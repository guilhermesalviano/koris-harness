import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketplaceList from './MarketplaceList';
import type { MarketplaceItem } from '../lib/types';
import type { UseMarketplaceApi } from '../lib/use-marketplace';

describe('MarketplaceList', () => {
  const mockItems: MarketplaceItem[] = [
    { slug: 'telegram', family: 'channel', summary: 'Telegram bot channel' },
    { slug: 'search-engine', family: 'tool', group: 'search', summary: 'Web search via SearXNG' },
    { slug: 'cat-fact', family: 'skill', summary: 'Returns random cat facts' },
    { slug: 'coredash', family: 'mcp', summary: 'Remote MCP server for dash' },
  ];

  const baseApi: UseMarketplaceApi = {
    items: mockItems,
    loading: false,
    error: null,
    pullingSlug: null,
    pull: vi.fn(),
    reload: vi.fn(),
  };

  it('renders empty state when there are no items to pull', () => {
    const html = renderToStaticMarkup(
      <MarketplaceList api={{ ...baseApi, items: [] }} />,
    );
    expect(html).toContain('Nothing new');
    expect(html).not.toContain('Tools (');
    expect(html).not.toContain('Skills (');
  });

  it('renders separate Tools and Skills sections and displays group pills', () => {
    const html = renderToStaticMarkup(<MarketplaceList api={baseApi} />);

    expect(html).toContain('Channels (1)');
    expect(html).toContain('Tools (1)');
    expect(html).toContain('Skills (1)');
    expect(html).toContain('MCP Servers (1)');

    // Check items rendered
    expect(html).toContain('Telegram');
    expect(html).toContain('Search Engine');
    expect(html).toContain('Cat Fact');
    expect(html).toContain('Coredash');

    // Group pill should be present
    expect(html).toContain('>search<');

    // Family notation badges should not be present
    expect(html).not.toContain('>tool<');
    expect(html).not.toContain('>skill<');
    expect(html).not.toContain('>channel<');
    expect(html).not.toContain('>mcp<');
  });

  it('renders pull button and reflects pulling state', () => {
    const html = renderToStaticMarkup(
      <MarketplaceList api={{ ...baseApi, pullingSlug: 'search-engine' }} />,
    );

    // search-engine should have loading spinner / disabled
    expect(html).toContain('aria-busy="true"');
  });
});
