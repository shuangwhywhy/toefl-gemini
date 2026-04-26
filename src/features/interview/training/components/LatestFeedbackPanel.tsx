import { Award, ClipboardList } from 'lucide-react';
import type { StageEvaluation, TrainingRecommendation } from '../../types';
import { AIRecommendationCard } from './AIRecommendationCard';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readDetails = (evaluation: StageEvaluation) =>
  isRecord(evaluation.details) ? evaluation.details : {};

const renderTranscript = (details: Record<string, unknown>) => {
  const segments = details.displayTranscriptSegments;
  if (Array.isArray(segments) && segments.length > 0) {
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Display Transcript
        </div>
        <div className="space-y-2 text-sm leading-relaxed">
          {segments.map((segment, index) => {
            if (!isRecord(segment)) {
              return null;
            }
            const text = typeof segment.text === 'string' ? segment.text : '';
            const afterCutoff = Boolean(segment.afterCutoff);
            const startSec =
              typeof segment.startSec === 'number' ? segment.startSec : 0;
            return (
              <div key={`${index}-${startSec}`}>
                {index > 0 && startSec >= 45 && (
                  <div className="my-2 border-t border-dashed border-rose-300 pt-2 text-[11px] font-bold uppercase tracking-wide text-rose-500">
                    45s cutoff
                  </div>
                )}
                <p
                  className={
                    afterCutoff
                      ? 'text-slate-400 line-through decoration-rose-300'
                      : 'text-slate-700'
                  }
                >
                  {text}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (typeof details.displayTranscript === 'string' && details.displayTranscript) {
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Display Transcript
        </div>
        <p className="text-sm leading-relaxed text-slate-700">
          {details.displayTranscript}
        </p>
      </div>
    );
  }

  return null;
};

const renderStructuredCards = (details: Record<string, unknown>) => {
  const timeAnalysis = isRecord(details.timeAnalysis) ? details.timeAnalysis : null;
  const comprehension = isRecord(details.questionComprehensionAnalysis)
    ? details.questionComprehensionAnalysis
    : null;
  const consistency = isRecord(details.crossQuestionConsistency)
    ? details.crossQuestionConsistency
    : null;

  if (!timeAnalysis && !comprehension && !consistency) {
    return null;
  }

  return (
    <div className="mt-4 grid gap-3">
      {timeAnalysis && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Timing
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {String(timeAnalysis.category ?? 'unknown')} ·{' '}
            {String(timeAnalysis.durationSec ?? '?')}s
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {String(timeAnalysis.pacingAdvice ?? '')}
          </p>
        </div>
      )}

      {comprehension && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Listening Check
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {comprehension.likelyAnsweredFromListening
              ? 'Likely answered from listening'
              : 'May have relied on visible text'}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {String(comprehension.evidence ?? '')}
          </p>
        </div>
      )}

      {consistency && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Cross-question Consistency
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {String(consistency.consistencySummary ?? '')}
          </p>
          {Array.isArray(consistency.contradictions) &&
            consistency.contradictions.length > 0 && (
              <p className="mt-1 text-sm font-semibold text-rose-700">
                {consistency.contradictions.length} contradiction(s) found.
              </p>
            )}
        </div>
      )}
    </div>
  );
};

export function LatestFeedbackPanel({
  evaluation,
  onGoToRecommendation
}: {
  evaluation: StageEvaluation | null;
  onGoToRecommendation: (recommendation: TrainingRecommendation) => void;
}) {
  if (!evaluation) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        No feedback for this stage yet.
      </section>
    );
  }
  const details = readDetails(evaluation);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ClipboardList className="h-4 w-4 text-emerald-600" />
            Latest Feedback
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {evaluation.mainIssue}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {evaluation.feedbackSummary}
          </p>
        </div>
        <div className="flex shrink-0 items-center rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
          <Award className="mr-2 h-4 w-4" />
          <span className="text-lg font-black">{evaluation.score}</span>
          <span className="ml-1 text-xs font-bold">/100</span>
        </div>
      </div>

      {evaluation.suggestedNextAction && (
        <div className="mt-4">
          <AIRecommendationCard
            recommendation={evaluation.suggestedNextAction}
            onGoToRecommendation={onGoToRecommendation}
          />
        </div>
      )}

      {renderTranscript(details)}
      {renderStructuredCards(details)}

      <details className="mt-4 rounded-lg bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-500">
          Detailed Feedback
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
          {JSON.stringify(evaluation.details, null, 2)}
        </pre>
      </details>
    </section>
  );
}
