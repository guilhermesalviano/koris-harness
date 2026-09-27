export interface OpenAICompatiblePreset {
  name: string;
  baseUrl: string;
  hint?: string;
  notFoundHint?: (ctx: { model: string; baseUrl: string; body: string }) => string | null;
  label?: string;
  docsUrl?: string;
  apiKeyUrl?: string;
  embeddings?: boolean;
  recommendedModel?: string;
  extraHeaders?: Record<string, string>;
}

const nvidiaNotFoundHint: OpenAICompatiblePreset['notFoundHint'] = ({ model, baseUrl, body }) =>
  body.includes('page not found') && !model.includes('/')
    ? `NVIDIA model not found: "${model}". NVIDIA models require a namespace prefix ` +
      `(e.g. "google/gemma-4-31b-it"). Check available models at ${baseUrl}/models`
    : null;

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAICompatiblePreset[] = [
  {
    name: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs/models',
    embeddings: true,
    recommendedModel: 'gpt-4o-mini',
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/models',
    embeddings: false,
    recommendedModel: 'openai/gpt-4o-mini',
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/guilhermesalviano/koris',
      'X-Title': 'koris',
    },
  },
  {
    name: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    embeddings: false,
    recommendedModel: 'deepseek-chat',
  },
  {
    name: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/models',
    embeddings: false,
    recommendedModel: 'llama-3.3-70b-versatile',
  },
  {
    name: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyUrl: 'https://console.x.ai',
    docsUrl: 'https://docs.x.ai/docs/models',
    embeddings: false,
    recommendedModel: 'grok-2-latest',
  },
  {
    name: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/getting-started/models/models_overview/',
    embeddings: true,
    recommendedModel: 'mistral-large-latest',
  },
  {
    name: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    docsUrl: 'https://docs.together.ai/docs/inference-models',
    embeddings: true,
    recommendedModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    embeddings: true,
    recommendedModel: 'gemini-2.0-flash',
    hint: 'Gemini OpenAI-compat exposes /chat/completions and /embeddings; /models health may report non-200 even when chat works',
  },
  {
    name: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyUrl: 'https://build.nvidia.com',
    docsUrl: 'https://build.nvidia.com/models',
    embeddings: true,
    recommendedModel: 'meta/llama-3.3-70b-instruct',
    notFoundHint: nvidiaNotFoundHint,
  },
] as const;

export function findOpenAICompatiblePreset(name: string): OpenAICompatiblePreset | undefined {
  return OPENAI_COMPATIBLE_PRESETS.find((preset) => preset.name === name);
}
