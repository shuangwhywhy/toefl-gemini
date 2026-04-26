import type { TimeAnalysis } from '../../types';

export type TimeAnalysisCardProps = {
  analysis: TimeAnalysis | null;
  timingEnabled?: boolean;
};

const getCategoryLabel = (category?: string) => {
  switch (category) {
    case 'too_short': return 'Build toward 35s';
    case 'good': return 'Ideal window';
    case 'slightly_long': return 'Wrap it up';
    case 'overtime': return 'Over 45s';
    default: return 'Unknown';
  }
};

export function TimeAnalysisCard({ analysis, timingEnabled = true }: TimeAnalysisCardProps) {
  if (!analysis) return null;

  if (!timingEnabled) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Timing
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-800">
          {analysis.durationSec}s
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          {analysis.pacingAdvice}
        </p>
        <p className="mt-1 text-xs text-slate-400 italic">
          * Strict timing is not enforced for this stage.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Timing
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-800">
        {getCategoryLabel(analysis.category)} · {analysis.durationSec}s
      </p>
      
      {analysis.beforeCutoffSummary && (
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          <span className="font-semibold mr-1">Before 45s:</span>
          {analysis.beforeCutoffSummary}
        </p>
      )}
      
      {analysis.afterCutoffSummary && (
        <p className="mt-1 text-sm leading-relaxed text-rose-700">
          <span className="font-semibold mr-1">After 45s:</span>
          {analysis.afterCutoffSummary}
        </p>
      )}
      
      {analysis.pacingAdvice && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-sm leading-relaxed text-slate-600">
            <span className="font-semibold mr-1">Pacing advice:</span>
            {analysis.pacingAdvice}
          </p>
        </div>
      )}
    </div>
  );
}
