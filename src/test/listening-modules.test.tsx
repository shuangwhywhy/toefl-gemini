import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ListeningDictationModule, ListeningPracticeModule } from '../features/listening/ListeningModules';
import { runBoundedGeneration } from '../services/llm/retry';
import { fetchGeminiText, fetchNeuralTTS, fetchConversationTTS } from '../services/llm/helpers';

vi.mock('../services/llm/retry', () => ({
  runBoundedGeneration: vi.fn()
}));

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: vi.fn(),
  fetchNeuralTTS: vi.fn(),
  fetchConversationTTS: vi.fn(),
  processDictationText: vi.fn().mockReturnValue([{ type: 'shown', word: 'Hello' }, { type: 'gap', word: 'World' }])
}));

vi.mock('../services/requestScope', () => ({
  useRequestScope: () => ({
    scopeId: 'test-scope',
    beginSession: () => 'token',
    isSessionCurrent: () => true,
    invalidateSession: () => 'new-token'
  })
}));

vi.mock('../services/preload/orchestrator', () => ({
  PreloadPipeline: {
    cache: { dictation: null, listening: null },
    abortCurrent: vi.fn()
  }
}));

describe('ListeningModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
  });

  describe('ListeningDictationModule', () => {
    it('generates and allows practice', async () => {
      vi.mocked(runBoundedGeneration).mockResolvedValue({
        value: {
          topic: 'Biology',
          text: 'Hello World',
          tokens: [{ type: 'shown', word: 'Hello' }, { type: 'gap', word: 'World' }],
          audioUrl: 'mock-audio'
        }
      } as any);

      render(<ListeningDictationModule onBack={vi.fn()} />);
      
      expect(screen.getByText(/准备学术短文/i)).toBeDefined();
      
      expect(await screen.findByText(/Hello/i)).toBeInTheDocument();
      // Use getAllByRole because AITutorChat also has a textbox
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThan(0);



      const input = screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'world' } });
      fireEvent.click(screen.getByText('完成校验'));
      
      expect(screen.getByText('100')).toBeDefined(); // Score
    });
  });

  describe('ListeningPracticeModule', () => {
    it('generates and allows note taking', async () => {
      vi.mocked(runBoundedGeneration).mockResolvedValue({
        value: {
          topic: 'History',
          transcript: 'Professor: Hi Student: Hello',
          truth: { who: 'P&S', problem: 'P', reason: 'R', solution: 'S', nextStep: 'N' },
          audioUrl: 'mock-audio'
        }
      } as any);

      render(<ListeningPracticeModule onBack={vi.fn()} />);
      
      await waitFor(() => {
        expect(screen.getByText(/Topic: History/i)).toBeDefined();
      });

      fireEvent.click(screen.getByText(/开始盲听与快记/i));
      expect(screen.getByText(/谁 \(Who\)/i)).toBeDefined();
      
      const whoInput = screen.getByPlaceholderText(/对话的双方是谁/i);
      fireEvent.change(whoInput, { target: { value: 'Student and Prof' } });
      
      vi.mocked(fetchGeminiText).mockResolvedValue({
        totalScore: 90,
        overallFeedback: 'Good',
        fieldEvaluations: []
      });

      const submitBtn = await screen.findByText(/提交笔记并分析|提交逻辑批改/i);
      fireEvent.click(submitBtn);
      
      await waitFor(() => {
        expect(screen.getByText(/Score: 90/i)).toBeDefined();
      });
    });
  });
});
