import type { Request, Response, Router } from 'express';
import { config, reloadConfig } from '../../config';
import { isConfigFilePresent } from '../../config/helpers';
import { checkAiProviderConnectivity } from '../../config/validators';
import { loadCurrentOrExampleSettings, writeSettingsFile } from '../../config/settings-writer';
import { DEFAULT_NUM_CTX } from '../../config/ai-config';
import { getSupportedProviders, getProviderCatalog, getProviderDefaultBaseUrl, clearProviderCache } from '../../services/providers';
import { asRecord, buildSettingsUpdate, collectSettingsPayloadErrors } from '../settings-payload';
import { maskDeep } from '../secrets';
import { addAllowedDomain } from '../../services/security/allowed-domains';
import { findGateBlocks } from '../../services/security/gate-blocks';
import type { IAuditLogRepository } from '../../repositories/audit-log';
import type { ILogger } from '../../infrastructure/logger';
import { CHANNEL_TYPES } from '../../entities/channel';

export interface SettingsRouteDependencies {
  logger: ILogger;
  auditRepo: Pick<IAuditLogRepository, 'findAll'>;
  getSettings: () => Record<string, unknown>;
  channelNames: () => string[];
  writeChannelConfig: (name: string, patch: Record<string, unknown>) => void;
  reprimeChannel: (name: string) => void;
}

export function registerSettingsRoutes(router: Router, dependencies: SettingsRouteDependencies): void {
  const { logger, auditRepo, getSettings, channelNames, writeChannelConfig, reprimeChannel } = dependencies;

  router.get('/settings', (_req: Request, res: Response) => {
    res.json(maskDeep(getSettings()));
  });

  router.get('/settings/status', (_req: Request, res: Response) => {
    const configured = isConfigFilePresent();
    res.json({ configured });
  });

  router.get('/capabilities', (_req: Request, res: Response) => {
    // "mock" is an internal testing provider, not a real choice for end users.
    const providers = getSupportedProviders().filter((provider) => provider !== 'mock');
    res.json({ providers, channels: CHANNEL_TYPES });
  });

  router.get('/providers', (_req: Request, res: Response) => {
    const activeProfile = (profile: {
      PROVIDER: string;
      MODEL: string;
      BASE_URL: string;
      API_TOKEN: string;
      NUM_CTX?: number;
    }) => ({
      provider: profile.PROVIDER,
      model: profile.MODEL,
      baseUrl: profile.BASE_URL,
      hasToken: !!profile.API_TOKEN?.trim(),
      numCtx: profile.NUM_CTX,
    });
    const configured = new Set([config.AI.MANAGER.PROVIDER, config.AI.WORKERS.PROVIDER, config.AI.EMBED.PROVIDER]);
    // Surface every provider kept in ai.providers[] on disk with its saved
    // models / base_url so the chat picker can switch straight to it instead
    // of showing "Set up".
    const storedByName = new Map<string, Record<string, unknown>>();
    const storedProviders = asRecord(asRecord(loadCurrentOrExampleSettings())?.ai)?.providers;
    if (Array.isArray(storedProviders)) {
      for (const raw of storedProviders) {
        const entry = asRecord(raw);
        const name = entry?.provider;
        if (entry && typeof name === 'string' && name.trim()) {
          configured.add(name);
          storedByName.set(name, entry);
        }
      }
    }
    const providers = getProviderCatalog().map((entry) => {
      const stored = storedByName.get(entry.name);
      const model = typeof stored?.model === 'string' ? stored.model : '';
      return {
        ...entry,
        configured: configured.has(entry.name),
        model,
        storedBaseUrl: typeof stored?.base_url === 'string' ? stored.base_url : '',
        hasToken: typeof stored?.api_token === 'string' ? !!stored.api_token.trim() : false,
        storedNumCtx: stored?.num_ctx !== undefined && Number.isFinite(Number(stored.num_ctx))
          ? Number(stored.num_ctx)
          : undefined,
      };
    });
    res.json({
      providers,
      defaultNumCtx: DEFAULT_NUM_CTX,
      active: {
        manager: activeProfile(config.AI.MANAGER),
        workers: activeProfile(config.AI.WORKERS),
        embed: { ...activeProfile(config.AI.EMBED), enabled: config.AI.EMBED.ENABLED },
      },
    });
  });

  router.post('/settings', (req: Request, res: Response) => {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }

    const errors = collectSettingsPayloadErrors(patch as Record<string, unknown>);
    if (errors.length > 0) {
      res.status(400).json({ error: 'Invalid settings.', details: errors });
      return;
    }

    const { settings, channelConfigPatches } = buildSettingsUpdate(
      loadCurrentOrExampleSettings(), patch as Record<string, unknown>, channelNames(),
    );
    const writtenPath = writeSettingsFile(settings);

    // `enabled` is DB-backed now (see PATCH /plugins/:family/:name) — strip it
    // defensively so a stale cached frontend can't write it back into config.yml.
    for (const { name, patch: channelPatch } of channelConfigPatches) {
      const { enabled: _enabled, ...rest } = channelPatch;
      writeChannelConfig(name, rest);
      reprimeChannel(name);
    }

    reloadConfig();
    clearProviderCache();

    logger.info(`Settings saved to ${writtenPath}`);
    res.json({ success: true, settings: maskDeep(getSettings()) });
  });

  router.get('/allowed-domains', (_req: Request, res: Response) => {
    res.json({ allowedDomains: config.ALLOWED_DOMAINS });
  });

  router.post('/allowed-domains', (req: Request, res: Response) => {
    const raw = typeof req.body?.domain === 'string' ? req.body.domain : '';
    const result = addAllowedDomain(raw);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.added) {
      logger.info(`allowed_domains: added "${result.hostname}"`);
    }
    res.json({ ok: true, added: result.added, allowedDomains: result.allowedDomains });
  });

  router.get('/chat/gate-blocks', (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const blocks = findGateBlocks(auditRepo, { sessionId, allowed: config.ALLOWED_DOMAINS });
    res.json({ blocks });
  });

  router.post('/ai/test-connection', async (req: Request, res: Response) => {
    const { provider, base_url: baseUrl, api_token: apiToken } = (req.body ?? {}) as Record<string, unknown>;

    const baseUrlStr = typeof baseUrl === 'string' ? baseUrl : '';
    if (typeof provider !== 'string' || (!baseUrlStr && !getProviderDefaultBaseUrl(provider))) {
      res.status(400).json({ error: 'provider and base_url are required.' });
      return;
    }

    const result = await checkAiProviderConnectivity({
      label: 'test',
      provider,
      baseUrl: baseUrlStr,
      apiToken: typeof apiToken === 'string' ? apiToken : '',
    });

    res.json(result);
  });
}
