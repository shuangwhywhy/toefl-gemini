import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: generateContentMock
      };
    }
  };
});

vi.mock('../services/storage/db', () => {
  return {
    DBUtils: {
      get: vi.fn(async () => ({ histories: {} })),
      set: vi.fn(async () => undefined)
    }
  };
});

import { ScopeCancelledError, SupersededError } from '../services/llm/errors';
import { createTestLLMClient } from '../services/llm/client';

const textRoute = {
  platform: 'gemini',
  service: 'text',
  model: 'gemini-2.5-flash'
};

const transcriptionRoute = {
  platform: 'gemini',
  service: 'transcription',
  model: 'gemini-2.5-flash'
};

const multiTtsRoute = {
  platform: 'gemini',
  service: 'tts-multi',
  model: 'gemini-2.5-flash-preview-tts'
};

const clock = {
  now: () => Date.now(),
  setTimeout: (handler: () => void, timeout: number) =>
    window.setTimeout(handler, timeout),
  clearTimeout: (timer: number) =>
    window.clearTimeout(timer)
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createRequest = (
  client: ReturnType<typeof createTestLLMClient>,
  route = textRoute,
  scopeId = 'scope-a',
  supersedeKey?: string
) =>
  client.request({
    route,
    scopeId,
    supersedeKey,
    payload: {
      kind: 'generate-content',
      params: {
        model: route.model,
        contents: 'test'
      }
    },
    parser: async (value) => value
  });

describe('LLMClient scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    generateContentMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fills route concurrency and starts the next queued request when a slot frees', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    const third = deferred<any>();
    const fourth = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise)
      .mockImplementationOnce(() => fourth.promise);

    const client = createTestLLMClient(clock);

    const p1 = createRequest(client);
    const p2 = createRequest(client, textRoute, 'scope-b');
    const p3 = createRequest(client, textRoute, 'scope-c');
    const p4 = createRequest(client, textRoute, 'scope-d');

    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    first.resolve({ id: 1 });
    await p1;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(4);

    second.resolve({ id: 2 });
    third.resolve({ id: 3 });
    fourth.resolve({ id: 4 });
    await Promise.all([p1, p2, p3, p4]);
  });

  it('supersedes only the matching pending request and preserves unrelated queued work', async () => {
    const activeA = deferred<any>();
    const activeB = deferred<any>();
    const activeC = deferred<any>();
    const replacement = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => activeA.promise)
      .mockImplementationOnce(() => activeB.promise)
      .mockImplementationOnce(() => activeC.promise)
      .mockImplementationOnce(() => replacement.promise);

    const client = createTestLLMClient(clock);

    const runningA = createRequest(client, textRoute, 'scope-1');
    const runningB = createRequest(client, textRoute, 'scope-2');
    const runningC = createRequest(client, textRoute, 'scope-3');
    await flush();

    const oldPending = createRequest(client, textRoute, 'scope-4', 'same-logical-request');
    const newPending = createRequest(client, textRoute, 'scope-4', 'same-logical-request');

    await expect(oldPending).rejects.toBeInstanceOf(SupersededError);
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    activeA.resolve({ ok: true });
    await runningA;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(4);

    activeB.resolve({ ok: true });
    activeC.resolve({ ok: true });
    replacement.resolve({ ok: true });
    await Promise.all([runningB, runningC, newPending]);
  });

  it('cancels only pending work for the requested scope', async () => {
    const activeA = deferred<any>();
    const activeB = deferred<any>();
    const activeC = deferred<any>();
    const survivingPending = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => activeA.promise)
      .mockImplementationOnce(() => activeB.promise)
      .mockImplementationOnce(() => activeC.promise)
      .mockImplementationOnce(() => survivingPending.promise);

    const client = createTestLLMClient(clock);

    const runningA = createRequest(client, textRoute, 'scope-1');
    const runningB = createRequest(client, textRoute, 'scope-2');
    const runningC = createRequest(client, textRoute, 'scope-3');
    await flush();

    const cancelled = createRequest(client, textRoute, 'scene-a');
    const survives = createRequest(client, textRoute, 'scene-b');
    await flush();

    client.cancelPendingByScope('scene-a');
    await expect(cancelled).rejects.toBeInstanceOf(ScopeCancelledError);

    activeA.resolve({ ok: true });
    await runningA;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(4);

    activeB.resolve({ ok: true });
    activeC.resolve({ ok: true });
    survivingPending.resolve({ ok: true });
    await flush();
  });

  it('waits for the next started-in-window budget before dispatching another request', async () => {
    generateContentMock.mockResolvedValue({ ok: true });
    const client = createTestLLMClient(clock);

    await createRequest(client, multiTtsRoute, 'tts-1');
    await createRequest(client, multiTtsRoute, 'tts-2');
    await createRequest(client, multiTtsRoute, 'tts-3');
    await createRequest(client, multiTtsRoute, 'tts-4');

    const fifth = createRequest(client, multiTtsRoute, 'tts-5');
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(generateContentMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(1);
    expect(generateContentMock).toHaveBeenCalledTimes(5);
    await fifth;
  });

  it('keeps the worker slot occupied during busy retries so queued work cannot cut in', async () => {
    const retrySuccess = deferred<any>();
    generateContentMock
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockImplementationOnce(() => retrySuccess.promise)
      .mockResolvedValueOnce({ ok: 'queued-after-retry' });

    const client = createTestLLMClient(clock);

    const first = createRequest(client, transcriptionRoute, 'transcribe-a');
    const second = createRequest(client, transcriptionRoute, 'transcribe-b');
    await flush();

    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    retrySuccess.resolve({ ok: 'retried' });
    await first;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    await second;
  });
});
