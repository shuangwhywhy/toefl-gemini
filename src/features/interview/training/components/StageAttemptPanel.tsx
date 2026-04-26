import { TRAINING_STAGE_LABELS } from '../../../../prompts/interviewTrainingPrompts';
import type { InterviewTrainingStage } from '../../types';
import { TextFallbackPanel } from './TextFallbackPanel';
import { VoiceAnswerRecorder } from './VoiceAnswerRecorder';

export function StageAttemptPanel({
  stage,
  isSubmitting,
  onSubmit,
  onSubmitAudio
}: {
  stage: InterviewTrainingStage;
  isSubmitting: boolean;
  onSubmit: (transcript: string) => Promise<void>;
  onSubmitAudio: (audioBlob: Blob, durationSec: number) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-900">
          Practice {TRAINING_STAGE_LABELS[stage]}
        </h3>
      </div>

      <div className="space-y-3">
        <VoiceAnswerRecorder
          stage={stage}
          isSubmitting={isSubmitting}
          onSubmitAudio={onSubmitAudio}
        />
        <TextFallbackPanel isSubmitting={isSubmitting} onSubmit={onSubmit} />
      </div>
    </section>
  );
}
