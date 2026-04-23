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
import {
  getSchedulerPolicy,
  resolveRoutePolicy,
  resolveSharedPoolPolicy
} from '../services/llm/config';
import type { LLMRouteKey } from '../services/llm/types';

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

const ttsSingleRoute = {
  platform: 'gemini',
  service: 'tts-single',
  model: 'gemini-2.5-flash-preview-tts'
};

const ttsMultiRoute = {
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
  {
    route = textRoute,
    scopeId = 'scope-a',
    supersedeKey,
    businessKey = `${route.service}:test`,
    isBackground = false
  }: {
    route?: LLMRouteKey;
    scopeId?: string;
    supersedeKey?: string;
    businessKey?: string;
    isBackground?: boolean;
  } = {}
) =>
  client.request({
    route,
    scopeId,
    supersedeKey,
    businessKey,
    isBackground,
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

    const p1 = createRequest(client, { route: textRoute, scopeId: 'scope-a', businessKey: 'text:a' });
    const p2 = createRequest(client, { route: textRoute, scopeId: 'scope-b', businessKey: 'text:b' });
    const p3 = createRequest(client, { route: textRoute, scopeId: 'scope-c', businessKey: 'text:c' });
    const p4 = createRequest(client, { route: textRoute, scopeId: 'scope-d', businessKey: 'text:d' });

    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    first.resolve({ id: 1 });
    await p1;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    second.resolve({ id: 2 });
    third.resolve({ id: 3 });
    fourth.resolve({ id: 4 });
    await Promise.all([p1, p2, p3, p4]);
  });

  it('supersedes only the matching pending request and preserves unrelated queued work', async () => {
    const activeA = deferred<any>();
    const activeB = deferred<any>();
    const replacement = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => activeA.promise)
      .mockImplementationOnce(() => activeB.promise)
      .mockImplementationOnce(() => replacement.promise);

    const client = createTestLLMClient(clock);

    const runningA = createRequest(client, { route: textRoute, scopeId: 'scope-1', businessKey: 'text:1' });
    const runningB = createRequest(client, { route: textRoute, scopeId: 'scope-2', businessKey: 'text:2' });
    await flush();

    const oldPending = createRequest(client, {
      route: textRoute,
      scopeId: 'scope-4',
      supersedeKey: 'same-logical-request',
      businessKey: 'text:old'
    });
    const newPending = createRequest(client, {
      route: textRoute,
      scopeId: 'scope-4',
      supersedeKey: 'same-logical-request',
      businessKey: 'text:new'
    });

    await expect(oldPending).rejects.toBeInstanceOf(SupersededError);
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    activeA.resolve({ ok: true });
    await runningA;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    activeB.resolve({ ok: true });
    replacement.resolve({ ok: true });
    await Promise.all([runningB, newPending]);
  });

  it('cancels only pending work for the requested scope', async () => {
    const activeA = deferred<any>();
    const activeB = deferred<any>();
    const survivingPending = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => activeA.promise)
      .mockImplementationOnce(() => activeB.promise)
      .mockImplementationOnce(() => survivingPending.promise);

    const client = createTestLLMClient(clock);

    const runningA = createRequest(client, { route: textRoute, scopeId: 'scope-1', businessKey: 'text:1' });
    const runningB = createRequest(client, { route: textRoute, scopeId: 'scope-2', businessKey: 'text:2' });
    await flush();

    const cancelled = createRequest(client, { route: textRoute, scopeId: 'scene-a', businessKey: 'text:cancel' });
    const survives = createRequest(client, { route: textRoute, scopeId: 'scene-b', businessKey: 'text:survive' });
    await flush();

    client.cancelPendingByScope('scene-a');
    await expect(cancelled).rejects.toBeInstanceOf(ScopeCancelledError);

    activeA.resolve({ ok: true });
    await runningA;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    activeB.resolve({ ok: true });
    survivingPending.resolve({ ok: true });
    await Promise.all([runningB, survives]);
  });

  it('waits for the next started-in-window budget before dispatching another transcription request', async () => {
    generateContentMock.mockResolvedValue({ ok: true });
    const client = createTestLLMClient(clock);
    const transcriptionPolicy = resolveRoutePolicy(transcriptionRoute);

    for (let index = 1; index <= 6; index += 1) {
      await createRequest(client, {
        route: transcriptionRoute,
        scopeId: `transcribe-${index}`,
        businessKey: `transcribe:${index}`
      });
    }

    const seventh = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'transcribe-7',
      businessKey: 'transcribe:7'
    });
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(6);

    const oneMinuteRule = transcriptionPolicy.rules.find(
      (rule) => rule.id === 'transcribe.started.1m'
    );
    expect(oneMinuteRule?.mode).toBe('started_in_window');

    await vi.advanceTimersByTimeAsync((oneMinuteRule as { windowMs: number }).windowMs - 1);
    expect(generateContentMock).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(1);
    expect(generateContentMock).toHaveBeenCalledTimes(7);
    await seventh;
  });

  it('keeps the worker slot occupied during busy retries so queued work cannot cut in', async () => {
    const retrySuccess = deferred<any>();
    generateContentMock
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockImplementationOnce(() => retrySuccess.promise)
      .mockResolvedValueOnce({ ok: 'queued-after-retry' });

    const client = createTestLLMClient(clock);
    const transcriptionPolicy = resolveRoutePolicy(transcriptionRoute);

    const first = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'transcribe-a',
      businessKey: 'transcribe:a'
    });
    const second = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'transcribe-b',
      businessKey: 'transcribe:b'
    });
    await flush();

    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(transcriptionPolicy.minBusyRetryDelayMs - 1);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    retrySuccess.resolve({ ok: 'retried' });
    await first;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    await second;
  });

  it('shares the TTS pool active budget across single and multi speaker routes', async () => {
    const singleVoice = deferred<any>();
    const multiVoice = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => singleVoice.promise)
      .mockImplementationOnce(() => multiVoice.promise);

    const client = createTestLLMClient(clock);

    const single = createRequest(client, {
      route: ttsSingleRoute,
      scopeId: 'tts-single-a',
      businessKey: 'tts:single:a'
    });
    const multi = createRequest(client, {
      route: ttsMultiRoute,
      scopeId: 'tts-multi-a',
      businessKey: 'tts:multi:a'
    });

    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    singleVoice.resolve({ ok: 'single-complete' });
    await single;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    multiVoice.resolve({ ok: 'multi-complete' });
    await multi;
  });

  it('shares the TTS pool started budget across single and multi speaker routes', async () => {
    generateContentMock.mockResolvedValue({ ok: true });
    const client = createTestLLMClient(clock);
    const sharedPoolPolicy = resolveSharedPoolPolicy(ttsSingleRoute);

    for (let index = 1; index <= 15; index += 1) {
      await createRequest(client, {
        route: index % 2 === 0 ? ttsMultiRoute : ttsSingleRoute,
        scopeId: `tts-shared-${index}`,
        businessKey: `tts:shared:${index}`
      });
    }

    const blocked = createRequest(client, {
      route: ttsMultiRoute,
      scopeId: 'tts-shared-16',
      businessKey: 'tts:shared:16'
    });
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(15);

    const oneMinuteRule = sharedPoolPolicy?.rules.find(
      (rule) => rule.id === 'tts.shared.started.1m'
    );
    expect(oneMinuteRule?.mode).toBe('started_in_window');

    await vi.advanceTimersByTimeAsync((oneMinuteRule as { windowMs: number }).windowMs - 1);
    expect(generateContentMock).toHaveBeenCalledTimes(15);

    await vi.advanceTimersByTimeAsync(1);
    expect(generateContentMock).toHaveBeenCalledTimes(16);
    await blocked;
  });

  it('coalesces an identical pending request instead of queueing a second root request', async () => {
    const activeA = deferred<any>();
    const activeB = deferred<any>();
    const sharedPending = deferred<any>();
    generateContentMock
      .mockImplementationOnce(() => activeA.promise)
      .mockImplementationOnce(() => activeB.promise)
      .mockImplementationOnce(() => sharedPending.promise);

    const client = createTestLLMClient(clock);

    const runningA = createRequest(client, { route: textRoute, scopeId: 'scope-1', businessKey: 'text:1' });
    const runningB = createRequest(client, { route: textRoute, scopeId: 'scope-2', businessKey: 'text:2' });
    await flush();

    const pendingRoot = createRequest(client, {
      route: textRoute,
      scopeId: 'scope-4',
      supersedeKey: 'same-family',
      businessKey: 'text:shared'
    });
    const pendingFollower = createRequest(client, {
      route: textRoute,
      scopeId: 'scope-5',
      supersedeKey: 'another-family',
      businessKey: 'text:shared'
    });

    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    activeA.resolve({ ok: 'slot-freed' });
    await runningA;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    sharedPending.resolve({ ok: 'shared-result' });
    await expect(pendingRoot).resolves.toEqual({ ok: 'shared-result' });
    await expect(pendingFollower).resolves.toEqual({ ok: 'shared-result' });

    activeB.resolve({ ok: true });
    await Promise.all([runningB]);
  });

  it('coalesces an identical in-flight request and preserves callback order', async () => {
    const sharedInFlight = deferred<any>();
    generateContentMock.mockImplementationOnce(() => sharedInFlight.promise);

    const client = createTestLLMClient(clock);

    const order: string[] = [];
    const first = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'scope-a',
      supersedeKey: 'family-a',
      businessKey: 'shared:audio'
    }).finally(() => {
      order.push('first');
    });
    await flush();

    const second = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'scope-b',
      supersedeKey: 'family-b',
      businessKey: 'shared:audio'
    }).finally(() => {
      order.push('second');
    });
    await flush();

    expect(generateContentMock).toHaveBeenCalledTimes(1);

    sharedInFlight.resolve({ ok: 'same-response' });
    await expect(first).resolves.toEqual({ ok: 'same-response' });
    await expect(second).resolves.toEqual({ ok: 'same-response' });
    expect(order).toEqual(['first', 'second']);
  });

  it('detaches only the cancelled scope from an in-flight shared request', async () => {
    const sharedInFlight = deferred<any>();
    generateContentMock.mockImplementationOnce(() => sharedInFlight.promise);

    const client = createTestLLMClient(clock);

    const first = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'scope-a',
      supersedeKey: 'family-a',
      businessKey: 'shared:audio'
    });
    await flush();

    const second = createRequest(client, {
      route: transcriptionRoute,
      scopeId: 'scope-b',
      supersedeKey: 'family-b',
      businessKey: 'shared:audio'
    });
    await flush();

    client.cancelPendingByScope('scope-b');
    await expect(second).rejects.toBeInstanceOf(ScopeCancelledError);

    sharedInFlight.resolve({ ok: 'still-runs' });
    await expect(first).resolves.toEqual({ ok: 'still-runs' });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('holds background work during the configured busy cooldown after repeated 429s', async () => {
    generateContentMock
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValueOnce({ ok: 'after-cooldown' });

    const client = createTestLLMClient(clock);
    const textPolicy = resolveRoutePolicy(textRoute);
    const { backgroundBusyCooldownMs } = getSchedulerPolicy();

    const first = createRequest(client, {
      route: textRoute,
      scopeId: 'background-a',
      businessKey: 'background:a',
      isBackground: true
    });
    const firstRejection = expect(first).rejects.toMatchObject({ status: 429 });
    const second = createRequest(client, {
      route: textRoute,
      scopeId: 'background-b',
      businessKey: 'background:b',
      isBackground: true
    });

    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(textPolicy.minBusyRetryDelayMs);
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(textPolicy.minBusyRetryDelayMs);
    await firstRejection;
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(backgroundBusyCooldownMs - 1);
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1);
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    client.cancelPendingByScope('missing-scope');
    await flush();
    expect(generateContentMock).toHaveBeenCalledTimes(4);
    await expect(second).resolves.toEqual({ ok: 'after-cooldown' });
  });
});
