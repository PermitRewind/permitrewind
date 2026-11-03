"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-navy-900">Something went wrong</h1>
      <p className="mt-2 text-slate-600">Please try again in a moment.</p>
      <button onClick={reset} className="mt-4 rounded-md bg-navy-700 px-4 py-2 text-white">Try again</button>
    </div>
  );
}
