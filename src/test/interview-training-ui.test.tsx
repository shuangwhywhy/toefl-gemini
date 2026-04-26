import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  InterviewTrainingQuestion,
  InterviewTrainingStage
} from '../features/interview/types';
import { CurrentQuestionPanel } from '../features/interview/training/components/CurrentQuestionPanel';
import { StageAttemptPanel } from '../features/interview/training/components/StageAttemptPanel';

const now = '2026-01-01T00:00:00.000Z';
const promptText =
  'How do you usually prepare when a class becomes unexpectedly difficult?';

const createQuestion = (
  overrides: Partial<InterviewTrainingQuestion> = {}
): InterviewTrainingQuestion => ({
  id: 'q1',
  index: 0,
  role: 'personal_anchor',
  question: promptText,
  promptAudio: {
    voice: 'Puck',
    audioUrl: 'https://example.com/q1.wav',
    status: 'ready'
  },
  promptUsage: {
    textVisible: false,
    textWasEverShown: false,
    listenCount: 0,
    playbackStartedCount: 0,
    playbackCompletedCount: 0
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
  updatedAt: now,
  ...overrides
});

function CurrentQuestionHarness({
  initialQuestion = createQuestion(),
  stage = 'thinking_structure'
}: {
  initialQuestion?: InterviewTrainingQuestion;
  stage?: InterviewTrainingStage;
}) {
  const [question, setQuestion] = React.useState(initialQuestion);

  return (
    <CurrentQuestionPanel
      topic="Study habits"
      question={question}
      stage={stage}
      onEnsurePromptAudio={vi.fn(async () => question.promptAudio?.audioUrl ?? null)}
      onPromptUsageChange={(_, update) =>
        setQuestion((previous) => ({
          ...previous,
          promptUsage: {
            ...previous.promptUsage,
            ...update
          }
        }))
      }
    />
  );
}

describe('interview training voice-first UI', () => {
  it('hides prompt text by default and records show-text metadata', () => {
    render(<CurrentQuestionHarness />);

    expect(screen.queryByText(promptText)).not.toBeInTheDocument();
    expect(screen.getByText('Prompt text hidden')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show prompt text/i }));

    expect(screen.getByText(promptText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide prompt text/i })).toBeInTheDocument();
  });

  it('increments listen metadata when the prompt audio completes', async () => {
    const { container } = render(<CurrentQuestionHarness />);

    fireEvent.click(screen.getByRole('button', { name: /play prompt/i }));
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.ended(audio);

    await waitFor(() => {
      expect(screen.getByTitle('Completed listens')).toHaveTextContent('1');
    });
  });

  it('keeps voice recording as the primary attempt action', () => {
    render(
      <StageAttemptPanel
        stage="final_practice"
        isSubmitting={false}
        onSubmit={vi.fn()}
        onSubmitAudio={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
    expect(screen.getByText(/use text fallback/i)).toBeInTheDocument();
    expect(screen.getByText(/0s/i)).toBeInTheDocument();
  });
});
