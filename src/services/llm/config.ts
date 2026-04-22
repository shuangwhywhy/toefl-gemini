import type { LLMRouteKey, RoutePolicy } from './types';

export const GEMINI_PLATFORM = 'gemini';
export const TEXT_MODEL =
  import.meta.env.VITE_GEMINI_TEXT_MODEL ?? 'gemini-2.5-flash';
export const TTS_MODEL =
  import.meta.env.VITE_GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';
export const TRANSCRIBE_MODEL =
  import.meta.env.VITE_GEMINI_TRANSCRIBE_MODEL ?? TEXT_MODEL;

const basePolicy: RoutePolicy = {
  maxConcurrency: 3,
  maxRetries: 2,
  minBusyRetryDelayMs: 2000,
  rules: [
    { id: 'platform.started.1m', mode: 'started_in_window', windowMs: 60_000, max: 20 },
    { id: 'platform.started.5m', mode: 'started_in_window', windowMs: 300_000, max: 60 },
    { id: 'platform.started.1d', mode: 'started_in_window', windowMs: 86_400_000, max: 1000 }
  ]
};

const servicePolicies: Record<string, Partial<RoutePolicy>> = {
  text: { maxConcurrency: 3 },
  evaluation: { maxConcurrency: 2 },
  chat: { maxConcurrency: 2 },
  'tts-single': {
    maxConcurrency: 2,
    rules: [
      { id: 'tts.single.started.1m', mode: 'started_in_window', windowMs: 60_000, max: 8 },
      { id: 'tts.single.started.5m', mode: 'started_in_window', windowMs: 300_000, max: 24 },
      { id: 'tts.single.started.1d', mode: 'started_in_window', windowMs: 86_400_000, max: 240 },
      { id: 'tts.single.active', mode: 'active_requests', max: 2 }
    ]
  },
  'tts-multi': {
    maxConcurrency: 1,
    rules: [
      { id: 'tts.multi.started.1m', mode: 'started_in_window', windowMs: 60_000, max: 4 },
      { id: 'tts.multi.started.5m', mode: 'started_in_window', windowMs: 300_000, max: 12 },
      { id: 'tts.multi.started.1d', mode: 'started_in_window', windowMs: 86_400_000, max: 120 },
      { id: 'tts.multi.active', mode: 'active_requests', max: 1 }
    ]
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
  'tts-single': {
    [TTS_MODEL]: {}
  },
  'tts-multi': {
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
