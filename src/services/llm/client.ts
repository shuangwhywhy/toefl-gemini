import { GoogleGenAI } from '@google/genai';
import { DBUtils } from '../storage/db';
import { ScopeCancelledError, SupersededError } from './errors';
import {
  GEMINI_PLATFORM,
  getSchedulerPolicy,
  resolveRoutePolicy,
  resolveSharedPoolPolicy
} from './config';
import type {
  LLMRequest,
  LLMPayload,
  LLMRouteKey,
  PersistedRateState,
  RateLimitRule,
  ResolvedSharedPoolPolicy,
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

interface QueueEntry<T> {
  id: string;
  seq: number;
  request: LLMRequest<T>;
  bucketKey: string;
  route: LLMRouteKey;
  policy: RoutePolicy;
  sharedPool: ResolvedSharedPoolPolicy | null;
  coalesceKey: string;
}

interface RouteBucketState {
  key: string;
  route: LLMRouteKey;
  policy: RoutePolicy;
  pending: QueueEntry<unknown>[];
  histories: Record<string, number[]>;
  inFlightCount: number;
}

interface SharedPoolState {
  key: string;
  policy: ResolvedSharedPoolPolicy;
  histories: Record<string, number[]>;
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

const RATE_STATE_KEY = 'llm_rate_state_v1';
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

const buildRouteBucketKey = (route: LLMRouteKey) =>
  `${route.platform}:${route.service}:${route.model}`;

const buildCoalesceKey = (route: LLMRouteKey, businessKey: string) =>
  `${buildRouteBucketKey(route)}:${businessKey}`;

const generateId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const clonePersistedState = (
  routeBuckets: Map<string, RouteBucketState>,
  sharedPools: Map<string, SharedPoolState>
) => {
  const histories: PersistedRateState['histories'] = {};

  for (const [bucketKey, bucket] of routeBuckets.entries()) {
    histories[bucketKey] = {};
    for (const [ruleId, values] of Object.entries(bucket.histories)) {
      histories[bucketKey][ruleId] = [...values];
    }
  }

  for (const [poolKey, pool] of sharedPools.entries()) {
    histories[poolKey] = {};
    for (const [ruleId, values] of Object.entries(pool.histories)) {
      histories[poolKey][ruleId] = [...values];
    }
  }

  return { histories };
};

class LLMClient {
  private readonly routeBuckets = new Map<string, RouteBucketState>();
  private readonly sharedPools = new Map<string, SharedPoolState>();
  private readonly sharedRequests = new Map<string, SharedRequestState<unknown>>();
  private readonly readyPromise: Promise<void>;
  private readonly ai: GoogleGenAI;
  private persistedHistories: PersistedRateState['histories'] = {};
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
    this.readyPromise = this.hydrate();
  }

  async request<T>(request: LLMRequest<T>) {
    await this.readyPromise;

    const route = {
      platform: request.route.platform || GEMINI_PLATFORM,
      service: request.route.service,
      model: request.route.model
    };
    const policy = resolveRoutePolicy(route);
    const sharedPool = resolveSharedPoolPolicy(route);
    const bucketKey = buildRouteBucketKey(route);
    const coalesceKey = buildCoalesceKey(route, request.businessKey);
    const bucket = this.getOrCreateRouteBucket(bucketKey, route, policy);

    if (sharedPool) {
      this.getOrCreateSharedPool(sharedPool);
    }

    this.supersedePending(request.scopeId, request.supersedeKey, coalesceKey);

    const activeShared = this.sharedRequests.get(coalesceKey) as
      | SharedRequestState<T>
      | undefined;
    if (activeShared && activeShared.status !== 'settled') {
      if (!request.isBackground && activeShared.entry.request.isBackground) {
        activeShared.entry.request.isBackground = false;
      }
      return await this.attachSubscriber(activeShared, request);
    }

    const subscriberBundle = this.createSubscriber<T>(request);
    const entry: QueueEntry<T> = {
      id: generateId(),
      seq: ++this.seq,
      request: { ...request, route },
      bucketKey,
      route,
      policy,
      sharedPool,
      coalesceKey
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
      histories: {}
    });

    this.persistedHistories = Object.fromEntries(
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
  }

  private readPersistedHistories(stateKey: string) {
    const persisted = this.persistedHistories[stateKey] ?? {};
    return Object.fromEntries(
      Object.entries(persisted).map(([ruleId, values]) => [ruleId, [...values]])
    );
  }

  private getOrCreateRouteBucket(
    bucketKey: string,
    route: LLMRouteKey,
    policy: RoutePolicy
  ) {
    const existing = this.routeBuckets.get(bucketKey);
    if (existing) {
      existing.policy = policy;
      return existing;
    }

    const bucket: RouteBucketState = {
      key: bucketKey,
      route,
      policy,
      pending: [],
      histories: this.readPersistedHistories(bucketKey),
      inFlightCount: 0
    };
    this.routeBuckets.set(bucketKey, bucket);
    this.pruneHistories(bucket.policy.rules, bucket.histories);
    return bucket;
  }

  private getOrCreateSharedPool(policy: ResolvedSharedPoolPolicy) {
    const existing = this.sharedPools.get(policy.stateKey);
    if (existing) {
      existing.policy = policy;
      return existing;
    }

    const pool: SharedPoolState = {
      key: policy.stateKey,
      policy,
      histories: this.readPersistedHistories(policy.stateKey),
      inFlightCount: 0
    };
    this.sharedPools.set(policy.stateKey, pool);
    this.pruneHistories(pool.policy.rules, pool.histories);
    return pool;
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
      this.startEntry(next.bucket, next.entry);
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
    let best: { bucket: RouteBucketState; entry: QueueEntry<unknown> } | null = null;
    for (const bucket of this.routeBuckets.values()) {
      const head = bucket.pending[0];
      if (!head) {
        continue;
      }

      const availability = this.getEntryAvailability(bucket, head.sharedPool);
      if (!availability.allowed) {
        continue;
      }

      if (head.request.isBackground && this.lastBusyAt) {
        const now = this.clock.now();
        if (now - this.lastBusyAt < schedulerPolicy.backgroundBusyCooldownMs) {
          continue;
        }
      }

      if (head.request.isBackground && bucket.policy.maxConcurrency > 1) {
        if (bucket.inFlightCount >= bucket.policy.maxConcurrency - 1) {
          continue;
        }
      }

      if (!best || head.seq < best.entry.seq) {
        best = { bucket, entry: head };
      }
    }
    return best;
  }

  private computeNextWakeAt() {
    let nextWakeAt: number | null = null;
    for (const bucket of this.routeBuckets.values()) {
      const head = bucket.pending[0];
      if (!head) {
        continue;
      }

      const availability = this.getEntryAvailability(bucket, head.sharedPool);
      if (availability.allowed || availability.nextWakeAt === null) {
        continue;
      }

      if (nextWakeAt === null || availability.nextWakeAt < nextWakeAt) {
        nextWakeAt = availability.nextWakeAt;
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

  private getEntryAvailability(
    bucket: RouteBucketState,
    sharedPoolPolicy: ResolvedSharedPoolPolicy | null
  ): AvailabilityResult {
    const routeAvailability = this.getAvailability(
      bucket.policy.rules,
      bucket.histories,
      bucket.inFlightCount,
      bucket.policy.maxConcurrency
    );

    if (!sharedPoolPolicy) {
      return routeAvailability;
    }

    const pool = this.getOrCreateSharedPool(sharedPoolPolicy);
    const poolAvailability = this.getAvailability(
      pool.policy.rules,
      pool.histories,
      pool.inFlightCount
    );

    if (routeAvailability.allowed && poolAvailability.allowed) {
      return { allowed: true, nextWakeAt: null };
    }

    const blockedAvailabilities = [routeAvailability, poolAvailability].filter(
      (availability) => !availability.allowed
    );
    const wakeAts = blockedAvailabilities
      .map((availability) => availability.nextWakeAt)
      .filter((value): value is number => value !== null);

    if (wakeAts.length !== blockedAvailabilities.length) {
      return { allowed: false, nextWakeAt: null };
    }

    return {
      allowed: false,
      nextWakeAt: Math.max(...wakeAts)
    };
  }

  private getAvailability(
    rules: RateLimitRule[],
    histories: Record<string, number[]>,
    inFlightCount: number,
    maxConcurrency?: number
  ): AvailabilityResult {
    this.pruneHistories(rules, histories);

    if (maxConcurrency !== undefined && inFlightCount >= maxConcurrency) {
      return { allowed: false, nextWakeAt: null };
    }

    let nextWakeAt: number | null = null;
    for (const rule of rules) {
      if (rule.mode === 'active_requests') {
        if (inFlightCount >= rule.max) {
          return { allowed: false, nextWakeAt: null };
        }
        continue;
      }

      const timestamps = histories[rule.id] ?? [];
      if (timestamps.length >= rule.max) {
        const blockedUntil = timestamps[0] + rule.windowMs;
        nextWakeAt = nextWakeAt === null ? blockedUntil : Math.max(nextWakeAt, blockedUntil);
      }
    }

    return { allowed: nextWakeAt === null, nextWakeAt };
  }

  private pruneHistories(
    rules: RateLimitRule[],
    histories: Record<string, number[]>
  ) {
    const now = this.clock.now();
    for (const rule of rules) {
      if (rule.mode !== 'started_in_window') {
        continue;
      }

      const existing = histories[rule.id] ?? [];
      histories[rule.id] = existing.filter(
        (timestamp) => now - timestamp < rule.windowMs
      );
    }
  }

  private recordStarted(
    rules: RateLimitRule[],
    histories: Record<string, number[]>
  ) {
    const startedAt = this.clock.now();
    for (const rule of rules) {
      if (rule.mode !== 'started_in_window') {
        continue;
      }

      const existing = histories[rule.id] ?? [];
      existing.push(startedAt);
      histories[rule.id] = existing;
    }
    this.persistState();
  }

  private persistState() {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    queueMicrotask(() => {
      this.flushing = false;
      void DBUtils.set(
        RATE_STATE_KEY,
        clonePersistedState(this.routeBuckets, this.sharedPools)
      );
    });
  }

  private startEntry(bucket: RouteBucketState, entry: QueueEntry<unknown>) {
    bucket.pending.shift();
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

    const sharedPool = entry.sharedPool
      ? this.getOrCreateSharedPool(entry.sharedPool)
      : null;

    shared.status = 'in-flight';
    bucket.inFlightCount += 1;
    if (sharedPool) {
      sharedPool.inFlightCount += 1;
    }
    this.recordStarted(bucket.policy.rules, bucket.histories);
    if (sharedPool) {
      this.recordStarted(sharedPool.policy.rules, sharedPool.histories);
    }

    void this.executeEntry(bucket, sharedPool, entry)
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
    sharedPool: SharedPoolState | null,
    entry: QueueEntry<T>
  ) {
    let attempt = 0;
    const maxAttempts = 1 + bucket.policy.maxRetries;
    let retryMinDelay = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        if (attempt > 1) {
          await this.waitForRetryAllowance(bucket, sharedPool, retryMinDelay);
          retryMinDelay = 0;
          this.recordStarted(bucket.policy.rules, bucket.histories);
          if (sharedPool) {
            this.recordStarted(sharedPool.policy.rules, sharedPool.histories);
          }
        }

        const raw = await this.executePayload(entry.request.payload);
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

  private getStartedWindowAvailability(
    rules: RateLimitRule[],
    histories: Record<string, number[]>
  ) {
    this.pruneHistories(rules, histories);
    let nextWakeAt: number | null = null;
    for (const rule of rules) {
      if (rule.mode !== 'started_in_window') {
        continue;
      }

      const timestamps = histories[rule.id] ?? [];
      if (timestamps.length >= rule.max) {
        const blockedUntil = timestamps[0] + rule.windowMs;
        nextWakeAt = nextWakeAt === null ? blockedUntil : Math.max(nextWakeAt, blockedUntil);
      }
    }
    return nextWakeAt;
  }

  private async waitForRetryAllowance(
    bucket: RouteBucketState,
    sharedPool: SharedPoolState | null,
    minDelayMs: number
  ) {
    while (true) {
      const now = this.clock.now();
      const routeWakeAt = this.getStartedWindowAvailability(
        bucket.policy.rules,
        bucket.histories
      );
      const poolWakeAt = sharedPool
        ? this.getStartedWindowAvailability(
            sharedPool.policy.rules,
            sharedPool.histories
          )
        : null;
      const retryAt = Math.max(
        now + minDelayMs,
        routeWakeAt ?? now,
        poolWakeAt ?? now
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
      return await this.ai.models.generateContent(payload.params);
    }
    throw new Error(`Unsupported LLM payload kind: ${(payload as LLMPayload).kind}`);
  }
}

let sharedClient: LLMClient | null = null;

export const getLLMClient = (clock?: SchedulerClock) => {
  if (!sharedClient) {
    sharedClient = new LLMClient(clock);
  }
  return sharedClient;
};

export const createTestLLMClient = (clock: SchedulerClock) => new LLMClient(clock);
