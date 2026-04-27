import { describe, expect, it } from 'vitest';
import { initialInterviewTrainingState, interviewTrainingReducer } from '../features/interview/training/interviewTrainingReducer';
import { 
  getActiveQuestion, 
  getStageState, 
  getAttemptsForActiveStage, 
  getLatestEvaluationForActiveStage 
} from '../features/interview/training/interviewTrainingSelectors';
import type { InterviewTrainingSession, TrainingAttempt, StageEvaluation } from '../types';

describe('Interview Training Logic (Reducer & Selectors)', () => {
  const mockSession: InterviewTrainingSession = {
    id: 's1',
    activeQuestionId: 'q1',
    activeStage: 'personal_anchor',
    questions: [
      {
        id: 'q1',
        title: 'Q1',
        stages: {
          personal_anchor: { status: 'idle' },
          role_play: { status: 'idle' }
        }
      }
    ],
    status: 'active',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01'
  } as any;

  const mockAttempt: TrainingAttempt = {
    id: 'a1',
    sessionId: 's1',
    questionId: 'q1',
    stage: 'personal_anchor',
    createdAt: '2024-01-01T12:00:00Z'
  } as any;

  const mockEvaluation: StageEvaluation = {
    id: 'e1',
    attemptId: 'a1',
    score: 80
  } as any;

  describe('Reducer', () => {
    it('handles SESSION_LOADED', () => {
      const state = interviewTrainingReducer(initialInterviewTrainingState, {
        type: 'SESSION_LOADED',
        source: 'history',
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
      const updated = { ...mockAttempt, status: 'evaluated' } as any;
      const state = interviewTrainingReducer(initialState, {
        type: 'ATTEMPT_UPDATED',
        attempt: updated
      });
      expect(state.attempts[0].status).toBe('evaluated');
    });

    it('handles EVALUATION_ADDED', () => {
      const initialState = { ...initialInterviewTrainingState, attempts: [mockAttempt] };
      const updatedAttempt = { ...mockAttempt, status: 'evaluated' } as any;
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
      const state = interviewTrainingReducer(initialInterviewTrainingState, { type: 'UNKNOWN' } as any);
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
      expect(getStageState(mockSession, 'q1', 'personal_anchor')).toEqual({ status: 'idle' });
      expect(getStageState(mockSession, 'q2', 'personal_anchor')).toBeNull();
    });

    it('getAttemptsForActiveStage works', () => {
      expect(getAttemptsForActiveStage(null, [])).toEqual([]);
      const attempts = [
        { ...mockAttempt, id: 'a1', createdAt: '2024-01-01' },
        { ...mockAttempt, id: 'a2', createdAt: '2024-01-02' }
      ] as any;
      const result = getAttemptsForActiveStage(mockSession, attempts);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a2'); // Sorted desc
    });

    it('getLatestEvaluationForActiveStage works', () => {
      expect(getLatestEvaluationForActiveStage(null, [])).toBeNull();
      
      const sessionWithLatestId: InterviewTrainingSession = {
        ...mockSession,
        questions: [{
          ...mockSession.questions[0],
          stages: {
            personal_anchor: { status: 'idle', latestEvaluationId: 'e1' }
          } as any
        }]
      } as any;
      
      expect(getLatestEvaluationForActiveStage(sessionWithLatestId, [mockEvaluation])).toEqual(mockEvaluation);

      const sessionWithAttemptId: InterviewTrainingSession = {
        ...mockSession,
        questions: [{
          ...mockSession.questions[0],
          stages: {
            personal_anchor: { status: 'idle', latestAttemptId: 'a1' }
          } as any
        }]
      } as any;
      expect(getLatestEvaluationForActiveStage(sessionWithAttemptId, [mockEvaluation])).toEqual(mockEvaluation);
      
      expect(getLatestEvaluationForActiveStage(mockSession, [])).toBeNull();
    });
  });
});
