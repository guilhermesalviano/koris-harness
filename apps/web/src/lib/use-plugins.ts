import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import type { PluginItem, PluginsResponse } from './types';

export function usePlugins() {
  const [items, setItems] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loaded = useRef(false);
  const version = useRef(0);

  const load = useCallback(async () => {
    const request = ++version.current;
    if (!loaded.current) setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<PluginsResponse>('/plugins');
      if (request !== version.current) return;
      loaded.current = true;
      setItems(res.items);
    } catch (err) {
      if (request === version.current) setError(err instanceof Error ? err.message : 'Failed to load plugins');
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(async (item: PluginItem) => {
    const nextEnabled = !item.enabled;
    setItems((prev) => prev.map((i) => (i.family === item.family && i.name === item.name ? { ...i, enabled: nextEnabled } : i)));

    try {
      await apiRequest(`/plugins/${item.family}/${encodeURIComponent(item.name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.family === item.family && i.name === item.name ? { ...i, enabled: item.enabled } : i)));
      throw err;
    }
  }, []);

  return { items, loading, error, toggle, reload: load };
}

export type UsePluginsApi = ReturnType<typeof usePlugins>;
