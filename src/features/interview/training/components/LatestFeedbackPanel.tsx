import { Award, ClipboardList } from 'lucide-react';
import type { StageEvaluation, TrainingRecommendation } from '../../types';
import { AIRecommendationCard } from './AIRecommendationCard';
import { 
  readEvaluationDetails, 
  readTimeAnalysis, 
  readQuestionComprehensionAnalysis, 
  readCrossQuestionConsistency, 
  readTranscriptDetails 
} from './evaluationDetails';
import { TimeAnalysisCard } from './TimeAnalysisCard';
import { QuestionComprehensionCard } from './QuestionComprehensionCard';
import { CrossQuestionConsistencyCard } from './CrossQuestionConsistencyCard';
import { TimedTranscriptView } from './TimedTranscriptView';

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
  
  const details = readEvaluationDetails(evaluation);
  const timeAnalysis = readTimeAnalysis(details);
  const comprehension = readQuestionComprehensionAnalysis(details);
  const consistency = readCrossQuestionConsistency(details);
  const { displayTranscript, displayTranscriptSegments } = readTranscriptDetails(details);
  
  // Using stage for timingEnabled check (timing is strict mainly in thinking_structure and final_practice)
  const timingEnabled = evaluation.stage === 'thinking_structure' || evaluation.stage === 'final_practice';

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

      <div className="mt-4 grid gap-3">
        <TimeAnalysisCard analysis={timeAnalysis} timingEnabled={timingEnabled} />
        <QuestionComprehensionCard analysis={comprehension} />
        <CrossQuestionConsistencyCard consistency={consistency} />
      </div>

      <TimedTranscriptView 
        displayTranscript={displayTranscript} 
        displayTranscriptSegments={displayTranscriptSegments} 
        durationSec={timeAnalysis?.durationSec}
      />

      <details className="mt-4 rounded-lg bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-500">
          Raw Detailed Data
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
          {JSON.stringify(evaluation.details, null, 2)}
        </pre>
      </details>
    </section>
  );
}
