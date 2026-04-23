export class SupersededError extends Error {
  constructor(message = 'Pending request was superseded by a newer request.') {
    super(message);
    this.name = 'SupersededError';
  }
}

export class ScopeCancelledError extends Error {
  constructor(message = 'Pending request was cancelled for the current scope.') {
    super(message);
    this.name = 'ScopeCancelledError';
  }
}

export class LLMFormatError extends Error {
  readonly reasonCode: string;

  constructor(
    message = 'Invalid structured LLM response.',
    reasonCode = 'format_error'
  ) {
    super(message);
    this.name = 'LLMFormatError';
    this.reasonCode = reasonCode;
  }
}

export class JSONExtractionError extends LLMFormatError {
  constructor(message = 'JSON extraction algorithm failed') {
    super(message, 'json_extraction_failed');
    this.name = 'JSONExtractionError';
  }
}

export type LLMFailureKind =
  | 'transient'
  | 'rate_limited'
  | 'terminal'
  | 'format_failure'
  | 'cancelled';

export interface ClassifiedLLMFailure {
  kind: LLMFailureKind;
  retryable: boolean;
  userMessage: string;
  statusCode?: number;
  reasonCode?: string;
  rawMessage: string;
}

const extractStatusCode = (error: unknown) => {
  const direct =
    (error as { status?: number; code?: number })?.status ??
    (error as { code?: number })?.code;
  return typeof direct === 'number' ? direct : undefined;
};

const extractMessage = (error: unknown) =>
  String((error as { message?: string })?.message ?? '').trim();

const isCancellationError = (error: unknown) => {
  const name = String((error as { name?: string })?.name ?? '');
  return (
    name === 'AbortError' ||
    error instanceof SupersededError ||
    error instanceof ScopeCancelledError
  );
};

const isFormatFailure = (error: unknown, message: string) => {
  if (error instanceof LLMFormatError) {
    return true;
  }

  return /json|schema|validator|validation|invalid format|unexpected token/i.test(
    message
  );
};

export const classifyLLMFailure = (
  error: unknown
): ClassifiedLLMFailure => {
  const statusCode = extractStatusCode(error);
  const rawMessage = extractMessage(error);
  const message = rawMessage.toLowerCase();
  const reasonCode =
    error instanceof LLMFormatError ? error.reasonCode : undefined;

  if (isCancellationError(error)) {
    return {
      kind: 'cancelled',
      retryable: false,
      userMessage: '请求已取消。',
      statusCode,
      reasonCode,
      rawMessage
    };
  }

  if (isFormatFailure(error, message)) {
    return {
      kind: 'format_failure',
      retryable: false,
      userMessage: 'AI 返回内容格式异常，请稍后重试。',
      statusCode,
      reasonCode,
      rawMessage
    };
  }

  if (
    statusCode === 429 ||
    /rate limit|too many|quota|resource exhausted|busy|overload/i.test(message)
  ) {
    return {
      kind: 'rate_limited',
      retryable: true,
      userMessage: '当前请求较多，请稍后重试。',
      statusCode,
      reasonCode,
      rawMessage
    };
  }

  if (
    statusCode === 408 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    /network|timeout|timed out|econn|ehost|enotfound|fetch failed|socket|connection reset|unavailable|temporary/i.test(
      message
    )
  ) {
    return {
      kind: 'transient',
      retryable: true,
      userMessage: '网络波动或服务暂时不可用，请稍后重试。',
      statusCode,
      reasonCode,
      rawMessage
    };
  }

  if (
    statusCode === 400 ||
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 404 ||
    /safety|policy|blocked|forbidden|permission|unauthorized|invalid|not found|failed precondition/i.test(
      message
    )
  ) {
    return {
      kind: 'terminal',
      retryable: false,
      userMessage: '请求被系统拒绝或参数无效，请稍后调整后重试。',
      statusCode,
      reasonCode,
      rawMessage
    };
  }

  return {
    kind: 'terminal',
    retryable: false,
    userMessage: '请求失败，请稍后重试。',
    statusCode,
    reasonCode,
    rawMessage
  };
};
