import { CheckCircle2 } from 'lucide-react';
import type { InterviewTrainingSession } from '../../types';

export function QuestionSwitcher({
  session,
  onSelect
}: {
  session: InterviewTrainingSession;
  onSelect: (questionId: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {session.questions.map((question) => {
        const reviewedCount = Object.values(question.stages).filter(
          (stage) => stage.status === 'reviewed' || stage.status === 'ready'
        ).length;
        const isActive = question.id === session.activeQuestionId;

        return (
          <button
            key={question.id}
            type="button"
            onClick={() => onSelect(question.id)}
            className={`text-left rounded-lg border px-3 py-3 transition-colors ${
              isActive
                ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide">
                Q{question.index + 1}
              </span>
              {reviewedCount > 0 && (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-snug">
              {question.question}
            </p>
          </button>
        );
      })}
    </div>
  );
}
