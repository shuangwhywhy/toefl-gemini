import type { CrossQuestionConsistency } from '../../types';

export type CrossQuestionConsistencyCardProps = {
  consistency: CrossQuestionConsistency | null;
};

export function CrossQuestionConsistencyCard({ consistency }: CrossQuestionConsistencyCardProps) {
  if (!consistency) return null;

  // Using includedQuestionIds to strictly determine context availability
  const hasContext = Array.isArray(consistency.includedQuestionIds) && consistency.includedQuestionIds.length > 0;

  if (!hasContext) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Cross-question Consistency
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Cross-question consistency will appear after other answered questions are available.
        </p>
      </div>
    );
  }

  const hasContradictions = Array.isArray(consistency.contradictions) && consistency.contradictions.length > 0;

  if (!hasContradictions) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Cross-question Consistency
        </div>
        <p className="mt-1 text-sm font-semibold text-emerald-700">
          No obvious contradictions across answered questions.
        </p>
        {consistency.consistencySummary && (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {consistency.consistencySummary}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Cross-question Consistency
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        {consistency.consistencySummary}
      </p>
      <div className="mt-3">
        <p className="text-sm font-semibold text-rose-700">
          Contradictions found:
        </p>
        <ul className="mt-1 list-disc list-inside text-sm text-slate-700 space-y-1">
          {consistency.contradictions.map((contradiction, index) => (
            <li key={index}>{contradiction}</li>
          ))}
        </ul>
      </div>
      {consistency.suggestedFix && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-sm leading-relaxed text-slate-600">
            <span className="font-semibold mr-1">Suggested fix:</span>
            {consistency.suggestedFix}
          </p>
        </div>
      )}
    </div>
  );
}
