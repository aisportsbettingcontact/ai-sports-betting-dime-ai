/**
 * MobileLoadingState — Polished skeleton loading for mobile owner tabs.
 * Renders animated pulse cards matching the dark mobile theme.
 */
export function MobileLoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-6 animate-in fade-in duration-300">
      <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">{label}</p>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-4 animate-pulse"
        >
          <div className="h-3 w-24 bg-zinc-700/50 rounded mb-3" />
          <div className="h-4 w-48 bg-zinc-700/40 rounded mb-2" />
          <div className="h-3 w-32 bg-zinc-700/30 rounded" />
        </div>
      ))}
    </div>
  );
}
