import type {
  InterviewTrainingStage,
  TimingWindow
} from '../types';

export const TIMED_INTERVIEW_STAGES = new Set<InterviewTrainingStage>([
  'thinking_structure',
  'final_practice'
]);

export const TIMING_POLICY = {
  idealStartSec: 35,
  idealEndSec: 40,
  softMaxSec: 45
} as const;

export function isTimedInterviewStage(stage: InterviewTrainingStage) {
  return TIMED_INTERVIEW_STAGES.has(stage);
}

export function getTimedAnswerCategory(seconds: number): NonNullable<TimingWindow['category']> {
  if (seconds < TIMING_POLICY.idealStartSec) {
    return 'too_short';
  }
  if (seconds < TIMING_POLICY.idealEndSec) {
    return 'good';
  }
  if (seconds <= TIMING_POLICY.softMaxSec) {
    return 'slightly_long';
  }
  return 'overtime';
}

export function createTimingWindow(
  stage: InterviewTrainingStage,
  durationSec?: number
): TimingWindow {
  const enabled = isTimedInterviewStage(stage);
  return {
    enabled,
    ...TIMING_POLICY,
    category:
      enabled && typeof durationSec === 'number'
        ? getTimedAnswerCategory(durationSec)
        : undefined
  };
}

export function getTimedAnswerPresentation(seconds: number) {
  const category = getTimedAnswerCategory(seconds);
  if (category === 'too_short') {
    return {
      category,
      label: 'Build toward 35s',
      className: 'border-lime-200 bg-lime-50 text-lime-800'
    };
  }
  if (category === 'good') {
    return {
      category,
      label: 'Ideal window',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800'
    };
  }
  if (category === 'slightly_long') {
    return {
      category,
      label: 'Wrap it up',
      className: 'border-orange-200 bg-orange-50 text-orange-800'
    };
  }
  return {
    category,
    label: 'Over 45s',
    className: 'border-rose-200 bg-rose-50 text-rose-800'
  };
}
