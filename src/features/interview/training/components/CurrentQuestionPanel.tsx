import { MessageSquareText } from 'lucide-react';
import { PromptAudioPanel } from '../../../shared/audio/PromptAudioPanel';
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
  stage,
  onPromptUsageChange,
  onEnsurePromptAudio
}: {
  topic: string;
  question: InterviewTrainingQuestion;
  stage: InterviewTrainingStage;
  onPromptUsageChange: (
    questionId: string,
    update: Partial<InterviewTrainingQuestion['promptUsage']>
  ) => void;
  onEnsurePromptAudio: (questionId: string) => Promise<string | null>;
}) {
  const promptUsage = question.promptUsage;

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
            Q{question.index + 1}. Listen to the interviewer prompt
          </h2>
          <div className="mt-4">
            <PromptAudioPanel
              text={question.question}
              showText={promptUsage.textVisible}
              listenCount={promptUsage.listenCount}
              audioUrl={question.promptAudio?.audioUrl}
              audioStatus={question.promptAudio?.status}
              onShowTextChange={(showText) =>
                onPromptUsageChange(question.id, {
                  textVisible: showText,
                  textWasEverShown:
                    promptUsage.textWasEverShown || showText
                })
              }
              onEnsureAudio={() => onEnsurePromptAudio(question.id)}
              onPlaybackStarted={() =>
                onPromptUsageChange(question.id, {
                  playbackStartedCount:
                    promptUsage.playbackStartedCount + 1
                })
              }
              onListenCompleted={() =>
                onPromptUsageChange(question.id, {
                  listenCount: promptUsage.listenCount + 1,
                  playbackCompletedCount:
                    promptUsage.playbackCompletedCount + 1
                })
              }
            />
          </div>
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
