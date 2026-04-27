import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import * as Persistence from '../services/interviewTrainingPersistence';
import type { InterviewTrainingSession, TrainingAttempt, StageEvaluation } from '../features/interview/types';
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
    const mockSession = {
      id: 'session-1',
      status: 'active' as const,
      updatedAt: new Date().toISOString(),
      questions: []
    } as unknown as InterviewTrainingSession;

    await saveInterviewTrainingSession(mockSession);
    const loaded = await loadActiveInterviewTrainingSession();
    expect(loaded?.id).toBe('session-1');
  });

  it('archives existing active sessions when creating a new one', async () => {
    const session1 = { id: 's1', status: 'active' as const, updatedAt: '2026-01-01T00:00:00Z' } as unknown as InterviewTrainingSession;
    const session2 = { id: 's2', status: 'active' as const, updatedAt: '2026-01-01T00:00:01Z' } as unknown as InterviewTrainingSession;

    await interviewTrainingDB.sessions.put(session1);
    await createInterviewTrainingSession(session2);

    const s1 = await interviewTrainingDB.sessions.get('s1');
    const s2 = await interviewTrainingDB.sessions.get('s2');

    expect(s1?.status).toBe('archived');
    expect(s2?.status).toBe('active');
  });

  it('saves training attempts and audio blobs', async () => {
    const attempt = {
      id: 'a1',
      sessionId: 's1',
      questionId: 'q1',
      stage: 'thinking_structure',
      status: 'recorded',
      inputType: 'audio',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as unknown as TrainingAttempt;
    const blob = new Blob(['audio data'], { type: 'audio/webm' });

    const saved = await saveTrainingAttempt(attempt, blob);
    expect(saved.audioBlobId).toBeDefined();

    const record = await interviewTrainingDB.audioBlobs.get(saved.audioBlobId!);
    expect(record?.blob).toBeDefined();
    expect(record?.sessionId).toBe('s1');
  });

  it('gets attempts for a specific stage', async () => {
    const a1 = { id: 'a1', sessionId: 's1', questionId: 'q1', stage: 'st1', createdAt: '2026-01-01T00:00:00Z' } as unknown as TrainingAttempt;
    const a2 = { id: 'a2', sessionId: 's1', questionId: 'q1', stage: 'st1', createdAt: '2026-01-01T00:00:01Z' } as unknown as TrainingAttempt;
    const a3 = { id: 'a3', sessionId: 's1', questionId: 'q2', stage: 'st1', createdAt: '2026-01-01T00:00:02Z' } as unknown as TrainingAttempt;

    await interviewTrainingDB.attempts.bulkPut([a1, a2, a3]);

    const results = await getAttemptsForStage('s1', 'q1', 'st1');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a2'); // Sorted by createdAt desc
  });

  it('gets all attempts for a session', async () => {
    const a1 = { id: 'a1', sessionId: 's1', createdAt: '2026-01-01T00:00:00Z' } as unknown as TrainingAttempt;
    const a2 = { id: 'a2', sessionId: 's1', createdAt: '2026-01-01T00:00:01Z' } as unknown as TrainingAttempt;
    await interviewTrainingDB.attempts.bulkPut([a1, a2]);

    const results = await Persistence.getAttemptsForSession('s1');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('a2');
  });

  it('gets latest evaluation and evaluations for session', async () => {
    const e1 = { id: 'e1', attemptId: 'a1', sessionId: 's1', createdAt: '2026-01-01T00:00:00Z' } as unknown as StageEvaluation;
    const e2 = { id: 'e2', attemptId: 'a1', sessionId: 's1', createdAt: '2026-01-01T00:00:01Z' } as unknown as StageEvaluation;
    await interviewTrainingDB.evaluations.bulkPut([e1, e2]);

    const latest = await Persistence.getLatestEvaluation('a1');
    expect(latest?.id).toBe('e2');

    const all = await Persistence.getEvaluationsForSession('s1');
    expect(all).toHaveLength(2);
  });

  it('archives duplicate active sessions', async () => {
    const s1 = { id: 's1', status: 'active', updatedAt: '2026-01-01T00:00:00Z' } as unknown as InterviewTrainingSession;
    const s2 = { id: 's2', status: 'active', updatedAt: '2026-01-01T00:00:01Z' } as unknown as InterviewTrainingSession;
    await interviewTrainingDB.sessions.bulkPut([s1, s2]);

    const latest = await loadActiveInterviewTrainingSession();
    expect(latest?.id).toBe('s2');

    const s1_archived = await interviewTrainingDB.sessions.get('s1');
    expect(s1_archived?.status).toBe('archived');
  });

  it('saves stage evaluation', async () => {
    const evaluation = { id: 'e1', score: 90 } as unknown as StageEvaluation;
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

    const session = {
      id: sessionId,
      status: 'active',
      questions: [
        {
          id: questionId,
          stages: {
            thinking_structure: {
              status: 'submitted',
              latestAttemptId: attemptId,
              updatedAt: 'old'
            }
          }
        }
      ]
    } as unknown as InterviewTrainingSession;

    const attempt = {
      id: attemptId,
      sessionId,
      questionId,
      stage: 'thinking_structure'
    } as unknown as TrainingAttempt;

    const evaluation = {
      id: evaluationId,
      attemptId,
      suggestedNextAction: { action: 'proceed' }
    } as unknown as StageEvaluation;

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
    expect(updatedSession?.globalRecommendation).toEqual(evaluation.suggestedNextAction);
  });

  it('completes attempt evaluation but does not promote if it is not the latest attempt', async () => {
    const sessionId = 's1';
    const questionId = 'q1';
    const attemptId = 'a1';
    const latestAttemptId = 'a2';

    const session = {
      id: sessionId,
      status: 'active',
      questions: [
        {
          id: questionId,
          stages: {
            thinking_structure: {
              status: 'submitted',
              latestAttemptId: latestAttemptId,
              updatedAt: 'old'
            }
          }
        }
      ]
    } as unknown as InterviewTrainingSession;

    const attempt = {
      id: attemptId,
      sessionId,
      questionId,
      stage: 'thinking_structure'
    } as unknown as TrainingAttempt;

    const evaluation = {
      id: 'e1',
      sessionId,
      questionId,
      stage: 'thinking_structure',
      attemptId,
      suggestedNextAction: { action: 'proceed' }
    } as unknown as StageEvaluation;

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
