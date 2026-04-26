import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePromptAudioPlayer } from '../features/shared/audio/usePromptAudioPlayer';

// Mock SpeechSynthesis
const mockSpeechSynthesis = {
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
};
global.window.speechSynthesis = mockSpeechSynthesis as any;
global.SpeechSynthesisUtterance = vi.fn().mockImplementation((text) => ({
  text,
  lang: 'en-US',
  rate: 1,
  onend: null,
})) as any;

describe('usePromptAudioPlayer behavior', () => {
  const defaultInput = {
    text: 'Test prompt text',
    audioUrl: 'http://test.com/audio.mp3',
    onEnsureAudio: vi.fn().mockResolvedValue('http://test.com/audio.mp3'),
    onPlaybackStarted: vi.fn(),
    onListenCompleted: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => usePromptAudioPlayer(defaultInput));
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.rate).toBe(1);
  });

  it('transitions to playing state on play (SpeechSynthesis fallback)', async () => {
    const { result } = renderHook(() => usePromptAudioPlayer({
        ...defaultInput,
        audioUrl: undefined, // Force fallback if audioRef is not setup
    }));
    
    await act(async () => {
      await result.current.play();
    });

    expect(result.current.isPlaying).toBe(true);
    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
  });

  it('stops and resets state on stop', async () => {
    const { result } = renderHook(() => usePromptAudioPlayer(defaultInput));
    
    await act(async () => {
      await result.current.play();
    });
    
    act(() => {
      result.current.stop();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });

  it('updates highlight on timeUpdate', () => {
    const { result } = renderHook(() => usePromptAudioPlayer({
        ...defaultInput,
        text: 'This is a test sentence.'
    }));

    // Simulate audio element
    const mockAudio = {
      currentTime: 1,
      duration: 10,
      pause: vi.fn(),
    };
    result.current.audioRef.current = mockAudio as any;
    
    act(() => {
        // @ts-ignore - setting isPlaying manually via hook call isn't possible, 
        // but we can simulate the state transition by calling play first
        result.current.play();
    });

    act(() => {
      result.current.handleTimeUpdate();
    });

    // With currentTime=1, duration=10, adjustedTime=0.75
    // targetIndex = floor(0.75 / 9.75 * 26) = floor(2)
    // 'This is a test sentence.' -> index 2 is 'i'
    // Expected highlight: 'This' (index 0 to 4)
    expect(result.current.highlightStart).toBe(0);
    expect(result.current.highlightLength).toBe(4);
  });
});
