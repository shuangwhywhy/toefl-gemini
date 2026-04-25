export interface LLMRouteKey {
  platform: string;
  service: string;
  model?: string;
  modelBucket?: LLMModelBucket;
}

export type LLMUsage = 'text' | 'tts' | 'transcription' | 'live' | 'image';

export type LLMOrigin = 'ui' | 'preload' | 'retry' | 'system';

export type LLMModelBucket = 'text' | 'tts';

export type LLMRouteService =
  | 'text'
  | 'evaluation'
  | 'chat'
  | 'tts-single'
  | 'tts-multi'
  | 'transcription';

export interface StartedInWindowRateLimitRule {
  id: string;
  mode: 'started_in_window';
  windowMs: number;
  max: number;
}

export interface ActiveRequestsRateLimitRule {
  id: string;
  mode: 'active_requests';
  max: number;
}

export type RateLimitRule =
  | StartedInWindowRateLimitRule
  | ActiveRequestsRateLimitRule;

export interface LLMBusyRetryConfig {
  maxRetries?: number;
  minDelay?: string;
}

export interface LLMLimitConfig {
  started?: Record<string, number>;
  active?: number;
}

export interface LLMPolicyProfileConfig {
  description?: string;
  concurrency?: number;
  busyRetry?: LLMBusyRetryConfig;
  limits?: LLMLimitConfig;
}

export interface LLMRouteModelOverrideConfig {
  description?: string;
  concurrency?: number;
  busyRetry?: LLMBusyRetryConfig;
  limits?: LLMLimitConfig;
}

export interface LLMRouteCapabilityConfig extends LLMPolicyProfileConfig {
  use?: string[];
  pool?: string;
  models?: Record<string, LLMRouteModelOverrideConfig>;
}

export interface LLMSharedPoolConfig {
  description?: string;
  limits: LLMLimitConfig;
}

export interface LLMPolicyDefaults {
  busyRetry: {
    maxRetries: number;
    minDelay: string;
  };
  backgroundQueue: {
    cooldownAfterBusy: string;
  };
}

export interface LLMTextGenerationCapabilitiesConfig {
  general: LLMRouteCapabilityConfig;
  evaluation: LLMRouteCapabilityConfig;
  chat: LLMRouteCapabilityConfig;
}

export interface LLMSpeechCapabilitiesConfig {
  singleVoice: LLMRouteCapabilityConfig;
  multiVoiceConversation: LLMRouteCapabilityConfig;
  transcription: LLMRouteCapabilityConfig;
}

export interface LLMPolicyConfigDocument {
  version: number;
  defaults: LLMPolicyDefaults;
  profiles: Record<string, LLMPolicyProfileConfig>;
  sharedPools: Record<string, LLMSharedPoolConfig>;
  capabilities: {
    textGeneration: LLMTextGenerationCapabilitiesConfig;
    speech: LLMSpeechCapabilitiesConfig;
  };
}

export interface LLMSchedulerPolicy {
  backgroundBusyCooldownMs: number;
}

export interface ResolvedRouteExecutionPolicy {
  maxConcurrency: number;
  maxRetries: number;
  minBusyRetryDelayMs: number;
  rules: RateLimitRule[];
  sharedPoolKey: string | null;
}

export type RoutePolicy = ResolvedRouteExecutionPolicy;

export interface ResolvedSharedPoolPolicy {
  key: string;
  stateKey: string;
  rules: RateLimitRule[];
}

export interface CompiledRouteDefinition {
  defaultPolicy: ResolvedRouteExecutionPolicy;
  modelPolicies: Record<string, ResolvedRouteExecutionPolicy>;
}

export interface CompiledSharedPoolDefinition {
  key: string;
  rules: RateLimitRule[];
  stateBucketSegment: string;
  appliesPerModel: boolean;
}

export interface CompiledLLMPolicyRegistry {
  routes: Record<string, CompiledRouteDefinition>;
  sharedPools: Record<string, CompiledSharedPoolDefinition>;
  scheduler: LLMSchedulerPolicy;
}

export interface LLMRequestMeta {
  label?: string;
  [key: string]: unknown;
}

export interface GenerateContentPayload {
  kind: 'generate-content';
  params: {
    model?: string;
    contents: unknown;
    config?: Record<string, unknown>;
  };
}

export type LLMPayload = GenerateContentPayload;

export interface LLMRequest<T> {
  route: LLMRouteKey;
  scopeId: string;
  supersedeKey?: string;
  businessKey: string;
  payload: LLMPayload;
  parser: (raw: unknown) => Promise<T> | T;
  meta?: LLMRequestMeta;
  isBackground?: boolean;
  usage?: LLMUsage;
  sceneKey?: string;
  origin?: LLMOrigin;
  priority?: number;
  estimatedInputTokens?: number;
}

export interface PersistedRateState {
  histories: Record<string, Record<string, number[]>>;
  tokenHistories?: Record<string, Record<string, Array<{ at: number; amount: number }>>>;
}
