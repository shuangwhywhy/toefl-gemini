import { describe, expect, it, vi, beforeEach } from 'vitest';
import { 
  queueShadowPreload, 
  queueInterviewPreload, 
  queueListeningPreload, 
  queueDictationPreload 
} from '../features/shared/preloadTasks';
import { PreloadPipeline } from '../services/preload/orchestrator';
import { fetchGeminiText, fetchNeuralTTS, fetchConversationTTS } from '../services/llm/helpers';
import { generateInterviewSession } from '../features/interview/interviewGeneration';

import { waitFor } from '@testing-library/react';

vi.mock('../services/preload/orchestrator', () => ({
  PreloadPipeline: {
    enqueue: vi.fn((type, finger, task) => {
      // Fire and forget, but catch to prevent unhandled rejection in tests
      task(new AbortController().signal).catch(() => {});
    }),
    cache: {}
  }
}));

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: vi.fn(),
  fetchNeuralTTS: vi.fn(),
  fetchConversationTTS: vi.fn(),
  processDictationText: vi.fn(() => [])
}));

vi.mock('../features/interview/interviewGeneration', () => ({
  generateInterviewSession: vi.fn(),
  INTERVIEW_PROMPT_VERSION: '1.0'
}));

describe('PreloadTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PreloadPipeline.cache = { shadow: null, interview: null, listening: null, dictation: null };
  });

  it('queues shadow preload and caches result', async () => {
    vi.mocked(fetchGeminiText).mockResolvedValue({ sentence: 'Test sentence.' });
    vi.mocked(fetchNeuralTTS).mockResolvedValue('audio-url');

    queueShadowPreload(3, 'Topic', 5, 'Voice');

    await waitFor(() => {
      expect(PreloadPipeline.cache.shadow?.text).toBe('Test sentence.');
      expect(PreloadPipeline.cache.shadow?.audioUrl).toBe('audio-url');
    });
  });

  it('skips shadow preload if already cached with same parameters', async () => {
    PreloadPipeline.cache.shadow = { lengthLevel: 3, learningFocus: 'T', difficultyLevel: 5 } as any;
    
    queueShadowPreload(3, 'T', 5, 'V');
    
    expect(fetchGeminiText).not.toHaveBeenCalled();
  });

  it('queues interview preload', async () => {
    vi.mocked(generateInterviewSession).mockResolvedValue({ topic: 'Interview' } as any);

    queueInterviewPreload('Voice');

    await waitFor(() => {
      expect(PreloadPipeline.cache.interview?.topic).toBe('Interview');
    });
  });

  it('queues listening preload', async () => {
    vi.mocked(fetchGeminiText).mockResolvedValue({ topic: 'L', transcript: 'T', truth: {} });
    vi.mocked(fetchConversationTTS).mockResolvedValue('audio-l');

    queueListeningPreload();

    await waitFor(() => {
      expect(PreloadPipeline.cache.listening?.audioUrl).toBe('audio-l');
    });
  });

  it('queues dictation preload', async () => {
    vi.mocked(fetchGeminiText).mockResolvedValue({ topic: 'D', text: 'Text' });
    vi.mocked(fetchNeuralTTS).mockResolvedValue('audio-d');

    queueDictationPreload();

    await waitFor(() => {
      expect(PreloadPipeline.cache.dictation?.audioUrl).toBe('audio-d');
    });
  });

  it('handles errors in preload tasks and dispatches event', async () => {
    vi.mocked(fetchGeminiText).mockRejectedValue(new Error('Preload Failed'));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    queueShadowPreload(3, 'Fail', 5, 'V');

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'preload-error',
        detail: { type: 'shadow' }
      }));
    });
    
    // Suppress unhandled rejection warning by catching it if possible
    // (though in fire-and-forget it's tricky, we've verified the side effect)
  });
});
