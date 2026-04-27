import { describe, expect, it } from 'vitest';
import { initialInterviewTrainingState, interviewTrainingReducer } from '../features/interview/training/interviewTrainingReducer';
import { 
  getActiveQuestion, 
  getStageState, 
  getAttemptsForActiveStage, 
  getLatestEvaluationForActiveStage 
} from '../features/interview/training/interviewTrainingSelectors';
import type { InterviewTrainingSession, TrainingAttempt, StageEvaluation } from '../features/interview/types';

describe('Interview Training Logic (Reducer & Selectors)', () => {
  const mockSession: InterviewTrainingSession = {
    id: 's1',
    version: 1,
    topic: 'Test Topic',
    activeQuestionId: 'q1',
    activeStage: 'thinking_structure',
    questions: [
      {
        id: 'q1',
        index: 0,
        question: 'Question 1',
        role: 'personal_anchor',
        stages: {
          thinking_structure: { status: 'not_started', attemptIds: [], updatedAt: '2024-01-01' },
          english_units: { status: 'not_started', attemptIds: [], updatedAt: '2024-01-01' },
          full_english_answer: { status: 'not_started', attemptIds: [], updatedAt: '2024-01-01' },
          vocabulary_upgrade: { status: 'not_started', attemptIds: [], updatedAt: '2024-01-01' },
          final_practice: { status: 'not_started', attemptIds: [], updatedAt: '2024-01-01' }
        },
        promptUsage: {
          textVisible: false,
          textWasEverShown: false,
          listenCount: 0,
          playbackStartedCount: 0,
          playbackCompletedCount: 0
        },
        currentStage: 'thinking_structure',
        completedStages: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01'
      }
    ],
    status: 'active',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01'
  };

  const mockAttempt: TrainingAttempt = {
    id: 'a1',
    sessionId: 's1',
    questionId: 'q1',
    stage: 'thinking_structure',
    status: 'recorded',
    inputType: 'text',
    transcript: 'Test transcript',
    durationSec: 10,
    createdAt: '2024-01-01T12:00:00Z',
    updatedAt: '2024-01-01T12:00:00Z'
  };

  const mockEvaluation: StageEvaluation = {
    id: 'e1',
    sessionId: 's1',
    questionId: 'q1',
    stage: 'thinking_structure',
    attemptId: 'a1',
    score: 80,
    feedbackSummary: 'Good',
    mainIssue: 'None',
    details: {},
    createdAt: '2024-01-01T12:05:00Z'
  };

  describe('Reducer', () => {
    it('handles SESSION_LOADED', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, {
        type: 'SESSION_LOADED',
        source: 'created_fresh',
        session: mockSession,
        attempts: [mockAttempt],
        evaluations: [mockEvaluation]
      });
      expect(state.status).toBe('ready');
      expect(state.session).toEqual(mockSession);
      expect(state.attempts).toHaveLength(1);
    });

    it('handles SESSION_UPDATED', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, {
        type: 'SESSION_UPDATED',
        session: mockSession
      });
      expect(state.session).toEqual(mockSession);
    });

    it('handles SESSION_CORRUPTED', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, {
        type: 'SESSION_CORRUPTED',
        session: mockSession,
        error: 'Boom'
      });
      expect(state.status).toBe('corrupted');
      expect(state.error).toBe('Boom');
    });

    it('handles ATTEMPT_ADDED (with existing deduplication)', () => {
      const initialState = { ...initialInterviewTrainingState, attempts: [mockAttempt] };
      const newAttempt = { ...mockAttempt, createdAt: 'later' };
      const state = interviewTrainingReducer(initialState, {
        type: 'ATTEMPT_ADDED',
        session: mockSession,
        attempt: newAttempt
      });
      expect(state.attempts).toHaveLength(1);
      expect(state.attempts[0].createdAt).toBe('later');
    });

    it('handles ATTEMPT_UPDATED', () => {
      const initialState = { ...initialInterviewTrainingState, attempts: [mockAttempt] };
      const updated = { ...mockAttempt, status: 'evaluated' as const };
      const state = interviewTrainingReducer(initialState, {
        type: 'ATTEMPT_UPDATED',
        attempt: updated
      });
      expect(state.attempts[0].status).toBe('evaluated');
    });

    it('handles EVALUATION_ADDED', () => {
      const initialState = { ...initialInterviewTrainingState, attempts: [mockAttempt] };
      const updatedAttempt = { ...mockAttempt, status: 'evaluated' as const };
      const state = interviewTrainingReducer(initialState, {
        type: 'EVALUATION_ADDED',
        session: mockSession,
        attempt: updatedAttempt,
        evaluation: mockEvaluation
      });
      expect(state.evaluations).toHaveLength(1);
      expect(state.attempts).toHaveLength(1);
      expect(state.attempts[0].status).toBe('evaluated');
    });

    it('handles SUBMITTING_SET', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, {
        type: 'SUBMITTING_SET',
        isSubmitting: true
      });
      expect(state.isSubmitting).toBe(true);
    });

    it('handles ERROR_SET', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, {
        type: 'ERROR_SET',
        error: 'Failed'
      });
      expect(state.status).toBe('error');
      expect(state.error).toBe('Failed');
    });

    it('returns state for unknown action', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, { type: 'UNKNOWN' } as unknown as { type: 'ERROR_SET', error: string });
      expect(state).toBe(initialInterviewTrainingState);
    });
  });

  describe('Selectors', () => {
    it('getActiveQuestion works', () => {
      expect(getActiveQuestion(null)).toBeNull();
      expect(getActiveQuestion(mockSession)).toEqual(mockSession.questions[0]);
      
      const sessionWithNoMatch = { ...mockSession, activeQuestionId: 'non-existent' };
      expect(getActiveQuestion(sessionWithNoMatch)).toEqual(mockSession.questions[0]);
      
      const emptySession = { ...mockSession, questions: [] };
      expect(getActiveQuestion(emptySession)).toBeNull();
    });

    it('getStageState works', () => {
      expect(getStageState(null, null, null)).toBeNull();
      expect(getStageState(mockSession, 'q1', 'thinking_structure')).toEqual({ status: 'not_started', attemptIds: [], updatedAt: '2024-01-01' });
      expect(getStageState(mockSession, 'q2', 'thinking_structure')).toBeNull();
    });

    it('getAttemptsForActiveStage works', () => {
      expect(getAttemptsForActiveStage(null, [])).toEqual([]);
      const attempts = [
        { ...mockAttempt, id: 'a1', createdAt: '2024-01-01' },
        { ...mockAttempt, id: 'a2', createdAt: '2024-01-02' }
      ] as TrainingAttempt[];
      const result = getAttemptsForActiveStage(mockSession, attempts);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a2'); // Sorted desc
    });

    it('getLatestEvaluationForActiveStage works', () => {
      expect(getLatestEvaluationForActiveStage(null, [])).toBeNull();
      
      const sessionWithLatestId = {
        ...mockSession,
        questions: [{
          ...mockSession.questions[0],
          stages: {
            ...mockSession.questions[0].stages,
            thinking_structure: { status: 'not_started' as const, attemptIds: [], latestEvaluationId: 'e1', updatedAt: '2024-01-01' }
          }
        }]
      } ;
      
      expect(getLatestEvaluationForActiveStage(sessionWithLatestId, [mockEvaluation])).toEqual(mockEvaluation);

      const sessionWithAttemptId = {
        ...mockSession,
        questions: [{
          ...mockSession.questions[0],
          stages: {
            ...mockSession.questions[0].stages,
            thinking_structure: { status: 'not_started' as const, attemptIds: [], latestAttemptId: 'a1', updatedAt: '2024-01-01' }
          }
        }]
      } ;
      expect(getLatestEvaluationForActiveStage(sessionWithAttemptId, [mockEvaluation])).toEqual(mockEvaluation);
      
      expect(getLatestEvaluationForActiveStage(mockSession, [])).toBeNull();
    });
  });
});
