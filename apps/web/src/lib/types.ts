export interface OverviewResponse {
  sessions: number;
  openSessions: number;
  openErrands: number;
  messages: number;
  memories: number;
  heartbeats: number;
  learnedSkills: number;
  learnedSkillsLimit: number;
  skills: number;
  auditErrors: number;
  provider: string;
  model: string;
  workerProvider: string;
  workerModel: string;
  environment: string;
  timezone: string;
  heartbeatEnabled: boolean;
  summarizerEnabled: boolean;
  aiParallel: boolean;
  aiSubagentsParallel: boolean;
  channels: { type: string; enabled: boolean }[];
  registeredChannels: { type: string; target: string; principal: boolean }[];
  lastHeartbeatRunAt?: string | null;
  health: { status: string; details?: unknown };
  activeRuns: ActiveRun[];
  queue: QueueResponse;
  usage: UsageStats;
  recentErrors: AuditItem[];
}

export type SessionKind = 'user' | 'delegated';

export interface SessionSummary {
  id: string;
  channel: string;
  peerId: string;
  kind: SessionKind;
  startedAt?: string;
  endedAt?: string;
  messageCount: number;
  preview?: string | null;
  metadata: Record<string, unknown>;
}

export interface SessionsResponse {
  total: number;
  limit: number;
  offset: number;
  items: SessionSummary[];
}

export type ErrandState =
  | 'draft'
  | 'queued'
  | 'open'
  | 'awaiting_peer'
  | 'awaiting_principal'
  | 'resolved'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ErrandTargetSession {
  sessionId: string;
  channel: string;
  peerId: string;
  kind: string;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
}

export interface ErrandItem {
  id: string;
  goal: string;
  state: ErrandState;
  originSessionId: string;
  pendingMessage: string | null;
  delivery: { type: 'opener' | 'resume'; sent: number; total: number; error: string | null } | null;
  notes: string | null;
  result: string | null;
  createdAt: string;
  lastProgressAt: string | null;
  closedAt: string | null;
  targets: ErrandTargetSession[];
}

export interface ErrandTranscriptMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface ErrandTranscriptResponse {
  errandId: string;
  messages: ErrandTranscriptMessage[];
}

export interface ErrandsResponse {
  limit: number;
  offset: number;
  items: ErrandItem[];
}

export interface ImageAttachment {
  data: string;
  mimeType?: string;
}

export interface MessageItem {
  id: string;
  role: string;
  content: string;
  images?: ImageAttachment[];
  missingImages?: number;
  errorCode?: string;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  sessionId?: string;
  source?: string;
  type: string;
  content: string;
  importance?: number;
  tags?: string;
  createdAt: string;
}

export interface SessionDetailResponse {
  session: SessionSummary;
  messages: MessageItem[];
  memories: MemoryItem[];
}

export interface MemoriesResponse {
  items: MemoryItem[];
}

export interface HeartbeatItem {
  id: string;
  beat: string;
  type: string;
  cron_expression: string;
  channel?: string | null;
  target?: string | null;
  run_once?: boolean;
  last_run?: string | null;
  next_run?: string | null;
  created_at: string;
}

export interface HeartbeatsResponse {
  items: HeartbeatItem[];
}

export interface ChannelItem {
  id: string;
  channel: string;
  target: string;
  isPrincipal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelsResponse {
  items: ChannelItem[];
}

export interface OutboundMessageItem {
  id: string;
  channel: string;
  target: string;
  content: string;
  status: 'sent' | 'failed';
  errorMessage?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

export interface OutboundResponse {
  items: OutboundMessageItem[];
}

export type SkillsMode = 'auto' | 'manual';

export interface PluginItem {
  family: 'tools' | 'channels' | 'skills' | 'mcps';
  name: string;
  enabled: boolean;
  mcpStatus?: {
    name: string;
    state: 'disabled' | 'connecting' | 'connected' | 'error';
    toolCount: number;
    error?: string;
  };
  /** Skills carry documentation with them; tools and channels do not. */
  description?: string;
  read_when?: string[] | null;
  content?: string | null;
  learned_at?: string | null;
}

export interface PluginsResponse {
  items: PluginItem[];
}

export interface ChannelHints {
  uninstalled?: string;
  inactive?: string;
  active?: string;
  pairing?: string;
  allowUnlisted?: string;
  whitelist?: string;
  [key: string]: string | undefined;
}

export interface MarketplaceItem {
  family: 'tool' | 'skill' | 'channel' | 'mcp';
  slug: string;
  group?: string;
  summary?: string;
  hints?: ChannelHints;
  configFields?: ChannelConfigField[];
}

export interface MarketplaceResponse {
  items: MarketplaceItem[];
}

export interface ChannelHintsResponse {
  hints: Record<string, ChannelHints>;
}

/**
 * Channels only: one editable config input, mirrored from koris-hub's channel
 * catalog so the setup wizard renders a channel's form from the catalog instead
 * of hard-coding it. `name` is the config key written to the channel's config.
 */
export interface ChannelConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'boolean' | 'number';
  placeholder?: string;
  description?: string;
  required?: boolean;
}

export interface ChannelCatalogItem {
  slug: string;
  name: string;
  summary?: string;
  hints?: ChannelHints;
  configFields?: ChannelConfigField[];
}

export interface ChannelsCatalogResponse {
  items: ChannelCatalogItem[];
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
  configured: boolean;
  /** The single model saved for this provider in koris.json's ai.providers[] (empty when unconfigured). */
  model: string;
  /** base_url saved for this provider (empty string means "use the shipped default"). */
  storedBaseUrl: string;
  /** Whether a non-empty api_token is saved for this provider. */
  hasToken: boolean;
  /** num_ctx saved for this provider (undefined ⇒ falls back to the default preset). */
  storedNumCtx?: number;
}

export interface ActiveProvider {
  provider: string;
  model: string;
  baseUrl: string;
  hasToken: boolean;
  /** Effective context size for this role (configured or the default preset). */
  numCtx?: number;
}

export type ProviderRole = 'manager' | 'workers';

export interface ProvidersResponse {
  providers: ProviderCatalogEntry[];
  defaultNumCtx: number;
  active: Record<ProviderRole, ActiveProvider> & {
    embed: ActiveProvider & { enabled: boolean };
  };
}

export interface ActiveRun {
  id: string;
  sessionId: string;
  question: string;
  startedAt: string;
  channel: string;
}

export interface GateBlock {
  domain: string;
  toolName: string | null;
  at: string;
}

export interface GateBlocksResponse {
  blocks: GateBlock[];
}

export interface AllowedDomainsResponse {
  ok?: boolean;
  added?: boolean;
  allowedDomains: string[];
}

export interface ActiveRunsResponse {
  items: ActiveRun[];
}

export interface QueueTaskInfo {
  label: string;
  priority: number;
  eligible: boolean;
}

export interface SubAgentQueueState {
  names: string[];
  queued: number;
  active: number;
  concurrency: number;
  queuedLabels: string[];
  activeLabels: string[];
}

export interface QueueResponse {
  parallel: boolean;
  subagentsParallel: boolean;
  backgroundGraceMs: number;
  subAgents: SubAgentQueueState[];
  running: QueueTaskInfo[];
  queued: QueueTaskInfo[];
}

export interface AuditItem {
  id: string;
  runId?: string;
  sessionId?: string;
  channel?: string;
  type: 'llm' | 'tool';
  role: 'manager' | 'worker';
  agentName?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  promptPreview?: string | null;
  promptLength?: number;
  response?: string;
  responsePreview?: string | null;
  responseLength?: number;
  finishReason?: string;
  toolCalls?: number;
  toolsEnabled?: boolean;
  toolName?: string;
  toolArgs?: string;
  success?: boolean;
  durationMs: number;
  status: 'success' | 'error';
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface AuditResponse {
  total: number;
  limit: number;
  offset: number;
  items: AuditItem[];
}

export interface UsageStats {
  calls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
}
