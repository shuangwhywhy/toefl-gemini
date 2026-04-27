import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder, getSupportedAudioMimeType } from '../hooks/useAudioRecorder';

describe('useAudioRecorder Extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('getSupportedAudioMimeType handles undefined MediaRecorder', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(getSupportedAudioMimeType()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('startTimer does nothing if enableTimer is false', async () => {
    const { result } = renderHook(() => useAudioRecorder({ enableTimer: false }));
    
    // Mock getUserMedia
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }]
        })
      }
    });
    
    // Mock MediaRecorder
    const mockRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null,
      onstop: null,
      state: 'inactive'
    };
    vi.stubGlobal('MediaRecorder', vi.fn(() => mockRecorder));

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.durationSec).toBe(0);
  });

  it('handles startRecording errors', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Permission Denied'))
      }
    });

    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('Permission Denied');
    expect(result.current.isRecording).toBe(false);
  });

  it('returns current blob if stopRecording called while inactive', async () => {
    const { result } = renderHook(() => useAudioRecorder());
    const blob = await result.current.stopRecording();
    expect(blob).toBe(null);
  });

  it('cleans up and resets state in cancelRecording while inactive', async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.cancelRecording();
    });
    expect(result.current.isRecording).toBe(false);
  });
});
