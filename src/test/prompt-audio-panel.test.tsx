import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { PromptAudioPanel } from '../features/shared/audio/PromptAudioPanel';

// Mock usePromptAudioPlayer
vi.mock('../features/shared/audio/usePromptAudioPlayer', () => ({
  usePromptAudioPlayer: vi.fn().mockReturnValue({
    audioRef: { current: null },
    rate: 1,
    setRate: vi.fn(),
    isPlaying: false,
    isPaused: false,
    isLoading: false,
    error: null,
    highlightStart: 0,
    highlightLength: 0,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    replay: vi.fn(),
    handleEnded: vi.fn(),
    handleTimeUpdate: vi.fn()
  })
}));

describe('PromptAudioPanel', () => {
  const defaultProps = {
    text: 'This is a test prompt',
    showText: true,
    listenCount: 2,
    audioUrl: 'mock-audio.mp3',
    onShowTextChange: vi.fn(),
    onEnsureAudio: vi.fn().mockResolvedValue('mock-audio.mp3'),
    onPlaybackStarted: vi.fn(),
    onListenCompleted: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default props', () => {
    render(<PromptAudioPanel {...defaultProps} />);
    expect(screen.getByText('This is a test prompt')).toBeInTheDocument();
    expect(screen.getByText('Audio prompt')).toBeInTheDocument();
    expect(screen.getByTitle('Completed listens')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('allows customizing labels via props', () => {
    render(
      <PromptAudioPanel 
        {...defaultProps} 
        title="Shadowing Prompt" 
        playButtonLabel="播放神经语音"
        resumeButtonLabel="继续播放"
        replayButtonLabel="重新播放"
      />
    );
    expect(screen.getByText('Shadowing Prompt')).toBeInTheDocument();
    expect(screen.getByText('播放神经语音')).toBeInTheDocument();
    expect(screen.getByText('重新播放')).toBeInTheDocument();
  });

  it('toggles text visibility', () => {
    render(<PromptAudioPanel {...defaultProps} showText={false} hiddenTextLabel="Text Hidden" />);
    expect(screen.queryByText('This is a test prompt')).not.toBeInTheDocument();
    expect(screen.getByText('Text Hidden')).toBeInTheDocument();

    const showButton = screen.getByRole('button', { name: /Text Hidden/i });
    fireEvent.click(showButton);
    expect(defaultProps.onShowTextChange).toHaveBeenCalledWith(true);
  });

  it('renders extra controls', () => {
    render(
      <PromptAudioPanel 
        {...defaultProps} 
        extraTopControls={<div data-testid="extra-top">Top Control</div>}
        extraBottomControls={<div data-testid="extra-bottom">Bottom Control</div>}
      />
    );
    expect(screen.getByTestId('extra-top')).toBeInTheDocument();
    expect(screen.getByTestId('extra-bottom')).toBeInTheDocument();
  });

  it('disables speed and listen count controls when specified', () => {
    render(
      <PromptAudioPanel 
        {...defaultProps} 
        showSpeedControl={false} 
        showListenCount={false} 
      />
    );
    expect(screen.queryByTitle('Completed listens')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt audio speed')).not.toBeInTheDocument();
  });
});
