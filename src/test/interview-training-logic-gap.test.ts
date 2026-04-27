import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { evaluateInterviewTrainingStage } from '../services/interviewTrainingEvaluation';
import { completeAttemptEvaluation } from '../services/interviewTrainingPersistence';
import { callStructuredGemini } from '../services/callStructuredGemini';
import { interviewTrainingDB } from '../services/interviewTrainingPersistence';
import type { InterviewTrainingSession, InterviewTrainingQuestion, StageEvaluation, TrainingAttempt, StageEvaluationResult } from '../features/interview/types';
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
      session: { id: 's1', topic: 'T' } as unknown as InterviewTrainingSession,
      question: { id: 'q1', index: 0 } as unknown as InterviewTrainingQuestion,
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
      await interviewTrainingDB.attempts.put({ id: 'a1', sessionId: 'missing-s' } as unknown as TrainingAttempt);
      
      await expect(completeAttemptEvaluation({
        attemptId: 'a1',
        evaluation: { id: 'e1' } as unknown as StageEvaluation
      })).rejects.toThrow('Session not found');
    });
  });
});
