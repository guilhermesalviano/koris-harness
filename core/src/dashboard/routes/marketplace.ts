import type { Request, Response, Router } from 'express';
import type { HubEntry, PullResult, ChannelHints, ChannelCatalogItem } from '../../../../scripts/hub-sync';
import { createCachedLoader } from '../../utils/cached-loader';

export interface MarketplaceRouteDependencies {
  hub: {
    listMissing: () => Promise<HubEntry[]>;
    pullEntry: (slug: string) => Promise<PullResult>;
    fetchChannelHints: () => Promise<Record<string, ChannelHints>>;
    fetchChannelCatalog: () => Promise<ChannelCatalogItem[]>;
  };
  getSkillSync: () => { sync(): void } | null;
  getToolSync: () => { sync(slug?: string): void } | null;
  getMcpSync: () => { sync(slug?: string): Promise<void> } | null;
  registerChannel: (slug: string) => void;
}

export function registerMarketplaceRoutes(router: Router, dependencies: MarketplaceRouteDependencies): void {
  const { hub, getSkillSync, getToolSync, getMcpSync, registerChannel } = dependencies;
  router.get('/marketplace', async (_req: Request, res: Response) => {
    try {
      const items = await hub.listMissing();
      res.json({ items });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to reach koris-hub.' });
    }
  });

  const ttlMs = 10 * 60 * 1000;
  const getHints = createCachedLoader({ load: hub.fetchChannelHints, ttlMs, fallback: () => ({}) });
  const getCatalog = createCachedLoader({ load: hub.fetchChannelCatalog, ttlMs, fallback: () => [] });

  router.get('/channels/hints', async (_req: Request, res: Response) => {
    res.json({ hints: await getHints() });
  });

  router.get('/channels/catalog', async (_req: Request, res: Response) => {
    res.json({ items: await getCatalog() });
  });

  router.post('/marketplace/:slug/pull', async (req: Request, res: Response) => {
    try {
      const item = await hub.pullEntry(String(req.params.slug));
      if (item.family === 'tool') {
        getToolSync()?.sync(item.slug);
      } else if (item.family === 'mcp') {
        await getMcpSync()?.sync(item.slug);
      } else if (item.family === 'skill') {
        getSkillSync()?.sync();
      } else if (item.family === 'channel') {
        // Installed inactive on purpose — see `registerPulledChannel`.
        registerChannel(item.slug);
      }
      res.status(201).json({ success: true, item });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to pull from koris-hub.' });
    }
  });
}
