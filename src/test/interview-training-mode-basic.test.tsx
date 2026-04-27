import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { InterviewTrainingMode } from '../features/interview/training/InterviewTrainingMode';
import { loadOrCreateTrainingSession } from '../services/interviewTrainingSessionFactory';
import { getAttemptsForSession, getEvaluationsForSession } from '../services/interviewTrainingPersistence';



vi.mock('../services/interviewTrainingSessionFactory', () => ({
  loadOrCreateTrainingSession: vi.fn(),
  createNewTrainingSession: vi.fn()
}));

vi.mock('../services/interviewTrainingPersistence', () => ({
  getAttemptsForSession: vi.fn().mockResolvedValue([]),
  getEvaluationsForSession: vi.fn().mockResolvedValue([]),
  loadActiveInterviewTrainingSession: vi.fn(),
  saveInterviewTrainingSession: vi.fn(),
  saveTrainingAttempt: vi.fn(),
  completeAttemptEvaluation: vi.fn(),
  cleanupOldAudioBlobs: vi.fn()
}));

vi.mock('../services/requestScope', () => ({
  useRequestScope: () => ({
    scopeId: 'test-scope',
    beginSession: () => 'token',
    isSessionCurrent: () => true,
    invalidateSession: vi.fn()
  })
}));

describe('InterviewTrainingMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSession = {
    id: 's1',
    activeQuestionId: 'q1',
    activeStage: 'thinking_structure',
    questions: [
      {
        id: 'q1',
        title: 'Q1',
        question: 'What is your name?',
        currentStage: 'thinking_structure',
        stages: {
          thinking_structure: { status: 'idle' },
          english_units: { status: 'not_started' },
          full_english_answer: { status: 'not_started' },
          vocabulary_upgrade: { status: 'not_started' },
          final_practice: { status: 'not_started' }
        },
        promptUsage: { textVisible: true }
      }
    ],
    status: 'active'
  };

  it('renders loading state then success state', async () => {
    vi.mocked(loadOrCreateTrainingSession).mockResolvedValue({
      kind: 'created_fresh',
      session: mockSession as any
    });

    render(<InterviewTrainingMode onBack={vi.fn()} />);
    
    expect(screen.getByText(/Training/i)).toBeDefined(); // formatLoadSource fallback
    
    await waitFor(() => {
      expect(screen.getByText('Q1')).toBeDefined();
    });
  });

  it('handles corrupted session', async () => {
    vi.mocked(loadOrCreateTrainingSession).mockResolvedValue({
      kind: 'corrupted',
      session: mockSession as any
    });

    render(<InterviewTrainingMode onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Restart|重置|恢复/i)).toBeDefined();
    });
  });

  it('handles loading error', async () => {
    vi.mocked(loadOrCreateTrainingSession).mockRejectedValue(new Error('Failed to load'));

    render(<InterviewTrainingMode onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Unavailable|失败/i)).toBeDefined();
    });
  });
});
