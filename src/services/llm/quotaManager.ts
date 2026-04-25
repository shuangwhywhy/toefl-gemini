import {
  DEFAULT_BUCKET_BY_SERVICE,
  DEFAULT_USAGE_BY_SERVICE,
  getCandidateModels,
  ORIGIN_PRIORITY
} from './modelCatalog';
import type {
  LLMModelBucket,
  LLMOrigin,
  LLMRouteKey,
  LLMRouteService,
  LLMUsage
} from './types';
import type { LLMModelDefinition } from './modelCatalog';

export interface TokenHistoryEvent {
  at: number;
  amount: number;
}

export interface QuotaHistories {
  started: Record<string, Record<string, number[]>>;
  tokens: Record<string, Record<string, TokenHistoryEvent[]>>;
}

export interface QuotaClock {
  now(): number;
}

export interface QuotaRequestContext {
  platform: string;
  service: LLMRouteService;
  modelBucket: LLMModelBucket;
  usage: LLMUsage;
  origin: LLMOrigin;
  sceneKey: string;
  priority: number;
  estimatedInputTokens: number;
}

export interface QuotaSelection {
  route: Required<Pick<LLMRouteKey, 'platform' | 'service' | 'model'>> & {
    modelBucket: LLMModelBucket;
  };
  model: LLMModelDefinition;
  hardRules: QuotaWindowRule[];
  softRules: QuotaWindowRule[];
  softPenalty: number;
}

export interface QuotaSelectionResult {
  selection: QuotaSelection | null;
  nextWakeAt: number | null;
}

type QuotaWindowKind = 'requests' | 'tokens';

interface QuotaWindowRule {
  id: string;
  stateKey: string;
  kind: QuotaWindowKind;
  windowMs: number;
  max: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MODEL_NOT_FOUND_DISABLE_MS = 10 * MINUTE_MS;
const BUSY_COOLDOWN_MS = 30_000;

const ORIGIN_SOFT_RATIO: Record<LLMOrigin, number> = {
  ui: 0.85,
  system: 0.65,
  preload: 0.4,
  retry: 0.25
};

const SCENE_SOFT_RATIO: Record<LLMOrigin, number> = {
  ui: 0.6,
  system: 0.45,
  preload: 0.3,
  retry: 0.2
};

const USAGE_SOFT_RATIO: Record<LLMUsage, number> = {
  text: 0.85,
  transcription: 0.3,
  tts: 0.8,
  live: 0.4,
  image: 0.4
};

const USAGE_HARD_LIMITS: Partial<
  Record<LLMUsage, { rpm?: number; rpd?: number; fiveMinute?: number }>
> = {
  transcription: {
    rpm: 6,
    fiveMinute: 18,
    rpd: 180
  }
};

export const createEmptyQuotaHistories = (): QuotaHistories => ({
  started: {},
  tokens: {}
});

export const normalizeLLMRoute = (
  route: LLMRouteKey,
  usage?: LLMUsage
): QuotaRequestContext => {
  const service = route.service as LLMRouteService;
  const inferredUsage = usage ?? DEFAULT_USAGE_BY_SERVICE[service] ?? 'text';
  const modelBucket =
    route.modelBucket ?? DEFAULT_BUCKET_BY_SERVICE[service] ?? 'text';

  return {
    platform: route.platform || 'gemini',
    service,
    modelBucket,
    usage: inferredUsage,
    origin: 'ui',
    sceneKey: service,
    priority: ORIGIN_PRIORITY.ui,
    estimatedInputTokens: 1
  };
};

export class QuotaManager {
  private readonly disabledUntil = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly clock: QuotaClock,
    private readonly histories: QuotaHistories
  ) {}

  selectCandidate(
    context: QuotaRequestContext,
    excludedModels = new Set<string>()
  ): QuotaSelectionResult {
    const candidates = getCandidateModels(context.modelBucket, context.usage);
    let best: QuotaSelection | null = null;
    let nextWakeAt: number | null = null;

    for (const model of candidates) {
      if (excludedModels.has(model.id)) {
        continue;
      }

      const disabledUntil = this.disabledUntil.get(model.id);
      if (disabledUntil && disabledUntil > this.clock.now()) {
        nextWakeAt = minWake(nextWakeAt, disabledUntil);
        continue;
      }
      if (disabledUntil) {
        this.disabledUntil.delete(model.id);
      }

      const hardRules = buildHardRules(context, model);
      const hardAvailability = this.getRulesAvailability(
        hardRules,
        context.estimatedInputTokens
      );
      if (!hardAvailability.allowed) {
        nextWakeAt = minWake(nextWakeAt, hardAvailability.nextWakeAt);
        continue;
      }

      const softRules = buildSoftRules(context, model);
      const softPenalty =
        this.getSoftPenalty(softRules, context.estimatedInputTokens) +
        this.getCooldownPenalty(model.id);
      const selection: QuotaSelection = {
        route: {
          platform: context.platform,
          service: context.service,
          model: model.id,
          modelBucket: context.modelBucket
        },
        model,
        hardRules,
        softRules,
        softPenalty
      };

      if (
        !best ||
        selection.softPenalty < best.softPenalty ||
        (selection.softPenalty === best.softPenalty &&
          candidates.indexOf(selection.model) < candidates.indexOf(best.model))
      ) {
        best = selection;
      }
    }

    return {
      selection: best,
      nextWakeAt
    };
  }

  getRulesAvailability(
    rules: QuotaWindowRule[],
    estimatedInputTokens: number
  ) {
    let nextWakeAt: number | null = null;

    for (const rule of rules) {
      const availability =
        rule.kind === 'requests'
          ? this.getStartedAvailability(rule)
          : this.getTokenAvailability(rule, estimatedInputTokens);
      if (availability.allowed) {
        continue;
      }
      nextWakeAt = minWake(nextWakeAt, availability.nextWakeAt);
    }

    return {
      allowed: nextWakeAt === null,
      nextWakeAt
    };
  }

  recordStarted(selection: QuotaSelection, estimatedInputTokens: number) {
    const startedAt = this.clock.now();
    const rules = [...selection.hardRules, ...selection.softRules];

    for (const rule of rules) {
      if (rule.kind === 'requests') {
        const bucket = getRuleHistory(this.histories.started, rule.stateKey);
        const existing = bucket[rule.id] ?? [];
        existing.push(startedAt);
        bucket[rule.id] = existing;
      } else {
        const bucket = getRuleHistory(this.histories.tokens, rule.stateKey);
        const existing = bucket[rule.id] ?? [];
        existing.push({
          at: startedAt,
          amount: Math.max(1, estimatedInputTokens)
        });
        bucket[rule.id] = existing;
      }
    }
  }

  markModelNotFound(modelId: string) {
    this.disabledUntil.set(modelId, this.clock.now() + MODEL_NOT_FOUND_DISABLE_MS);
  }

  markModelBusy(modelId: string) {
    this.cooldownUntil.set(modelId, this.clock.now() + BUSY_COOLDOWN_MS);
  }

  private getSoftPenalty(
    rules: QuotaWindowRule[],
    estimatedInputTokens: number
  ) {
    return rules.reduce((penalty, rule) => {
      const availability =
        rule.kind === 'requests'
          ? this.getStartedAvailability(rule)
          : this.getTokenAvailability(rule, estimatedInputTokens);
      return penalty + (availability.allowed ? 0 : 1);
    }, 0);
  }

  private getCooldownPenalty(modelId: string) {
    const cooldownUntil = this.cooldownUntil.get(modelId);
    if (!cooldownUntil) {
      return 0;
    }
    if (cooldownUntil <= this.clock.now()) {
      this.cooldownUntil.delete(modelId);
      return 0;
    }
    return 100;
  }

  private getStartedAvailability(rule: QuotaWindowRule) {
    const bucket = getRuleHistory(this.histories.started, rule.stateKey);
    const existing = bucket[rule.id] ?? [];
    const now = this.clock.now();
    const pruned = existing.filter((timestamp) => now - timestamp < rule.windowMs);
    bucket[rule.id] = pruned;

    if (pruned.length >= rule.max) {
      return {
        allowed: false,
        nextWakeAt: pruned[0] + rule.windowMs
      };
    }

    return { allowed: true, nextWakeAt: null };
  }

  private getTokenAvailability(
    rule: QuotaWindowRule,
    estimatedInputTokens: number
  ) {
    const bucket = getRuleHistory(this.histories.tokens, rule.stateKey);
    const existing = bucket[rule.id] ?? [];
    const now = this.clock.now();
    const pruned = existing.filter((event) => now - event.at < rule.windowMs);
    bucket[rule.id] = pruned;

    const amount = Math.max(1, estimatedInputTokens);
    const total = pruned.reduce((sum, event) => sum + event.amount, 0);
    if (total + amount <= rule.max) {
      return { allowed: true, nextWakeAt: null };
    }

    let reducedTotal = total;
    for (const event of pruned) {
      reducedTotal -= event.amount;
      if (reducedTotal + amount <= rule.max) {
        return {
          allowed: false,
          nextWakeAt: event.at + rule.windowMs
        };
      }
    }

    return {
      allowed: false,
      nextWakeAt: pruned[0]?.at ? pruned[0].at + rule.windowMs : null
    };
  }
}

export const buildQuotaContext = ({
  route,
  usage,
  origin,
  sceneKey,
  priority,
  estimatedInputTokens
}: {
  route: LLMRouteKey;
  usage?: LLMUsage;
  origin?: LLMOrigin;
  sceneKey?: string;
  priority?: number;
  estimatedInputTokens?: number;
}): QuotaRequestContext => {
  const base = normalizeLLMRoute(route, usage);
  const normalizedOrigin = origin ?? 'ui';
  return {
    ...base,
    origin: normalizedOrigin,
    sceneKey: sceneKey ?? base.sceneKey,
    priority: priority ?? ORIGIN_PRIORITY[normalizedOrigin],
    estimatedInputTokens: Math.max(1, Math.ceil(estimatedInputTokens ?? 1))
  };
};

const buildHardRules = (
  context: QuotaRequestContext,
  model: LLMModelDefinition
): QuotaWindowRule[] => {
  const modelStateKey = buildStateKey(context.platform, 'model', model.id);
  const rules: QuotaWindowRule[] = [
    {
      id: 'model.requests.1m',
      stateKey: modelStateKey,
      kind: 'requests',
      windowMs: MINUTE_MS,
      max: model.quota.rpm
    },
    {
      id: 'model.requests.1d',
      stateKey: modelStateKey,
      kind: 'requests',
      windowMs: DAY_MS,
      max: model.quota.rpd
    }
  ];

  if (model.quota.tpm !== null) {
    rules.push({
      id: 'model.tokens.1m',
      stateKey: modelStateKey,
      kind: 'tokens',
      windowMs: MINUTE_MS,
      max: model.quota.tpm
    });
  }

  const usageLimit = USAGE_HARD_LIMITS[context.usage];
  if (usageLimit) {
    const usageStateKey = buildStateKey(context.platform, 'usage', context.usage);
    if (usageLimit.rpm) {
      rules.push({
        id: 'usage.requests.1m',
        stateKey: usageStateKey,
        kind: 'requests',
        windowMs: MINUTE_MS,
        max: usageLimit.rpm
      });
    }
    if (usageLimit.fiveMinute) {
      rules.push({
        id: 'usage.requests.5m',
        stateKey: usageStateKey,
        kind: 'requests',
        windowMs: 5 * MINUTE_MS,
        max: usageLimit.fiveMinute
      });
    }
    if (usageLimit.rpd) {
      rules.push({
        id: 'usage.requests.1d',
        stateKey: usageStateKey,
        kind: 'requests',
        windowMs: DAY_MS,
        max: usageLimit.rpd
      });
    }
  }

  return rules;
};

const buildSoftRules = (
  context: QuotaRequestContext,
  model: LLMModelDefinition
): QuotaWindowRule[] => {
  const originStateKey = buildStateKey(
    context.platform,
    'model-origin',
    `${model.id}:${context.origin}`
  );
  const usageStateKey = buildStateKey(
    context.platform,
    'model-usage',
    `${model.id}:${context.usage}`
  );
  const sceneStateKey = buildStateKey(
    context.platform,
    'model-scene',
    `${model.id}:${context.sceneKey}`
  );

  return [
    ...buildSoftRulesForState(
      originStateKey,
      'origin',
      model,
      ORIGIN_SOFT_RATIO[context.origin]
    ),
    ...buildSoftRulesForState(
      usageStateKey,
      'usage',
      model,
      USAGE_SOFT_RATIO[context.usage]
    ),
    ...buildSoftRulesForState(
      sceneStateKey,
      'scene',
      model,
      SCENE_SOFT_RATIO[context.origin]
    )
  ];
};

const buildSoftRulesForState = (
  stateKey: string,
  prefix: string,
  model: LLMModelDefinition,
  ratio: number
): QuotaWindowRule[] => {
  const rules: QuotaWindowRule[] = [
    {
      id: `${prefix}.requests.1m`,
      stateKey,
      kind: 'requests',
      windowMs: MINUTE_MS,
      max: softMax(model.quota.rpm, ratio)
    },
    {
      id: `${prefix}.requests.1d`,
      stateKey,
      kind: 'requests',
      windowMs: DAY_MS,
      max: softMax(model.quota.rpd, ratio)
    }
  ];

  if (model.quota.tpm !== null) {
    rules.push({
      id: `${prefix}.tokens.1m`,
      stateKey,
      kind: 'tokens',
      windowMs: MINUTE_MS,
      max: softMax(model.quota.tpm, ratio)
    });
  }

  return rules;
};

const softMax = (max: number, ratio: number) =>
  Math.max(1, Math.floor(max * ratio));

const buildStateKey = (platform: string, dimension: string, value: string) =>
  `${platform}:${dimension}:${value}`;

const getRuleHistory = <T>(
  histories: Record<string, Record<string, T[]>>,
  stateKey: string
) => {
  histories[stateKey] ??= {};
  return histories[stateKey];
};

const minWake = (current: number | null, candidate: number | null) => {
  if (candidate === null) {
    return current;
  }
  return current === null ? candidate : Math.min(current, candidate);
};
