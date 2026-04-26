import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InterviewTrainingQuestion,
  InterviewTrainingSession
} from '../features/interview/types';

const hoisted = vi.hoisted(() => ({
  callStructuredGeminiMock: vi.fn()
}));

vi.mock('../services/callStructuredGemini', () => ({
  callStructuredGemini: hoisted.callStructuredGeminiMock
}));

import { evaluateInterviewTrainingStage } from '../services/interviewTrainingEvaluation';

const now = '2026-01-01T00:00:00.000Z';

const question: InterviewTrainingQuestion = {
  id: 'q1',
  index: 0,
  role: 'personal_anchor',
  question: 'How do you usually prepare for a difficult class?',
  promptAudio: { voice: 'Puck', status: 'ready', audioUrl: 'blob:q1' },
  promptUsage: {
    textVisible: false,
    textWasEverShown: false,
    listenCount: 1,
    playbackStartedCount: 1,
    playbackCompletedCount: 1
  },
  stages: {
    thinking_structure: { status: 'not_started', attemptIds: [], updatedAt: now },
    english_units: { status: 'not_started', attemptIds: [], updatedAt: now },
    full_english_answer: { status: 'not_started', attemptIds: [], updatedAt: now },
    vocabulary_upgrade: { status: 'not_started', attemptIds: [], updatedAt: now },
    final_practice: { status: 'not_started', attemptIds: [], updatedAt: now }
  },
  currentStage: 'thinking_structure',
  completedStages: [],
  createdAt: now,
  updatedAt: now
};

const session: InterviewTrainingSession = {
  id: 'session-1',
  version: 1,
  createdAt: now,
  updatedAt: now,
  topic: 'Study habits',
  questions: [question, { ...question, id: 'q2', index: 1, question: 'Question 2?' }],
  activeQuestionId: 'q1',
  activeStage: 'thinking_structure',
  status: 'active'
};

describe('evaluateInterviewTrainingStage', () => {
  beforeEach(() => {
    hoisted.callStructuredGeminiMock.mockReset();
    hoisted.callStructuredGeminiMock.mockResolvedValue({
      score: 82,
      readiness: 'almost_ready',
      mainIssue: 'Needs a clearer example.',
      feedbackSummary: 'Good structure, add one concrete detail.',
      displayTranscript: 'I usually make a quick plan.',
      timeAnalysis: {
        durationSec: 38,
        cutoffSec: 45,
        category: 'good',
        beforeCutoffSummary: 'Complete answer.',
        pacingAdvice: 'Keep this pace.'
      },
      details: { strengths: ['clear'] }
    });
  });

  it('sends current raw audio plus cross-question text as Gemini parts', async () => {
    const audioBlob = new Blob(['voice-answer'], { type: 'audio/webm' });

    const result = await evaluateInterviewTrainingStage({
      session,
      question,
      stage: 'thinking_structure',
      inputType: 'audio',
      audioBlob,
      durationSec: 38,
      promptUsage: {
        textVisibleOnSubmit: false,
        textWasEverShown: false,
        listenCount: 1,
        playbackStartedCount: 1,
        playbackCompletedCount: 1
      },
      timingWindow: {
        enabled: true,
        idealStartSec: 35,
        idealEndSec: 40,
        softMaxSec: 45,
        category: 'good'
      },
      crossQuestionTextContext: {
        entries: [],
        promptText: 'Q2 context text'
      },
      attemptId: 'attempt-1',
      scopeId: 'scope-1'
    });

    const options = hoisted.callStructuredGeminiMock.mock.calls[0][0];
    expect(Array.isArray(options.promptOrParts)).toBe(true);
    expect(options.promptOrParts).toHaveLength(3);
    expect(options.promptOrParts[0].text).toContain(
      'Current answer has raw audio: yes'
    );
    expect(options.promptOrParts[1].inlineData).toMatchObject({
      mimeType: 'audio/webm'
    });
    expect(options.promptOrParts[1].inlineData.data).toEqual(expect.any(String));
    expect(options.promptOrParts[2]).toEqual({ text: 'Q2 context text' });
    expect(result.details).toMatchObject({
      strengths: ['clear'],
      displayTranscript: 'I usually make a quick plan.',
      timeAnalysis: {
        category: 'good'
      }
    });
  });

  it('keeps text fallback as text without an audio part', async () => {
    await evaluateInterviewTrainingStage({
      session,
      question,
      stage: 'english_units',
      inputType: 'text',
      transcript: 'Typed answer.',
      attemptId: 'attempt-2',
      scopeId: 'scope-1'
    });

    const options = hoisted.callStructuredGeminiMock.mock.calls[0][0];
    expect(options.promptOrParts).toHaveLength(1);
    expect(options.promptOrParts[0].text).toContain('Text fallback answer:');
    expect(options.promptOrParts[0].text).toContain('Typed answer.');
  });
});
