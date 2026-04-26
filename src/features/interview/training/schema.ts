import { z } from 'zod';
import {
  INTERVIEW_TRAINING_STAGES,
  type InterviewTrainingStage
} from '../types';

export const InterviewTrainingStageSchema = z.enum(INTERVIEW_TRAINING_STAGES);

export const StageStateSchema = z.object({
  status: z.enum([
    'not_started',
    'in_progress',
    'submitted',
    'reviewed',
    'ready',
    'needs_work'
  ]),
  attemptIds: z.array(z.string()),
  latestAttemptId: z.string().optional(),
  latestEvaluationId: z.string().optional(),
  userNotes: z.string().optional(),
  updatedAt: z.string()
});

const stageRecordShape = INTERVIEW_TRAINING_STAGES.reduce(
  (shape, stage) => ({
    ...shape,
    [stage]: StageStateSchema
  }),
  {} as Record<InterviewTrainingStage, typeof StageStateSchema>
);

export const TrainingRecommendationSchema = z.object({
  questionId: z.string(),
  stage: InterviewTrainingStageSchema,
  priority: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
  actionLabel: z.string(),
  createdAt: z.string()
});

export const InterviewTrainingQuestionSchema = z.object({
  id: z.string(),
  index: z.number(),
  role: z.enum([
    'personal_anchor',
    'personal_choice',
    'broad_opinion',
    'future_or_tradeoff'
  ]),
  question: z.string(),
  stages: z.object(stageRecordShape),
  currentStage: InterviewTrainingStageSchema,
  completedStages: z.array(InterviewTrainingStageSchema),
  recommendation: TrainingRecommendationSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const InterviewTrainingSessionSchema = z.object({
  id: z.string(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  topic: z.string(),
  questions: z.array(InterviewTrainingQuestionSchema).length(4),
  activeQuestionId: z.string(),
  activeStage: InterviewTrainingStageSchema,
  globalRecommendation: TrainingRecommendationSchema.optional(),
  status: z.enum(['active', 'archived']),
  metadata: z
    .object({
      source: z.enum([
        'generated',
        'restored',
        'migrated',
        'preload_cache',
        'fresh_generation'
      ]),
      generationPromptVersion: z.string().optional()
    })
    .optional()
});

export const TrainingAttemptSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  questionId: z.string(),
  stage: InterviewTrainingStageSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  inputType: z.enum(['audio', 'text']),
  transcript: z.string().optional(),
  audioBlobId: z.string().optional(),
  durationSec: z.number().optional(),
  selectedUnitIds: z.array(z.string()).optional(),
  evaluationId: z.string().optional(),
  status: z.enum([
    'recorded',
    'transcribed',
    'evaluating',
    'evaluated',
    'failed'
  ])
});

export const StageEvaluationSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  questionId: z.string(),
  stage: InterviewTrainingStageSchema,
  attemptId: z.string(),
  createdAt: z.string(),
  score: z.number(),
  readiness: z.enum(['not_ready', 'almost_ready', 'ready']).optional(),
  mainIssue: z.string(),
  feedbackSummary: z.string(),
  suggestedNextAction: TrainingRecommendationSchema.optional(),
  rawModelOutput: z.string().optional(),
  details: z.unknown()
});

const ModelRecommendationSchema = TrainingRecommendationSchema.extend({
  createdAt: z.string().optional()
});

export const StageEvaluationResultSchema = z.object({
  score: z.number().min(0).max(100),
  readiness: z.enum(['not_ready', 'almost_ready', 'ready']).optional(),
  mainIssue: z.string(),
  feedbackSummary: z.string(),
  suggestedNextAction: ModelRecommendationSchema.optional(),
  details: z.unknown()
});
