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
  playButtonLabel = 'Play',
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

  const stopPlayer = player.stop;
  useEffect(() => {
    if (forceStop) {
      stopPlayer();
    }
  }, [forceStop, stopPlayer]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/80 p-5 shadow-sm backdrop-blur-xl transition-all hover:shadow-md group/panel">
      <audio
        ref={player.audioRef}
        onEnded={player.handleEnded}
        onTimeUpdate={player.handleTimeUpdate}
        className="hidden"
      />

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
            <Headphones className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
            {showListenCount && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                <span className="uppercase tracking-wider">Listen count:</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  {listenCount}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {extraTopControls}
          {showSpeedControl && (
            <div className="flex items-center gap-1 rounded-full bg-slate-100/50 p-1">
              <button
                type="button"
                onClick={() =>
                  player.setRate(player.rate === 1 ? 0.8 : player.rate === 0.8 ? 1.2 : 1)
                }
                className="flex h-7 px-2 items-center gap-1.5 rounded-full text-[10px] font-bold text-slate-600 transition hover:bg-white hover:shadow-sm active:scale-95"
              >
                <span className="opacity-60">{player.rate}x</span>
              </button>
            </div>
          )}
          {showTextToggle && (
            <button
              type="button"
              onClick={() => onShowTextChange(!showText)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-cyan-600 transition-colors"
            >
              {showText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-slate-50/30 p-4 transition-colors group-hover/panel:bg-slate-50/50">
        {showText ? (
          <div className="relative flex min-h-[56px] items-center">
            {highlightText ? (
              <HighlightedPromptText
                text={text}
                highlightStart={player.highlightStart}
                highlightLength={player.highlightLength}
              />
            ) : (
              <p className="text-base leading-relaxed text-slate-800 whitespace-pre-wrap">
                {text}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onShowTextChange(true)}
            className="flex min-h-[56px] w-full flex-row items-center justify-center gap-3 rounded-lg text-slate-400 transition hover:text-cyan-600 group"
            disabled={!showTextToggle}
          >
            <Eye className="h-5 w-5 opacity-40 group-hover:opacity-100 transition-opacity" />
            <span className="text-sm font-bold uppercase tracking-widest">
              {hiddenTextLabel}
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-center">
        <div className="flex items-center rounded-full bg-slate-100/40 p-1.5 shadow-inner">
          <div className="flex items-center gap-1 pr-3">
            {player.isPlaying ? (
              <button
                type="button"
                onClick={player.pause}
                title="Pause"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-white shadow-md transition hover:bg-cyan-700 active:scale-95"
              >
                <Pause className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void player.play()}
                disabled={isLoading || !text}
                title={player.isPaused ? resumeButtonLabel : playButtonLabel}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-white shadow-md transition hover:bg-cyan-700 active:scale-95 disabled:opacity-50"
              >
                {isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={player.stop}
              disabled={!player.isPlaying && !player.isPaused}
              title="Stop"
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-20"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>

            <button
              type="button"
              onClick={() => void player.replay()}
              disabled={isLoading || !text}
              title={replayButtonLabel}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-20"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          {extraBottomControls && (
            <div className="flex items-center gap-2 border-l border-slate-200/80 pl-3">
              {extraBottomControls}
            </div>
          )}
        </div>
      </div>

      {(player.error || audioStatus === 'failed') && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          <RefreshCw className="h-3 w-3" />
          {player.error ?? 'Prompt audio failed. Try replaying.'}
        </div>
      )}
    </div>
  );
}
