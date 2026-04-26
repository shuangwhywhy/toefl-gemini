export function HighlightedPromptText({
  text,
  highlightStart,
  highlightLength
}: {
  text: string;
  highlightStart: number;
  highlightLength: number;
}) {
  if (highlightLength <= 0) {
    return (
      <p className="text-base font-normal leading-relaxed text-slate-900 md:text-lg">
        {text}
      </p>
    );
  }

  const before = text.substring(0, highlightStart);
  const highlighted = text.substring(
    highlightStart,
    highlightStart + highlightLength
  );
  const after = text.substring(highlightStart + highlightLength);

  return (
    <p className="text-base font-normal leading-relaxed text-slate-500 md:text-lg">
      <span>{before}</span>
      <span className="rounded bg-cyan-50 px-1 text-cyan-700 transition-colors">
        {highlighted}
      </span>
      <span className="text-slate-900">{after}</span>
    </p>
  );
}
