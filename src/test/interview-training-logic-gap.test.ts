import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { evaluateInterviewTrainingStage } from '../services/interviewTrainingEvaluation';
import { completeAttemptEvaluation } from '../services/interviewTrainingPersistence';
import { callStructuredGemini } from '../services/callStructuredGemini';
import { interviewTrainingDB } from '../services/interviewTrainingPersistence';
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
      session: { id: 's1', topic: 'T' },
      question: { id: 'q1', index: 0 },
      stage: 'thinking_structure',
      inputType: 'text',
      transcript: 'Hello',
      attemptId: 'a1',
      scopeId: 'sc1'
    } as any;

    it('handles invalid recommendation stage names by defaulting to current stage', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 80,
        suggestedNextAction: { reason: 'R', actionLabel: 'A', stage: 'invalid_stage' }
      } as any);

      const result = await evaluateInterviewTrainingStage(mockInput);
      expect(result.suggestedNextAction?.stage).toBe('thinking_structure');
    });

    it('throws error if audio mode produces no transcript', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 50
      } as any);

      const audioInput = { ...mockInput, inputType: 'audio', audioBlob: new Blob() };
      await expect(evaluateInterviewTrainingStage(audioInput))
        .rejects.toThrow('Evaluation failed to produce a transcript.');
    });

    it('merges optional structured details correctly', async () => {
      vi.mocked(callStructuredGemini).mockResolvedValue({
        score: 70,
        displayTranscript: 'T',
        timeAnalysis: { durationSec: 10 },
        details: { custom: 1 }
      } as any);

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
      } as any);

      const result = await evaluateInterviewTrainingStage(mockInput);
      expect(result.details).toEqual({});
    });
  });

  describe('Persistence Gaps', () => {
    it('throws error in completeAttemptEvaluation if session is missing', async () => {
      await interviewTrainingDB.attempts.put({ id: 'a1', sessionId: 'missing-s' } as any);
      
      await expect(completeAttemptEvaluation({
        attemptId: 'a1',
        evaluation: { id: 'e1' } as any
      })).rejects.toThrow('Session not found');
    });
  });
});
