import type { QuestionComprehensionAnalysis } from '../../types';

export type QuestionComprehensionCardProps = {
  analysis: QuestionComprehensionAnalysis | null;
};

export function QuestionComprehensionCard({ analysis }: QuestionComprehensionCardProps) {
  if (!analysis) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Listening Check
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-800">
        {analysis.likelyAnsweredFromListening
          ? 'Likely answered from listening'
          : 'May have relied on visible text'}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        {analysis.evidence}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-2">
        <div>
          <span className="font-semibold mr-1">Prompt text visible on submit:</span>
          {analysis.promptTextVisibleOnSubmit ? 'Yes' : 'No'}
        </div>
        <div>
          <span className="font-semibold mr-1">Prompt was ever shown:</span>
          {analysis.promptTextWasEverShown ? 'Yes' : 'No'}
        </div>
        <div className="sm:col-span-2">
          <span className="font-semibold mr-1">Completed listens:</span>
          {analysis.promptListenCount}
        </div>
      </div>
    </div>
  );
}
