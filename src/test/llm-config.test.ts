import { describe, expect, it } from 'vitest';

import llmPolicyJson from '../services/llm/llm-policy.json';
import {
  compileLLMPolicyConfigDocument,
  getSchedulerPolicy,
  parseLLMPolicyConfigDocument,
  resolveRoutePolicy,
  resolveSharedPoolPolicy
} from '../services/llm/config';

const textRoute = {
  platform: 'gemini',
  service: 'text',
  model: 'gemini-2.5-flash'
} as const;

const transcriptionRoute = {
  platform: 'gemini',
  service: 'transcription',
  model: 'gemini-2.5-flash'
} as const;

const singleVoiceRoute = {
  platform: 'gemini',
  service: 'tts-single',
  model: 'gemini-2.5-flash-preview-tts'
} as const;

describe('LLM policy config', () => {
  it('parses and compiles the semantic config while preserving compatibility ids', () => {
    const parsed = parseLLMPolicyConfigDocument(llmPolicyJson);
    const compiled = compileLLMPolicyConfigDocument(parsed);

    expect(compiled.scheduler.backgroundBusyCooldownMs).toBe(30000);
    expect(compiled.routes.text.defaultPolicy.maxConcurrency).toBe(2);
    expect(getSchedulerPolicy().backgroundBusyCooldownMs).toBe(30000);

    expect(resolveRoutePolicy(textRoute).rules.map((rule) => rule.id)).toEqual([
      'platform.started.1m',
      'platform.started.1d'
    ]);
    expect(resolveRoutePolicy(transcriptionRoute).rules.map((rule) => rule.id)).toEqual([
      'transcribe.started.1m',
      'transcribe.started.5m',
      'transcribe.started.1d',
      'transcribe.active'
    ]);

    expect(resolveSharedPoolPolicy(singleVoiceRoute)).toMatchObject({
      key: 'speechSynthesis',
      stateKey: 'gemini:tts-shared:gemini-2.5-flash-preview-tts'
    });
    expect(
      resolveSharedPoolPolicy(singleVoiceRoute)?.rules.map((rule) => rule.id)
    ).toEqual([
      'tts.shared.started.1m',
      'tts.shared.started.1d',
      'tts.shared.active'
    ]);
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
              ...llmPolicyJson.capabilities.speech.singleVoice.models,
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

    expect(() =>
      parseLLMPolicyConfigDocument({
        ...llmPolicyJson,
        sharedPools: {
          ...llmPolicyJson.sharedPools,
          speechSynthesis: {
            ...llmPolicyJson.sharedPools.speechSynthesis,
            limits: {
              started: {
                '90q': 15
              }
            }
          }
        }
      })
    ).toThrow(/sharedPools\.speechSynthesis\.limits\.started\.90q/);
  });
});
