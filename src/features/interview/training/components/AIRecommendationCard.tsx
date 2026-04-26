import { ArrowRight, Sparkles } from 'lucide-react';
import { TRAINING_STAGE_LABELS } from '../../../../prompts/interviewTrainingPrompts';
import type { TrainingRecommendation } from '../../types';

export function AIRecommendationCard({
  recommendation,
  onGoToRecommendation
}: {
  recommendation: TrainingRecommendation;
  onGoToRecommendation: (recommendation: TrainingRecommendation) => void;
}) {
  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 text-cyan-700" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wide text-cyan-800">
            Recommended Next
          </div>
          <p className="mt-1 text-sm leading-relaxed text-cyan-950">
            {recommendation.reason}
          </p>
          <button
            type="button"
            onClick={() => onGoToRecommendation(recommendation)}
            className="mt-3 inline-flex items-center rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-800"
          >
            {recommendation.actionLabel ||
              `Go to ${TRAINING_STAGE_LABELS[recommendation.stage]}`}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
