import type { AIProvider, AIProviderOptions } from '../../types/chat';
import type { ILogger } from '../../infrastructure/logger';

export interface ProviderRegistration {
  name: string;
  defaultBaseUrl?: string;
  isOpenAICompatible?: boolean;
  /** Human-facing name for the providers UI (falls back to `name`). */
  label?: string;
  /** Link to the provider's model catalogue / docs. */
  docsUrl?: string;
  /** Link where a user creates an API key (omit for local providers). */
  apiKeyUrl?: string;
  /** Whether the provider exposes a usable `/embeddings` endpoint. */
  embeddings?: boolean;
  /** Placeholder model shown in the providers UI — not enforced. */
  recommendedModel?: string;
  create(logger: ILogger, opts?: AIProviderOptions): AIProvider;
}

export interface ProviderModule {
  providerManifest?: () => ProviderRegistration[];
}
