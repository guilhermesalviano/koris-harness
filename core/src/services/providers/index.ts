import type { AIProvider, AIProviderOptions } from '../../types/chat';
import { config } from '../../config';
import { ILogger } from '../../infrastructure/logger';
import { SerialAIProvider } from './serial-provider';
import type { ProviderRegistration } from './manifest';
import { providerManifest as ollamaManifest } from './ollama';
import { providerManifest as mockManifest } from './mock';
import { providerManifest as openAICompatibleManifest } from './openai-compatible';

/**
 * Provider discovery: every provider folder exposes `providerManifest()`
 * returning one or more `ProviderRegistration`s (the `openai-compatible` folder
 * registers the whole preset table). Adding a native provider is a folder plus
 * one line here; adding an OpenAI-compatible service is a single row in
 * `openai-compatible/presets.ts`.
 */
const PROVIDER_MANIFESTS: ReadonlyArray<() => ProviderRegistration[]> = [
  ollamaManifest,
  mockManifest,
  openAICompatibleManifest,
];

export function buildProviderRegistry(
  manifests: ReadonlyArray<() => ProviderRegistration[]> = PROVIDER_MANIFESTS,
): Map<string, ProviderRegistration> {
  const registry = new Map<string, ProviderRegistration>();
  for (const manifest of manifests) {
    for (const registration of manifest()) {
      registry.set(registration.name, registration);
    }
  }
  return registry;
}

let registryCache: Map<string, ProviderRegistration> | null = null;

function providerRegistry(): Map<string, ProviderRegistration> {
  if (!registryCache) {
    registryCache = buildProviderRegistry();
  }
  return registryCache;
}

export type AIProviderRole = 'manager' | 'worker' | 'embed';

export const AI_PRIORITY_BACKGROUND = 0;
export const AI_PRIORITY_INTERACTIVE = 1;

export interface GetAIProviderOptions {
  background?: boolean;
}

/**
 * Singleton cache for AI provider instances, keyed by role and priority mode.
 */
class ProviderCache {
  private instances = new Map<string, AIProvider>();
  private cachedLogger: ILogger | null = null;

  get(logger: ILogger, key: string): AIProvider | null {
    if (this.cachedLogger !== null && this.cachedLogger !== logger) {
      this.clear();
    }
    return this.instances.get(key) ?? null;
  }

  set(provider: AIProvider, logger: ILogger, key: string): void {
    if (this.cachedLogger !== null && this.cachedLogger !== logger) {
      this.clear();
    }
    this.cachedLogger = logger;
    this.instances.set(key, provider);
  }

  clear(): void {
    this.instances.clear();
    this.cachedLogger = null;
  }
}

const cache = new ProviderCache();

/**
 * Get or create AI provider instance based on configuration and role.
 * Provider is cached as a singleton per logger, role and priority mode.
 *
 * When `ai.parallel` is false the shared `SerialAIProvider` queue ensures
 * manager and worker LLM calls never run at the same time. `background`
 * callers (summarizer, heartbeat) get lower queue priority so they never
 * block interactive requests. When `ai.parallel` is true the same wrapper
 * still tracks in-flight activity for observability but runs calls
 * concurrently.
 *
 * @throws {Error} If configured provider is not supported
 */
export function getAIProvider(
  logger: ILogger,
  role: AIProviderRole = 'manager',
  options?: GetAIProviderOptions,
): AIProvider {
  const priority = options?.background ? AI_PRIORITY_BACKGROUND : AI_PRIORITY_INTERACTIVE;
  const label = options?.background ? `${role}:background` : role;
  const key = `${role}:${priority}`;
  const cached = cache.get(logger, key);
  if (cached) {
    return cached;
  }

  const provider = createAIProvider(logger, role);
  const resolved = new SerialAIProvider(provider, undefined, priority, label);
  cache.set(resolved, logger, key);

  return resolved;
}

/**
 * Create a new provider instance based on configuration and role
 */
export function createAIProvider(logger: ILogger, role: AIProviderRole = 'manager'): AIProvider {
  const profile = role === 'worker'
    ? config.AI.WORKERS
    : role === 'embed'
      ? config.AI.EMBED
      : config.AI.MANAGER;
  const providerType = profile.PROVIDER as string;
  const registry = providerRegistry();

  const registration = registry.get(providerType);
  if (!registration) {
    logger.warn(`Unknown provider "${providerType}", falling back to mock`);
    return registry.get('mock')!.create(logger);
  }

  const opts: AIProviderOptions = {
    baseUrl: resolveProviderBaseUrl(providerType, profile.BASE_URL),
    model: profile.MODEL,
    apiToken: profile.API_TOKEN,
    embeddingEnabled: config.AI.EMBED.ENABLED,
    embeddingModel: config.AI.EMBED.MODEL,
    numCtx: role === 'manager' ? config.AI.MANAGER.NUM_CTX : config.AI.WORKERS.NUM_CTX,
  };

  logger.info(`[provider] Initializing AI provider: ${providerType} (${role})`);
  return registration.create(logger, opts);
}

/**
 * Whether a provider name is known to the discovered registry.
 */
export function isValidProvider(provider: string): boolean {
  return providerRegistry().has(provider);
}

/**
 * Clear the cached provider instances (useful for testing)
 */
export function clearProviderCache(): void {
  cache.clear();
}

/**
 * Reset the discovered provider registry (useful for testing).
 */
export function clearProviderRegistry(): void {
  registryCache = null;
}

/**
 * Get list of supported provider types
 */
export function getSupportedProviders(): readonly string[] {
  return [...providerRegistry().keys()];
}

/**
 * The default base URL a provider ships with (undefined for providers that
 * require an explicit `base_url`).
 */
export function getProviderDefaultBaseUrl(name: string): string | undefined {
  return providerRegistry().get(name)?.defaultBaseUrl;
}

export function isOpenAICompatibleProvider(name: string): boolean {
  return providerRegistry().get(name)?.isOpenAICompatible === true;
}

/**
 * Resolve the base URL for a provider: an explicitly-configured value wins,
 * otherwise fall back to the provider's shipped default.
 */
export function resolveProviderBaseUrl(name: string, configuredBaseUrl?: string): string {
  return (configuredBaseUrl?.trim() || getProviderDefaultBaseUrl(name)) ?? '';
}

export interface ProviderCatalogEntry {
  name: string;
  label: string;
  defaultBaseUrl?: string;
  isOpenAICompatible: boolean;
  embeddings: boolean;
  recommendedModel?: string;
  apiKeyUrl?: string;
  docsUrl?: string;
}

/**
 * The user-facing provider catalogue: every selectable provider (minus the
 * internal `mock`) with its presentational metadata.
 */
export function getProviderCatalog(): ProviderCatalogEntry[] {
  return [...providerRegistry().values()]
    .filter((registration) => registration.name !== 'mock')
    .map((registration) => ({
      name: registration.name,
      label: registration.label ?? registration.name,
      defaultBaseUrl: registration.defaultBaseUrl,
      isOpenAICompatible: registration.isOpenAICompatible === true,
      embeddings: registration.embeddings === true,
      recommendedModel: registration.recommendedModel,
      apiKeyUrl: registration.apiKeyUrl,
      docsUrl: registration.docsUrl,
    }));
}
