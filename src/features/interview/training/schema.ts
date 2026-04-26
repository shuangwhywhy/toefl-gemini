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

const QuestionPromptUsageStateSchema = z
  .object({
    textVisible: z.boolean().default(false),
    textWasEverShown: z.boolean().default(false),
    listenCount: z.number().default(0),
    playbackStartedCount: z.number().default(0),
    playbackCompletedCount: z.number().default(0)
  })
  .default({
    textVisible: false,
    textWasEverShown: false,
    listenCount: 0,
    playbackStartedCount: 0,
    playbackCompletedCount: 0
  });

const QuestionPromptUsageSchema = z.object({
  textVisibleOnSubmit: z.boolean(),
  textWasEverShown: z.boolean(),
  listenCount: z.number(),
  playbackStartedCount: z.number().optional(),
  playbackCompletedCount: z.number().optional()
});

const QuestionPromptAudioSchema = z.object({
  voice: z.string(),
  audioUrl: z.string().optional(),
  status: z.enum(['idle', 'loading', 'ready', 'failed']).optional()
});

const TimingWindowSchema = z.object({
  enabled: z.boolean(),
  idealStartSec: z.number(),
  idealEndSec: z.number(),
  softMaxSec: z.number(),
  category: z
    .enum(['too_short', 'good', 'slightly_long', 'overtime'])
    .optional()
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
  promptAudio: QuestionPromptAudioSchema.optional(),
  promptUsage: QuestionPromptUsageStateSchema,
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
  answerLanguage: z
    .enum(['zh', 'en', 'mixed', 'unknown'])
    .optional()
    .default('unknown'),
  promptUsage: QuestionPromptUsageSchema.optional(),
  timingWindow: TimingWindowSchema.optional(),
  selectedUnitIds: z.array(z.string()).optional(),
  evaluationId: z.string().optional(),
  status: z.enum([
    'recording',
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

const TranscriptSegmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  afterCutoff: z.boolean()
});

const TimeAnalysisSchema = z.object({
  durationSec: z.number(),
  cutoffSec: z.number(),
  category: z.enum(['too_short', 'good', 'slightly_long', 'overtime']),
  beforeCutoffSummary: z.string(),
  afterCutoffSummary: z.string().optional(),
  pacingAdvice: z.string()
});

const QuestionComprehensionAnalysisSchema = z.object({
  promptTextVisibleOnSubmit: z.boolean(),
  promptTextWasEverShown: z.boolean(),
  promptListenCount: z.number(),
  likelyAnsweredFromListening: z.boolean(),
  evidence: z.string()
});

const CrossQuestionConsistencySchema = z.object({
  includedQuestionIds: z.array(z.string()),
  contradictions: z.array(z.string()),
  consistencySummary: z.string(),
  suggestedFix: z.string()
});

export const StageEvaluationResultSchema = z.object({
  score: z.number().min(0).max(100),
  readiness: z.enum(['not_ready', 'almost_ready', 'ready']).optional(),
  mainIssue: z.string(),
  feedbackSummary: z.string(),
  suggestedNextAction: ModelRecommendationSchema.optional(),
  displayTranscript: z.string().optional(),
  displayTranscriptSegments: z.array(TranscriptSegmentSchema).optional(),
  timeAnalysis: TimeAnalysisSchema.optional(),
  questionComprehensionAnalysis: QuestionComprehensionAnalysisSchema.optional(),
  crossQuestionConsistency: CrossQuestionConsistencySchema.optional(),
  details: z.unknown()
});
