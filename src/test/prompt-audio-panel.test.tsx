import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { PromptAudioPanel } from '../features/shared/audio/PromptAudioPanel';

// Mock usePromptAudioPlayer
const { usePromptAudioPlayerMock } = vi.hoisted(() => ({
  usePromptAudioPlayerMock: vi.fn().mockReturnValue({
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

vi.mock('../features/shared/audio/usePromptAudioPlayer', () => ({
  usePromptAudioPlayer: usePromptAudioPlayerMock
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
    expect(screen.getByText(/Listen count:/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    
    // Check default buttons
    expect(screen.getByTitle('Play')).toBeInTheDocument();
    expect(screen.getByTitle('Stop')).toBeInTheDocument();
    expect(screen.getByTitle('Replay')).toBeInTheDocument();
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
    expect(screen.getByTitle('播放神经语音')).toBeInTheDocument();
    expect(screen.getByTitle('重新播放')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    usePromptAudioPlayerMock.mockReturnValueOnce({
      ...usePromptAudioPlayerMock(),
      isLoading: true
    } as unknown as ReturnType<typeof usePromptAudioPlayerMock>);

    const { container } = render(<PromptAudioPanel {...defaultProps} />);
    // RefreshCw icon with animate-spin class should be present
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders error state', () => {
    usePromptAudioPlayerMock.mockReturnValueOnce({
      ...usePromptAudioPlayerMock(),
      error: 'Test Error Message'
    } as unknown as ReturnType<typeof usePromptAudioPlayerMock>);

    render(<PromptAudioPanel {...defaultProps} />);
    expect(screen.getByText('Test Error Message')).toBeInTheDocument();
  });

  it('renders paused state with resume label', () => {
    usePromptAudioPlayerMock.mockReturnValueOnce({
      ...usePromptAudioPlayerMock(),
      isPaused: true
    } as unknown as ReturnType<typeof usePromptAudioPlayerMock>);

    render(<PromptAudioPanel {...defaultProps} resumeButtonLabel="Resume Me" />);
    expect(screen.getByTitle('Resume Me')).toBeInTheDocument();
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
    expect(screen.queryByText(/Listen count/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1x/i)).not.toBeInTheDocument();
  });

  it('renders loading status correctly', () => {
    render(<PromptAudioPanel {...defaultProps} audioStatus="loading" />);
    // When loading, RefreshCw icon with animate-spin should be visible
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders failed status correctly', () => {
    render(<PromptAudioPanel {...defaultProps} audioStatus="failed" />);
    expect(screen.getByText(/Audio failed/i)).toBeInTheDocument();
  });

  it('respects UI visibility flags', () => {
    const { rerender } = render(
      <PromptAudioPanel 
        {...defaultProps} 
        showSpeedControl={false} 
        showListenCount={false} 
        showTextToggle={false} 
      />
    );

    expect(screen.queryByText(/1x/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Listen count:/i)).not.toBeInTheDocument();
    // The toggle button should be absent
    expect(document.querySelector('.lucide-eye')).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-eye-off')).not.toBeInTheDocument();

    rerender(
      <PromptAudioPanel 
        {...defaultProps} 
        showSpeedControl={true} 
        showListenCount={true} 
        showTextToggle={true} 
      />
    );

    expect(screen.getByText(/1x/i)).toBeInTheDocument();
    expect(screen.getByText(/Listen count:/i)).toBeInTheDocument();
    // Eye icon is visible because showText is true by default
    expect(document.querySelector('.lucide-eye-off')).toBeInTheDocument();
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

  it('applies highlighting when playing and enabled', () => {
    usePromptAudioPlayerMock.mockReturnValueOnce({
      ...usePromptAudioPlayerMock(),
      isPlaying: true,
      highlightStart: 0,
      highlightLength: 4
    } as unknown as ReturnType<typeof usePromptAudioPlayerMock>);

    const { container } = render(
      <PromptAudioPanel 
        {...defaultProps} 
        highlightText={true} 
      />
    );

    // HighlightedPromptText renders spans, the highlighted one has bg-cyan-50
    const highlighted = container.querySelector('.relative .bg-cyan-50');
    expect(highlighted).toBeInTheDocument();
    expect(highlighted).toHaveTextContent('This');
  });

  it('does not apply highlighting when disabled', () => {
    usePromptAudioPlayerMock.mockReturnValueOnce({
      ...usePromptAudioPlayerMock(),
      isPlaying: true,
      highlightStart: 0,
      highlightLength: 4
    } as unknown as ReturnType<typeof usePromptAudioPlayerMock>);

    const { container } = render(
      <PromptAudioPanel 
        {...defaultProps} 
        highlightText={false} 
      />
    );

    expect(container.querySelector('.relative .bg-cyan-50')).not.toBeInTheDocument();
  });

  it('calls stop when forceStop becomes true', () => {
    const stopSpy = vi.fn();
    usePromptAudioPlayerMock.mockReturnValue({
      ...usePromptAudioPlayerMock(),
      stop: stopSpy
    } as unknown as ReturnType<typeof usePromptAudioPlayerMock>);

    const { rerender } = render(<PromptAudioPanel {...defaultProps} forceStop={false} />);
    expect(stopSpy).not.toHaveBeenCalled();

    rerender(<PromptAudioPanel {...defaultProps} forceStop={true} />);
    expect(stopSpy).toHaveBeenCalled();
  });
});
