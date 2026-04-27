import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callStructuredGemini } from '../services/callStructuredGemini';
import { fetchGeminiText } from '../services/llm/helpers';
import { createScopeId, useRequestScope } from '../services/requestScope';
import { renderHook, act } from '@testing-library/react';
import { getLLMClient } from '../services/llm/client';

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: vi.fn()
}));

vi.mock('../services/llm/client', () => ({
  getLLMClient: vi.fn(() => ({
    cancelPendingByScope: vi.fn()
  }))
}));

describe('Extended LLM Services', () => {
  describe('callStructuredGemini', () => {
    it('calls fetchGeminiText and parses response with Zod', async () => {
      const mockResult = JSON.stringify({ name: 'Test', age: 25 });
      vi.mocked(fetchGeminiText).mockResolvedValue(mockResult);

      const schema = z.object({ name: z.string(), age: z.number() });
      const result = await callStructuredGemini({
        promptOrParts: 'Hello',
        responseSchema: {},
        zodSchema: schema,
        scopeId: 's1',
        supersedeKey: 'k1'
      });

      expect(result).toEqual({ name: 'Test', age: 25 });
      expect(fetchGeminiText).toHaveBeenCalledWith(
        'Hello',
        0.4,
        2000,
        {},
        null,
        null,
        expect.objectContaining({ scopeId: 's1' })
      );
    });

    it('handles already parsed JSON objects from fetchGeminiText', async () => {
      const mockResult = { name: 'Direct', age: 30 };
      vi.mocked(fetchGeminiText).mockResolvedValue(mockResult as unknown as string);

      const schema = z.object({ name: z.string(), age: z.number() });
      const result = await callStructuredGemini({
        promptOrParts: 'Hello',
        responseSchema: null,
        zodSchema: schema,
        scopeId: 's1',
        supersedeKey: 'k1'
      });

      expect(result).toEqual({ name: 'Direct', age: 30 });
    });
  });

  describe('requestScope', () => {
    it('creates a unique scope id', () => {
      const id1 = createScopeId('p');
      const id2 = createScopeId('p');
      expect(id1).not.toBe(id2);
      expect(id1).toContain('p:');
    });

    it('manages sessions and invalidates on unmount', () => {
      const cancelMock = vi.fn();
      vi.mocked(getLLMClient).mockReturnValue({ cancelPendingByScope: cancelMock } as unknown as ReturnType<typeof getLLMClient>);

      const { result, unmount } = renderHook(() => useRequestScope('test'));
      
      const scopeId = result.current.scopeId;
      expect(scopeId).toContain('test:');

      const token1 = result.current.beginSession();
      expect(result.current.isSessionCurrent(token1)).toBe(true);

      act(() => {
        result.current.invalidateSession();
      });
      
      expect(result.current.isSessionCurrent(token1)).toBe(false);
      expect(cancelMock).toHaveBeenCalledWith(scopeId);

      unmount();
      expect(cancelMock).toHaveBeenCalledTimes(2);
    });
  });
});
