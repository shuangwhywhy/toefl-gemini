import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockAudioContext = {
  state: 'suspended',
  resume: vi.fn().mockResolvedValue(undefined),
  createOscillator: vi.fn(),
  createGain: vi.fn().mockReturnValue({
    connect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    }
  }),
  destination: {},
  currentTime: 10
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));
vi.stubGlobal('webkitAudioContext', vi.fn(() => mockAudioContext));

import { playBeep } from '../services/audio/playback';

describe('Audio Playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioContext.createOscillator.mockReturnValue({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() }
    });
  });

  it('plays a beep by initializing and resuming AudioContext', async () => {
    await playBeep(1000, 0.2);
    
    expect(mockAudioContext.resume).toHaveBeenCalled();
    // Since sharedAudioCtx is cached, we check if createOscillator was called
    // (It will be called if it was null before or if the mock persists)
    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
  });

  it('handles errors gracefully', async () => {
    // If playBeep already has sharedAudioCtx, it will use it.
    // We can mock the methods ON the object we know it has or will have.
    mockAudioContext.createOscillator.mockImplementation(() => {
      throw new Error('Web Audio Error');
    });
    
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await playBeep();
    
    // We might need to wait for the catch block
    expect(consoleSpy).toHaveBeenCalledWith('Beep error:', expect.any(Error));
  });

  it('skips if AudioContext is not supported', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    
    await playBeep();
    // No error thrown, just returns
  });
});
