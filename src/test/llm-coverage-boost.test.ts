import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { 
  fetchConversationTTS, 
  requestChatCompletion, 
  requestTranscription,
  processDictationText,
  extractJSON,
  fetchGeminiText
} from '../services/llm/helpers';
import { runBoundedGeneration, toRetryFailure, BoundedRetryError } from '../services/llm/retry';
import { JSONExtractionError, LLMFormatError } from '../services/llm/errors';

const requestMock = vi.fn();
vi.mock('../services/llm/client', () => ({
  getLLMClient: () => ({
    request: requestMock as unknown as (args: { parser: (val: unknown) => Promise<unknown> }) => Promise<unknown>,
    cancelPendingByScope: vi.fn()
  })
}));

describe('LLM Coverage Boost', () => {
  beforeEach(() => {
    requestMock.mockReset();
    // Ensure requestMock calls the parser if provided in the arguments
    requestMock.mockImplementation(async (args: { parser: (val: unknown) => Promise<unknown> }) => {
      if (args.parser) {
        // Default behavior for other tests
      }
    });

    if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = async function() {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      };
    }

    if (typeof URL !== 'undefined' && !URL.createObjectURL) {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('helpers.ts additional coverage', () => {
    it('fetchConversationTTS handles successful audio return', async () => {
      requestMock.mockImplementation(async (args) => {
        return await args.parser({
          candidates: [{ content: { parts: [{ inlineData: { data: 'YmFzZTY0', mimeType: 'audio/wav;rate=24000' } }] } }]
        });
      });
      
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/wav' }))
      }));

      const url = await fetchConversationTTS('Professor: Hello. Student: Hi.', null, { scopeId: 'test' });
      expect(url).toBeDefined();
      expect(requestMock).toHaveBeenCalled();
    });

    it('requestChatCompletion returns a string', async () => {
      requestMock.mockImplementation(async (args) => {
        return await args.parser({
          candidates: [{ content: { parts: [{ text: 'Hello there!' }] } }]
        });
      });
      const result = await requestChatCompletion({ 
        contents: [], 
        scopeId: 'test' 
      });
      expect(result).toBe('Hello there!');
    });

    it('requestChatCompletion returns fallback message for empty response', async () => {
      requestMock.mockImplementation(async (args) => {
        return await args.parser({});
      });
      const result = await requestChatCompletion({ contents: [], scopeId: 'test' });
      expect(result).toContain('抱歉');
    });

    it('requestTranscription handles audio blob and returns transcript', async () => {
      vi.useRealTimers(); // FileReader/Blob logic often conflicts with fake timers
      requestMock.mockImplementation(async (args) => {
        return await args.parser({
          candidates: [{ content: { parts: [{ text: '{"transcript": "Hello world"}' }] } }]
        });
      });
      const blob = new Blob(['audio'], { type: 'audio/webm' });
      const result = await requestTranscription({ audioBlob: blob, scopeId: 'test' });
      expect(result).toBe('Hello world');
    });

    it('processDictationText hits complex punctuation and number branches', () => {
      const res = processDictationText('Wait! 123... No?');
      expect(res.find(r => r.word === '123')?.type).toBe('shown');
      // '...' is matched as three separate '.' tokens
      expect(res.filter(r => r.word === '.').length).toBe(3);
      expect(res.find(r => r.word === '.')?.type).toBe('shown');
      expect(res.find(r => r.word === 'No')?.type).toBe('gap');
    });

    it('extractJSON handles arrays and deeply nested objects', () => {
      const input = 'Data: [{"a": {"b": [1, 2]}}]';
      expect(extractJSON(input)).toEqual([{ a: { b: [1, 2] } }]);
    });

    it('extractJSON handles malformed JSON with leading/trailing text and array recovery', () => {
      const input = 'Check this array [1, 2, 3] and that was it.';
      expect(extractJSON(input)).toEqual([1, 2, 3]);
    });

    it('extractJSON handles newline recovery in objects and arrays', () => {
      // Logic replaces \n with \\n inside extracted { } or [ ]
      const objInput = '{"foo": "bar\nbaz"}';
      expect(extractJSON(objInput)).toEqual({ foo: 'bar\nbaz' });
      
      const arrInput = '["one\ntwo"]';
      expect(extractJSON(arrInput)).toEqual(["one\ntwo"]);
    });

    it('fetchGeminiText schema validation failure', async () => {
      requestMock.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ text: '{"wrong": true}' }] } }]
      });
      const validator = (p: Record<string, unknown>) => { if (!p.right) throw new Error('Bad'); };
      await expect(fetchGeminiText<unknown>('prompt', 0, 100, null, null, validator, { scopeId: 'test' }))
        .rejects.toThrow(LLMFormatError);
    });

    it('fetchGeminiText triggers fixer when allowed', async () => {
      requestMock
        .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ text: '{ "broken": ' }] } }] })
        .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ text: '{"fixed": true}' }] } }] });
      
      const result = await fetchGeminiText<unknown>('p', 0, 100, null, null, null, { scopeId: 'test' });
      expect(result).toEqual({ fixed: true });
      expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('fetchGeminiText respects disableJsonFixer', async () => {
      requestMock.mockResolvedValueOnce({ candidates: [{ content: { parts: [{ text: '{ "broken": ' }] } }] });
      await expect(fetchGeminiText<unknown>('p', 0, 100, null, null, null, { scopeId: 'test', disableJsonFixer: true }))
        .rejects.toThrow(JSONExtractionError);
    });
  });

  describe('retry.ts additional coverage', () => {
    it('runBoundedGeneration invokes onRetry callback', async () => {
      vi.useFakeTimers();
      const onRetry = vi.fn();
      const action = vi.fn()
        .mockRejectedValueOnce({ status: 503, message: 'busy' })
        .mockResolvedValueOnce('ok');

      const promise = runBoundedGeneration({ 
        action, 
        maxRetries: 1, 
        delayMs: 10, 
        onRetry 
      });
      
      await vi.advanceTimersByTimeAsync(11);
      const res = await promise;
      
      expect(res.value).toBe('ok');
      expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, retriesCompleted: 0 }));
    });

    it('toRetryFailure converts errors and BoundedRetryErrors', () => {
      const err = new Error('boom');
      const res1 = toRetryFailure(err);
      expect(res1).toBeInstanceOf(BoundedRetryError);
      expect(res1.attempts).toBe(1);

      const res2 = toRetryFailure(res1);
      expect(res2).toBe(res1);
    });
  });
});
