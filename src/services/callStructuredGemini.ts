import { z } from 'zod';
import { fetchGeminiText } from './llm/helpers';

export async function callStructuredGemini<T>(options: {
  promptOrParts: string | Array<Record<string, unknown>>;
  responseSchema: Record<string, unknown> | null;
  zodSchema: z.ZodSchema<T>;
  scopeId: string;
  supersedeKey: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal | null;
  requestOptions?: Record<string, unknown>;
}): Promise<T> {
  const payload = await fetchGeminiText(
    options.promptOrParts,
    options.temperature ?? 0.4,
    options.maxOutputTokens ?? 2000,
    options.responseSchema,
    options.signal ?? null,
    null,
    {
      scopeId: options.scopeId,
      supersedeKey: options.supersedeKey,
      origin: 'ui',
      sceneKey: options.supersedeKey,
      ...(options.requestOptions ?? {})
    }
  );

  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  return options.zodSchema.parse(parsed);
}
