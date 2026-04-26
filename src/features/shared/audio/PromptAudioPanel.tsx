import React, { useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Headphones,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Square,
  Volume2
} from 'lucide-react';
import { HighlightedPromptText } from './HighlightedPromptText';
import { usePromptAudioPlayer } from './usePromptAudioPlayer';

export type PromptAudioPanelProps = {
  text: string;
  showText: boolean;
  listenCount: number;
  audioUrl?: string;
  audioStatus?: 'idle' | 'loading' | 'ready' | 'failed';
  
  title?: string;
  hiddenTextLabel?: string;
  playButtonLabel?: string;
  resumeButtonLabel?: string;
  replayButtonLabel?: string;
  
  showListenCount?: boolean;
  showSpeedControl?: boolean;
  showTextToggle?: boolean;
  highlightText?: boolean;
  forceStop?: boolean;

  extraTopControls?: React.ReactNode;
  extraBottomControls?: React.ReactNode;

  onShowTextChange: (showText: boolean) => void;
  onEnsureAudio: () => Promise<string | null>;
  onPlaybackStarted: () => void;
  onListenCompleted: () => void;
};

export function PromptAudioPanel({
  text,
  showText,
  listenCount,
  audioUrl,
  audioStatus,
  
  title = 'Audio prompt',
  hiddenTextLabel = 'Prompt text hidden',
  playButtonLabel = 'Play prompt',
  resumeButtonLabel = 'Resume',
  replayButtonLabel = 'Replay',
  
  showListenCount = true,
  showSpeedControl = true,
  showTextToggle = true,
  highlightText = true,
  forceStop = false,

  extraTopControls,
  extraBottomControls,

  onShowTextChange,
  onEnsureAudio,
  onPlaybackStarted,
  onListenCompleted
}: PromptAudioPanelProps) {
  const player = usePromptAudioPlayer({
    text,
    audioUrl,
    onEnsureAudio,
    onPlaybackStarted,
    onListenCompleted
  });
  const isLoading = player.isLoading || audioStatus === 'loading';

  useEffect(() => {
    if (forceStop) {
      player.stop();
    }
  }, [forceStop, player]);

  return (
    <div className="space-y-4">
      <audio
        ref={player.audioRef}
        onEnded={player.handleEnded}
        onTimeUpdate={player.handleTimeUpdate}
        className="hidden"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm">
            <span className="inline-flex items-center gap-1.5" title={title}>
              <Volume2 className="h-3.5 w-3.5 text-cyan-600" />
              {title}
            </span>
            
            {showListenCount && (
              <>
                <span className="h-3.5 w-px bg-slate-200" />
                <span className="inline-flex items-center gap-1.5" title="Completed listens">
                  <Headphones className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-bold text-slate-800">{listenCount}</span>
                </span>
              </>
            )}
            
            {showSpeedControl && (
              <>
                <span className="h-3.5 w-px bg-slate-200" />
                <label className="inline-flex items-center gap-1.5">
                  <Settings className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={player.rate}
                    onChange={(event) => player.setRate(Number(event.target.value))}
                    className="bg-transparent text-xs font-bold text-slate-700 outline-none"
                    aria-label="Prompt audio speed"
                  >
                    <option value="0.8">0.8x</option>
                    <option value="1">1.0x</option>
                    <option value="1.2">1.2x</option>
                  </select>
                </label>
              </>
            )}
          </div>
          {extraTopControls}
        </div>

        {showTextToggle && (
          <button
            type="button"
            onClick={() => onShowTextChange(!showText)}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {showText ? (
              <EyeOff className="mr-2 h-4 w-4" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            {showText ? 'Hide prompt text' : 'Show prompt text'}
          </button>
        )}
      </div>

      <div className="min-h-[88px] rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
        {showText ? (
          highlightText ? (
            <HighlightedPromptText
              text={text}
              highlightStart={player.highlightStart}
              highlightLength={player.highlightLength}
            />
          ) : (
            <p className="text-base leading-relaxed text-slate-800 whitespace-pre-wrap font-medium">
              {text}
            </p>
          )
        ) : (
          <button
            type="button"
            onClick={() => onShowTextChange(true)}
            className="flex min-h-[56px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 transition hover:border-cyan-300 hover:text-cyan-600"
            disabled={!showTextToggle}
          >
            <Eye className="mb-1 h-6 w-6 opacity-60" />
            <span className="text-xs font-bold uppercase tracking-wide">
              {hiddenTextLabel}
            </span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {player.isPlaying ? (
            <button
              type="button"
              onClick={player.pause}
              className="inline-flex items-center rounded-lg bg-cyan-100 px-4 py-2 text-sm font-bold text-cyan-800 hover:bg-cyan-200"
            >
              <Pause className="mr-2 h-4 w-4 fill-current" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void player.play()}
              disabled={isLoading || !text}
              className="inline-flex items-center rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4 fill-current" />
              )}
              {isLoading ? 'Loading audio...' : player.isPaused ? resumeButtonLabel : playButtonLabel}
            </button>
          )}

          <button
            type="button"
            onClick={player.stop}
            disabled={!player.isPlaying && !player.isPaused}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Square className="mr-2 h-4 w-4 fill-current" />
            Stop
          </button>

          <button
            type="button"
            onClick={() => void player.replay()}
            disabled={isLoading || !text}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {replayButtonLabel}
          </button>
        </div>
        {extraBottomControls && (
          <div className="flex items-center gap-2">
            {extraBottomControls}
          </div>
        )}
      </div>

      {(player.error || audioStatus === 'failed') && (
        <p className="text-sm text-amber-700">
          {player.error ?? 'Prompt audio could not be loaded. Try replaying.'}
        </p>
      )}
    </div>
  );
}
