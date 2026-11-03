"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SearchMode } from "@/lib/types";

const MODES: { id: SearchMode; label: string; placeholder: string }[] = [
  { id: "address", label: "Address", placeholder: "e.g. 3524 Longview Ln" },
  { id: "parcel", label: "Parcel ID", placeholder: "e.g. 24-28-15-000000-012345" },
  { id: "permit", label: "Permit #", placeholder: "e.g. BT-2026-14923" },
];

export default function SearchForm({ initialMode = "address", initialQ = "", compact = false }: { initialMode?: SearchMode; initialQ?: string; compact?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [q, setQ] = useState(initialQ);
  const [pending, setPending] = useState(false);
  const current = MODES.find((m) => m.id === mode)!;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setPending(true);
    router.push(`/search?mode=${mode}&q=${encodeURIComponent(q.trim())}`);
    setTimeout(() => setPending(false), 1500);
  }

  return (
    <form onSubmit={submit} className={`no-print w-full ${compact ? "" : "max-w-2xl mx-auto"}`} role="search">
      <div className="flex gap-1 mb-2" role="tablist" aria-label="Search by">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${mode === m.id ? (compact ? "bg-navy-700 text-white" : "bg-white text-navy-900") : compact ? "text-slate-600 hover:bg-slate-200" : "text-slate-200 hover:bg-white/10"}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <label htmlFor="q" className="sr-only">{current.label}</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={current.placeholder} autoComplete="off"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        <button type="submit" disabled={pending || !q.trim()}
          className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 px-6 py-3 font-semibold text-white shadow-sm">
          {pending ? "Searching…" : "Search permits"}
        </button>
      </div>
    </form>
  );
}
