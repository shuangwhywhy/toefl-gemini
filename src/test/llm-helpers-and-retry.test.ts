import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
const cancelPendingMock = vi.fn();

vi.mock('../services/llm/client', () => {
  return {
    getLLMClient: () => ({
      request: requestMock,
      cancelPendingByScope: cancelPendingMock
    })
  };
});

import {
  JSONExtractionError,
  LLMFormatError,
  ScopeCancelledError,
  classifyLLMFailure
} from '../services/llm/errors';
import {
  BoundedRetryError,
  runBoundedGeneration
} from '../services/llm/retry';
import {
  fetchGeminiText,
  shouldAttemptJsonFixer
} from '../services/llm/helpers';

const responseWithText = (text: string) => ({
  candidates: [
    {
      content: {
        parts: [{ text }]
      }
    }
  ]
});

describe('LLM helper recovery and bounded retry', () => {
  beforeEach(() => {
    vi.useRealTimers();
    requestMock.mockReset();
    cancelPendingMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies terminal, transient, format, and cancelled failures correctly', () => {
    expect(classifyLLMFailure({ status: 503, message: 'service unavailable' })).toMatchObject({
      kind: 'transient',
      retryable: true
    });

    expect(classifyLLMFailure({ status: 429, message: 'quota exceeded' })).toMatchObject({
      kind: 'rate_limited',
      retryable: true
    });

    expect(classifyLLMFailure(new LLMFormatError('validator failed'))).toMatchObject({
      kind: 'format_failure',
      retryable: false
    });

    expect(classifyLLMFailure(new ScopeCancelledError())).toMatchObject({
      kind: 'cancelled',
      retryable: false
    });

    expect(classifyLLMFailure({ status: 404, message: 'not found' })).toMatchObject({
      kind: 'terminal',
      retryable: false
    });
  });

  it('retries transient generation failures until success', async () => {
    vi.useFakeTimers();
    const action = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: 'service unavailable' })
      .mockResolvedValueOnce('ok');

    const resultPromise = runBoundedGeneration({
      action,
      maxRetries: 2,
      delayMs: 1000
    });

    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(action).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ value: 'ok', retries: 1, attempts: 2 });
  });

  it('does not retry terminal generation failures', async () => {
    const action = vi.fn().mockRejectedValue({ status: 404, message: 'not found' });

    await expect(
      runBoundedGeneration({
        action,
        maxRetries: 2,
        delayMs: 1000
      })
    ).rejects.toBeInstanceOf(BoundedRetryError);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('skips the fixer when local extraction already succeeds', async () => {
    requestMock.mockResolvedValueOnce(
      responseWithText('```json\n{"topic":"A","text":"B"}\n```')
    );

    const result = await fetchGeminiText(
      'prompt',
      0.9,
      200,
      null,
      null,
      null,
      { scopeId: 'scope-local-success' }
    );

    expect(result).toEqual({ topic: 'A', text: 'B' });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('only invokes the fixer for json-like malformed content', async () => {
    requestMock
      .mockResolvedValueOnce(responseWithText('topic: "A"\ntext: "B"'))
      .mockResolvedValueOnce(responseWithText('{"topic":"A","text":"B"}'));

    const result = await fetchGeminiText(
      'prompt',
      0.9,
      200,
      null,
      null,
      null,
      { scopeId: 'scope-fixer' }
    );

    expect(result).toEqual({ topic: 'A', text: 'B' });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does not invoke the fixer for obvious failure text', async () => {
    requestMock.mockResolvedValueOnce(responseWithText('Error: quota exceeded'));

    await expect(
      fetchGeminiText(
        'prompt',
        0.9,
        200,
        null,
        null,
        null,
        { scopeId: 'scope-failure-text' }
      )
    ).rejects.toBeInstanceOf(JSONExtractionError);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(shouldAttemptJsonFixer('Error: quota exceeded')).toBe(false);
  });
});
