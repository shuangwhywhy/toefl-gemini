import { RefreshCw } from 'lucide-react';

export function NewTrainingSetButton({
  disabled,
  onNewTrainingSet
}: {
  disabled: boolean;
  onNewTrainingSet: () => Promise<void>;
}) {
  const handleClick = async () => {
    const confirmed = window.confirm(
      'This will archive your current interview training session and start a new one. Continue?'
    );
    if (!confirmed) {
      return;
    }
    await onNewTrainingSet();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void handleClick()}
      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCw className="mr-2 h-4 w-4" />
      New Training Set
    </button>
  );
}
