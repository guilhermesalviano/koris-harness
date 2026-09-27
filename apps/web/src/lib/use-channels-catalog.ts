import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";
import type { ChannelCatalogItem, ChannelsCatalogResponse } from "./types";

export function useChannelsCatalog(): {
  items: ChannelCatalogItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<ChannelCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<ChannelsCatalogResponse>("/channels/catalog");
      if (res.items) {
        setItems(res.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, reload: load };
}
