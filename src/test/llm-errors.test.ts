import { describe, expect, it } from 'vitest';
import { 
  classifyLLMFailure, 
  LLMFormatError, 
  JSONExtractionError, 
  SupersededError, 
  ScopeCancelledError 
} from '../services/llm/errors';

describe('LLM Failure Classification', () => {
  it('classifies cancellations correctly', () => {
    expect(classifyLLMFailure(new SupersededError())).toMatchObject({ kind: 'cancelled', retryable: false });
    expect(classifyLLMFailure(new ScopeCancelledError())).toMatchObject({ kind: 'cancelled', retryable: false });
    expect(classifyLLMFailure({ name: 'AbortError', message: 'aborted' })).toMatchObject({ kind: 'cancelled', retryable: false });
  });

  it('classifies format failures correctly', () => {
    expect(classifyLLMFailure(new LLMFormatError('invalid json'))).toMatchObject({ kind: 'format_failure', retryable: false });
    expect(classifyLLMFailure(new JSONExtractionError())).toMatchObject({ kind: 'format_failure', retryable: false });
    expect(classifyLLMFailure(new Error('Validation failed for schema'))).toMatchObject({ kind: 'format_failure', retryable: false });
    expect(classifyLLMFailure(new Error('Unexpected token { in JSON'))).toMatchObject({ kind: 'format_failure', retryable: false });
  });

  it('classifies rate limits and quota errors correctly', () => {
    expect(classifyLLMFailure({ status: 429, message: 'Too Many Requests' })).toMatchObject({ kind: 'rate_limited', retryable: true });
    expect(classifyLLMFailure(new Error('Quota exceeded for model'))).toMatchObject({ kind: 'rate_limited', retryable: true });
    expect(classifyLLMFailure(new Error('Resource exhausted'))).toMatchObject({ kind: 'rate_limited', retryable: true });
    expect(classifyLLMFailure(new Error('Model is overloaded'))).toMatchObject({ kind: 'rate_limited', retryable: true });
  });

  it('classifies transient errors correctly', () => {
    expect(classifyLLMFailure({ status: 503, message: 'Service Unavailable' })).toMatchObject({ kind: 'transient', retryable: true });
    expect(classifyLLMFailure({ code: 500, message: 'Internal Server Error' })).toMatchObject({ kind: 'transient', retryable: true });
    expect(classifyLLMFailure(new Error('fetch failed'))).toMatchObject({ kind: 'transient', retryable: true });
    expect(classifyLLMFailure(new Error('Connection timeout'))).toMatchObject({ kind: 'transient', retryable: true });
    expect(classifyLLMFailure(new Error('Socket reset'))).toMatchObject({ kind: 'transient', retryable: true });
  });

  it('classifies terminal errors correctly', () => {
    expect(classifyLLMFailure({ status: 404, message: 'Model not found' })).toMatchObject({ kind: 'terminal', retryable: false });
    expect(classifyLLMFailure({ status: 401, message: 'Unauthorized' })).toMatchObject({ kind: 'terminal', retryable: false });
    expect(classifyLLMFailure(new Error('Safety block triggered'))).toMatchObject({ kind: 'terminal', retryable: false });
    expect(classifyLLMFailure(new Error('Invalid parameters provided'))).toMatchObject({ kind: 'terminal', retryable: false });
  });

  it('defaults to terminal for unknown errors', () => {
    expect(classifyLLMFailure(new Error('Something completely weird happened'))).toMatchObject({ kind: 'terminal', retryable: false });
  });
});
