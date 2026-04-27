import { useCallback, useEffect, useRef, useState } from 'react';

export function usePromptAudioPlayer({
  text,
  audioUrl,
  onEnsureAudio,
  onPlaybackStarted,
  onListenCompleted
}: {
  text: string;
  audioUrl?: string;
  onEnsureAudio: () => Promise<string | null>;
  onPlaybackStarted: () => void;
  onListenCompleted: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [rate, setRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightStart, setHighlightStart] = useState(0);
  const [highlightLength, setHighlightLength] = useState(0);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  const resetHighlight = () => {
    setHighlightStart(0);
    setHighlightLength(0);
  };

  const playSimpleSpeech = useCallback(() => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate;
    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      resetHighlight();
      onListenCompleted();
    };
    onPlaybackStarted();
    synth.speak(utterance);
    setIsPlaying(true);
    setIsPaused(false);
  }, [onListenCompleted, onPlaybackStarted, rate, text]);

  const play = useCallback(async () => {
    setError(null);

    if (isPaused) {
      setIsLoading(false);
      if (audioRef.current && audioRef.current.src) {
        try {
          await audioRef.current.play();
          setIsPaused(false);
          setIsPlaying(true);
          return;
        } catch (playError) {
          console.warn('Prompt audio resume blocked:', playError);
        }
      } else {
        window.speechSynthesis.resume();
        setIsPaused(false);
        setIsPlaying(true);
        return;
      }
    }

    setIsLoading(true);
    try {
      const ensuredUrl = audioUrl ?? (await onEnsureAudio());

      if (ensuredUrl && audioRef.current) {
        audioRef.current.src = ensuredUrl;
        audioRef.current.playbackRate = rate;
        try {
          await audioRef.current.play();
          onPlaybackStarted();
          setIsPlaying(true);
          setIsPaused(false);
          return;
        } catch (playError) {
          console.warn('Prompt audio playback blocked:', playError);
          setError('Audio playback was blocked, using system speech instead.');
        }
      }

      playSimpleSpeech();
    } catch (e) {
      console.error('Failed to ensure audio:', e);
      setError('Failed to load audio. Using system speech fallback.');
      playSimpleSpeech();
    } finally {
      setIsLoading(false);
    }
  }, [audioUrl, isPaused, onEnsureAudio, onPlaybackStarted, playSimpleSpeech, rate]);

  const pause = useCallback(() => {
    if (audioRef.current && isPlaying && audioRef.current.src) {
      audioRef.current.pause();
    } else if (isPlaying) {
      window.speechSynthesis.pause();
    }
    setIsPaused(true);
    setIsPlaying(false);
    setIsLoading(false);
  }, [isPlaying]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setIsLoading(false);
    resetHighlight();
  }, []);

  const replay = useCallback(async () => {
    stop();
    await play();
  }, [play, stop]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    resetHighlight();
    onListenCompleted();
  }, [onListenCompleted]);

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current || !isPlaying || !text) {
      return;
    }

    const { currentTime, duration } = audioRef.current;
    if (duration > 0.25) {
      const adjustedTime = Math.max(0, currentTime - 0.25);
      const targetIndex = Math.floor(
        (adjustedTime / Math.max(0.25, duration - 0.25)) * text.length
      );
      let start = targetIndex;
      while (start > 0 && !/\s/.test(text[start - 1])) {
        start -= 1;
      }
      let end = targetIndex;
      while (end < text.length && !/\s/.test(text[end])) {
        end += 1;
      }
      setHighlightStart(Math.max(0, start));
      setHighlightLength(Math.min(text.length, end) - start);
    }
  }, [isPlaying, text]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    audioRef,
    rate,
    setRate,
    isPlaying,
    isPaused,
    isLoading,
    error,
    highlightStart,
    highlightLength,
    play,
    pause,
    stop,
    replay,
    handleEnded,
    handleTimeUpdate
  };
}
