import {
  ClassifiedLLMFailure,
  classifyLLMFailure
} from './errors';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export interface BoundedGenerationOptions<T> {
  action: () => Promise<T>;
  classify?: (error: unknown) => ClassifiedLLMFailure;
  maxRetries?: number;
  delayMs?: number;
  onRetry?: (info: {
    attempt: number;
    retriesCompleted: number;
    maxRetries: number;
    failure: ClassifiedLLMFailure;
  }) => void | Promise<void>;
}

export interface BoundedGenerationResult<T> {
  value: T;
  attempts: number;
  retries: number;
}

export class BoundedRetryError extends Error {
  readonly failure: ClassifiedLLMFailure;
  readonly attempts: number;
  readonly retries: number;
  override readonly cause: unknown;

  constructor(
    error: unknown,
    failure: ClassifiedLLMFailure,
    attempts: number
  ) {
    super(
      String(
        (error as { message?: string })?.message ??
          failure.userMessage ??
          'Bounded generation failed.'
      )
    );
    this.name = 'BoundedRetryError';
    this.failure = failure;
    this.attempts = attempts;
    this.retries = Math.max(0, attempts - 1);
    this.cause = error;
  }
}

export const toRetryFailure = (error: unknown) => {
  if (error instanceof BoundedRetryError) {
    return error;
  }

  const failure = classifyLLMFailure(error);
  return new BoundedRetryError(error, failure, 1);
};

export const runBoundedGeneration = async <T>({
  action,
  classify = classifyLLMFailure,
  maxRetries = 2,
  delayMs = 1000,
  onRetry
}: BoundedGenerationOptions<T>): Promise<BoundedGenerationResult<T>> => {
  let attempts = 0;

  while (attempts < maxRetries + 1) {
    attempts += 1;
    try {
      const value = await action();
      return {
        value,
        attempts,
        retries: Math.max(0, attempts - 1)
      };
    } catch (error) {
      const failure = classify(error);
      const retriesCompleted = Math.max(0, attempts - 1);

      if (!failure.retryable || retriesCompleted >= maxRetries) {
        throw new BoundedRetryError(error, failure, attempts);
      }

      if (onRetry) {
        await onRetry({
          attempt: attempts,
          retriesCompleted,
          maxRetries,
          failure
        });
      }

      await sleep(delayMs);
    }
  }

  throw new Error('Unreachable bounded retry state.');
};
