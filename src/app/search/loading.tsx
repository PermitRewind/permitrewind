export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6" aria-busy="true" aria-live="polite">
      <p className="text-sm text-slate-500 mb-4">Searching permit records…</p>
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-slate-200" />)}
      </div>
    </div>
  );
}
