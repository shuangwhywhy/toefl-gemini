import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimeAnalysisCard } from '../features/interview/training/components/TimeAnalysisCard';
import { QuestionComprehensionCard } from '../features/interview/training/components/QuestionComprehensionCard';
import { CrossQuestionConsistencyCard } from '../features/interview/training/components/CrossQuestionConsistencyCard';
import { TimedTranscriptView } from '../features/interview/training/components/TimedTranscriptView';

describe('Interview Training Result UI Cards', () => {
  describe('TimeAnalysisCard', () => {
    it('renders correctly when timing is enabled and category is good', () => {
      render(
        <TimeAnalysisCard
          timingEnabled={true}
          analysis={{
            durationSec: 38,
            cutoffSec: 45,
            category: 'good',
            beforeCutoffSummary: 'Great point',
            pacingAdvice: 'Keep it up',
          }}
        />
      );
      expect(screen.getByText(/Ideal window/)).toBeInTheDocument();
      expect(screen.getByText(/38s/)).toBeInTheDocument();
      expect(screen.getByText(/Great point/)).toBeInTheDocument();
      expect(screen.getByText(/Keep it up/)).toBeInTheDocument();
    });

    it('renders correctly when timing is disabled', () => {
      render(
        <TimeAnalysisCard
          timingEnabled={false}
          analysis={{
            durationSec: 38,
            cutoffSec: 45,
            category: 'good',
            beforeCutoffSummary: 'Great point',
            pacingAdvice: 'Keep it up',
          }}
        />
      );
      // Shouldn't show the strict category label
      expect(screen.queryByText(/Ideal window/)).not.toBeInTheDocument();
      expect(screen.getByText(/38s/)).toBeInTheDocument();
      expect(screen.getByText(/Strict timing is not enforced/)).toBeInTheDocument();
    });
  });

  describe('QuestionComprehensionCard', () => {
    it('renders correctly for likely answered from listening', () => {
      render(
        <QuestionComprehensionCard
          analysis={{
            promptTextVisibleOnSubmit: false,
            promptTextWasEverShown: false,
            promptListenCount: 2,
            likelyAnsweredFromListening: true,
            evidence: 'Did not view text.',
          }}
        />
      );
      expect(screen.getByText(/Likely answered from listening/)).toBeInTheDocument();
      expect(screen.getByText(/Did not view text./)).toBeInTheDocument();
    });
  });

  describe('CrossQuestionConsistencyCard', () => {
    it('renders no context message when includedQuestionIds is empty', () => {
      render(
        <CrossQuestionConsistencyCard
          consistency={{
            includedQuestionIds: [],
            contradictions: [],
            consistencySummary: '',
            suggestedFix: '',
          }}
        />
      );
      expect(
        screen.getByText(/will appear after other answered questions are available/)
      ).toBeInTheDocument();
    });

    it('renders contradictions correctly', () => {
      render(
        <CrossQuestionConsistencyCard
          consistency={{
            includedQuestionIds: ['q1', 'q2'],
            contradictions: ['Contradiction 1'],
            consistencySummary: 'Found issues',
            suggestedFix: 'Fix it',
          }}
        />
      );
      expect(screen.getByText(/Contradiction 1/)).toBeInTheDocument();
      expect(screen.getByText(/Fix it/)).toBeInTheDocument();
    });
  });

  describe('TimedTranscriptView', () => {
    it('renders segments and inserts 45s cutoff marker appropriately', () => {
      render(
        <TimedTranscriptView
          displayTranscriptSegments={[
            { startSec: 0, endSec: 30, text: 'Part 1', afterCutoff: false },
            { startSec: 46, endSec: 50, text: 'Part 2', afterCutoff: true },
          ]}
        />
      );
      expect(screen.getByText(/Part 1/)).toBeInTheDocument();
      expect(screen.getByText(/Part 2/)).toBeInTheDocument();
      expect(screen.getByText(/45s cutoff/i)).toBeInTheDocument();
    });

    it('renders displayTranscript fallback', () => {
      render(<TimedTranscriptView displayTranscript="Just text fallback" durationSec={50} />);
      expect(screen.getByText(/Just text fallback/)).toBeInTheDocument();
      expect(screen.getByText(/45s cutoff marker unavailable/)).toBeInTheDocument();
    });

    it('only renders 45s cutoff marker once', () => {
      render(
        <TimedTranscriptView
          displayTranscriptSegments={[
            { startSec: 46, endSec: 50, text: 'Late 1', afterCutoff: true },
            { startSec: 51, endSec: 55, text: 'Late 2', afterCutoff: true },
          ]}
        />
      );
      const markers = screen.queryAllByText(/45s cutoff/i);
      expect(markers.length).toBe(1);
    });

    it('applies line-through class to afterCutoff segments', () => {
      render(
        <TimedTranscriptView
          displayTranscriptSegments={[
            { startSec: 46, endSec: 50, text: 'Strikethrough text', afterCutoff: true },
          ]}
        />
      );
      const segment = screen.getByText(/Strikethrough text/).closest('p');
      expect(segment).toHaveClass('line-through');
    });
  });
});
