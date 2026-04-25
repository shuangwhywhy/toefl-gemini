import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import llmPolicyJson from '../services/llm/llm-policy.json';
import {
  compileLLMPolicyConfigDocument,
  getSchedulerPolicy,
  parseLLMPolicyConfigDocument,
  resolveRoutePolicy,
  resolveSharedPoolPolicy
} from '../services/llm/config';
import {
  getCandidateModels,
  LLM_MODEL_CATALOG,
  MODEL_BUCKETS
} from '../services/llm/modelCatalog';

const textRoute = {
  platform: 'gemini',
  service: 'text',
  modelBucket: 'text'
} as const;

const singleVoiceRoute = {
  platform: 'gemini',
  service: 'tts-single',
  model: 'gemini-3.1-flash-tts-preview'
} as const;

describe('LLM policy config and model catalog', () => {
  it('keeps execution policy separate from model quota', () => {
    const parsed = parseLLMPolicyConfigDocument(llmPolicyJson);
    const compiled = compileLLMPolicyConfigDocument(parsed);

    expect(compiled.scheduler.backgroundBusyCooldownMs).toBe(30000);
    expect(getSchedulerPolicy().backgroundBusyCooldownMs).toBe(30000);
    expect(resolveRoutePolicy(textRoute).maxConcurrency).toBe(2);
    expect(resolveRoutePolicy(textRoute).rules).toEqual([]);

    expect(resolveSharedPoolPolicy(singleVoiceRoute)).toMatchObject({
      key: 'speechSynthesis',
      stateKey: 'gemini:tts-shared:gemini-3.1-flash-tts-preview'
    });
    expect(
      resolveSharedPoolPolicy(singleVoiceRoute)?.rules.map((rule) => rule.id)
    ).toEqual(['tts.shared.active']);
  });

  it('defines ordered text and TTS buckets with screenshot quotas', () => {
    expect(MODEL_BUCKETS.text).toEqual([
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-flash-lite-preview',
      'gemini-2.5-flash-preview',
      'gemma-4-31b-it'
    ]);
    expect(MODEL_BUCKETS.tts).toEqual([
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-flash-preview-tts'
    ]);

    expect(LLM_MODEL_CATALOG['gemini-3.1-flash-lite-preview'].quota).toEqual({
      rpm: 15,
      tpm: 250000,
      rpd: 500
    });
    expect(LLM_MODEL_CATALOG['gemini-2.5-flash-lite-preview'].quota).toEqual({
      rpm: 10,
      tpm: 250000,
      rpd: 20
    });
    expect(LLM_MODEL_CATALOG['gemini-2.5-flash-preview'].quota).toEqual({
      rpm: 5,
      tpm: 250000,
      rpd: 20
    });
    expect(LLM_MODEL_CATALOG['gemini-3.1-flash-tts-preview'].quota).toEqual({
      rpm: 3,
      tpm: 10000,
      rpd: 10
    });
    expect(LLM_MODEL_CATALOG['gemma-4-31b-it'].quota).toEqual({
      rpm: 15,
      tpm: null,
      rpd: 1500
    });
  });

  it('keeps Gemma 4 31B as the official non-preview API id', () => {
    expect(LLM_MODEL_CATALOG['gemma-4-31b-it']).toBeTruthy();
    expect(LLM_MODEL_CATALOG['gemma-4-31b-preview']).toBeUndefined();
    expect(getCandidateModels('text', 'text').map((model) => model.id)).toContain(
      'gemma-4-31b-it'
    );
    expect(getCandidateModels('text', 'transcription').map((model) => model.id)).not.toContain(
      'gemma-4-31b-it'
    );
  });

  it('does not expose model selection through env variables', () => {
    const envExample = readFileSync(
      resolve(process.cwd(), '.env.example'),
      'utf8'
    );

    expect(envExample).toContain('VITE_GEMINI_API_KEY');
    expect(envExample).not.toContain('VITE_GEMINI_TEXT_MODEL');
    expect(envExample).not.toContain('VITE_GEMINI_TTS_MODEL');
    expect(envExample).not.toContain('VITE_GEMINI_TRANSCRIBE_MODEL');
  });

  it('applies profile ordering and model-specific overrides when compiling', () => {
    const parsed = parseLLMPolicyConfigDocument({
      ...llmPolicyJson,
      capabilities: {
        ...llmPolicyJson.capabilities,
        speech: {
          ...llmPolicyJson.capabilities.speech,
          singleVoice: {
            ...llmPolicyJson.capabilities.speech.singleVoice,
            models: {
              'gemini-custom-tts': {
                concurrency: 3,
                busyRetry: {
                  minDelay: '12s'
                },
                limits: {
                  active: 3
                }
              }
            }
          }
        }
      }
    });

    const compiled = compileLLMPolicyConfigDocument(parsed);

    expect(compiled.routes.evaluation.defaultPolicy.maxConcurrency).toBe(1);
    expect(compiled.routes.chat.defaultPolicy.maxConcurrency).toBe(1);
    expect(compiled.routes['tts-single'].modelPolicies['gemini-custom-tts']).toMatchObject({
      maxConcurrency: 3,
      maxRetries: 2,
      minBusyRetryDelayMs: 12000,
      sharedPoolKey: 'speechSynthesis'
    });
    expect(
      compiled.routes['tts-single'].modelPolicies['gemini-custom-tts'].rules
    ).toMatchObject([{ id: 'tts.singleVoice.active', max: 3 }]);
  });

  it('throws when a capability references a missing profile or shared pool', () => {
    const missingProfile = parseLLMPolicyConfigDocument({
      ...llmPolicyJson,
      capabilities: {
        ...llmPolicyJson.capabilities,
        textGeneration: {
          ...llmPolicyJson.capabilities.textGeneration,
          chat: {
            ...llmPolicyJson.capabilities.textGeneration.chat,
            use: ['standardText', 'missingProfile']
          }
        }
      }
    });

    expect(() => compileLLMPolicyConfigDocument(missingProfile)).toThrow(
      /missing profile "missingProfile"/
    );

    const missingPool = parseLLMPolicyConfigDocument({
      ...llmPolicyJson,
      capabilities: {
        ...llmPolicyJson.capabilities,
        speech: {
          ...llmPolicyJson.capabilities.speech,
          singleVoice: {
            ...llmPolicyJson.capabilities.speech.singleVoice,
            pool: 'missingPool'
          }
        }
      }
    });

    expect(() => compileLLMPolicyConfigDocument(missingPool)).toThrow(
      /missing shared pool "missingPool"/
    );
  });

  it('throws for invalid duration tokens in semantic config fields', () => {
    expect(() =>
      parseLLMPolicyConfigDocument({
        ...llmPolicyJson,
        defaults: {
          ...llmPolicyJson.defaults,
          backgroundQueue: {
            cooldownAfterBusy: '30x'
          }
        }
      })
    ).toThrow(/backgroundQueue\.cooldownAfterBusy/);
  });
});
