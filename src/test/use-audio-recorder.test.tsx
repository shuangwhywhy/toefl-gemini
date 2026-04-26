import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSupportedAudioMimeType,
  useAudioRecorder
} from '../hooks/useAudioRecorder';

class MockMediaRecorder {
  static isTypeSupported = vi.fn((mimeType: string) =>
    mimeType === 'audio/webm;codecs=opus'
  );

  public state: RecordingState = 'inactive';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;
  public mimeType: string;

  constructor(
    public readonly stream: MediaStream,
    options?: MediaRecorderOptions
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.ondataavailable?.({
      data: new Blob(['voice'], { type: this.mimeType })
    });
    this.state = 'inactive';
    this.onstop?.();
  }
}

describe('useAudioRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockMediaRecorder.isTypeSupported.mockClear();

    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder
    });
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }]
        }))
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects the preferred supported mime type', () => {
    expect(getSupportedAudioMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('stops into a preview blob and fires the threshold once', async () => {
    const onThresholdCrossed = vi.fn();
    const { result } = renderHook(() =>
      useAudioRecorder({
        thresholdSec: 3,
        onThresholdCrossed
      })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.durationSec).toBe(5);
    expect(onThresholdCrossed).toHaveBeenCalledTimes(1);
    expect(onThresholdCrossed).toHaveBeenCalledWith(3);

    await act(async () => {
      await result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioBlob?.type).toBe('audio/webm;codecs=opus');
  });

  it('cancels without keeping a preview blob or duration', async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.durationSec).toBe(2);

    await act(async () => {
      await result.current.cancelRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.durationSec).toBe(0);
  });
});
