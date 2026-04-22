export interface LLMRouteKey {
  platform: string;
  service: string;
  model: string;
}

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

export interface RoutePolicy {
  maxConcurrency: number;
  rules: RateLimitRule[];
  maxRetries: number;
  minBusyRetryDelayMs: number;
}

export interface LLMRequestMeta {
  label?: string;
  [key: string]: unknown;
}

export interface GenerateContentPayload {
  kind: 'generate-content';
  params: {
    model: string;
    contents: unknown;
    config?: Record<string, unknown>;
  };
}

export type LLMPayload = GenerateContentPayload;

export interface LLMRequest<T> {
  route: LLMRouteKey;
  scopeId: string;
  supersedeKey?: string;
  payload: LLMPayload;
  parser: (raw: unknown) => Promise<T> | T;
  meta?: LLMRequestMeta;
}

export interface PersistedRateState {
  histories: Record<string, Record<string, number[]>>;
}
