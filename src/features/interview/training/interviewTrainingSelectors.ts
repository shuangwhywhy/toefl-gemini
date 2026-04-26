import type {
  InterviewTrainingSession,
  InterviewTrainingStage,
  StageEvaluation,
  TrainingAttempt
} from '../types';

export const getActiveQuestion = (session: InterviewTrainingSession | null) => {
  if (!session) {
    return null;
  }
  return (
    session.questions.find((question) => question.id === session.activeQuestionId) ??
    session.questions[0] ??
    null
  );
};

export const getStageState = (
  session: InterviewTrainingSession | null,
  questionId: string | null,
  stage: InterviewTrainingStage | null
) => {
  if (!session || !questionId || !stage) {
    return null;
  }
  const question = session.questions.find((entry) => entry.id === questionId);
  return question?.stages[stage] ?? null;
};

export const getAttemptsForActiveStage = (
  session: InterviewTrainingSession | null,
  attempts: TrainingAttempt[]
) => {
  const question = getActiveQuestion(session);
  if (!session || !question) {
    return [];
  }

  return attempts
    .filter(
      (attempt) =>
        attempt.sessionId === session.id &&
        attempt.questionId === question.id &&
        attempt.stage === session.activeStage
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

export const getLatestEvaluationForActiveStage = (
  session: InterviewTrainingSession | null,
  evaluations: StageEvaluation[]
) => {
  const question = getActiveQuestion(session);
  const stageState = getStageState(
    session,
    question?.id ?? null,
    session?.activeStage ?? null
  );

  if (!stageState) {
    return null;
  }

  if (stageState.latestEvaluationId) {
    return (
      evaluations.find(
        (evaluation) => evaluation.id === stageState.latestEvaluationId
      ) ?? null
    );
  }

  if (stageState.latestAttemptId) {
    return (
      evaluations.find(
        (evaluation) => evaluation.attemptId === stageState.latestAttemptId
      ) ?? null
    );
  }

  return null;
};
