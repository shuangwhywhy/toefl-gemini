import { FormEvent, useState } from 'react';
import { Mic, RefreshCw, RotateCcw, Send, Square } from 'lucide-react';
import { TRAINING_STAGE_LABELS } from '../../../../prompts/interviewTrainingPrompts';
import type { InterviewTrainingStage } from '../../types';
import { useAudioRecorder } from '../../../../hooks/useAudioRecorder';
import { useObjectUrl } from '../hooks/useObjectUrl';

export function StageAttemptPanel({
  stage,
  isSubmitting,
  isTranscribing,
  onSubmit,
  onSubmitAudio
}: {
  stage: InterviewTrainingStage;
  isSubmitting: boolean;
  isTranscribing: boolean;
  onSubmit: (transcript: string) => Promise<void>;
  onSubmitAudio: (audioBlob: Blob, durationSec: number) => Promise<void>;
}) {
  const [transcript, setTranscript] = useState('');
  const {
    isRecording,
    durationSec,
    audioBlob,
    startRecording,
    stopRecording,
    resetRecording,
    error
  } = useAudioRecorder();
  const audioUrl = useObjectUrl(audioBlob);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = transcript.trim();
    if (!trimmed || isSubmitting) {
      return;
    }

    await onSubmit(trimmed);
    setTranscript('');
  };

  const handleSubmitAudio = async () => {
    if (!audioBlob || isSubmitting || isTranscribing) {
      return;
    }
    await onSubmitAudio(audioBlob, durationSec);
    resetRecording();
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Practice {TRAINING_STAGE_LABELS[stage]}
          </h3>
        </div>
      </div>
      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        rows={7}
        placeholder="Type what you would say for this stage..."
        className="min-h-40 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
      />
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={!transcript.trim() || isSubmitting}
          className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {isSubmitting ? 'Evaluating...' : 'Submit Attempt'}
        </button>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {!isRecording ? (
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={isSubmitting || isTranscribing}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mic className="mr-2 h-4 w-4" />
              Record
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stopRecording()}
              className="inline-flex items-center rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700"
            >
              <Square className="mr-2 h-4 w-4 fill-current" />
              Stop {durationSec}s
            </button>
          )}

          {audioBlob && (
            <>
              <button
                type="button"
                onClick={() => void handleSubmitAudio()}
                disabled={isSubmitting || isTranscribing}
                className="inline-flex items-center rounded-lg bg-cyan-700 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isTranscribing ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isTranscribing ? 'Transcribing...' : 'Submit Recording'}
              </button>
              <button
                type="button"
                onClick={resetRecording}
                disabled={isSubmitting || isTranscribing}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </button>
            </>
          )}
        </div>
        {audioUrl && (
          <audio controls src={audioUrl} className="mt-3 w-full" />
        )}
        {error && (
          <p className="mt-2 text-sm text-rose-600">{error}</p>
        )}
      </div>
    </form>
  );
}
