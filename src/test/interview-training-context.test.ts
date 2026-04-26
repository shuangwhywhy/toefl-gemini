import { describe, expect, it } from 'vitest';
import type {
  InterviewTrainingQuestion,
  InterviewTrainingSession,
  InterviewTrainingStage,
  StageEvaluation,
  TrainingAttempt
} from '../features/interview/types';
import {
  buildCrossQuestionTextContext,
  selectOneCompleteAnswerPerOtherQuestion,
  shouldIncludeCrossQuestionContext
} from '../features/interview/training/interviewTrainingContext';

const now = '2026-01-01T00:00:00.000Z';
const stages = [
  'thinking_structure',
  'english_units',
  'full_english_answer',
  'vocabulary_upgrade',
  'final_practice'
] as const;

const createQuestion = (index: number): InterviewTrainingQuestion => ({
  id: `q${index + 1}`,
  index,
  role: index === 0 ? 'personal_anchor' : 'personal_choice',
  question: `Question ${index + 1}?`,
  promptAudio: { voice: 'Puck', status: 'idle' },
  promptUsage: {
    textVisible: false,
    textWasEverShown: false,
    listenCount: 0,
    playbackStartedCount: 0,
    playbackCompletedCount: 0
  },
  stages: Object.fromEntries(
    stages.map((stage) => [
      stage,
      { status: 'not_started', attemptIds: [], updatedAt: now }
    ])
  ) as InterviewTrainingQuestion['stages'],
  currentStage: 'thinking_structure',
  completedStages: [],
  createdAt: now,
  updatedAt: now
});

const createSession = (): InterviewTrainingSession => ({
  id: 'session-1',
  version: 1,
  createdAt: now,
  updatedAt: now,
  topic: 'Campus study habits',
  questions: [0, 1, 2, 3].map(createQuestion),
  activeQuestionId: 'q1',
  activeStage: 'thinking_structure',
  status: 'active'
});

const createAttempt = (input: {
  id: string;
  questionId: string;
  stage: InterviewTrainingStage;
  createdAt: string;
  transcript?: string;
  inputType?: 'audio' | 'text';
  durationSec?: number;
}): TrainingAttempt => ({
  id: input.id,
  sessionId: 'session-1',
  questionId: input.questionId,
  stage: input.stage,
  createdAt: input.createdAt,
  updatedAt: input.createdAt,
  inputType: input.inputType ?? 'audio',
  transcript: input.transcript,
  durationSec: input.durationSec ?? 38,
  status: 'evaluated'
});

const createEvaluation = (
  attemptId: string,
  details: StageEvaluation['details']
): StageEvaluation => ({
  id: `eval-${attemptId}`,
  sessionId: 'session-1',
  questionId: 'q2',
  stage: 'thinking_structure',
  attemptId,
  createdAt: now,
  score: 80,
  mainIssue: 'ok',
  feedbackSummary: 'ok',
  details
});

describe('interview training cross-question context', () => {
  it('only enables cross-question context for timed stages', () => {
    expect(shouldIncludeCrossQuestionContext('thinking_structure')).toBe(true);
    expect(shouldIncludeCrossQuestionContext('final_practice')).toBe(true);
    expect(shouldIncludeCrossQuestionContext('english_units')).toBe(false);
    expect(shouldIncludeCrossQuestionContext('full_english_answer')).toBe(false);
    expect(shouldIncludeCrossQuestionContext('vocabulary_upgrade')).toBe(false);
  });

  it('selects one complete answer per other question from the preferred stage', () => {
    const session = createSession();
    const attempts = [
      createAttempt({
        id: 'q2-final',
        questionId: 'q2',
        stage: 'final_practice',
        createdAt: '2026-01-01T00:02:00.000Z'
      }),
      createAttempt({
        id: 'q2-thinking',
        questionId: 'q2',
        stage: 'thinking_structure',
        createdAt: '2026-01-01T00:01:00.000Z'
      }),
      createAttempt({
        id: 'q3-text',
        questionId: 'q3',
        stage: 'thinking_structure',
        createdAt: '2026-01-01T00:03:00.000Z',
        inputType: 'text',
        transcript: 'Text fallback answer.'
      })
    ];
    const evaluations = [
      createEvaluation('q2-final', { displayTranscript: 'Final English answer.' }),
      createEvaluation('q2-thinking', {
        displayTranscript: 'Thinking structure answer.'
      })
    ];

    const selected = selectOneCompleteAnswerPerOtherQuestion({
      session,
      currentQuestionId: 'q1',
      currentStage: 'thinking_structure',
      attempts,
      evaluations
    });

    expect(selected).toHaveLength(2);
    expect(selected[0]).toMatchObject({
      questionId: 'q2',
      selectedAttemptId: 'q2-thinking',
      answerText: 'Thinking structure answer.',
      answerTextSource: 'display_transcript'
    });
    expect(selected[1]).toMatchObject({
      questionId: 'q3',
      selectedAttemptId: 'q3-text',
      answerText: 'Text fallback answer.',
      answerTextSource: 'text_fallback'
    });
  });

  it('formats display transcript segments and omits stages without context', () => {
    const session = createSession();
    const attempts = [
      createAttempt({
        id: 'q2-audio',
        questionId: 'q2',
        stage: 'final_practice',
        createdAt: '2026-01-01T00:01:00.000Z'
      })
    ];
    const evaluations = [
      createEvaluation('q2-audio', {
        displayTranscriptSegments: [
          { startSec: 0, endSec: 2, text: 'Segment one.', afterCutoff: false },
          { startSec: 46, endSec: 48, text: 'Late segment.', afterCutoff: true }
        ]
      })
    ];

    const context = buildCrossQuestionTextContext({
      session,
      currentQuestionId: 'q1',
      currentStage: 'final_practice',
      attempts,
      evaluations
    });

    expect(context?.entries[0]).toMatchObject({
      answerText: 'Segment one. Late segment.',
      answerTextSource: 'transcript_segments'
    });
    expect(context?.promptText).toContain('Question: Question 2?');
    expect(
      buildCrossQuestionTextContext({
        session,
        currentQuestionId: 'q1',
        currentStage: 'english_units',
        attempts,
        evaluations
      })
    ).toBeNull();
  });
});
