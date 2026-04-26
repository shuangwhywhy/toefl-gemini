import { useCallback, useEffect, useRef, useState } from 'react';

export const AUDIO_RECORDER_MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

export function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return undefined;
  }

  return AUDIO_RECORDER_MIME_TYPE_CANDIDATES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType)
  );
}

export function useAudioRecorder(options: {
  enableTimer?: boolean;
  thresholdSec?: number;
  onThresholdCrossed?: (seconds: number) => void;
} = {}) {
  const { enableTimer = true, thresholdSec, onThresholdCrossed } = options;
  const [isRecording, setIsRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const thresholdCrossedRef = useRef(false);
  const selectedMimeTypeRef = useRef<string | undefined>(undefined);

  const cleanupTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startTimer = () => {
    if (!enableTimer) {
      return;
    }

    timerRef.current = window.setInterval(() => {
      setDurationSec((current) => {
        const next = current + 1;
        if (
          thresholdSec &&
          current < thresholdSec &&
          next >= thresholdSec &&
          !thresholdCrossedRef.current
        ) {
          thresholdCrossedRef.current = true;
          onThresholdCrossed?.(next);
        }
        return next;
      });
    }, 1000);
  };

  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    setDurationSec(0);
    cancelledRef.current = false;
    thresholdCrossedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      selectedMimeTypeRef.current = getSupportedAudioMimeType();

      const recorder = selectedMimeTypeRef.current
        ? new MediaRecorder(stream, { mimeType: selectedMimeTypeRef.current })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.start();
      setIsRecording(true);
      startTimer();
    } catch (recordingError) {
      setError(
        String(
          (recordingError as { message?: string })?.message ??
            'Microphone permission was not granted.'
        )
      );
      stopTracks();
    }
  }, [enableTimer, onThresholdCrossed, thresholdSec]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return audioBlob;
    }

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        cleanupTimer();
        stopTracks();
        const finalBlob = new Blob(chunksRef.current, {
          type:
            recorder.mimeType ||
            selectedMimeTypeRef.current ||
            'audio/webm'
        });
        setAudioBlob(finalBlob);
        setIsRecording(false);
        resolve(finalBlob);
      };
      recorder.stop();
    });

    return blob;
  }, [audioBlob]);

  const cancelRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    cancelledRef.current = true;

    if (!recorder || recorder.state === 'inactive') {
      cleanupTimer();
      stopTracks();
      chunksRef.current = [];
      setAudioBlob(null);
      setDurationSec(0);
      setIsRecording(false);
      return;
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        cleanupTimer();
        stopTracks();
        chunksRef.current = [];
        setAudioBlob(null);
        setDurationSec(0);
        setIsRecording(false);
        resolve();
      };
      recorder.stop();
    });
  }, []);

  const resetRecording = useCallback(() => {
    cleanupTimer();
    stopTracks();
    chunksRef.current = [];
    cancelledRef.current = false;
    thresholdCrossedRef.current = false;
    setAudioBlob(null);
    setDurationSec(0);
    setIsRecording(false);
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      cleanupTimer();
      stopTracks();
    };
  }, []);

  return {
    isRecording,
    durationSec,
    audioBlob,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecording,
    error
  };
}
