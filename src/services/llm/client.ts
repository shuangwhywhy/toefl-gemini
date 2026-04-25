import { GoogleGenAI } from '@google/genai';
import { DBUtils } from '../storage/db';
import { ScopeCancelledError, SupersededError } from './errors';
import {
  GEMINI_PLATFORM,
  getCandidateModels,
  ORIGIN_PRIORITY
} from './modelCatalog';
import { getSchedulerPolicy, resolveRoutePolicy } from './config';
import {
  buildQuotaContext,
  createEmptyQuotaHistories,
  QuotaHistories,
  QuotaManager,
  QuotaRequestContext,
  QuotaSelection
} from './quotaManager';
import type {
  LLMOrigin,
  LLMRequest,
  LLMPayload,
  LLMRouteService,
  PersistedRateState,
  RoutePolicy
} from './types';

interface QueueSubscriber<T> {
  id: string;
  scopeId: string;
  supersedeKey?: string;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

interface SharedRequestState<T> {
  coalesceKey: string;
  bucketKey: string;
  status: 'pending' | 'in-flight' | 'settled';
  entry: QueueEntry<T>;
  subscribers: QueueSubscriber<T>[];
}

interface NormalizedLLMRequest<T> extends LLMRequest<T> {
  route: {
    platform: string;
    service: LLMRouteService;
    modelBucket: 'text' | 'tts';
  };
}

interface QueueEntry<T> {
  id: string;
  seq: number;
  request: NormalizedLLMRequest<T>;
  bucketKey: string;
  policy: RoutePolicy;
  coalesceKey: string;
  quotaContext: QuotaRequestContext;
}

interface RouteBucketState {
  key: string;
  service: LLMRouteService;
  policy: RoutePolicy;
  pending: QueueEntry<unknown>[];
  inFlightCount: number;
}

interface SharedPoolState {
  key: string;
  maxActive: number;
  inFlightCount: number;
}

interface AvailabilityResult {
  allowed: boolean;
  nextWakeAt: number | null;
}

interface SchedulerClock {
  now(): number;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(timer: number): void;
}

const RATE_STATE_KEY = 'llm_rate_state_v2';
const TTS_SHARED_POOL_KEY = 'speechSynthesis';
const TTS_SHARED_POOL_ACTIVE = 1;
const schedulerPolicy = getSchedulerPolicy();
const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const defaultClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (handler, timeout) => window.setTimeout(handler, timeout),
  clearTimeout: (timer) => window.clearTimeout(timer)
};

const isBusyOrRateLimitedError = (error: unknown) => {
  const status =
    (error as { status?: number; code?: number })?.status ??
    (error as { code?: number })?.code;
  const message = String((error as { message?: string })?.message ?? '').toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    status === 504 ||
    /rate|quota|busy|overload|resource exhausted|unavailable|too many/i.test(message)
  );
};

const isModelNotFoundError = (error: unknown) => {
  const status =
    (error as { status?: number; code?: number })?.status ??
    (error as { code?: number })?.code;
  const message = String((error as { message?: string })?.message ?? '').toLowerCase();
  return (
    (status === 400 || status === 404) &&
    /model|unknown|not found|not supported|unsupported/i.test(message)
  );
};

const buildLogicalBucketKey = (entry: QuotaRequestContext) =>
  `${entry.platform}:${entry.service}:${entry.modelBucket}`;

const buildCoalesceKey = (bucketKey: string, businessKey: string) =>
  `${bucketKey}:${businessKey}`;

const generateId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const inferOrigin = (request: LLMRequest<unknown>): LLMOrigin => {
  if (request.origin) {
    return request.origin;
  }
  if (request.isBackground || request.scopeId.startsWith('preload:')) {
    return 'preload';
  }
  return 'ui';
};

const inferSceneKey = (request: LLMRequest<unknown>) => {
  if (request.sceneKey) {
    return request.sceneKey;
  }
  if (request.supersedeKey) {
    return request.supersedeKey.split(':').slice(0, 2).join(':');
  }
  return request.route.service;
};

const clonePersistedState = (histories: QuotaHistories): PersistedRateState => ({
  histories: Object.fromEntries(
    Object.entries(histories.started).map(([stateKey, ruleHistory]) => [
      stateKey,
      Object.fromEntries(
        Object.entries(ruleHistory).map(([ruleId, values]) => [ruleId, [...values]])
      )
    ])
  ),
  tokenHistories: Object.fromEntries(
    Object.entries(histories.tokens).map(([stateKey, ruleHistory]) => [
      stateKey,
      Object.fromEntries(
        Object.entries(ruleHistory).map(([ruleId, values]) => [
          ruleId,
          values.map((event) => ({ ...event }))
        ])
      )
    ])
  )
});

class LLMClient {
  private readonly routeBuckets = new Map<string, RouteBucketState>();
  private readonly sharedPools = new Map<string, SharedPoolState>();
  private readonly sharedRequests = new Map<string, SharedRequestState<unknown>>();
  private readonly readyPromise: Promise<void>;
  private readonly ai: GoogleGenAI;
  private readonly quotaHistories = createEmptyQuotaHistories();
  private readonly quotaManager: QuotaManager;
  private wakeTimer: number | null = null;
  private wakeAt: number | null = null;
  private seq = 0;
  private flushing = false;
  private lastBusyAt: number | null = null;

  constructor(private readonly clock: SchedulerClock = defaultClock) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY ?? 'test-key';
    if (!import.meta.env.VITE_GEMINI_API_KEY && import.meta.env.MODE !== 'test') {
      throw new Error('Missing VITE_GEMINI_API_KEY');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.quotaManager = new QuotaManager(clock, this.quotaHistories);
    this.readyPromise = this.hydrate();
  }

  async request<T>(request: LLMRequest<T>) {
    await this.readyPromise;

    const origin = inferOrigin(request as LLMRequest<unknown>);
    const quotaContext = buildQuotaContext({
      route: {
        platform: request.route.platform || GEMINI_PLATFORM,
        service: request.route.service,
        model: request.route.model,
        modelBucket: request.route.modelBucket
      },
      usage: request.usage,
      origin,
      sceneKey: inferSceneKey(request as LLMRequest<unknown>),
      priority: request.priority ?? ORIGIN_PRIORITY[origin],
      estimatedInputTokens: request.estimatedInputTokens
    });
    const policy = resolveRoutePolicy({
      platform: quotaContext.platform,
      service: quotaContext.service
    });
    const bucketKey = buildLogicalBucketKey(quotaContext);
    const coalesceKey = buildCoalesceKey(bucketKey, request.businessKey);
    const bucket = this.getOrCreateRouteBucket(bucketKey, quotaContext.service, policy);

    if (this.needsSharedPool(quotaContext.service)) {
      this.getOrCreateSharedPool(TTS_SHARED_POOL_KEY);
    }

    this.supersedePending(request.scopeId, request.supersedeKey, coalesceKey);

    const activeShared = this.sharedRequests.get(coalesceKey) as
      | SharedRequestState<T>
      | undefined;
    if (activeShared && activeShared.status !== 'settled') {
      if (!request.isBackground && activeShared.entry.request.isBackground) {
        activeShared.entry.request.isBackground = false;
      }
      if (quotaContext.priority < activeShared.entry.quotaContext.priority) {
        activeShared.entry.quotaContext.priority = quotaContext.priority;
        activeShared.entry.quotaContext.origin = quotaContext.origin;
      }
      return await this.attachSubscriber(activeShared, request);
    }

    const subscriberBundle = this.createSubscriber<T>(request);
    const normalizedRequest: NormalizedLLMRequest<T> = {
      ...request,
      route: {
        platform: quotaContext.platform,
        service: quotaContext.service,
        modelBucket: quotaContext.modelBucket
      }
    };
    const entry: QueueEntry<T> = {
      id: generateId(),
      seq: ++this.seq,
      request: normalizedRequest,
      bucketKey,
      policy,
      coalesceKey,
      quotaContext
    };
    const shared: SharedRequestState<T> = {
      coalesceKey,
      bucketKey,
      status: 'pending',
      entry,
      subscribers: [subscriberBundle.subscriber]
    };

    this.sharedRequests.set(coalesceKey, shared as SharedRequestState<unknown>);
    bucket.pending.push(entry as QueueEntry<unknown>);
    this.processQueues();

    return await subscriberBundle.promise;
  }

  cancelPendingByScope(scopeId: string) {
    const cancellationError = new ScopeCancelledError();
    for (const shared of this.sharedRequests.values()) {
      const remainingSubscribers: QueueSubscriber<unknown>[] = [];
      for (const subscriber of shared.subscribers) {
        if (subscriber.scopeId === scopeId) {
          this.rejectSubscriber(subscriber, cancellationError);
        } else {
          remainingSubscribers.push(subscriber);
        }
      }
      shared.subscribers = remainingSubscribers;
      this.cleanupOrphanedPendingShared(shared);
    }
    this.processQueues();
  }

  private async hydrate() {
    const persisted = await DBUtils.get<PersistedRateState>(RATE_STATE_KEY, {
      histories: {},
      tokenHistories: {}
    });

    this.quotaHistories.started = Object.fromEntries(
      Object.entries(persisted.histories ?? {}).map(([stateKey, ruleHistory]) => [
        stateKey,
        Object.fromEntries(
          Object.entries(ruleHistory ?? {}).map(([ruleId, values]) => [
            ruleId,
            (Array.isArray(values) ? values : []).filter((value) =>
              Number.isFinite(value)
            )
          ])
        )
      ])
    );
    this.quotaHistories.tokens = Object.fromEntries(
      Object.entries(persisted.tokenHistories ?? {}).map(([stateKey, ruleHistory]) => [
        stateKey,
        Object.fromEntries(
          Object.entries(ruleHistory ?? {}).map(([ruleId, values]) => [
            ruleId,
            (Array.isArray(values) ? values : []).filter(
              (event) =>
                Number.isFinite(event?.at) && Number.isFinite(event?.amount)
            )
          ])
        )
      ])
    );
  }

  private getOrCreateRouteBucket(
    bucketKey: string,
    service: LLMRouteService,
    policy: RoutePolicy
  ) {
    const existing = this.routeBuckets.get(bucketKey);
    if (existing) {
      existing.policy = policy;
      return existing;
    }

    const bucket: RouteBucketState = {
      key: bucketKey,
      service,
      policy,
      pending: [],
      inFlightCount: 0
    };
    this.routeBuckets.set(bucketKey, bucket);
    return bucket;
  }

  private getOrCreateSharedPool(key: string) {
    const existing = this.sharedPools.get(key);
    if (existing) {
      return existing;
    }

    const pool: SharedPoolState = {
      key,
      maxActive: TTS_SHARED_POOL_ACTIVE,
      inFlightCount: 0
    };
    this.sharedPools.set(key, pool);
    return pool;
  }

  private needsSharedPool(service: LLMRouteService) {
    return service === 'tts-single' || service === 'tts-multi';
  }

  private createSubscriber<T>(request: LLMRequest<T>) {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      subscriber: {
        id: generateId(),
        scopeId: request.scopeId,
        supersedeKey: request.supersedeKey,
        resolve,
        reject,
        settled: false
      } as QueueSubscriber<T>
    };
  }

  private attachSubscriber<T>(
    shared: SharedRequestState<T>,
    request: LLMRequest<T>
  ) {
    const subscriberBundle = this.createSubscriber(request);
    shared.subscribers.push(subscriberBundle.subscriber);
    return subscriberBundle.promise;
  }

  private supersedePending(
    scopeId: string,
    supersedeKey: string | undefined,
    nextCoalesceKey: string
  ) {
    if (!supersedeKey) {
      return;
    }

    const supersededError = new SupersededError();
    for (const shared of this.sharedRequests.values()) {
      if (shared.status !== 'pending' || shared.coalesceKey === nextCoalesceKey) {
        continue;
      }

      const remainingSubscribers: QueueSubscriber<unknown>[] = [];
      for (const subscriber of shared.subscribers) {
        if (
          subscriber.scopeId === scopeId &&
          subscriber.supersedeKey === supersedeKey
        ) {
          this.rejectSubscriber(subscriber, supersededError);
        } else {
          remainingSubscribers.push(subscriber);
        }
      }
      shared.subscribers = remainingSubscribers;
      this.cleanupOrphanedPendingShared(shared);
    }
  }

  private resolveSubscriber<T>(subscriber: QueueSubscriber<T>, value: T) {
    if (subscriber.settled) {
      return;
    }
    subscriber.settled = true;
    subscriber.resolve(value);
  }

  private rejectSubscriber(
    subscriber: QueueSubscriber<unknown>,
    error: unknown
  ) {
    if (subscriber.settled) {
      return;
    }
    subscriber.settled = true;
    subscriber.reject(error);
  }

  private cleanupOrphanedPendingShared(shared: SharedRequestState<unknown>) {
    if (shared.status !== 'pending' || shared.subscribers.length > 0) {
      return;
    }

    const bucket = this.routeBuckets.get(shared.bucketKey);
    if (bucket) {
      bucket.pending = bucket.pending.filter((entry) => entry.id !== shared.entry.id);
    }
    shared.status = 'settled';
    this.sharedRequests.delete(shared.coalesceKey);
  }

  private settleShared<T>(
    shared: SharedRequestState<T>,
    result: { ok: true; value: T } | { ok: false; error: unknown }
  ) {
    if (shared.status === 'settled') {
      return;
    }

    shared.status = 'settled';
    this.sharedRequests.delete(shared.coalesceKey);
    const subscribers = [...shared.subscribers];
    shared.subscribers = [];

    for (const subscriber of subscribers) {
      if (result.ok === true) {
        this.resolveSubscriber(subscriber, result.value);
      } else {
        this.rejectSubscriber(subscriber, result.error);
      }
    }
  }

  private processQueues() {
    let didStart = false;

    while (true) {
      const next = this.findNextRunnableEntry();
      if (!next) {
        break;
      }
      didStart = true;
      this.startEntry(next.bucket, next.entry, next.selection);
    }

    const nextWakeAt = this.computeNextWakeAt();
    this.scheduleWake(nextWakeAt);

    if (!didStart && nextWakeAt === null && this.wakeTimer) {
      this.clock.clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
      this.wakeAt = null;
    }
  }

  private findNextRunnableEntry() {
    let best:
      | {
          bucket: RouteBucketState;
          entry: QueueEntry<unknown>;
          selection: QuotaSelection;
        }
      | null = null;

    for (const bucket of this.routeBuckets.values()) {
      for (const entry of bucket.pending) {
        const serviceAvailability = this.getServiceAvailability(bucket, entry);
        if (!serviceAvailability.allowed) {
          continue;
        }

        const quotaResult = this.quotaManager.selectCandidate(entry.quotaContext);
        if (!quotaResult.selection) {
          continue;
        }

        if (
          !best ||
          entry.quotaContext.priority < best.entry.quotaContext.priority ||
          (entry.quotaContext.priority === best.entry.quotaContext.priority &&
            quotaResult.selection.softPenalty < best.selection.softPenalty) ||
          (entry.quotaContext.priority === best.entry.quotaContext.priority &&
            quotaResult.selection.softPenalty === best.selection.softPenalty &&
            entry.seq < best.entry.seq)
        ) {
          best = {
            bucket,
            entry,
            selection: quotaResult.selection
          };
        }
      }
    }
    return best;
  }

  private computeNextWakeAt() {
    let nextWakeAt: number | null = null;
    for (const bucket of this.routeBuckets.values()) {
      for (const entry of bucket.pending) {
        const serviceAvailability = this.getServiceAvailability(bucket, entry);
        if (!serviceAvailability.allowed) {
          nextWakeAt = minWake(nextWakeAt, serviceAvailability.nextWakeAt);
          continue;
        }

        const quotaResult = this.quotaManager.selectCandidate(entry.quotaContext);
        if (quotaResult.selection || quotaResult.nextWakeAt === null) {
          continue;
        }

        nextWakeAt = minWake(nextWakeAt, quotaResult.nextWakeAt);
      }
    }
    return nextWakeAt;
  }

  private scheduleWake(nextWakeAt: number | null) {
    if (nextWakeAt === null) {
      if (this.wakeTimer) {
        this.clock.clearTimeout(this.wakeTimer);
        this.wakeTimer = null;
      }
      this.wakeAt = null;
      return;
    }

    if (this.wakeAt !== null && this.wakeAt <= nextWakeAt && this.wakeTimer) {
      return;
    }

    if (this.wakeTimer) {
      this.clock.clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }

    this.wakeAt = nextWakeAt;
    const delay = Math.max(0, nextWakeAt - this.clock.now());
    this.wakeTimer = this.clock.setTimeout(() => {
      this.wakeTimer = null;
      this.wakeAt = null;
      this.processQueues();
    }, delay);
  }

  private getServiceAvailability(
    bucket: RouteBucketState,
    entry: QueueEntry<unknown>
  ): AvailabilityResult {
    if (bucket.inFlightCount >= bucket.policy.maxConcurrency) {
      return { allowed: false, nextWakeAt: null };
    }

    if (entry.request.isBackground && this.lastBusyAt) {
      const cooldownUntil =
        this.lastBusyAt + schedulerPolicy.backgroundBusyCooldownMs;
      if (this.clock.now() < cooldownUntil) {
        return { allowed: false, nextWakeAt: cooldownUntil };
      }
    }

    if (entry.request.isBackground && bucket.policy.maxConcurrency > 1) {
      if (bucket.inFlightCount >= bucket.policy.maxConcurrency - 1) {
        return { allowed: false, nextWakeAt: null };
      }
    }

    if (this.needsSharedPool(bucket.service)) {
      const sharedPool = this.getOrCreateSharedPool(TTS_SHARED_POOL_KEY);
      if (sharedPool.inFlightCount >= sharedPool.maxActive) {
        return { allowed: false, nextWakeAt: null };
      }
    }

    return { allowed: true, nextWakeAt: null };
  }

  private persistState() {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    queueMicrotask(() => {
      this.flushing = false;
      void DBUtils.set(RATE_STATE_KEY, clonePersistedState(this.quotaHistories));
    });
  }

  private startEntry(
    bucket: RouteBucketState,
    entry: QueueEntry<unknown>,
    initialSelection: QuotaSelection
  ) {
    bucket.pending = bucket.pending.filter((pending) => pending.id !== entry.id);
    const shared = this.sharedRequests.get(entry.coalesceKey);
    if (!shared || shared.status !== 'pending') {
      this.processQueues();
      return;
    }
    if (shared.subscribers.length === 0) {
      this.cleanupOrphanedPendingShared(shared);
      this.processQueues();
      return;
    }

    const sharedPool = this.needsSharedPool(bucket.service)
      ? this.getOrCreateSharedPool(TTS_SHARED_POOL_KEY)
      : null;

    shared.status = 'in-flight';
    bucket.inFlightCount += 1;
    if (sharedPool) {
      sharedPool.inFlightCount += 1;
    }

    void this.executeEntry(bucket, entry, initialSelection)
      .then((value) => {
        this.settleShared(shared, { ok: true, value });
      })
      .catch((error) => {
        this.settleShared(shared, { ok: false, error });
      })
      .finally(() => {
        bucket.inFlightCount = Math.max(0, bucket.inFlightCount - 1);
        if (sharedPool) {
          sharedPool.inFlightCount = Math.max(0, sharedPool.inFlightCount - 1);
        }
        this.processQueues();
      });
  }

  private async executeEntry<T>(
    bucket: RouteBucketState,
    entry: QueueEntry<T>,
    initialSelection: QuotaSelection
  ) {
    const attemptedModels = new Set<string>();
    let nextSelection: QuotaSelection | null = initialSelection;
    let lastError: unknown = null;

    while (true) {
      const selection =
        nextSelection ?? (await this.waitForCandidate(entry, attemptedModels, lastError));
      nextSelection = null;

      try {
        return await this.executeWithCandidate(bucket, entry, selection);
      } catch (error) {
        lastError = error;
        attemptedModels.add(selection.model.id);

        if (isModelNotFoundError(error)) {
          this.quotaManager.markModelNotFound(selection.model.id);
        } else if (isBusyOrRateLimitedError(error)) {
          this.quotaManager.markModelBusy(selection.model.id);
        } else {
          throw error;
        }

        if (!this.hasRemainingCandidate(entry.quotaContext, attemptedModels)) {
          throw error;
        }

        const fallback = this.quotaManager.selectCandidate(
          entry.quotaContext,
          attemptedModels
        );
        nextSelection = fallback.selection;
      }
    }
  }

  private async executeWithCandidate<T>(
    bucket: RouteBucketState,
    entry: QueueEntry<T>,
    selection: QuotaSelection
  ) {
    let attempt = 0;
    const maxAttempts = 1 + bucket.policy.maxRetries;
    let retryMinDelay = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        if (attempt > 1) {
          await this.waitForRetryAllowance(
            selection,
            entry.quotaContext.estimatedInputTokens,
            retryMinDelay
          );
          retryMinDelay = 0;
        }

        this.quotaManager.recordStarted(
          selection,
          entry.quotaContext.estimatedInputTokens
        );
        this.persistState();

        const raw = await this.executePayload(
          withPayloadModel(entry.request.payload, selection.model.id)
        );
        const result = await entry.request.parser(raw);
        this.lastBusyAt = null;
        return result;
      } catch (error) {
        if (!isBusyOrRateLimitedError(error) || attempt >= maxAttempts) {
          throw error;
        }

        this.lastBusyAt = this.clock.now();
        retryMinDelay = bucket.policy.minBusyRetryDelayMs;
      }
    }

    throw new Error('Unreachable LLM retry state.');
  }

  private async waitForCandidate<T>(
    entry: QueueEntry<T>,
    attemptedModels: Set<string>,
    lastError: unknown
  ) {
    while (true) {
      const result = this.quotaManager.selectCandidate(
        entry.quotaContext,
        attemptedModels
      );
      if (result.selection) {
        return result.selection;
      }

      if (result.nextWakeAt === null) {
        throw lastError ?? new Error('No LLM model candidate is available.');
      }

      await sleep(Math.max(0, result.nextWakeAt - this.clock.now()));
    }
  }

  private hasRemainingCandidate(
    context: QuotaRequestContext,
    attemptedModels: Set<string>
  ) {
    return getCandidateModels(context.modelBucket, context.usage).some(
      (model) => !attemptedModels.has(model.id)
    );
  }

  private async waitForRetryAllowance(
    selection: QuotaSelection,
    estimatedInputTokens: number,
    minDelayMs: number
  ) {
    while (true) {
      const now = this.clock.now();
      const availability = this.quotaManager.getRulesAvailability(
        selection.hardRules,
        estimatedInputTokens
      );
      const retryAt = Math.max(
        now + minDelayMs,
        availability.nextWakeAt ?? now
      );
      const delay = Math.max(0, retryAt - now);
      if (delay === 0) {
        return;
      }

      await sleep(delay);
      minDelayMs = 0;
    }
  }

  private async executePayload(payload: LLMPayload) {
    if (payload.kind === 'generate-content') {
      const model = payload.params.model;
      if (!model) {
        throw new Error('Missing model for generateContent payload.');
      }
      return await this.ai.models.generateContent({
        ...payload.params,
        model
      });
    }
    throw new Error(`Unsupported LLM payload kind: ${(payload as LLMPayload).kind}`);
  }
}

const withPayloadModel = (payload: LLMPayload, model: string): LLMPayload => {
  if (payload.kind === 'generate-content') {
    return {
      ...payload,
      params: {
        ...payload.params,
        model
      }
    };
  }
  return payload;
};

const minWake = (current: number | null, candidate: number | null) => {
  if (candidate === null) {
    return current;
  }
  return current === null ? candidate : Math.min(current, candidate);
};

let sharedClient: LLMClient | null = null;

export const getLLMClient = (clock?: SchedulerClock) => {
  if (!sharedClient) {
    sharedClient = new LLMClient(clock);
  }
  return sharedClient;
};

export const createTestLLMClient = (clock: SchedulerClock) => new LLMClient(clock);
