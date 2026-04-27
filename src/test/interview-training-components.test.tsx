import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIRecommendationCard } from '../features/interview/training/components/AIRecommendationCard';
import { NewTrainingSetButton } from '../features/interview/training/components/NewTrainingSetButton';

describe('Interview Training Components', () => {
  describe('AIRecommendationCard', () => {
    it('renders and handles click', () => {
      const onGo = vi.fn();
      const recommendation = {
        stage: 'role_play',
        reason: 'Good progress'
      } as any;

      render(<AIRecommendationCard recommendation={recommendation} onGoToRecommendation={onGo} />);
      
      expect(screen.getByText('Good progress')).toBeDefined();
      fireEvent.click(screen.getByRole('button'));
      expect(onGo).toHaveBeenCalledWith(recommendation);
    });

    it('uses actionLabel if provided', () => {
      const recommendation = {
        stage: 'role_play',
        reason: 'Reason',
        actionLabel: 'Custom Action'
      } as any;

      render(<AIRecommendationCard recommendation={recommendation} onGoToRecommendation={vi.fn()} />);
      expect(screen.getByText('Custom Action')).toBeDefined();
    });
  });

  describe('NewTrainingSetButton', () => {
    it('handles confirmation and click', async () => {
      const onNew = vi.fn();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      
      render(<NewTrainingSetButton disabled={false} onNewTrainingSet={onNew} />);
      
      fireEvent.click(screen.getByText('New Training Set'));
      expect(window.confirm).toHaveBeenCalled();
      expect(onNew).toHaveBeenCalled();
    });

    it('does nothing if cancelled', async () => {
      const onNew = vi.fn();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      
      render(<NewTrainingSetButton disabled={false} onNewTrainingSet={onNew} />);
      
      fireEvent.click(screen.getByText('New Training Set'));
      expect(onNew).not.toHaveBeenCalled();
    });
  });
});
