import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGeminiTranscription } from '../hooks/useGeminiTranscription';
import { requestTranscription } from '../services/llm/helpers';

vi.mock('../services/llm/helpers', () => ({
  requestTranscription: vi.fn()
}));

describe('useGeminiTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs transcription and updates loading state', async () => {
    vi.mocked(requestTranscription).mockResolvedValue('Transcribed Text');
    
    const { result } = renderHook(() => useGeminiTranscription({ scopeId: 's1' }));
    
    expect(result.current.isTranscribing).toBe(false);

    let promise: Promise<string>;
    await act(async () => {
      promise = result.current.transcribeAudio({
        audioBlob: new Blob(['audio']),
        prompt: 'test',
        supersedeKey: 'k1'
      });
    });

    const finalResult = await promise!;
    expect(finalResult).toBe('Transcribed Text');
    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('handles transcription errors', async () => {
    vi.mocked(requestTranscription).mockRejectedValue(new Error('Fail'));
    
    const { result } = renderHook(() => useGeminiTranscription({ scopeId: 's1' }));

    await act(async () => {
      try {
        await result.current.transcribeAudio({
          audioBlob: new Blob(['audio']),
          prompt: 'test',
          supersedeKey: 'k1'
        });
      } catch (e) {
        // ignore
      }
    });

    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.error).toBe('Fail');
  });
});
