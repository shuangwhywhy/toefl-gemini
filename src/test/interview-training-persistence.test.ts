import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import * as Persistence from '../services/interviewTrainingPersistence';
import { TrainingAttempt } from '../features/interview/types';
import { createMockSession, createMockQuestion, createMockEvaluation, createMockAttempt, createMockRecommendation } from './fixtures/interviewFixtures';
const { 
  interviewTrainingDB, 
  clearInterviewTrainingData,
  loadActiveInterviewTrainingSession,
  saveInterviewTrainingSession,
  createInterviewTrainingSession,
  saveTrainingAttempt,
  getAttemptsForStage
} = Persistence;

describe('InterviewTrainingPersistence', () => {
  beforeEach(async () => {
    await clearInterviewTrainingData();
  });

  it('saves and loads an active session', async () => {
    const mockSession = createMockSession({
      id: 'session-1',
      status: 'active',
      updatedAt: new Date().toISOString(),
      questions: []
    });

    await saveInterviewTrainingSession(mockSession);
    const loaded = await loadActiveInterviewTrainingSession();
    expect(loaded?.id).toBe('session-1');
  });

  it('archives existing active sessions when creating a new one', async () => {
    const session1 = createMockSession({ id: 's1', status: 'active', updatedAt: '2026-01-01T00:00:00Z' });
    const session2 = createMockSession({ id: 's2', status: 'active', updatedAt: '2026-01-01T00:00:01Z' });

    await interviewTrainingDB.sessions.put(session1);
    await createInterviewTrainingSession(session2);

    const s1 = await interviewTrainingDB.sessions.get('s1');
    const s2 = await interviewTrainingDB.sessions.get('s2');

    expect(s1?.status).toBe('archived');
    expect(s2?.status).toBe('active');
  });

  it('saves training attempts and audio blobs', async () => {
    const attempt = createMockAttempt({
      id: 'a1',
      sessionId: 's1',
      questionId: 'q1',
      stage: 'thinking_structure',
      status: 'recorded',
      inputType: 'audio',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const blob = new Blob(['audio data'], { type: 'audio/webm' });

    const saved = await saveTrainingAttempt(attempt, blob);
    expect(saved.audioBlobId).toBeDefined();

    const record = await interviewTrainingDB.audioBlobs.get(saved.audioBlobId!);
    expect(record?.blob).toBeDefined();
    expect(record?.sessionId).toBe('s1');
  });

  it('gets attempts for a specific stage', async () => {
    const a1 = createMockAttempt({ id: 'a1', sessionId: 's1', questionId: 'q1', stage: 'thinking_structure', createdAt: '2026-01-01T00:00:00Z' });
    const a2 = createMockAttempt({ id: 'a2', sessionId: 's1', questionId: 'q1', stage: 'thinking_structure', createdAt: '2026-01-01T00:00:01Z' });
    const a3 = createMockAttempt({ id: 'a3', sessionId: 's1', questionId: 'q2', stage: 'thinking_structure', createdAt: '2026-01-01T00:00:02Z' });

    await interviewTrainingDB.attempts.bulkPut([a1, a2, a3]);

    const results = await getAttemptsForStage('s1', 'q1', 'thinking_structure');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a2'); // Sorted by createdAt desc
  });

  it('gets all attempts for a session', async () => {
    const a1 = createMockAttempt({ id: 'a1', sessionId: 's1', createdAt: '2026-01-01T00:00:00Z' });
    const a2 = createMockAttempt({ id: 'a2', sessionId: 's1', createdAt: '2026-01-01T00:00:01Z' });
    await interviewTrainingDB.attempts.bulkPut([a1, a2]);

    const results = await Persistence.getAttemptsForSession('s1');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a2');
  });

  it('gets latest evaluation and evaluations for session', async () => {
    const e1 = createMockEvaluation({ id: 'e1', attemptId: 'a1', sessionId: 's1', createdAt: '2026-01-01T00:00:00Z' });
    const e2 = createMockEvaluation({ id: 'e2', attemptId: 'a1', sessionId: 's1', createdAt: '2026-01-01T00:00:01Z' });
    await interviewTrainingDB.evaluations.bulkPut([e1, e2]);

    const latest = await Persistence.getLatestEvaluation('a1');
    expect(latest?.id).toBe('e2');

    const all = await Persistence.getEvaluationsForSession('s1');
    expect(all).toHaveLength(2);
  });

  it('archives duplicate active sessions', async () => {
    const s1 = createMockSession({ id: 's1', status: 'active', updatedAt: '2026-01-01T00:00:00Z' });
    const s2 = createMockSession({ id: 's2', status: 'active', updatedAt: '2026-01-01T00:00:01Z' });
    await interviewTrainingDB.sessions.bulkPut([s1, s2]);

    const latest = await loadActiveInterviewTrainingSession();
    expect(latest?.id).toBe('s2');

    const s1_archived = await interviewTrainingDB.sessions.get('s1');
    expect(s1_archived?.status).toBe('archived');
  });

  it('saves stage evaluation', async () => {
    const evaluation = createMockEvaluation({ id: 'e1', score: 90 });
    await Persistence.saveStageEvaluation(evaluation);
    const saved = await interviewTrainingDB.evaluations.get('e1');
    expect(saved?.score).toBe(90);
  });

  it('retrieves audio blob by id', async () => {
    const blob = new Blob(['data']);
    await interviewTrainingDB.audioBlobs.put({
      id: 'b1',
      blob,
      sessionId: 's1',
      attemptId: 'a1',
      createdAt: new Date().toISOString(),
      mimeType: 'audio/webm'
    });
    const result = await Persistence.getAudioBlob('b1');
    expect(result).toBeDefined();
  });

  it('completes attempt evaluation and updates session if it is the latest attempt', async () => {
    const sessionId = 's1';
    const questionId = 'q1';
    const attemptId = 'a1';
    const evaluationId = 'e1';

    const session = createMockSession({
      id: sessionId,
      status: 'active',
      questions: [
        createMockQuestion({
          id: questionId,
          stages: {
            thinking_structure: {
              status: 'submitted',
              latestAttemptId: attemptId,
              attemptIds: [attemptId],
              updatedAt: 'old'
            },
            english_units: { status: 'not_started', attemptIds: [], updatedAt: 'old' },
            full_english_answer: { status: 'not_started', attemptIds: [], updatedAt: 'old' },
            vocabulary_upgrade: { status: 'not_started', attemptIds: [], updatedAt: 'old' },
            final_practice: { status: 'not_started', attemptIds: [], updatedAt: 'old' }
          }
        })
      ]
    });

    const attempt = {
      id: attemptId,
      sessionId,
      questionId,
      stage: 'thinking_structure'
    } as unknown as TrainingAttempt;

    const evaluation = createMockEvaluation({
      id: evaluationId,
      attemptId,
      suggestedNextAction: createMockRecommendation({ 
        questionId,
        stage: 'thinking_structure',
        priority: 'high',
        reason: 'Test',
        actionLabel: 'Proceed'
      })
    });

    await interviewTrainingDB.sessions.put(session);
    await interviewTrainingDB.attempts.put(attempt);

    const result = await Persistence.completeAttemptEvaluation({
      attemptId,
      evaluation
    });

    expect(result.saved).toBe(true);
    expect(result.promotedToLatest).toBe(true);

    const updatedSession = await interviewTrainingDB.sessions.get(sessionId);
    const updatedStage = updatedSession?.questions[0].stages.thinking_structure;
    expect(updatedStage?.status).toBe('reviewed');
    expect(updatedStage?.latestEvaluationId).toBe(evaluationId);
    expect(updatedSession?.questions[0].completedStages).toContain('thinking_structure');
    expect(updatedSession?.globalRecommendation).toEqual(evaluation.suggestedNextAction);
  });

  it('completes attempt evaluation but does not promote if it is not the latest attempt', async () => {
    const sessionId = 's1';
    const questionId = 'q1';
    const attemptId = 'a1';
    const latestAttemptId = 'a2';

    const session = createMockSession({
      id: sessionId,
      status: 'active',
      questions: [
        createMockQuestion({
          id: questionId,
          stages: {
            thinking_structure: {
              status: 'submitted',
              latestAttemptId: latestAttemptId,
              attemptIds: [latestAttemptId],
              updatedAt: 'old'
            },
            english_units: { status: 'not_started', attemptIds: [], updatedAt: 'old' },
            full_english_answer: { status: 'not_started', attemptIds: [], updatedAt: 'old' },
            vocabulary_upgrade: { status: 'not_started', attemptIds: [], updatedAt: 'old' },
            final_practice: { status: 'not_started', attemptIds: [], updatedAt: 'old' }
          }
        })
      ]
    });

    const attempt = {
      id: attemptId,
      sessionId,
      questionId,
      stage: 'thinking_structure'
    } as unknown as TrainingAttempt;

    const evaluation = createMockEvaluation({
      id: 'e1',
      sessionId,
      questionId,
      stage: 'thinking_structure',
      attemptId,
      suggestedNextAction: createMockRecommendation({ 
        questionId,
        stage: 'thinking_structure',
        priority: 'high',
        reason: 'Test',
        actionLabel: 'Proceed'
      })
    });

    await interviewTrainingDB.sessions.put(session);
    await interviewTrainingDB.attempts.put(attempt);

    const result = await Persistence.completeAttemptEvaluation({
      attemptId,
      evaluation
    });

    expect(result.saved).toBe(true);
    expect(result.promotedToLatest).toBe(false);
  });
});
