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
global.window.speechSynthesis = mockSpeechSynthesis as unknown as SpeechSynthesis;
global.SpeechSynthesisUtterance = vi.fn().mockImplementation((text) => ({
  text,
  lang: 'en-US',
  rate: 1,
  onend: null,
})) as unknown as typeof SpeechSynthesisUtterance;

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

  it('updates highlight on timeUpdate with correct word boundaries', () => {
    const text = 'Quick brown fox jumps.';
    const { result } = renderHook(() => usePromptAudioPlayer({
        ...defaultInput,
        text
    }));

    const mockAudio = {
      currentTime: 0,
      duration: 10,
      pause: vi.fn(),
    };
    result.current.audioRef.current = mockAudio as unknown as HTMLAudioElement;
    
    // Simulate playing state
    act(() => {
        result.current.play();
    });

    // Case 1: Start of the sentence
    mockAudio.currentTime = 0.3; // adjustedTime = 0.05
    // (0.05 / 9.75) * 22 = ~0.11 -> targetIndex 0
    act(() => { result.current.handleTimeUpdate(); });
    expect(result.current.highlightStart).toBe(0);
    expect(result.current.highlightLength).toBe(5); // 'Quick'

    // Case 2: Middle of a word
    mockAudio.currentTime = 3.25; // adjustedTime = 3.0
    // (3.0 / 9.75) * 22 = ~6.7 -> targetIndex 6
    // 'Quick brown fox jumps.' -> index 6 is 'b'
    act(() => { result.current.handleTimeUpdate(); });
    expect(result.current.highlightStart).toBe(6);
    expect(result.current.highlightLength).toBe(5); // 'brown'

    // Case 3: End of the sentence
    mockAudio.currentTime = 10; // adjustedTime = 9.75
    // (9.75 / 9.75) * 22 = 22 -> targetIndex 22
    act(() => { result.current.handleTimeUpdate(); });
    expect(result.current.highlightStart).toBe(16);
    expect(result.current.highlightLength).toBe(6); // 'jumps.'
  });

  it('updates playbackRate when rate changes', () => {
    const { result } = renderHook(() => usePromptAudioPlayer(defaultInput));
    const mockAudio = { playbackRate: 1, pause: vi.fn() };
    result.current.audioRef.current = mockAudio as unknown as HTMLAudioElement;

    act(() => {
      result.current.setRate(1.5);
    });

    expect(mockAudio.playbackRate).toBe(1.5);
  });

  it('falls back to SpeechSynthesis when audio playback fails', async () => {
    const { result } = renderHook(() => usePromptAudioPlayer(defaultInput));
    const mockAudio = {
      play: vi.fn().mockRejectedValue(new Error('Blocked')),
      pause: vi.fn(),
      src: '',
      playbackRate: 1,
    };
    result.current.audioRef.current = mockAudio as unknown as HTMLAudioElement;

    await act(async () => {
      await result.current.play();
    });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
    expect(result.current.error).toContain('Audio playback was blocked');
  });

  it('cancels playback on unmount', () => {
    const { unmount } = renderHook(() => usePromptAudioPlayer(defaultInput));
    unmount();
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });

  it('handles playback ended', () => {
    const onListenCompleted = vi.fn();
    const { result } = renderHook(() => usePromptAudioPlayer({
      ...defaultInput,
      onListenCompleted
    }));

    act(() => {
      result.current.handleEnded();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(onListenCompleted).toHaveBeenCalled();
  });
});
