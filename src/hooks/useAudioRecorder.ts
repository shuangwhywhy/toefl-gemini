import { useCallback, useEffect, useRef, useState } from 'react';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

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

  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    setDurationSec(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.start();
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setDurationSec((current) => current + 1);
      }, 1000);
    } catch (recordingError) {
      setError(
        String(
          (recordingError as { message?: string })?.message ??
            'Microphone permission was not granted.'
        )
      );
      stopTracks();
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return audioBlob;
    }

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        cleanupTimer();
        stopTracks();
        const finalBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(finalBlob);
        setIsRecording(false);
        resolve(finalBlob);
      };
      recorder.stop();
    });

    return blob;
  }, [audioBlob]);

  const resetRecording = useCallback(() => {
    cleanupTimer();
    stopTracks();
    chunksRef.current = [];
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
    resetRecording,
    error
  };
}
