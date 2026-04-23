import { GoogleGenAI } from '@google/genai';
import { DBUtils } from '../storage/db';
import { ScopeCancelledError, SupersededError } from './errors';
import { GEMINI_PLATFORM, resolveRoutePolicy } from './config';
import type {
  LLMRequest,
  LLMPayload,
  LLMRouteKey,
  PersistedRateState,
  RateLimitRule,
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
  coalesceKey: string;
}

interface BucketState {
  key: string;
  route: LLMRouteKey;
  policy: RoutePolicy;
  pending: QueueEntry<unknown>[];
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

const buildBucketKey = (route: LLMRouteKey) =>
  `${route.platform}:${route.service}:${route.model}`;
const buildCoalesceKey = (route: LLMRouteKey, businessKey: string) =>
  `${buildBucketKey(route)}:${businessKey}`;

const generateId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const clonePersistedState = (buckets: Map<string, BucketState>) => {
  const histories: PersistedRateState['histories'] = {};
  for (const [bucketKey, bucket] of buckets.entries()) {
    histories[bucketKey] = {};
    for (const [ruleId, values] of Object.entries(bucket.histories)) {
      histories[bucketKey][ruleId] = [...values];
    }
  }
  return { histories };
};

class LLMClient {
  private readonly buckets = new Map<string, BucketState>();
  private readonly sharedRequests = new Map<string, SharedRequestState<unknown>>();
  private readonly readyPromise: Promise<void>;
  private readonly ai: GoogleGenAI;
  private wakeTimer: number | null = null;
  private wakeAt: number | null = null;
  private seq = 0;
  private flushing = false;

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
    const bucketKey = buildBucketKey(route);
    const coalesceKey = buildCoalesceKey(route, request.businessKey);
    const bucket = this.getOrCreateBucket(bucketKey, route, policy);

    this.supersedePending(request.scopeId, request.supersedeKey, coalesceKey);

    const activeShared = this.sharedRequests.get(coalesceKey) as
      | SharedRequestState<T>
      | undefined;
    if (activeShared && activeShared.status !== 'settled') {
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
    for (const [bucketKey, ruleHistory] of Object.entries(persisted.histories)) {
      const [platform, service, ...modelParts] = bucketKey.split(':');
      const route = {
        platform,
        service,
        model: modelParts.join(':')
      };
      const policy = resolveRoutePolicy(route);
      const bucket = this.getOrCreateBucket(bucketKey, route, policy);
      bucket.histories = Object.fromEntries(
        Object.entries(ruleHistory).map(([ruleId, values]) => [
          ruleId,
          values.filter((value) => Number.isFinite(value))
        ])
      );
      this.pruneHistories(bucket);
    }
  }

  private getOrCreateBucket(
    bucketKey: string,
    route: LLMRouteKey,
    policy: RoutePolicy
  ) {
    const existing = this.buckets.get(bucketKey);
    if (existing) {
      existing.policy = policy;
      return existing;
    }
    const bucket: BucketState = {
      key: bucketKey,
      route,
      policy,
      pending: [],
      histories: {},
      inFlightCount: 0
    };
    this.buckets.set(bucketKey, bucket);
    return bucket;
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

    const bucket = this.buckets.get(shared.bucketKey);
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
    let best: { bucket: BucketState; entry: QueueEntry<unknown> } | null = null;
    for (const bucket of this.buckets.values()) {
      const head = bucket.pending[0];
      if (!head) {
        continue;
      }
      const availability = this.getAvailability(bucket);
      if (!availability.allowed) {
        continue;
      }
      if (!best || head.seq < best.entry.seq) {
        best = { bucket, entry: head };
      }
    }
    return best;
  }

  private computeNextWakeAt() {
    let nextWakeAt: number | null = null;
    for (const bucket of this.buckets.values()) {
      if (!bucket.pending.length) {
        continue;
      }
      const availability = this.getAvailability(bucket);
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

  private getAvailability(bucket: BucketState): AvailabilityResult {
    this.pruneHistories(bucket);

    if (bucket.inFlightCount >= bucket.policy.maxConcurrency) {
      return { allowed: false, nextWakeAt: null };
    }

    let nextWakeAt: number | null = null;
    for (const rule of bucket.policy.rules) {
      if (rule.mode === 'active_requests') {
        if (bucket.inFlightCount >= rule.max) {
          return { allowed: false, nextWakeAt: null };
        }
        continue;
      }

      const timestamps = bucket.histories[rule.id] ?? [];
      if (timestamps.length >= rule.max) {
        const blockedUntil = timestamps[0] + rule.windowMs;
        nextWakeAt = nextWakeAt === null ? blockedUntil : Math.max(nextWakeAt, blockedUntil);
      }
    }

    return { allowed: nextWakeAt === null, nextWakeAt };
  }

  private pruneHistories(bucket: BucketState) {
    const now = this.clock.now();
    for (const rule of bucket.policy.rules) {
      if (rule.mode !== 'started_in_window') {
        continue;
      }
      const existing = bucket.histories[rule.id] ?? [];
      bucket.histories[rule.id] = existing.filter(
        (timestamp) => now - timestamp < rule.windowMs
      );
    }
  }

  private recordStarted(bucket: BucketState) {
    const startedAt = this.clock.now();
    for (const rule of bucket.policy.rules) {
      if (rule.mode !== 'started_in_window') {
        continue;
      }
      const existing = bucket.histories[rule.id] ?? [];
      existing.push(startedAt);
      bucket.histories[rule.id] = existing;
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
      void DBUtils.set(RATE_STATE_KEY, clonePersistedState(this.buckets));
    });
  }

  private startEntry(bucket: BucketState, entry: QueueEntry<unknown>) {
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

    shared.status = 'in-flight';
    bucket.inFlightCount += 1;
    this.recordStarted(bucket);

    void this.executeEntry(bucket, entry)
      .then((value) => {
        this.settleShared(shared, { ok: true, value });
      })
      .catch((error) => {
        this.settleShared(shared, { ok: false, error });
      })
      .finally(() => {
        bucket.inFlightCount = Math.max(0, bucket.inFlightCount - 1);
        this.processQueues();
      });
  }

  private async executeEntry<T>(bucket: BucketState, entry: QueueEntry<T>) {
    let attempt = 0;
    const maxAttempts = 1 + bucket.policy.maxRetries;
    let retryMinDelay = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        if (attempt > 1) {
          await this.waitForRetryAllowance(bucket, retryMinDelay);
          retryMinDelay = 0;
          this.recordStarted(bucket);
        }
        const raw = await this.executePayload(entry.request.payload);
        return await entry.request.parser(raw);
      } catch (error) {
        if (!isBusyOrRateLimitedError(error) || attempt >= maxAttempts) {
          throw error;
        }
        retryMinDelay = bucket.policy.minBusyRetryDelayMs;
      }
    }

    throw new Error('Unreachable LLM retry state.');
  }

  private getStartedWindowAvailability(bucket: BucketState) {
    this.pruneHistories(bucket);
    let nextWakeAt: number | null = null;
    for (const rule of bucket.policy.rules) {
      if (rule.mode !== 'started_in_window') {
        continue;
      }
      const timestamps = bucket.histories[rule.id] ?? [];
      if (timestamps.length >= rule.max) {
        const blockedUntil = timestamps[0] + rule.windowMs;
        nextWakeAt = nextWakeAt === null ? blockedUntil : Math.max(nextWakeAt, blockedUntil);
      }
    }
    return nextWakeAt;
  }

  private async waitForRetryAllowance(bucket: BucketState, minDelayMs: number) {
    while (true) {
      const now = this.clock.now();
      const nextWakeAt = this.getStartedWindowAvailability(bucket);
      const retryAt =
        nextWakeAt === null
          ? now + minDelayMs
          : Math.max(nextWakeAt, now + minDelayMs);
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
