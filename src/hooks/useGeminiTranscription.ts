import { useCallback, useState } from 'react';
import { requestTranscription } from '../services/llm/helpers';

export function useGeminiTranscription({ scopeId }: { scopeId: string }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribeAudio = useCallback(
    async (options: {
      audioBlob: Blob;
      prompt: string;
      supersedeKey: string;
    }) => {
      setIsTranscribing(true);
      setError(null);
      try {
        return await requestTranscription({
          audioBlob: options.audioBlob,
          prompt: options.prompt,
          scopeId,
          supersedeKey: options.supersedeKey
        });
      } catch (transcriptionError) {
        setError(
          String(
            (transcriptionError as { message?: string })?.message ??
              'Transcription failed.'
          )
        );
        throw transcriptionError;
      } finally {
        setIsTranscribing(false);
      }
    },
    [scopeId]
  );

  return {
    transcribeAudio,
    isTranscribing,
    error
  };
}
