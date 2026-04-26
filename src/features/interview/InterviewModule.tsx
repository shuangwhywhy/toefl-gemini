import { InterviewTrainingMode } from './training/InterviewTrainingMode';

export function InterviewModule({ onBack }: { onBack: () => void }) {
  return <InterviewTrainingMode onBack={onBack} />;
}
