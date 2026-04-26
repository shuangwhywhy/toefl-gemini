import type {
  InterviewTrainingQuestion,
  InterviewTrainingSession,
  InterviewTrainingStage,
  StageEvaluation,
  TrainingAttempt
} from '../types';

export type CrossQuestionAnswerTextSource =
  | 'display_transcript'
  | 'transcript_segments'
  | 'text_fallback';

export type CrossQuestionAnswerContext = {
  questionId: string;
  questionIndex: number;
  questionText: string;
  selectedStage: InterviewTrainingStage;
  selectedAttemptId: string;
  answerLanguage?: TrainingAttempt['answerLanguage'];
  durationSec?: number;
  promptUsage?: TrainingAttempt['promptUsage'];
  answerText: string;
  answerTextSource: CrossQuestionAnswerTextSource;
};

export type CrossQuestionTextContext = {
  entries: CrossQuestionAnswerContext[];
  promptText: string;
};

const CROSS_QUESTION_CONTEXT_STAGES = new Set<InterviewTrainingStage>([
  'thinking_structure',
  'final_practice'
]);

export function shouldIncludeCrossQuestionContext(stage: InterviewTrainingStage) {
  return CROSS_QUESTION_CONTEXT_STAGES.has(stage);
}

const getPreferredStages = (
  currentStage: InterviewTrainingStage
): InterviewTrainingStage[] => {
  if (currentStage === 'thinking_structure') {
    return ['thinking_structure', 'final_practice'];
  }
  if (currentStage === 'final_practice') {
    return ['final_practice', 'thinking_structure'];
  }
  return [];
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const findEvaluationForAttempt = (
  evaluations: StageEvaluation[],
  attemptId: string
) => evaluations.find((evaluation) => evaluation.attemptId === attemptId);

const extractAnswerText = (
  attempt: TrainingAttempt,
  evaluation?: StageEvaluation
): { text: string; source: CrossQuestionAnswerTextSource } | null => {
  const details = isPlainRecord(evaluation?.details) ? evaluation.details : {};
  const displayTranscript = details.displayTranscript;
  if (typeof displayTranscript === 'string' && displayTranscript.trim()) {
    return {
      text: displayTranscript.trim(),
      source: 'display_transcript'
    };
  }

  const displayTranscriptSegments = details.displayTranscriptSegments;
  if (Array.isArray(displayTranscriptSegments)) {
    const text = displayTranscriptSegments
      .map((segment) =>
        isPlainRecord(segment) && typeof segment.text === 'string'
          ? segment.text.trim()
          : ''
      )
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text) {
      return {
        text,
        source: 'transcript_segments'
      };
    }
  }

  if (attempt.transcript?.trim()) {
    return {
      text: attempt.transcript.trim(),
      source: 'text_fallback'
    };
  }

  return null;
};

const isEligibleAttempt = (
  attempt: TrainingAttempt,
  extractedText: { text: string; source: CrossQuestionAnswerTextSource } | null
) => {
  if (!extractedText?.text) {
    return false;
  }

  const allowedStatus =
    attempt.status === 'evaluating' || attempt.status === 'evaluated';
  if (!allowedStatus) {
    return false;
  }

  if (attempt.inputType === 'text') {
    return true;
  }

  return Boolean(attempt.durationSec && attempt.durationSec > 0);
};

export function selectOneCompleteAnswerPerOtherQuestion(input: {
  session: InterviewTrainingSession;
  currentQuestionId: string;
  currentStage: InterviewTrainingStage;
  attempts: TrainingAttempt[];
  evaluations: StageEvaluation[];
}): CrossQuestionAnswerContext[] {
  if (!shouldIncludeCrossQuestionContext(input.currentStage)) {
    return [];
  }

  const preferredStages = getPreferredStages(input.currentStage);
  return input.session.questions
    .filter((question) => question.id !== input.currentQuestionId)
    .map((question) =>
      selectAnswerForQuestion({
        question,
        stages: preferredStages,
        attempts: input.attempts,
        evaluations: input.evaluations
      })
    )
    .filter((entry): entry is CrossQuestionAnswerContext => Boolean(entry));
}

function selectAnswerForQuestion({
  question,
  stages,
  attempts,
  evaluations
}: {
  question: InterviewTrainingQuestion;
  stages: InterviewTrainingStage[];
  attempts: TrainingAttempt[];
  evaluations: StageEvaluation[];
}): CrossQuestionAnswerContext | null {
  for (const stage of stages) {
    const candidates = attempts
      .filter(
        (attempt) => attempt.questionId === question.id && attempt.stage === stage
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    for (const attempt of candidates) {
      const evaluation = findEvaluationForAttempt(evaluations, attempt.id);
      const extracted = extractAnswerText(attempt, evaluation);
      if (!isEligibleAttempt(attempt, extracted)) {
        continue;
      }

      return {
        questionId: question.id,
        questionIndex: question.index,
        questionText: question.question,
        selectedStage: stage,
        selectedAttemptId: attempt.id,
        answerLanguage: attempt.answerLanguage,
        durationSec: attempt.durationSec,
        promptUsage: attempt.promptUsage,
        answerText: extracted.text,
        answerTextSource: extracted.source
      };
    }
  }

  return null;
}

export function buildCrossQuestionTextContext(input: {
  session: InterviewTrainingSession;
  currentQuestionId: string;
  currentStage: InterviewTrainingStage;
  attempts: TrainingAttempt[];
  evaluations: StageEvaluation[];
}): CrossQuestionTextContext | null {
  const entries = selectOneCompleteAnswerPerOtherQuestion(input);
  if (entries.length === 0) {
    return null;
  }

  const promptText = [
    'Cross-question context from other answered interview questions.',
    'Use this only for consistency analysis. These are text versions of other answers, not current-answer input.',
    ...entries.map(
      (entry) =>
        `Q${entry.questionIndex + 1} (${entry.selectedStage}, ${entry.answerTextSource})\nQuestion: ${entry.questionText}\nAnswer: ${entry.answerText}`
    )
  ].join('\n\n');

  return {
    entries,
    promptText
  };
}
