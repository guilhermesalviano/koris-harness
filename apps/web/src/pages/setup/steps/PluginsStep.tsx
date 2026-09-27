import { useMemo, useState } from 'react';
import PluginsList from '../../../components/PluginsList';
import MarketplaceList from '../../../components/MarketplaceList';
import { usePlugins, type UsePluginsApi } from '../../../lib/use-plugins';
import { useMarketplace } from '../../../lib/use-marketplace';
import type { MarketplaceItem } from '../../../lib/types';
import type { SettingsFormApi } from '../../../lib/use-settings-form';
import { useSaveCoordinator } from '../../../lib/config-save-context';
import { Segmented, type SegmentedOption } from '../../../components/ui';

type TabKey = 'installed' | 'marketplace';
const TABS: readonly SegmentedOption<TabKey>[] = [
  { value: 'installed', label: 'Installed' },
  { value: 'marketplace', label: 'Marketplace' },
];

export function PluginsStep({
  pluginsApi: providedPluginsApi,
}: {
  api?: SettingsFormApi;
  pluginsApi?: UsePluginsApi;
} = {}) {
  const [tab, setTab] = useState<TabKey>('installed');
  const saves = useSaveCoordinator();
  const localPluginsApi = usePlugins();
  const pluginsApi = providedPluginsApi ?? localPluginsApi;
  const marketplaceApi = useMarketplace();

  const wrappedMarketplaceApi = useMemo(
    () => ({
      ...marketplaceApi,
      pull: async (item: MarketplaceItem) => {
        await marketplaceApi.pull(item);
        await pluginsApi.reload();
      },
    }),
    [marketplaceApi, pluginsApi],
  );

  return (
    <div>
      <Segmented
        label="Plugin source"
        options={TABS}
        value={tab}
        onChange={(next) => {
          void saves.flush('plugins.');
          setTab(next);
        }}
        panelId={() => 'plugins-step-panel'}
        className="mb-4"
      />

      <p className="mb-4 max-w-prose text-caption leading-relaxed text-txt-2">
        {tab === 'installed' ? (
          'Turn off any tools, channels, MCP servers, or skills you don’t want enabled. Toggling here takes effect immediately and can be changed later from Configuration → Plugins.'
        ) : (
          <>
            Browse and download tools, channels, MCP servers, and skills from Koris Hub. Downloaded tools and skills activate automatically; channels and MCP servers are installed inactive and must be configured, then enabled. You can also explore available plugins on the hub website at{' '}
            <a
              href="https://hub.koaris.com/marketplace/"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline hover:opacity-80"
            >
              https://hub.koaris.com/marketplace/
            </a>
            .
          </>
        )}
      </p>

      <div id="plugins-step-panel" role="tabpanel">
        {tab === 'installed' ? (
          <PluginsList api={pluginsApi} />
        ) : (
          <MarketplaceList api={wrappedMarketplaceApi} />
        )}
      </div>
    </div>
  );
}
