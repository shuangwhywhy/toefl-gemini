import type {
  LLMModelBucket,
  LLMOrigin,
  LLMRouteService,
  LLMUsage
} from './types';

export const GEMINI_PLATFORM = 'gemini';

export interface ModelQuota {
  rpm: number;
  tpm: number | null;
  rpd: number;
}

export interface LLMModelDefinition {
  id: string;
  displayName: string;
  bucket: LLMModelBucket;
  capabilities: LLMUsage[];
  quota: ModelQuota;
  source: 'ai-studio-active-limits';
}

export const LLM_MODEL_CATALOG: Record<string, LLMModelDefinition> = {
  'gemini-3.1-flash-lite-preview': {
    id: 'gemini-3.1-flash-lite-preview',
    displayName: 'Gemini 3.1 Flash Lite',
    bucket: 'text',
    capabilities: ['text', 'transcription'],
    quota: {
      rpm: 15,
      tpm: 250_000,
      rpd: 500
    },
    source: 'ai-studio-active-limits'
  },
  'gemini-2.5-flash-lite-preview': {
    id: 'gemini-2.5-flash-lite-preview',
    displayName: 'Gemini 2.5 Flash Lite',
    bucket: 'text',
    capabilities: ['text', 'transcription'],
    quota: {
      rpm: 10,
      tpm: 250_000,
      rpd: 20
    },
    source: 'ai-studio-active-limits'
  },
  'gemini-2.5-flash-preview': {
    id: 'gemini-2.5-flash-preview',
    displayName: 'Gemini 2.5 Flash',
    bucket: 'text',
    capabilities: ['text', 'transcription'],
    quota: {
      rpm: 5,
      tpm: 250_000,
      rpd: 20
    },
    source: 'ai-studio-active-limits'
  },
  'gemma-4-31b-it': {
    id: 'gemma-4-31b-it',
    displayName: 'Gemma 4 31B',
    bucket: 'text',
    capabilities: ['text'],
    quota: {
      rpm: 15,
      tpm: null,
      rpd: 1_500
    },
    source: 'ai-studio-active-limits'
  },
  'gemini-3.1-flash-tts-preview': {
    id: 'gemini-3.1-flash-tts-preview',
    displayName: 'Gemini 3.1 Flash TTS',
    bucket: 'tts',
    capabilities: ['tts'],
    quota: {
      rpm: 3,
      tpm: 10_000,
      rpd: 10
    },
    source: 'ai-studio-active-limits'
  },
  'gemini-2.5-flash-preview-tts': {
    id: 'gemini-2.5-flash-preview-tts',
    displayName: 'Gemini 2.5 Flash TTS',
    bucket: 'tts',
    capabilities: ['tts'],
    quota: {
      rpm: 3,
      tpm: 10_000,
      rpd: 10
    },
    source: 'ai-studio-active-limits'
  }
};

export const MODEL_BUCKETS: Record<LLMModelBucket, string[]> = {
  text: [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite-preview',
    'gemini-2.5-flash-preview',
    'gemma-4-31b-it'
  ],
  tts: [
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-preview-tts'
  ]
};

export const DEFAULT_BUCKET_BY_SERVICE: Record<LLMRouteService, LLMModelBucket> = {
  text: 'text',
  evaluation: 'text',
  chat: 'text',
  transcription: 'text',
  'tts-single': 'tts',
  'tts-multi': 'tts'
};

export const DEFAULT_USAGE_BY_SERVICE: Record<LLMRouteService, LLMUsage> = {
  text: 'text',
  evaluation: 'text',
  chat: 'text',
  transcription: 'transcription',
  'tts-single': 'tts',
  'tts-multi': 'tts'
};

export const ORIGIN_PRIORITY: Record<LLMOrigin, number> = {
  ui: 0,
  system: 1,
  preload: 2,
  retry: 3
};

export const getModelDefinition = (modelId: string) => {
  const model = LLM_MODEL_CATALOG[modelId];
  if (!model) {
    throw new Error(`Unsupported LLM model: ${modelId}`);
  }
  return model;
};

export const getCandidateModels = (
  bucket: LLMModelBucket,
  usage: LLMUsage
) =>
  MODEL_BUCKETS[bucket]
    .map((modelId) => getModelDefinition(modelId))
    .filter((model) => model.capabilities.includes(usage));
