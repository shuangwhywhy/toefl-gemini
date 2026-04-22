let sharedAudioCtx: AudioContext | null = null;

export const playBeep = async (freq = 800, duration = 0.1) => {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioContextCtor();
    }

    if (sharedAudioCtx.state === 'suspended') {
      await sharedAudioCtx.resume();
    }

    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, sharedAudioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, sharedAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      sharedAudioCtx.currentTime + duration
    );
    osc.start(sharedAudioCtx.currentTime);
    osc.stop(sharedAudioCtx.currentTime + duration);
    await new Promise((resolve) => window.setTimeout(resolve, duration * 1000));
  } catch (error) {
    console.warn('Beep error:', error);
  }
};
