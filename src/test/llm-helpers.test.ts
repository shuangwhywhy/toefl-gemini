import { describe, expect, it } from 'vitest';
import { extractJSON, processDictationText, shouldAttemptJsonFixer } from '../services/llm/helpers';
import { JSONExtractionError } from '../services/llm/errors';

describe('LLM Helpers', () => {
  describe('extractJSON', () => {
    it('extracts pure JSON strings', () => {
      const input = '{"foo": "bar"}';
      expect(extractJSON(input)).toEqual({ foo: 'bar' });
    });

    it('extracts JSON from markdown code blocks', () => {
      const input = 'Here is your data:\n```json\n{"foo": "bar"}\n```\nHope it helps!';
      expect(extractJSON(input)).toEqual({ foo: 'bar' });
    });

    it('extracts JSON from raw text with noise', () => {
      const input = 'Some text before {"foo": "bar"} some text after';
      expect(extractJSON(input)).toEqual({ foo: 'bar' });
    });

    it('extracts array JSON', () => {
      const input = '[1, 2, 3]';
      expect(extractJSON(input)).toEqual([1, 2, 3]);
    });

    it('handles nested objects and arrays', () => {
      const input = 'Check this: {"a": [1, 2], "b": {"c": 3}}';
      expect(extractJSON(input)).toEqual({ a: [1, 2], b: { c: 3 } });
    });

    it('throws JSONExtractionError for invalid JSON', () => {
      const input = 'This is just plain text without any JSON';
      expect(() => extractJSON(input)).toThrow(JSONExtractionError);
    });

    it('handles broken JSON with newline recovery', () => {
      // The algorithm tries replacing newlines if basic parse fails inside {}
      // We use a string where newlines only appear inside the value
      const input = '{"foo": "bar\nbaz"}';
      expect(extractJSON(input)).toEqual({ foo: 'bar\nbaz' });
    });
  });

  describe('shouldAttemptJsonFixer', () => {
    it('returns false for empty input', () => {
      expect(shouldAttemptJsonFixer('')).toBe(false);
      expect(shouldAttemptJsonFixer('  ')).toBe(false);
    });

    it('returns false for obvious failure messages', () => {
      expect(shouldAttemptJsonFixer('Error: Quota exceeded')).toBe(false);
      expect(shouldAttemptJsonFixer('Request blocked by safety policy')).toBe(false);
    });

    it('returns true for text containing json-like characters', () => {
      expect(shouldAttemptJsonFixer('```json\n{}')).toBe(true);
      expect(shouldAttemptJsonFixer('{"foo": "bar"}')).toBe(true);
      expect(shouldAttemptJsonFixer('result: value')).toBe(true);
    });
  });

  describe('processDictationText', () => {
    it('processes simple sentences into gaps and shown words', () => {
      const text = 'Hello world!';
      const result = processDictationText(text);
      
      expect(result).toEqual([
        { word: 'Hello', type: 'gap' },
        { word: 'world', type: 'gap' },
        { word: '!', type: 'shown' }
      ]);
    });

    it('shows punctuation and numbers', () => {
      const text = 'I have 2 apples.';
      const result = processDictationText(text);
      
      expect(result[0]).toEqual({ word: 'I', type: 'gap' });
      expect(result[2]).toEqual({ word: '2', type: 'shown' });
      expect(result[4]).toEqual({ word: '.', type: 'shown' });
    });

    it('shows capitalized words in middle of sentence (Proper Nouns)', () => {
      const text = 'I visited London today.';
      const result = processDictationText(text);
      
      // London (index 2) should be shown because it's capitalized and not start of sentence
      expect(result[2]).toEqual({ word: 'London', type: 'shown' });
      // today (index 3) should be gap
      expect(result[3]).toEqual({ word: 'today', type: 'gap' });
    });

    it('handles multi-sentence capitalization correctly', () => {
      const text = 'He left. She stayed.';
      const result = processDictationText(text);
      
      // 'He' is start of sentence -> gap
      expect(result[0]).toEqual({ word: 'He', type: 'gap' });
      // 'She' is start of sentence (after '.') -> gap
      expect(result[3]).toEqual({ word: 'She', type: 'gap' });
    });
  });
});
