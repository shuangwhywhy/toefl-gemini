import { 
  InterviewTrainingSession, 
  InterviewTrainingQuestion, 
  TrainingAttempt, 
  StageEvaluation,
  StageState,
  TrainingRecommendation
} from '../../features/interview/types';

export const createMockStageState = (overrides: Partial<StageState> = {}): StageState => ({
  status: 'not_started',
  attemptIds: [],
  latestEvaluationId: 'e1',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides
});

export const createMockRecommendation = (overrides: Partial<TrainingRecommendation> = {}): TrainingRecommendation => ({
  questionId: 'q1',
  stage: 'thinking_structure',
  priority: 'medium',
  reason: 'Test reason',
  actionLabel: 'Try again',
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides
});

export const createMockQuestion = (overrides: Partial<InterviewTrainingQuestion> = {}): InterviewTrainingQuestion => {
  const id = overrides.id || 'q1';
  return {
    id,
    index: 0,
    role: 'personal_anchor',
    question: 'Test question?',
    promptUsage: {
      textVisible: false,
      textWasEverShown: false,
      listenCount: 0,
      playbackStartedCount: 0,
      playbackCompletedCount: 0
    },
    stages: {
      thinking_structure: { status: 'not_started' as const, attemptIds: [], latestEvaluationId: 'e1', updatedAt: '2024-01-01T00:00:00Z' },
      english_units: createMockStageState(),
      full_english_answer: createMockStageState(),
      vocabulary_upgrade: createMockStageState(),
      final_practice: createMockStageState()
    },
    currentStage: 'thinking_structure',
    completedStages: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides
  };
};

export const createMockSession = (overrides: Partial<InterviewTrainingSession> = {}): InterviewTrainingSession => ({
  id: 's1',
  version: 1,
  topic: 'Test Topic',
  questions: [createMockQuestion()],
  status: 'active' as const,
  activeQuestionId: 'q1',
  activeStage: 'thinking_structure' as const,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides
});

export const createMockAttempt = (overrides: Partial<TrainingAttempt> = {}): TrainingAttempt => ({
  id: 'a1',
  sessionId: 's1',
  questionId: 'q1',
  stage: 'thinking_structure',
  status: 'recorded',
  inputType: 'audio',
  durationSec: 10,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides
});

export const createMockEvaluation = (overrides: Partial<StageEvaluation> = {}): StageEvaluation => ({
  id: 'e1',
  attemptId: 'a1',
  sessionId: 's1',
  questionId: 'q1',
  stage: 'thinking_structure',
  score: 80,
  readiness: 'almost_ready',
  mainIssue: 'Test issue',
  feedbackSummary: 'Test feedback',
  details: {},
  suggestedNextAction: createMockRecommendation(),
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides
});
