import {
  buildTrainingEvaluationPrompt,
  TRAINING_EVALUATION_RESPONSE_SCHEMA
} from '../prompts/interviewTrainingPrompts';
import {
  INTERVIEW_TRAINING_STAGES,
  type InterviewTrainingQuestion,
  type InterviewTrainingSession,
  type InterviewTrainingStage,
  type StageEvaluationResult,
  type TrainingRecommendation
} from '../features/interview/types';
import { StageEvaluationResultSchema } from '../features/interview/training/schema';
import { callStructuredGemini } from './callStructuredGemini';

const clampScore = (score: number) =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(score) ? score : 0)));

const normalizeRecommendation = (
  recommendation: Partial<TrainingRecommendation> | undefined,
  question: InterviewTrainingQuestion,
  stage: InterviewTrainingStage
): TrainingRecommendation | undefined => {
  if (!recommendation?.reason || !recommendation?.actionLabel) {
    return undefined;
  }

  const nextStage = INTERVIEW_TRAINING_STAGES.includes(
    recommendation.stage as InterviewTrainingStage
  )
    ? (recommendation.stage as InterviewTrainingStage)
    : stage;

  return {
    questionId: recommendation.questionId || question.id,
    stage: nextStage,
    priority: recommendation.priority ?? 'medium',
    reason: recommendation.reason,
    actionLabel: recommendation.actionLabel,
    createdAt: recommendation.createdAt ?? new Date().toISOString()
  };
};

export async function evaluateInterviewTrainingStage(input: {
  session: InterviewTrainingSession;
  question: InterviewTrainingQuestion;
  stage: InterviewTrainingStage;
  transcript: string;
  durationSec?: number;
  attemptId: string;
  scopeId: string;
  signal?: AbortSignal | null;
}): Promise<StageEvaluationResult> {
  const result = await callStructuredGemini({
    promptOrParts: buildTrainingEvaluationPrompt({
      topic: input.session.topic,
      question: input.question,
      stage: input.stage,
      transcript: input.transcript,
      durationSec: input.durationSec
    }),
    responseSchema: TRAINING_EVALUATION_RESPONSE_SCHEMA,
    zodSchema: StageEvaluationResultSchema,
    scopeId: input.scopeId,
    supersedeKey: [
      'interview-training',
      input.session.id,
      input.question.id,
      input.stage,
      'evaluation'
    ].join(':'),
    signal: input.signal ?? null,
    temperature: 0.35,
    maxOutputTokens: 2600,
    requestOptions: {
      businessContext: {
        task: 'interview-training-evaluation',
        sessionId: input.session.id,
        questionId: input.question.id,
        stage: input.stage,
        attemptId: input.attemptId
      }
    }
  });

  return {
    ...result,
    score: clampScore(result.score),
    suggestedNextAction: normalizeRecommendation(
      result.suggestedNextAction,
      input.question,
      input.stage
    ),
    details: result.details ?? {}
  };
}
