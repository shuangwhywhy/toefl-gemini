import type { TranscriptSegment } from '../../types';

export type TimedTranscriptViewProps = {
  displayTranscript?: string;
  displayTranscriptSegments?: TranscriptSegment[];
  durationSec?: number;
};

export function TimedTranscriptView({
  displayTranscript,
  displayTranscriptSegments,
  durationSec,
}: TimedTranscriptViewProps) {
  const hasSegments = Array.isArray(displayTranscriptSegments) && displayTranscriptSegments.length > 0;

  if (hasSegments) {
    let cutoffMarkerInserted = false;

    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Display Transcript
        </div>
        <div className="space-y-2 text-sm leading-relaxed">
          {displayTranscriptSegments.map((segment, index) => {
            const afterCutoff = Boolean(segment.afterCutoff);
            const startSec = typeof segment.startSec === 'number' ? segment.startSec : 0;
            const endSec = typeof segment.endSec === 'number' ? segment.endSec : 0;
            
            let insertMarkerHere = false;
            if (!cutoffMarkerInserted) {
              // Insert marker if this is the first segment marked as afterCutoff 
              // OR if it's the first segment starting at or after 45s
              if (afterCutoff || startSec >= 45) {
                insertMarkerHere = true;
                cutoffMarkerInserted = true;
              }
            }

            return (
              <div key={`${index}-${startSec}`}>
                {insertMarkerHere && (
                  <div className="my-3 border-t-2 border-dashed border-rose-400 pt-2 text-[11px] font-bold uppercase tracking-wide text-rose-500">
                    45s cutoff
                    <span className="ml-2 font-normal normal-case text-rose-400">
                      Content below may be too late for real scoring.
                    </span>
                  </div>
                )}
                <p
                  className={
                    afterCutoff
                      ? 'text-slate-400 line-through decoration-rose-300'
                      : 'text-slate-700'
                  }
                >
                  <span className="mr-2 text-[10px] font-mono font-medium text-slate-400 bg-slate-100 px-1 py-0.5 rounded">
                    [{startSec}-{endSec}s]
                  </span>
                  {segment.text}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (displayTranscript) {
    const isOvertime = durationSec !== undefined && durationSec > 45;
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Display Transcript
        </div>
        {isOvertime && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
            45s cutoff marker unavailable because segment timestamps were not returned.
            Review pacing using the timing card above.
          </div>
        )}
        <p className="text-sm leading-relaxed text-slate-700">
          {displayTranscript}
        </p>
      </div>
    );
  }

  return null;
}
