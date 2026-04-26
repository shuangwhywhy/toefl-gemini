import { FormEvent, useState } from 'react';
import { Keyboard, RefreshCw, Send } from 'lucide-react';

export function TextFallbackPanel({
  isSubmitting,
  onSubmit
}: {
  isSubmitting: boolean;
  onSubmit: (transcript: string) => Promise<void>;
}) {
  const [transcript, setTranscript] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = transcript.trim();
    if (!trimmed || isSubmitting) {
      return;
    }

    await onSubmit(trimmed);
    setTranscript('');
  };

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-bold text-slate-600">
        <span className="inline-flex items-center">
          <Keyboard className="mr-2 inline h-4 w-4" />
          Use text fallback
        </span>
      </summary>
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-3">
        <textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          rows={5}
          placeholder="Type a fallback answer only if recording is unavailable..."
          className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={!transcript.trim() || isSubmitting}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Submit text fallback
          </button>
        </div>
      </form>
    </details>
  );
}
