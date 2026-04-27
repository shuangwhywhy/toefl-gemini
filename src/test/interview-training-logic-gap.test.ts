import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { evaluateInterviewTrainingStage } from '../services/interviewTrainingEvaluation';
import { completeAttemptEvaluation } from '../services/interviewTrainingPersistence';
import { callStructuredGemini } from '../services/callStructuredGemini';
import { interviewTrainingDB } from '../services/interviewTrainingPersistence';
import { StageEvaluationResult } from '../features/interview/types';
import { createMockSession, createMockQuestion, createMockEvaluation, createMockAttempt } from './fixtures/interviewFixtures';
import 'fake-indexeddb/auto';

vi.mock('../services/callStructuredGemini', () => ({
  callStructuredGemini: vi.fn()
}));

vi.mock('../services/audio/multimodal', () => ({
  buildInlineAudioPartFromBlob: vi.fn(async () => ({ inlineData: 'audio' }))
}));

describe('InterviewTraining Logic Gaps', () => {
  describe('evaluateInterviewTrainingStage', () => {
    const mockInput = {
      session: createMockSession({ id: 's1', topic: 'T' }),
      question: createMockQuestion({ id: 'q1', index: 0 }),
      stage: 'thinking_structure' as const,
      inputType: 'text' as const,
      transcript: 'Hello',
      attemptId: 'a1',
      scopeId: 'sc1'
    };

    it('handles invalid recommendation stage names by defaulting to current stage', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 80,
        suggestedNextAction: { reason: 'R', actionLabel: 'A', stage: 'invalid_stage' }
      } as unknown as StageEvaluationResult);

      const result = await evaluateInterviewTrainingStage(mockInput);
      expect(result.suggestedNextAction?.stage).toBe('thinking_structure');
    });

    it('throws error if audio mode produces no transcript', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 50
      } as unknown as StageEvaluationResult);

      const audioInput = { ...mockInput, inputType: 'audio' as const, audioBlob: new Blob() };
      await expect(evaluateInterviewTrainingStage(audioInput))
        .rejects.toThrow('Evaluation failed to produce a transcript.');
    });

    it('merges optional structured details correctly', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 70,
        displayTranscript: 'T',
        timeAnalysis: { durationSec: 10 },
        details: { custom: 1 }
      } as unknown as StageEvaluationResult);

      const result = await evaluateInterviewTrainingStage(mockInput);
      expect(result.details).toEqual({
        custom: 1,
        displayTranscript: 'T',
        timeAnalysis: { durationSec: 10 }
      });
    });

    it('handles non-object details safely', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 70,
        details: 'not-an-object'
      } as unknown as StageEvaluationResult);

      const result = await evaluateInterviewTrainingStage(mockInput);
      expect(result.details).toEqual({});
    });
  });

  describe('Persistence Gaps', () => {
    it('throws error in completeAttemptEvaluation if session is missing', async () => {
      await interviewTrainingDB.attempts.put(createMockAttempt({ id: 'a1', sessionId: 'missing-s' }));
      
      await expect(completeAttemptEvaluation({
        attemptId: 'a1',
        evaluation: createMockEvaluation({ id: 'e1' })
      })).rejects.toThrow('Session not found');
    });
  });
});
