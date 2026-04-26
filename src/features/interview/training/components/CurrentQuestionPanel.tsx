import { MessageSquareText } from 'lucide-react';
import {
  TRAINING_STAGE_DESCRIPTIONS,
  TRAINING_STAGE_LABELS
} from '../../../../prompts/interviewTrainingPrompts';
import type {
  InterviewTrainingQuestion,
  InterviewTrainingStage
} from '../../types';

export function CurrentQuestionPanel({
  topic,
  question,
  stage
}: {
  topic: string;
  question: InterviewTrainingQuestion;
  stage: InterviewTrainingStage;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Topic: {topic}
          </div>
          <h2 className="mt-2 text-lg font-bold leading-snug text-slate-900">
            Q{question.index + 1}. {question.question}
          </h2>
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-bold text-slate-800">
              {TRAINING_STAGE_LABELS[stage]}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {TRAINING_STAGE_DESCRIPTIONS[stage]}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
