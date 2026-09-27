/**
 * Time/day marker dropped between two turns that are far enough apart.
 * The label itself comes from `lib/date`'s `chatSeparatorLabel`.
 */
export function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 border-t border-subtle" />
      <span className="flex-shrink-0 rounded-full border border-subtle bg-bg-2 px-2.5 py-0.5 font-mono text-micro uppercase text-txt-3">
        {label}
      </span>
      <div className="h-px flex-1 border-t border-subtle" />
    </div>
  );
}
