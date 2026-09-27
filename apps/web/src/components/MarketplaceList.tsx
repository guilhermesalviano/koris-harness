import { Card, EmptyState, Toast, useToast } from './AdminUI';
import { Badge, Button } from './ui';
import type { UseMarketplaceApi } from '../lib/use-marketplace';
import type { MarketplaceItem } from '../lib/types';
import { pullSuccessMessage } from '../lib/marketplace-messages';

function humanize(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const FAMILY_ORDER: MarketplaceItem['family'][] = ['channel', 'tool', 'skill', 'mcp'];

function familyLabel(family: MarketplaceItem['family']): string {
  if (family === 'channel') return 'Channels';
  if (family === 'tool') return 'Tools';
  if (family === 'skill') return 'Skills';
  return 'MCP Servers';
}

function groupByFamily(items: MarketplaceItem[]): [MarketplaceItem['family'], MarketplaceItem[]][] {
  const groups = new Map<MarketplaceItem['family'], MarketplaceItem[]>();
  for (const item of items) {
    const list = groups.get(item.family);
    if (list) {
      list.push(item);
    } else {
      groups.set(item.family, [item]);
    }
  }

  return [...groups.entries()].sort(([a], [b]) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
}

function MarketplaceRow({ item, pulling, onPull }: { item: MarketplaceItem; pulling: boolean; onPull: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-txt">{humanize(item.slug)}</span>
          {item.group && (
            <Badge tone="accent" className="text-micro">{item.group}</Badge>
          )}
        </div>
        {item.summary && <div className="mt-1 text-caption text-txt-2">{item.summary}</div>}
      </div>
      <Button
        size="sm"
        variant="secondary"
        loading={pulling}
        onClick={onPull}
        className="flex-shrink-0"
      >
        Pull
      </Button>
    </div>
  );
}

export default function MarketplaceList({ api }: { api: UseMarketplaceApi }) {
  const [toastMsg, showToast, isError] = useToast();

  async function handlePull(item: MarketplaceItem) {
    try {
      await api.pull(item);
      showToast(pullSuccessMessage(item.family, humanize(item.slug)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to pull from koris-hub', true);
    }
  }

  const groups = groupByFamily(api.items);

  return (
    <div className="space-y-4">
      {api.error && <EmptyState text={api.error} />}
      {!api.error && api.loading && <EmptyState text="Loading…" />}
      {!api.error && !api.loading && api.items.length === 0 && (
        <EmptyState text="Nothing new — every tool, channel, MCP server, or skill in koris-hub is already present locally." />
      )}

      {!api.error && !api.loading && api.items.length > 0 && groups.map(([family, items]) => (
        <div key={family}>
          <div className="mb-2 font-mono text-micro uppercase tracking-wide text-txt-3">
            {familyLabel(family)} ({items.length})
          </div>
          <Card className="divide-y divide-subtle p-3.5 sm:p-4">
            {items.map((item) => (
              <MarketplaceRow
                key={item.slug}
                item={item}
                pulling={api.pullingSlug === item.slug}
                onPull={() => handlePull(item)}
              />
            ))}
          </Card>
        </div>
      ))}
      <div className="pt-2 text-center font-mono text-[11px] text-txt-3">
        Explore more tools, channels, MCP servers, and skills on the hub website:{' '}
        <a
          href="https://hub.koaris.com/marketplace/"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline hover:opacity-80"
        >
          https://hub.koaris.com/marketplace/
        </a>
      </div>
      <Toast message={toastMsg} isError={isError} />
    </div>
  );
}
