import { TRAINING_STAGE_LABELS, STAGE_ORDER } from '../../../../prompts/interviewTrainingPrompts';
import type { InterviewTrainingStage, StageState } from '../../types';

const statusTone: Record<StageState['status'], string> = {
  not_started: 'bg-slate-200',
  in_progress: 'bg-blue-400',
  submitted: 'bg-amber-400',
  reviewed: 'bg-emerald-500',
  ready: 'bg-emerald-500',
  needs_work: 'bg-rose-400'
};

export function StageSwitcher({
  activeStage,
  stages,
  onSelect
}: {
  activeStage: InterviewTrainingStage;
  stages: Record<InterviewTrainingStage, StageState>;
  onSelect: (stage: InterviewTrainingStage) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {STAGE_ORDER.map((stage) => {
        const isActive = activeStage === stage;
        return (
          <button
            key={stage}
            type="button"
            onClick={() => onSelect(stage)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              isActive
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <span
              className={`mr-2 inline-block h-2 w-2 rounded-full ${statusTone[stages[stage].status]}`}
            />
            {TRAINING_STAGE_LABELS[stage]}
          </button>
        );
      })}
    </div>
  );
}
