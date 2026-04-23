import { globalAudioCache } from '../audio/cache';
import { pcmToWavUrl } from '../audio/pcm';
import {
  GEMINI_PLATFORM,
  TEXT_MODEL,
  TRANSCRIBE_MODEL,
  TTS_MODEL
} from './config';
import {
  JSONExtractionError,
  LLMFormatError
} from './errors';
import {
  createBusinessKey,
  hashBlobForBusinessKey
} from './businessKey';
import { getLLMClient } from './client';

const createAbortError = () => {
  const error = new Error('Request aborted before dispatch.');
  error.name = 'AbortError';
  return error;
};

const bindPendingAbort = (
  promise: Promise<unknown>,
  scopeId: string,
  signal: AbortSignal | null
) => {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    getLLMClient().cancelPendingByScope(scopeId);
    throw createAbortError();
  }

  const abortHandler = () => {
    getLLMClient().cancelPendingByScope(scopeId);
  };
  signal.addEventListener('abort', abortHandler, { once: true });
  return promise.finally(() => signal.removeEventListener('abort', abortHandler));
};

const parseGenerateContentText = (response: any) =>
  response?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

const extractInlineData = (response: any) =>
  response?.candidates?.[0]?.content?.parts?.[0]?.inlineData ?? null;

const FAILURE_RESPONSE_PATTERN =
  /\b(error|failed|failure|quota|rate limit|too many|unavailable|permission|unauthorized|forbidden|not found|policy|safety|blocked|refused|denied|invalid api|resource exhausted)\b/i;
const JSONISH_TEXT_PATTERN =
  /```|[{[]|"\s*[\w-]+"\s*:|^\s*[\w-]+\s*:/m;

export const shouldAttemptJsonFixer = (rawText: string) => {
  const text = rawText.trim();
  if (!text) {
    return false;
  }

  if (FAILURE_RESPONSE_PATTERN.test(text)) {
    return false;
  }

  return JSONISH_TEXT_PATTERN.test(text);
};

export const extractJSON = (rawText: string) => {
  if (!rawText) throw new JSONExtractionError('Empty API response');
  let text = rawText.trim();

  try {
    return JSON.parse(text);
  } catch {
    // Continue to recovery strategies below.
  }

  const backticks = String.fromCharCode(96, 96, 96);
  const blockRegex = new RegExp(
    `${backticks}(?:json|javascript|js|html|md)?\\s*([\\s\\S]*?)\\s*${backticks}`,
    'ig'
  );
  text = text.replace(blockRegex, '$1').trim();

  try {
    return JSON.parse(text);
  } catch {
    // Continue to recovery strategies below.
  }

  const startObj = text.indexOf('{');
  const endObj = text.lastIndexOf('}');
  const startArr = text.indexOf('[');
  const endArr = text.lastIndexOf(']');

  let objStr =
    startObj !== -1 && endObj > startObj
      ? text.substring(startObj, endObj + 1)
      : null;
  let arrStr =
    startArr !== -1 && endArr > startArr
      ? text.substring(startArr, endArr + 1)
      : null;

  if (objStr && arrStr) {
    if (startObj < startArr && endObj > endArr) arrStr = null;
    else if (startArr < startObj && endArr > endObj) objStr = null;
  }

  if (objStr) {
    try {
      return JSON.parse(objStr);
    } catch {
      try {
        return JSON.parse(objStr.replace(/\n/g, '\\n').replace(/\r/g, ''));
      } catch {
        // Continue to array attempt.
      }
    }
  }

  if (arrStr) {
    try {
      return JSON.parse(arrStr);
    } catch {
      try {
        return JSON.parse(arrStr.replace(/\n/g, '\\n').replace(/\r/g, ''));
      } catch {
        // Fall through to final failure.
      }
    }
  }

  throw new JSONExtractionError('JSON extraction algorithm failed');
};

export const processDictationText = (rawText: string) => {
  const tokensRaw = rawText.match(/[a-zA-Z0-9'-]+|[^a-zA-Z0-9'\s-]/g) || [];
  let isStartOfSentence = true;

  return tokensRaw.map((token) => {
    const isPunctuation = /^[^a-zA-Z0-9]+$/.test(token);
    const isNumber = /^\d+$/.test(token);
    const isCapitalized = /^[A-Z]/.test(token);

    let type: 'gap' | 'shown' = 'gap';

    if (isPunctuation) {
      type = 'shown';
      if (/^[.!?]+$/.test(token)) {
        isStartOfSentence = true;
      }
    } else if (isNumber) {
      type = 'shown';
      isStartOfSentence = false;
    } else {
      if (isCapitalized && !isStartOfSentence && token !== 'I') {
        type = 'shown';
      }
      isStartOfSentence = false;
    }

    return { word: token, type };
  });
};

interface SharedRequestOptions {
  scopeId: string;
  supersedeKey?: string;
  service?: string;
  model?: string;
  businessContext?: unknown;
}

const ensureScope = (options?: SharedRequestOptions) => {
  if (!options?.scopeId) {
    throw new Error('LLM helper requests require a scopeId.');
  }
  return options;
};

export const fetchGeminiText = async (
  promptOrParts: string | Array<Record<string, unknown>>,
  temperature = 0.9,
  maxOutputTokens = 1500,
  schema: Record<string, unknown> | null = null,
  signal: AbortSignal | null = null,
  validator: ((payload: any) => void) | null = null,
  requestOptions?: SharedRequestOptions
) => {
  const { scopeId, supersedeKey } = ensureScope(requestOptions);
  const model = requestOptions?.model ?? TEXT_MODEL;
  const primaryService = requestOptions?.service ?? 'text';

  if (signal?.aborted) {
    throw createAbortError();
  }

  const parts = Array.isArray(promptOrParts)
    ? promptOrParts
    : [{ text: promptOrParts }];
  const validatorSignature = validator
    ? String(validator).replace(/\s+/g, ' ').trim()
    : null;

  const systemInstruction = {
    parts: [
      {
        text:
          'You are a rigid backend API endpoint. You MUST output ONLY valid, raw JSON data. ' +
          "CRITICAL: NEVER include conversational filler inside JSON values."
      }
    ]
  };

  const runAttempt = async (fixMode = false) => {
    const businessKey = createBusinessKey(
      `generate-content:${fixMode ? 'evaluation' : primaryService}:${model}`,
      requestOptions?.businessContext ?? {
        contents: parts,
        temperature: fixMode ? 0 : temperature,
        maxOutputTokens,
        schema,
        validator: validatorSignature
      }
    );
    const promise = getLLMClient().request({
      route: {
        platform: GEMINI_PLATFORM,
        service: fixMode ? 'evaluation' : primaryService,
        model
      },
      scopeId,
      supersedeKey,
      businessKey,
      payload: {
        kind: 'generate-content',
        params: {
          model,
          contents: [{ parts }],
          config: {
            temperature: fixMode ? 0 : temperature,
            maxOutputTokens,
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {}),
            ...(fixMode ? {} : { systemInstruction })
          }
        }
      },
      parser: async (response) => response
    });

    return await bindPendingAbort(promise, scopeId, signal);
  };

  const response = await runAttempt(false);
  const rawText = parseGenerateContentText(response);

  let parsedData: any;
  try {
    parsedData = extractJSON(rawText);
  } catch (parseError) {
    if (!shouldAttemptJsonFixer(rawText)) {
      throw parseError;
    }
    console.warn('High-temp JSON parsing failed, triggering zero-temp fixer...');
    const fixerPrompt =
      'Convert the following raw text into STRICT valid JSON. ' +
      'Do not change the core meaning, just fix formatting issues.\n\n' +
      `RAW TEXT:\n${rawText}`;
    const fixerPromise = getLLMClient().request({
      route: {
        platform: GEMINI_PLATFORM,
        service: 'evaluation',
        model
      },
      scopeId,
      supersedeKey,
      businessKey: createBusinessKey(`json-fixer:evaluation:${model}`, {
        rawText,
        schema,
        maxOutputTokens
      }),
      payload: {
        kind: 'generate-content',
        params: {
          model,
          contents: [{ parts: [{ text: fixerPrompt }] }],
          config: {
            temperature: 0,
            maxOutputTokens,
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {})
          }
        }
      },
      parser: async (result) => result
    });
    const fixerResponse = await bindPendingAbort(fixerPromise, scopeId, signal);

    const fixedText = parseGenerateContentText(fixerResponse);
    parsedData = extractJSON(fixedText);
  }

  if (validator) {
    try {
      validator(parsedData);
    } catch (error) {
      throw new LLMFormatError(
        String(
          (error as { message?: string })?.message ??
            'Structured response validation failed.'
        ),
        'validation_failed'
      );
    }
  }

  return parsedData;
};

export const fetchNeuralTTS = async (
  voiceName: string,
  textToSpeak: string,
  signal: AbortSignal | null = null,
  requestOptions?: SharedRequestOptions
) => {
  const { scopeId, supersedeKey } = ensureScope(requestOptions);
  const cacheKey = `tts_${voiceName}_${textToSpeak}`;
  if (globalAudioCache.has(cacheKey)) {
    return globalAudioCache.get(cacheKey) ?? null;
  }

  const promise = getLLMClient().request({
    route: {
      platform: GEMINI_PLATFORM,
      service: 'tts-single',
      model: TTS_MODEL
    },
    scopeId,
    supersedeKey,
    businessKey: createBusinessKey(`tts-single:${TTS_MODEL}`, {
      voiceName,
      textToSpeak,
      responseModalities: ['AUDIO']
    }),
    payload: {
      kind: 'generate-content',
      params: {
        model: TTS_MODEL,
        contents: [{ parts: [{ text: textToSpeak }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      }
    },
    parser: async (response) => {
      const inlineData = extractInlineData(response);
      if (!inlineData) {
        return null;
      }
      const mimeMatch = String(inlineData.mimeType ?? '').match(/rate=(\d+)/);
      const url = pcmToWavUrl(
        inlineData.data,
        mimeMatch ? Number.parseInt(mimeMatch[1], 10) : 24_000
      );
      globalAudioCache.set(cacheKey, url);
      return url;
    }
  });

  return await bindPendingAbort(promise, scopeId, signal);
};

export const fetchConversationTTS = async (
  transcript: string,
  signal: AbortSignal | null = null,
  requestOptions?: SharedRequestOptions
) => {
  const { scopeId, supersedeKey } = ensureScope(requestOptions);
  const cacheKey = `tts_conversation_${transcript.substring(0, 50)}`;
  if (globalAudioCache.has(cacheKey)) {
    return globalAudioCache.get(cacheKey) ?? null;
  }

  const promise = getLLMClient().request({
    route: {
      platform: GEMINI_PLATFORM,
      service: 'tts-multi',
      model: TTS_MODEL
    },
    scopeId,
    supersedeKey,
    businessKey: createBusinessKey(`tts-multi:${TTS_MODEL}`, {
      transcript,
      responseModalities: ['AUDIO'],
      speakers: [
        { speaker: 'Student', voiceName: 'Puck' },
        { speaker: 'Professor', voiceName: 'Aoede' }
      ]
    }),
    payload: {
      kind: 'generate-content',
      params: {
        model: TTS_MODEL,
        contents: [{ parts: [{ text: transcript }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: 'Student',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Puck' }
                  }
                },
                {
                  speaker: 'Professor',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Aoede' }
                  }
                }
              ]
            }
          }
        }
      }
    },
    parser: async (response) => {
      const inlineData = extractInlineData(response);
      if (!inlineData) {
        throw new Error('Empty audio data returned');
      }
      const mimeMatch = String(inlineData.mimeType ?? '').match(/rate=(\d+)/);
      const url = pcmToWavUrl(
        inlineData.data,
        mimeMatch ? Number.parseInt(mimeMatch[1], 10) : 24_000
      );
      globalAudioCache.set(cacheKey, url);
      return url;
    }
  });

  return await bindPendingAbort(promise, scopeId, signal);
};

export const requestChatCompletion = async ({
  contents,
  systemInstruction,
  temperature = 0.7,
  maxOutputTokens = 1500,
  scopeId,
  supersedeKey
}: {
  contents: unknown;
  systemInstruction?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  scopeId: string;
  supersedeKey?: string;
}) => {
  return await getLLMClient().request<string>({
    route: {
      platform: GEMINI_PLATFORM,
      service: 'chat',
      model: TEXT_MODEL
    },
    scopeId,
    supersedeKey,
    businessKey: createBusinessKey(`chat:${TEXT_MODEL}`, {
      contents,
      systemInstruction,
      temperature,
      maxOutputTokens
    }),
    payload: {
      kind: 'generate-content',
      params: {
        model: TEXT_MODEL,
        contents,
        config: {
          temperature,
          maxOutputTokens,
          ...(systemInstruction ? { systemInstruction } : {})
        }
      }
    },
    parser: async (response) =>
      parseGenerateContentText(response) || '抱歉，我没太明白您的意思。'
  });
};

const blobToBase64 = async (blob: Blob) =>
  await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const [, data = ''] = String(reader.result ?? '').split(',');
      resolve(data);
    };
    reader.readAsDataURL(blob);
  });

export const requestTranscription = async ({
  audioBlob,
  prompt,
  scopeId,
  supersedeKey
}: {
  audioBlob: Blob;
  prompt?: string;
  scopeId: string;
  supersedeKey?: string;
}) => {
  const audioDigest = await hashBlobForBusinessKey(audioBlob);
  const data = await blobToBase64(audioBlob);
  const schema = {
    type: 'OBJECT',
    properties: {
      transcript: { type: 'STRING' }
    },
    required: ['transcript']
  };

  const result = await fetchGeminiText(
    [
      {
        text:
          prompt ??
          'Transcribe this audio faithfully into plain text. Return JSON: {"transcript":"..."}'
      },
      {
        inlineData: {
          mimeType: audioBlob.type || 'audio/webm',
          data
        }
      }
    ],
    0,
    1024,
    schema,
    null,
    (payload) => {
      if (!payload || typeof payload.transcript !== 'string') {
        throw new Error('Invalid transcription response.');
      }
    },
    {
      scopeId,
      supersedeKey,
      service: 'transcription',
      model: TRANSCRIBE_MODEL,
      businessContext: {
        prompt:
          prompt ??
          'Transcribe this audio faithfully into plain text. Return JSON: {"transcript":"..."}',
        audioDigest
      }
    }
  );

  return result.transcript.trim();
};
