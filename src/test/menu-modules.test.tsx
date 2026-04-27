import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MainMenuModule, SpeakingMenuModule, type PreloadStatus } from '../features/navigation/MenuModules';

describe('MenuModules', () => {
  it('renders MainMenuModule and triggers navigation', () => {
    const onNavigate = vi.fn();
    render(<MainMenuModule onNavigate={onNavigate} />);
    
    const listeningBtn = screen.getByText(/听力/i);
    
    expect(listeningBtn).toBeDefined();
    
    fireEvent.click(listeningBtn);
    expect(onNavigate).toHaveBeenCalledWith('listening_menu');
  });

  it('renders SpeakingMenuModule and triggers navigation', () => {
    const onNavigate = vi.fn();
    const onBack = vi.fn();
    const preloadStatus: PreloadStatus = {
      shadow: false,
      interview: false,
      listening: false,
      dictation: false,
      shadowError: false,
      interviewError: false,
      listeningError: false,
      dictationError: false
    };
    render(<SpeakingMenuModule onNavigate={onNavigate} onBack={onBack} preloadStatus={preloadStatus} />);
    
    const shadowBtn = screen.getByText(/Repeat/i);
    fireEvent.click(shadowBtn);
    expect(onNavigate).toHaveBeenCalledWith('shadow');
  });
});
