import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './api';
import type { MarketplaceItem, MarketplaceResponse } from './types';

export function useMarketplace() {
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pullingSlug, setPullingSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<MarketplaceResponse>('/marketplace');
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach koris-hub');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pull = useCallback(async (item: MarketplaceItem) => {
    setPullingSlug(item.slug);
    try {
      await apiRequest(`/marketplace/${encodeURIComponent(item.slug)}/pull`, { method: 'POST' });
      setItems((prev) => prev.filter((i) => i.slug !== item.slug));
    } finally {
      setPullingSlug(null);
    }
  }, []);

  return { items, loading, error, pullingSlug, pull, reload: load };
}

export type UseMarketplaceApi = ReturnType<typeof useMarketplace>;
