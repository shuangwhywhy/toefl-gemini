import { Clock3, RefreshCcw } from 'lucide-react';
import { TRAINING_STAGE_LABELS } from '../../../../prompts/interviewTrainingPrompts';
import type { TrainingAttempt } from '../../types';

export function AttemptHistory({
  attempts,
  onRetryAttempt
}: {
  attempts: TrainingAttempt[];
  onRetryAttempt?: (attemptId: string) => void;
}) {
  if (attempts.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <Clock3 className="h-4 w-4 text-slate-500" />
        Attempt History
      </div>
      <div className="space-y-3">
        {attempts.slice(0, 6).map((attempt) => (
          <div key={attempt.id} className="rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-bold text-slate-700">
                {TRAINING_STAGE_LABELS[attempt.stage]}
              </span>
              <div className="flex items-center gap-2">
                {attempt.status === 'failed' && onRetryAttempt && (
                  <button
                    onClick={() => onRetryAttempt(attempt.id)}
                    className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 font-bold text-rose-700 hover:bg-rose-100"
                  >
                    <RefreshCcw className="h-3 w-3" />
                    Retry Eval
                  </button>
                )}
                <span>{new Date(attempt.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-700">
              {attempt.transcript ||
                (attempt.inputType === 'audio'
                  ? `Audio answer${attempt.durationSec ? ` · ${attempt.durationSec}s` : ''}`
                  : '(No transcript)')}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
