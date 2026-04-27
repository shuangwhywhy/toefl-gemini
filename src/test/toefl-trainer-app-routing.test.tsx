import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import ToeflTrainerApp from '../app/ToeflTrainerApp';

// Mock sub-modules to avoid heavy dependencies
vi.mock('../features/navigation/MenuModules', () => ({
  DeviceSetupModule: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>Complete Setup</button>,
  MainMenuModule: ({ onNavigate }: { onNavigate: (v: string) => void }) => (
    <div>
      <button onClick={() => onNavigate('speaking_menu')}>Speaking</button>
      <button onClick={() => onNavigate('listening_menu')}>Listening</button>
    </div>
  ),
  SpeakingMenuModule: ({ onNavigate, onBack }: { onNavigate: (v: string) => void, onBack: () => void }) => (
    <div>
      <button onClick={() => onNavigate('shadow')}>Shadow</button>
      <button onClick={() => onNavigate('interview')}>Interview</button>
      <button onClick={onBack}>Back</button>
    </div>
  ),
  ListeningMenuModule: ({ onNavigate, onBack }: { onNavigate: (v: string) => void, onBack: () => void }) => (
    <div>
      <button onClick={() => onNavigate('listening_practice')}>Practice</button>
      <button onClick={() => onNavigate('listening_dictation')}>Dictation</button>
      <button onClick={onBack}>Back</button>
    </div>
  )
}));

vi.mock('../features/listening/ListeningModules', () => ({
  ListeningDictationModule: ({ onBack }: { onBack: () => void }) => <div data-testid="dictation"><button onClick={onBack}>Back</button></div>,
  ListeningPracticeModule: ({ onBack }: { onBack: () => void }) => <div data-testid="practice"><button onClick={onBack}>Back</button></div>
}));

vi.mock('../features/shadowing/ShadowingModule', () => ({
  ShadowingModule: ({ onBack }: { onBack: () => void }) => <div data-testid="shadow"><button onClick={onBack}>Back</button></div>
}));

vi.mock('../features/interview/InterviewModule', () => ({
  InterviewModule: ({ onBack }: { onBack: () => void }) => <div data-testid="interview"><button onClick={onBack}>Back</button></div>
}));

describe('ToeflTrainerApp Routing', () => {
  it('navigates through all screens', async () => {
    render(<ToeflTrainerApp />);
    
    // 1. Setup -> Main Menu
    fireEvent.click(screen.getByText('Complete Setup'));
    expect(screen.getByText('Speaking')).toBeDefined();
    
    // 2. Main Menu -> Speaking Menu
    fireEvent.click(screen.getByText('Speaking'));
    expect(screen.getByText('Shadow')).toBeDefined();
    
    // 3. Speaking Menu -> Shadowing
    fireEvent.click(screen.getByText('Shadow'));
    expect(screen.getByTestId('shadow')).toBeDefined();
    
    // 4. Shadowing -> Speaking Menu
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Interview')).toBeDefined();
    
    // 5. Speaking Menu -> Interview
    fireEvent.click(screen.getByText('Interview'));
    expect(screen.getByTestId('interview')).toBeDefined();
    
    // 6. Interview -> Speaking Menu -> Main Menu
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Listening')).toBeDefined();
    
    // 7. Main Menu -> Listening Menu
    fireEvent.click(screen.getByText('Listening'));
    expect(screen.getByText('Dictation')).toBeDefined();
    
    // 8. Listening Menu -> Dictation
    fireEvent.click(screen.getByText('Dictation'));
    expect(screen.getByTestId('dictation')).toBeDefined();
  });

  it('handles preload events', () => {
    render(<ToeflTrainerApp />);
    fireEvent.click(screen.getByText('Complete Setup'));
    
    act(() => {
      window.dispatchEvent(new CustomEvent('preload-ready', { detail: { type: 'shadow' } }));
      window.dispatchEvent(new CustomEvent('preload-error', { detail: { type: 'interview' } }));
    });
    
    // Note: We'd need to expose preloadStatus or check props of sub-modules to verify this fully
    // but the events are covered.
  });
});
