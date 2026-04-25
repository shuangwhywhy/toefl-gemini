import llmPolicyJson from './llm-policy.json';
import type {
  ActiveRequestsRateLimitRule,
  CompiledLLMPolicyRegistry,
  CompiledRouteDefinition,
  CompiledSharedPoolDefinition,
  LLMBusyRetryConfig,
  LLMLimitConfig,
  LLMPolicyConfigDocument,
  LLMPolicyDefaults,
  LLMPolicyProfileConfig,
  LLMRouteCapabilityConfig,
  LLMRouteKey,
  LLMRouteModelOverrideConfig,
  LLMSharedPoolConfig,
  LLMSchedulerPolicy,
  RateLimitRule,
  ResolvedRouteExecutionPolicy,
  ResolvedSharedPoolPolicy,
  StartedInWindowRateLimitRule
} from './types';
export { GEMINI_PLATFORM } from './modelCatalog';

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

const ROUTE_BINDINGS = {
  text: {
    capabilityPath: ['textGeneration', 'general'] as const,
    historyNamespace: 'platform'
  },
  evaluation: {
    capabilityPath: ['textGeneration', 'evaluation'] as const,
    historyNamespace: 'platform'
  },
  chat: {
    capabilityPath: ['textGeneration', 'chat'] as const,
    historyNamespace: 'platform'
  },
  'tts-single': {
    capabilityPath: ['speech', 'singleVoice'] as const,
    historyNamespace: 'tts.singleVoice'
  },
  'tts-multi': {
    capabilityPath: ['speech', 'multiVoiceConversation'] as const,
    historyNamespace: 'tts.multiVoiceConversation'
  },
  transcription: {
    capabilityPath: ['speech', 'transcription'] as const,
    historyNamespace: 'transcribe'
  }
} as const;

const SHARED_POOL_BINDINGS = {
  speechSynthesis: {
    historyNamespace: 'tts.shared',
    stateBucketSegment: 'tts-shared',
    appliesPerModel: true
  }
} as const;

type RouteServiceKey = keyof typeof ROUTE_BINDINGS;
type SharedPoolKey = keyof typeof SHARED_POOL_BINDINGS;

interface RouteMergeFragment {
  concurrency?: number;
  busyRetry?: LLMBusyRetryConfig;
  limits?: LLMLimitConfig;
  pool?: string | null;
}

const readObject = (
  value: unknown,
  path: string
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid LLM policy config at ${path}: expected object.`);
  }
  return value as Record<string, unknown>;
};

const readInteger = (
  value: unknown,
  path: string,
  min = 0
) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min
  ) {
    throw new Error(
      `Invalid LLM policy config at ${path}: expected integer >= ${min}.`
    );
  }
  return value;
};

const readString = (value: unknown, path: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid LLM policy config at ${path}: expected non-empty string.`);
  }
  return value;
};

const readStringArray = (value: unknown, path: string) => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid LLM policy config at ${path}: expected array.`);
  }
  return value.map((entry, index) =>
    readString(entry, `${path}[${index}]`)
  );
};

const validateDurationToken = (value: string, path: string) => {
  if (!DURATION_PATTERN.test(value)) {
    throw new Error(
      `Invalid LLM policy config at ${path}: expected duration like 30s, 1m, 5m, 1h, or 1d.`
    );
  }
  return value;
};

const durationToMs = (value: string, path: string) => {
  const normalized = validateDurationToken(value, path);
  const match = normalized.match(DURATION_PATTERN);
  if (!match) {
    throw new Error(`Invalid LLM policy config at ${path}: invalid duration.`);
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multiplier =
    unit === 's'
      ? 1_000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : 86_400_000;
  return amount * multiplier;
};

const parseBusyRetryConfig = (
  value: unknown,
  path: string,
  required = false
): LLMBusyRetryConfig | undefined => {
  if (value === undefined) {
    if (required) {
      throw new Error(`Invalid LLM policy config at ${path}: missing busyRetry.`);
    }
    return undefined;
  }

  const raw = readObject(value, path);
  const config: LLMBusyRetryConfig = {};

  if ('maxRetries' in raw) {
    config.maxRetries = readInteger(raw.maxRetries, `${path}.maxRetries`, 0);
  }
  if ('minDelay' in raw) {
    config.minDelay = validateDurationToken(
      readString(raw.minDelay, `${path}.minDelay`),
      `${path}.minDelay`
    );
  }

  if (required && (config.maxRetries === undefined || config.minDelay === undefined)) {
    throw new Error(
      `Invalid LLM policy config at ${path}: busyRetry requires maxRetries and minDelay.`
    );
  }

  return config;
};

const parseLimitConfig = (
  value: unknown,
  path: string,
  required = false
): LLMLimitConfig | undefined => {
  if (value === undefined) {
    if (required) {
      throw new Error(`Invalid LLM policy config at ${path}: missing limits.`);
    }
    return undefined;
  }

  const raw = readObject(value, path);
  const config: LLMLimitConfig = {};

  if ('started' in raw) {
    const startedRaw = readObject(raw.started, `${path}.started`);
    config.started = Object.fromEntries(
      Object.entries(startedRaw).map(([windowLabel, max]) => [
        validateDurationToken(windowLabel, `${path}.started.${windowLabel}`),
        readInteger(max, `${path}.started.${windowLabel}`, 1)
      ])
    );
  }

  if ('active' in raw) {
    config.active = readInteger(raw.active, `${path}.active`, 1);
  }

  if (required && !config.started && config.active === undefined) {
    throw new Error(
      `Invalid LLM policy config at ${path}: limits require started and/or active settings.`
    );
  }

  return config;
};

const parseSharedPolicyFields = (
  raw: Record<string, unknown>,
  path: string
) => {
  const parsed: LLMPolicyProfileConfig = {};

  if ('description' in raw) {
    parsed.description = readString(raw.description, `${path}.description`);
  }
  if ('concurrency' in raw) {
    parsed.concurrency = readInteger(raw.concurrency, `${path}.concurrency`, 1);
  }
  if ('busyRetry' in raw) {
    parsed.busyRetry = parseBusyRetryConfig(raw.busyRetry, `${path}.busyRetry`);
  }
  if ('limits' in raw) {
    parsed.limits = parseLimitConfig(raw.limits, `${path}.limits`);
  }

  return parsed;
};

const parsePolicyProfileConfig = (
  value: unknown,
  path: string
): LLMPolicyProfileConfig => {
  const raw = readObject(value, path);
  return parseSharedPolicyFields(raw, path);
};

const parseRouteModelOverrideConfig = (
  value: unknown,
  path: string
): LLMRouteModelOverrideConfig => {
  const raw = readObject(value, path);
  return parseSharedPolicyFields(raw, path);
};

const parseRouteCapabilityConfig = (
  value: unknown,
  path: string
): LLMRouteCapabilityConfig => {
  const raw = readObject(value, path);
  const parsed: LLMRouteCapabilityConfig = parseSharedPolicyFields(raw, path);

  if ('use' in raw) {
    parsed.use = readStringArray(raw.use, `${path}.use`);
  }
  if ('pool' in raw) {
    parsed.pool = readString(raw.pool, `${path}.pool`);
  }
  if ('models' in raw) {
    const modelsRaw = readObject(raw.models, `${path}.models`);
    parsed.models = Object.fromEntries(
      Object.entries(modelsRaw).map(([model, config]) => [
        model,
        parseRouteModelOverrideConfig(config, `${path}.models.${model}`)
      ])
    );
  }

  return parsed;
};

const parseSharedPoolConfig = (
  value: unknown,
  path: string
): LLMSharedPoolConfig => {
  const raw = readObject(value, path);
  const parsed: LLMSharedPoolConfig = {
    limits: parseLimitConfig(raw.limits, `${path}.limits`, true) ?? {}
  };

  if ('description' in raw) {
    parsed.description = readString(raw.description, `${path}.description`);
  }

  return parsed;
};

const parseDefaults = (
  value: unknown,
  path: string
): LLMPolicyDefaults => {
  const raw = readObject(value, path);
  const busyRetryRaw = readObject(raw.busyRetry, `${path}.busyRetry`);
  const backgroundQueueRaw = readObject(
    raw.backgroundQueue,
    `${path}.backgroundQueue`
  );

  return {
    busyRetry: {
      maxRetries: readInteger(
        busyRetryRaw.maxRetries,
        `${path}.busyRetry.maxRetries`,
        0
      ),
      minDelay: validateDurationToken(
        readString(busyRetryRaw.minDelay, `${path}.busyRetry.minDelay`),
        `${path}.busyRetry.minDelay`
      )
    },
    backgroundQueue: {
      cooldownAfterBusy: validateDurationToken(
        readString(
          backgroundQueueRaw.cooldownAfterBusy,
          `${path}.backgroundQueue.cooldownAfterBusy`
        ),
        `${path}.backgroundQueue.cooldownAfterBusy`
      )
    }
  };
};

export const parseLLMPolicyConfigDocument = (
  value: unknown
): LLMPolicyConfigDocument => {
  const raw = readObject(value, 'llmPolicy');
  const version = readInteger(raw.version, 'llmPolicy.version', 1);
  if (version !== 1) {
    throw new Error('Invalid LLM policy config at llmPolicy.version: only version 1 is supported.');
  }

  const profilesRaw = readObject(raw.profiles, 'llmPolicy.profiles');
  const sharedPoolsRaw = readObject(raw.sharedPools, 'llmPolicy.sharedPools');
  const capabilitiesRaw = readObject(raw.capabilities, 'llmPolicy.capabilities');
  const textGenerationRaw = readObject(
    capabilitiesRaw.textGeneration,
    'llmPolicy.capabilities.textGeneration'
  );
  const speechRaw = readObject(
    capabilitiesRaw.speech,
    'llmPolicy.capabilities.speech'
  );

  return {
    version,
    defaults: parseDefaults(raw.defaults, 'llmPolicy.defaults'),
    profiles: Object.fromEntries(
      Object.entries(profilesRaw).map(([profileName, profileConfig]) => [
        profileName,
        parsePolicyProfileConfig(
          profileConfig,
          `llmPolicy.profiles.${profileName}`
        )
      ])
    ),
    sharedPools: Object.fromEntries(
      Object.entries(sharedPoolsRaw).map(([poolName, poolConfig]) => [
        poolName,
        parseSharedPoolConfig(poolConfig, `llmPolicy.sharedPools.${poolName}`)
      ])
    ),
    capabilities: {
      textGeneration: {
        general: parseRouteCapabilityConfig(
          textGenerationRaw.general,
          'llmPolicy.capabilities.textGeneration.general'
        ),
        evaluation: parseRouteCapabilityConfig(
          textGenerationRaw.evaluation,
          'llmPolicy.capabilities.textGeneration.evaluation'
        ),
        chat: parseRouteCapabilityConfig(
          textGenerationRaw.chat,
          'llmPolicy.capabilities.textGeneration.chat'
        )
      },
      speech: {
        singleVoice: parseRouteCapabilityConfig(
          speechRaw.singleVoice,
          'llmPolicy.capabilities.speech.singleVoice'
        ),
        multiVoiceConversation: parseRouteCapabilityConfig(
          speechRaw.multiVoiceConversation,
          'llmPolicy.capabilities.speech.multiVoiceConversation'
        ),
        transcription: parseRouteCapabilityConfig(
          speechRaw.transcription,
          'llmPolicy.capabilities.speech.transcription'
        )
      }
    }
  };
};

const cloneStartedLimits = (started?: Record<string, number>) =>
  started ? { ...started } : undefined;

const mergeLimitConfig = (
  base?: LLMLimitConfig,
  override?: LLMLimitConfig
): LLMLimitConfig | undefined => {
  if (!base && !override) {
    return undefined;
  }

  return {
    started: {
      ...(base?.started ?? {}),
      ...(override?.started ?? {})
    },
    active: override?.active ?? base?.active
  };
};

const mergeBusyRetryConfig = (
  base?: LLMBusyRetryConfig,
  override?: LLMBusyRetryConfig
): LLMBusyRetryConfig | undefined => {
  if (!base && !override) {
    return undefined;
  }

  return {
    maxRetries: override?.maxRetries ?? base?.maxRetries,
    minDelay: override?.minDelay ?? base?.minDelay
  };
};

const mergeRouteFragment = (
  base: RouteMergeFragment,
  override?:
    | LLMPolicyProfileConfig
    | LLMRouteCapabilityConfig
    | LLMRouteModelOverrideConfig
): RouteMergeFragment => {
  if (!override) {
    return {
      concurrency: base.concurrency,
      busyRetry: mergeBusyRetryConfig(base.busyRetry),
      limits: base.limits
        ? {
            started: cloneStartedLimits(base.limits.started),
            active: base.limits.active
          }
        : undefined,
      pool: base.pool ?? null
    };
  }

  const next: RouteMergeFragment = {
    concurrency: override.concurrency ?? base.concurrency,
    busyRetry: mergeBusyRetryConfig(base.busyRetry, override.busyRetry),
    limits: mergeLimitConfig(base.limits, override.limits),
    pool:
      'pool' in override && override.pool !== undefined
        ? override.pool
        : base.pool ?? null
  };

  return next;
};

const buildStartedRuleId = (namespace: string, label: string) =>
  `${namespace}.started.${label}`;

const buildActiveRuleId = (namespace: string) => `${namespace}.active`;

const compileRateLimitRules = (
  limits: LLMLimitConfig | undefined,
  namespace: string
): RateLimitRule[] => {
  const startedRules: StartedInWindowRateLimitRule[] = Object.entries(
    limits?.started ?? {}
  )
    .map(([label, max]) => ({
      id: buildStartedRuleId(namespace, label),
      mode: 'started_in_window' as const,
      windowMs: durationToMs(label, `limit window ${label}`),
      max
    }))
    .sort((left, right) => left.windowMs - right.windowMs);

  const activeRules: ActiveRequestsRateLimitRule[] =
    limits?.active === undefined
      ? []
      : [
          {
            id: buildActiveRuleId(namespace),
            mode: 'active_requests',
            max: limits.active
          }
        ];

  return [...startedRules, ...activeRules];
};

const getCapabilityConfig = (
  document: LLMPolicyConfigDocument,
  path: readonly [string, string]
): LLMRouteCapabilityConfig => {
  const [group, entry] = path;
  if (group === 'textGeneration') {
    return document.capabilities.textGeneration[
      entry as keyof typeof document.capabilities.textGeneration
    ];
  }

  return document.capabilities.speech[
    entry as keyof typeof document.capabilities.speech
  ];
};

const compileRoutePolicy = (
  fragment: RouteMergeFragment,
  historyNamespace: string,
  path: string
): ResolvedRouteExecutionPolicy => {
  if (fragment.concurrency === undefined) {
    throw new Error(`Invalid LLM policy config at ${path}: missing concurrency.`);
  }
  if (
    fragment.busyRetry?.maxRetries === undefined ||
    fragment.busyRetry.minDelay === undefined
  ) {
    throw new Error(`Invalid LLM policy config at ${path}: missing busyRetry settings.`);
  }

  return {
    maxConcurrency: fragment.concurrency,
    maxRetries: fragment.busyRetry.maxRetries,
    minBusyRetryDelayMs: durationToMs(
      fragment.busyRetry.minDelay,
      `${path}.busyRetry.minDelay`
    ),
    rules: compileRateLimitRules(fragment.limits, historyNamespace),
    sharedPoolKey: fragment.pool ?? null
  };
};

const compileSharedPoolDefinition = (
  poolKey: SharedPoolKey,
  poolConfig: LLMSharedPoolConfig
): CompiledSharedPoolDefinition => {
  const binding = SHARED_POOL_BINDINGS[poolKey];
  return {
    key: poolKey,
    rules: compileRateLimitRules(poolConfig.limits, binding.historyNamespace),
    stateBucketSegment: binding.stateBucketSegment,
    appliesPerModel: binding.appliesPerModel
  };
};

export const compileLLMPolicyConfigDocument = (
  document: LLMPolicyConfigDocument
): CompiledLLMPolicyRegistry => {
  for (const poolName of Object.keys(document.sharedPools)) {
    if (!(poolName in SHARED_POOL_BINDINGS)) {
      throw new Error(
        `Invalid LLM policy config at llmPolicy.sharedPools.${poolName}: unsupported shared pool.`
      );
    }
  }

  const sharedPools: Record<string, CompiledSharedPoolDefinition> = Object.fromEntries(
    (Object.entries(document.sharedPools) as Array<[SharedPoolKey, LLMSharedPoolConfig]>)
      .map(([poolKey, poolConfig]) => [
        poolKey,
        compileSharedPoolDefinition(poolKey, poolConfig)
      ])
  );

  const baseFragment: RouteMergeFragment = {
    busyRetry: {
      maxRetries: document.defaults.busyRetry.maxRetries,
      minDelay: document.defaults.busyRetry.minDelay
    }
  };

  const routes: Record<string, CompiledRouteDefinition> = {};

  for (const [service, binding] of Object.entries(ROUTE_BINDINGS) as Array<
    [RouteServiceKey, (typeof ROUTE_BINDINGS)[RouteServiceKey]]
  >) {
    const capabilityConfig = getCapabilityConfig(document, binding.capabilityPath);
    let mergedBase = mergeRouteFragment(baseFragment);

    for (const profileName of capabilityConfig.use ?? []) {
      const profile = document.profiles[profileName];
      if (!profile) {
        throw new Error(
          `Invalid LLM policy config at capability ${service}: missing profile "${profileName}".`
        );
      }
      mergedBase = mergeRouteFragment(mergedBase, profile);
    }

    mergedBase = mergeRouteFragment(mergedBase, capabilityConfig);

    if (mergedBase.pool && !sharedPools[mergedBase.pool]) {
      throw new Error(
        `Invalid LLM policy config at capability ${service}: missing shared pool "${mergedBase.pool}".`
      );
    }

    const defaultPolicy = compileRoutePolicy(
      mergedBase,
      binding.historyNamespace,
      `capability ${service}`
    );

    const modelPolicies = Object.fromEntries(
      Object.entries(capabilityConfig.models ?? {}).map(([model, override]) => {
        const mergedOverride = mergeRouteFragment(mergedBase, override);
        if (mergedOverride.pool && !sharedPools[mergedOverride.pool]) {
          throw new Error(
            `Invalid LLM policy config at capability ${service}.models.${model}: missing shared pool "${mergedOverride.pool}".`
          );
        }
        return [
          model,
          compileRoutePolicy(
            mergedOverride,
            binding.historyNamespace,
            `capability ${service}.models.${model}`
          )
        ];
      })
    );

    routes[service] = {
      defaultPolicy,
      modelPolicies
    };
  }

  return {
    routes,
    sharedPools,
    scheduler: {
      backgroundBusyCooldownMs: durationToMs(
        document.defaults.backgroundQueue.cooldownAfterBusy,
        'llmPolicy.defaults.backgroundQueue.cooldownAfterBusy'
      )
    }
  };
};

const cloneRule = (rule: RateLimitRule): RateLimitRule =>
  rule.mode === 'started_in_window'
    ? { ...rule }
    : { ...rule };

const cloneRoutePolicy = (
  policy: ResolvedRouteExecutionPolicy
): ResolvedRouteExecutionPolicy => ({
  ...policy,
  rules: policy.rules.map((rule) => cloneRule(rule))
});

const cloneSharedPoolPolicy = (
  policy: ResolvedSharedPoolPolicy
): ResolvedSharedPoolPolicy => ({
  ...policy,
  rules: policy.rules.map((rule) => cloneRule(rule))
});

const compiledLLMPolicyRegistry = compileLLMPolicyConfigDocument(
  parseLLMPolicyConfigDocument(llmPolicyJson)
);

export const getSchedulerPolicy = (): LLMSchedulerPolicy => ({
  ...compiledLLMPolicyRegistry.scheduler
});

export const resolveRoutePolicy = (
  route: LLMRouteKey
): ResolvedRouteExecutionPolicy => {
  const definition = compiledLLMPolicyRegistry.routes[route.service];
  if (!definition) {
    throw new Error(`Unsupported LLM route service: ${route.service}`);
  }

  const resolved =
    definition.modelPolicies[route.model] ?? definition.defaultPolicy;
  return cloneRoutePolicy(resolved);
};

export const resolveSharedPoolPolicy = (
  route: LLMRouteKey
): ResolvedSharedPoolPolicy | null => {
  const routePolicy = resolveRoutePolicy(route);
  if (!routePolicy.sharedPoolKey) {
    return null;
  }

  const definition = compiledLLMPolicyRegistry.sharedPools[routePolicy.sharedPoolKey];
  if (!definition) {
    throw new Error(
      `Unsupported LLM shared pool: ${routePolicy.sharedPoolKey}`
    );
  }

  const stateKey = definition.appliesPerModel
    ? `${route.platform}:${definition.stateBucketSegment}:${route.model}`
    : `${route.platform}:${definition.stateBucketSegment}`;

  return cloneSharedPoolPolicy({
    key: definition.key,
    stateKey,
    rules: definition.rules
  });
};
