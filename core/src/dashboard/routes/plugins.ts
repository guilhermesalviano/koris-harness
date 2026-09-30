import type { Request, Response, Router } from 'express';
import type { ILearnedSkillsRepository } from '../../repositories/learned-skills';
import type { ISkillsRepository } from '../../repositories/skills';
import type { IPluginSettingsRepository } from '../../repositories/plugin-settings';
import type { ILogger } from '../../infrastructure/logger';
import type { McpManager } from '../../services/mcps/mcp-manager';
import type { PluginCatalogSingleton } from '../../services/plugins/plugin-catalog-singleton';
import { resolvePluginEnabled } from '../../services/plugins/plugin-enablement';
import { maskSecret } from '../secrets';

export interface PluginsRouteDependencies {
  logger: ILogger;
  learnedSkillsRepo: Pick<ILearnedSkillsRepository, 'getAll' | 'setEnabled'>;
  skillsRepo: Pick<ISkillsRepository, 'get'>;
  pluginSettingsRepo: Pick<IPluginSettingsRepository, 'getEnabled' | 'setEnabled'>;
  catalog: Pick<typeof PluginCatalogSingleton, 'getExistingInstance' | 'append'>;
  installedChannelNames: () => string[];
  getSkillSync: () => { sync(): void } | null;
  getToolSync: () => { sync(slug?: string): void } | null;
  getMcpSync: () => { sync(slug?: string): Promise<void> } | null;
  getMcpManager: () => Pick<McpManager, 'getStatuses' | 'enable' | 'disable' | 'getDefinition' | 'reconnect'> | null;
  startChannel: (name: string) => void;
  stopChannel: (name: string) => void;
}

function isInsecureMcpUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'http:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost';
  } catch {
    return false;
  }
}

export function registerPluginsRoutes(router: Router, dependencies: PluginsRouteDependencies): void {
  const {
    logger, learnedSkillsRepo, skillsRepo, pluginSettingsRepo, catalog, installedChannelNames,
    getSkillSync, getToolSync, getMcpSync, getMcpManager, startChannel, stopChannel,
  } = dependencies;
  /**
   * Skills as plugin rows, for the shared `/plugins` listing. Disk decides
   * which skills exist; the `learned_skills` row only supplies state, so a
   * skill that has not been synced yet still lists as enabled.
   */
  function listSkillPlugins() {
    const learnedByName = new Map(learnedSkillsRepo.getAll().map((skill) => [skill.name, skill]));

    return skillsRepo.get().map((skill) => {
      const learned = learnedByName.get(skill.name);
      return {
        family: 'skills' as const,
        name: skill.name,
        enabled: learned ? learned.enabled : true,
        description: skill.description,
        read_when: skill.read_when ?? null,
        content: skill.content ?? null,
        learned_at: learned ? learned.learned_at : null,
      };
    });
  }

  router.post('/skills/sync', (_req: Request, res: Response) => {
    const sync = getSkillSync();
    if (!sync) {
      res.status(503).json({ error: 'Skill sync not initialized' });
      return;
    }

    sync.sync();
    res.json({ success: true });
  });

  router.get('/plugins', (_req: Request, res: Response) => {
    getToolSync()?.sync();
    void getMcpSync()?.sync();
    getSkillSync()?.sync();

    const diskChannels = installedChannelNames();
    if (diskChannels.length > 0) {
      catalog.append(diskChannels.map((name) => ({ family: 'channels', name })));
    }

    const mcpStatuses = new Map(
      (getMcpManager()?.getStatuses() ?? []).map((status) => [status.name, status]),
    );
    const items = catalog.getExistingInstance().map(({ family, name }) => ({
      family,
      name,
      enabled: resolvePluginEnabled(pluginSettingsRepo, family, name),
      ...(family === 'mcps' ? { mcpStatus: mcpStatuses.get(name) } : {}),
    }));

    res.json({ items: [...items, ...listSkillPlugins()] });
  });

  router.patch('/plugins/:family/:name', async (req: Request, res: Response) => {
    const family = req.params.family;
    if (family !== 'tools' && family !== 'channels' && family !== 'mcps' && family !== 'skills') {
      res.status(400).json({ error: "family must be 'tools', 'channels', 'mcps' or 'skills'." });
      return;
    }

    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    const name = String(req.params.name);

    // Skills are listed alongside plugins but keep their own store: their
    // enabled flag is a column on the `learned_skills` content row, not a
    // `plugin_settings` entry, and they are never in the plugin catalog.
    if (family === 'skills') {
      if (!learnedSkillsRepo.setEnabled(name, enabled)) {
        res.status(404).json({ error: 'Skill not found' });
        return;
      }

      res.json({ success: true, item: { family, name, enabled } });
      return;
    }

    if (family === 'channels') {
      const diskChannels = installedChannelNames();
      if (diskChannels.includes(name)) {
        catalog.append([{ family: 'channels', name }]);
      }
    }

    const installedPlugins = catalog.getExistingInstance();
    if (!installedPlugins.some((p) => p.family === family && p.name === name)) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }

    pluginSettingsRepo.setEnabled(family, name, enabled);

    if (family === 'channels') {
      if (enabled) {
        startChannel(name);
      } else {
        stopChannel(name);
      }
    } else if (family === 'mcps') {
      const manager = getMcpManager();
      if (enabled) {
        await manager?.enable(name);
      } else {
        await manager?.disable(name);
      }
    }

    res.json({ success: true, item: { family, name, enabled } });
  });

  router.get('/mcps/:name/config', (req: Request, res: Response) => {
    const definition = getMcpManager()?.getDefinition(String(req.params.name));
    if (!definition) {
      res.status(404).json({ error: 'MCP plugin not found' });
      return;
    }
    const current = definition.loadConfig();
    res.json({
      name: definition.name,
      url: current.url,
      bearer_token: current.bearerToken ? maskSecret(current.bearerToken) : '',
    });
  });

  router.patch('/mcps/:name/config', async (req: Request, res: Response) => {
    const name = String(req.params.name);
    const definition = getMcpManager()?.getDefinition(name);
    if (!definition?.writeConfigPatch) {
      res.status(404).json({ error: 'Configurable MCP plugin not found' });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.url === 'string') {
      try {
        const url = new URL(req.body.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
        patch.url = url.toString();
        // Warn when a bearer_token would be sent over a plaintext HTTP connection
        // to a non-loopback host — the token would be exposed in transit.
        if (isInsecureMcpUrl(url.toString())) {
          logger.warn(
            `[MCP] Insecure http:// URL configured for "${name}" — bearer_token will be transmitted in plaintext. Consider using https://.`,
          );
        }
      } catch {
        res.status(400).json({ error: 'url must be an absolute http or https URL' });
        return;
      }
    }
    if (typeof req.body?.bearer_token === 'string' && !req.body.bearer_token.includes('••••')) {
      patch.bearer_token = req.body.bearer_token;
    }
    definition.writeConfigPatch(patch);
    if (resolvePluginEnabled(pluginSettingsRepo, 'mcps', name)) {
      await getMcpManager()?.reconnect(name);
    }
    const configuredUrl = typeof patch.url === 'string' ? patch.url : definition.loadConfig().url;
    const urlInsecure = isInsecureMcpUrl(configuredUrl);
    res.json({ success: true, ...(urlInsecure ? { warning: 'MCP server URL uses http:// — bearer_token is transmitted in plaintext.' } : {}) });
  });
}
