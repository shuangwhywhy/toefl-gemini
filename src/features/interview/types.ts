import type { InterviewQuestionRole } from './interviewGeneration';

export const INTERVIEW_TRAINING_STAGES = [
  'thinking_structure',
  'english_units',
  'full_english_answer',
  'vocabulary_upgrade',
  'final_practice'
] as const;

export type InterviewTrainingStage = (typeof INTERVIEW_TRAINING_STAGES)[number];

export type StageStatus =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'reviewed'
  | 'ready'
  | 'needs_work';

export type TrainingRecommendation = {
  questionId: string;
  stage: InterviewTrainingStage;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  actionLabel: string;
  createdAt: string;
};

export type QuestionPromptUsage = {
  textVisibleOnSubmit: boolean;
  textWasEverShown: boolean;
  listenCount: number;
  playbackStartedCount?: number;
  playbackCompletedCount?: number;
};

export type QuestionPromptUsageState = {
  textVisible: boolean;
  textWasEverShown: boolean;
  listenCount: number;
  playbackStartedCount: number;
  playbackCompletedCount: number;
};

export type QuestionPromptAudio = {
  voice: string;
  audioUrl?: string;
  status?: 'idle' | 'loading' | 'ready' | 'failed';
};

export type TimingWindow = {
  enabled: boolean;
  idealStartSec: number;
  idealEndSec: number;
  softMaxSec: number;
  category?: 'too_short' | 'good' | 'slightly_long' | 'overtime';
};

export type StageState = {
  status: StageStatus;
  attemptIds: string[];
  latestAttemptId?: string;
  latestEvaluationId?: string;
  userNotes?: string;
  updatedAt: string;
};

export type InterviewTrainingQuestion = {
  id: string;
  index: number;
  role: InterviewQuestionRole;
  question: string;
  promptAudio?: QuestionPromptAudio;
  promptUsage: QuestionPromptUsageState;
  stages: Record<InterviewTrainingStage, StageState>;
  currentStage: InterviewTrainingStage;
  completedStages: InterviewTrainingStage[];
  recommendation?: TrainingRecommendation;
  createdAt: string;
  updatedAt: string;
};

export type InterviewTrainingSession = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  topic: string;
  questions: InterviewTrainingQuestion[];
  activeQuestionId: string;
  activeStage: InterviewTrainingStage;
  globalRecommendation?: TrainingRecommendation;
  status: 'active' | 'archived';
  metadata?: {
    source:
      | 'generated'
      | 'restored'
      | 'migrated'
      | 'preload_cache'
      | 'fresh_generation';
    generationPromptVersion?: string;
  };
};

export type TrainingAttempt = {
  id: string;
  sessionId: string;
  questionId: string;
  stage: InterviewTrainingStage;
  createdAt: string;
  updatedAt: string;
  inputType: 'audio' | 'text';
  transcript?: string;
  audioBlobId?: string;
  durationSec?: number;
  answerLanguage?: 'zh' | 'en' | 'mixed' | 'unknown';
  promptUsage?: QuestionPromptUsage;
  timingWindow?: TimingWindow;
  selectedUnitIds?: string[];
  evaluationId?: string;
  status:
    | 'recording'
    | 'recorded'
    | 'transcribed'
    | 'evaluating'
    | 'evaluated'
    | 'failed';
};

export type TimeAnalysis = {
  durationSec: number;
  cutoffSec: number;
  category: 'too_short' | 'good' | 'slightly_long' | 'overtime';
  beforeCutoffSummary: string;
  afterCutoffSummary?: string;
  pacingAdvice: string;
};

export type QuestionComprehensionAnalysis = {
  promptTextVisibleOnSubmit: boolean;
  promptTextWasEverShown: boolean;
  promptListenCount: number;
  likelyAnsweredFromListening: boolean;
  evidence: string;
};

export type CrossQuestionConsistency = {
  includedQuestionIds: string[];
  contradictions: string[];
  consistencySummary: string;
  suggestedFix: string;
};

export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
  afterCutoff: boolean;
};

export type StageEvaluation = {
  id: string;
  sessionId: string;
  questionId: string;
  stage: InterviewTrainingStage;
  attemptId: string;
  createdAt: string;
  score: number;
  readiness?: 'not_ready' | 'almost_ready' | 'ready';
  mainIssue: string;
  feedbackSummary: string;
  suggestedNextAction?: TrainingRecommendation;
  rawModelOutput?: string;
  details: unknown;
};

export type StageEvaluationResult = Omit<
  StageEvaluation,
  'id' | 'sessionId' | 'questionId' | 'stage' | 'attemptId' | 'createdAt'
> & {
  displayTranscript?: string;
  displayTranscriptSegments?: TranscriptSegment[];
  timeAnalysis?: TimeAnalysis;
  questionComprehensionAnalysis?: QuestionComprehensionAnalysis;
  crossQuestionConsistency?: CrossQuestionConsistency;
};

export type TrainingAudioBlob = {
  id: string;
  sessionId: string;
  attemptId: string;
  createdAt: string;
  mimeType: string;
  blob: Blob;
};
