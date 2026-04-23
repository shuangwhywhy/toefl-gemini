import type { LLMRouteKey, RoutePolicy } from './types';

export const GEMINI_PLATFORM = 'gemini';
export const TEXT_MODEL =
  import.meta.env.VITE_GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash';
export const TTS_MODEL =
  import.meta.env.VITE_GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';
export const TRANSCRIBE_MODEL =
  import.meta.env.VITE_GEMINI_TRANSCRIBE_MODEL ?? TEXT_MODEL;

const basePolicy: RoutePolicy = {
  maxConcurrency: 2,
  maxRetries: 2,
  minBusyRetryDelayMs: 10000,
  rules: [
    { id: 'platform.started.1m', mode: 'started_in_window', windowMs: 60_000, max: 15 },
    { id: 'platform.started.1d', mode: 'started_in_window', windowMs: 86_400_000, max: 500 }
  ]
};

const servicePolicies: Record<string, Partial<RoutePolicy>> = {
  text: { maxConcurrency: 2 },
  evaluation: { maxConcurrency: 1 },
  chat: { maxConcurrency: 1 },
  'tts-shared': {
    maxConcurrency: 2,
    rules: [
      { id: 'tts.shared.started.1m', mode: 'started_in_window', windowMs: 60_000, max: 15 },
      { id: 'tts.shared.started.1d', mode: 'started_in_window', windowMs: 86_400_000, max: 200 },
      { id: 'tts.shared.active', mode: 'active_requests', max: 1 }
    ]
  },
  'tts-single': {
    maxConcurrency: 2,
    rules: [{ id: 'tts.shared.delegated', mode: 'active_requests', max: 2 }]
  },
  'tts-multi': {
    maxConcurrency: 1,
    rules: [{ id: 'tts.shared.delegated', mode: 'active_requests', max: 2 }]
  },
  transcription: {
    maxConcurrency: 1,
    rules: [
      { id: 'transcribe.started.1m', mode: 'started_in_window', windowMs: 60_000, max: 6 },
      { id: 'transcribe.started.5m', mode: 'started_in_window', windowMs: 300_000, max: 18 },
      { id: 'transcribe.started.1d', mode: 'started_in_window', windowMs: 86_400_000, max: 180 },
      { id: 'transcribe.active', mode: 'active_requests', max: 1 }
    ]
  }
};

const modelPoliciesByService: Record<string, Record<string, Partial<RoutePolicy>>> = {
  text: {},
  evaluation: {},
  chat: {},
  transcription: {},
  'tts-shared': {
    [TTS_MODEL]: {}
  }
};


export const resolveRoutePolicy = (route: LLMRouteKey): RoutePolicy => {
  const serviceOverride = servicePolicies[route.service] ?? {};
  const modelOverride =
    modelPoliciesByService[route.service]?.[route.model] ?? {};
  return {
    maxConcurrency:
      modelOverride.maxConcurrency ??
      serviceOverride.maxConcurrency ??
      basePolicy.maxConcurrency,
    maxRetries:
      modelOverride.maxRetries ??
      serviceOverride.maxRetries ??
      basePolicy.maxRetries,
    minBusyRetryDelayMs:
      modelOverride.minBusyRetryDelayMs ??
      serviceOverride.minBusyRetryDelayMs ??
      basePolicy.minBusyRetryDelayMs,
    rules:
      modelOverride.rules ??
      serviceOverride.rules ??
      basePolicy.rules
  };
};
