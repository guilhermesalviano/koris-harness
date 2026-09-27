import { useMemo, useState } from 'react';
import { SettingsSection } from '../../components/SettingsUI';
import { Segmented, type SegmentedOption } from '../../components/ui';
import { useSaveCoordinator } from '../../lib/config-save-context';
import PluginsList from '../../components/PluginsList';
import MarketplaceList from '../../components/MarketplaceList';
import { usePlugins } from '../../lib/use-plugins';
import { useMarketplace } from '../../lib/use-marketplace';
import type { MarketplaceItem } from '../../lib/types';

type TabKey = 'installed' | 'marketplace';

const TABS: readonly SegmentedOption<TabKey>[] = [
  { value: 'installed', label: 'Installed' },
  { value: 'marketplace', label: 'Marketplace' },
];

export default function PluginsPage() {
  const saves = useSaveCoordinator();
  const [tab, setTab] = useState<TabKey>('installed');
  const pluginsApi = usePlugins();
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
    <SettingsSection title="Plugins" description="Extend your assistant with tools, channels, skills, and MCP servers.">
      <div className="mb-6">
        <Segmented
          options={TABS}
          value={tab}
          label="Plugin source"
          panelId={(value) => `plugins-panel-${value}`}
          onChange={(value) => { void saves.flush(); setTab(value); }}
        />
      </div>

      <div id={`plugins-panel-${tab}`} role="tabpanel">
        {tab === 'installed' ? <PluginsList api={pluginsApi} /> : <MarketplaceList api={wrappedMarketplaceApi} />}
      </div>
    </SettingsSection>
  );
}
