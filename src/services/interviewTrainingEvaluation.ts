import {
  buildTrainingEvaluationPrompt,
  TRAINING_EVALUATION_RESPONSE_SCHEMA
} from '../prompts/interviewTrainingPrompts';
import {
  INTERVIEW_TRAINING_STAGES,
  type InterviewTrainingQuestion,
  type InterviewTrainingSession,
  type InterviewTrainingStage,
  type QuestionPromptUsage,
  type StageEvaluationResult,
  type TimingWindow,
  type TrainingRecommendation
} from '../features/interview/types';
import type { CrossQuestionTextContext } from '../features/interview/training/interviewTrainingContext';
import { StageEvaluationResultSchema } from '../features/interview/training/schema';
import { buildInlineAudioPartFromBlob } from './audio/multimodal';
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

const asDetailsRecord = (details: unknown): Record<string, unknown> =>
  details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};

const mergeStructuredDetails = (
  result: Pick<
    StageEvaluationResult,
    | 'details'
    | 'displayTranscript'
    | 'displayTranscriptSegments'
    | 'timeAnalysis'
    | 'questionComprehensionAnalysis'
    | 'crossQuestionConsistency'
  >
): Record<string, unknown> => ({
  ...asDetailsRecord(result.details),
  ...(result.displayTranscript
    ? { displayTranscript: result.displayTranscript }
    : {}),
  ...(result.displayTranscriptSegments
    ? { displayTranscriptSegments: result.displayTranscriptSegments }
    : {}),
  ...(result.timeAnalysis ? { timeAnalysis: result.timeAnalysis } : {}),
  ...(result.questionComprehensionAnalysis
    ? { questionComprehensionAnalysis: result.questionComprehensionAnalysis }
    : {}),
  ...(result.crossQuestionConsistency
    ? { crossQuestionConsistency: result.crossQuestionConsistency }
    : {})
});

export async function evaluateInterviewTrainingStage(input: {
  session: InterviewTrainingSession;
  question: InterviewTrainingQuestion;
  stage: InterviewTrainingStage;
  inputType: 'audio' | 'text';
  transcript?: string;
  audioBlob?: Blob;
  durationSec?: number;
  promptUsage?: QuestionPromptUsage;
  timingWindow?: TimingWindow;
  crossQuestionTextContext?: CrossQuestionTextContext | null;
  attemptId: string;
  scopeId: string;
  signal?: AbortSignal | null;
}): Promise<StageEvaluationResult> {
  const promptText = buildTrainingEvaluationPrompt({
    topic: input.session.topic,
    question: input.question,
    stage: input.stage,
    inputType: input.inputType,
    transcript: input.transcript,
    durationSec: input.durationSec,
    promptUsage: input.promptUsage,
    timingWindow: input.timingWindow,
    hasRawAudio: Boolean(input.audioBlob),
    crossQuestionTextContext: input.crossQuestionTextContext
  });
  const parts: Array<Record<string, unknown>> = [{ text: promptText }];
  if (input.audioBlob) {
    parts.push(await buildInlineAudioPartFromBlob(input.audioBlob));
  }
  if (input.crossQuestionTextContext?.promptText) {
    parts.push({ text: input.crossQuestionTextContext.promptText });
  }

  const result = await callStructuredGemini({
    promptOrParts: parts,
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

  if (
    input.inputType === 'audio' &&
    !result.displayTranscript &&
    (!result.displayTranscriptSegments || result.displayTranscriptSegments.length === 0)
  ) {
    throw new Error('Evaluation failed to produce a transcript. Please try again.');
  }

  return {
    ...result,
    score: clampScore(result.score),
    suggestedNextAction: normalizeRecommendation(
      result.suggestedNextAction,
      input.question,
      input.stage
    ),
    details: mergeStructuredDetails(result)
  };
}
