import { Mic, RefreshCw, RotateCcw, Send, Square, Trash2, X } from 'lucide-react';
import { playBeep } from '../../../../services/audio/playback';
import { useAudioRecorder } from '../../../../hooks/useAudioRecorder';
import { useObjectUrl } from '../hooks/useObjectUrl';
import {
  getTimedAnswerPresentation,
  isTimedInterviewStage
} from '../useTimedAnswer';
import type { InterviewTrainingStage } from '../../types';

const formatSeconds = (seconds: number) => `${seconds}s`;

export function VoiceAnswerRecorder({
  stage,
  isSubmitting,
  onSubmitAudio
}: {
  stage: InterviewTrainingStage;
  isSubmitting: boolean;
  onSubmitAudio: (audioBlob: Blob, durationSec: number) => Promise<void>;
}) {
  const isTimed = isTimedInterviewStage(stage);
  const {
    isRecording,
    durationSec,
    audioBlob,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecording,
    error
  } = useAudioRecorder({
    enableTimer: true,
    thresholdSec: isTimed ? 45 : undefined,
    onThresholdCrossed: isTimed ? () => void playBeep(220, 0.18) : undefined
  });
  const audioUrl = useObjectUrl(audioBlob);
  const timing = getTimedAnswerPresentation(durationSec);

  const handleSubmit = async () => {
    if (!audioBlob || isSubmitting) {
      return;
    }
    await onSubmitAudio(audioBlob, durationSec);
    resetRecording();
  };

  const handleRetake = async () => {
    resetRecording();
    await startRecording();
  };

  return (
    <section className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-slate-900">Voice answer</h4>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Record your spoken response, preview it, then submit the audio.
            </p>
          </div>
          {isTimed && (
            <div
              className={`rounded-lg border px-3 py-2 text-right ${timing.className}`}
            >
              <div className="text-lg font-black tabular-nums">
                {formatSeconds(durationSec)}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide">
                {timing.label}
              </div>
            </div>
          )}
        </div>

        {!isRecording && !audioBlob && (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={isSubmitting}
            className="inline-flex min-h-14 items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-base font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic className="mr-2 h-5 w-5" />
            Start recording
          </button>
        )}

        {isRecording && (
          <div className="rounded-lg border border-rose-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex items-center text-sm font-bold text-rose-700">
                <span className="mr-2 h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                Recording {formatSeconds(durationSec)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void stopRecording()}
                className="inline-flex items-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700"
              >
                <Square className="mr-2 h-4 w-4 fill-current" />
                Finish
              </button>
              <button
                type="button"
                onClick={() => void cancelRecording()}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isRecording && audioBlob && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">
                Recording ready
                <span className="ml-2 text-xs font-semibold text-slate-500">
                  {formatSeconds(durationSec)}
                </span>
              </div>
            </div>
            {audioUrl && <audio controls src={audioUrl} className="mb-3 w-full" />}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className="inline-flex items-center rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? 'Evaluating...' : 'Submit audio'}
              </button>
              <button
                type="button"
                onClick={() => void handleRetake()}
                disabled={isSubmitting}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Retake
              </button>
              <button
                type="button"
                onClick={resetRecording}
                disabled={isSubmitting}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Discard
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </section>
  );
}
