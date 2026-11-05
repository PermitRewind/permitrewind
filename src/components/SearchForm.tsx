"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AddressSuggestInput from "@/components/AddressSuggestInput";
import { isAddressSearchEnabled } from "@/lib/address-combobox";
import type { AddressSuggestion } from "@/lib/address-suggest";
import type { SearchMode } from "@/lib/types";

const MODES: { id: SearchMode; label: string; placeholder: string }[] = [
  { id: "address", label: "Address", placeholder: "e.g. 19156 Dove Creek Dr, Tampa" },
  { id: "parcel", label: "Parcel ID", placeholder: "e.g. 24-28-15-000000-012345" },
  { id: "permit", label: "Permit #", placeholder: "e.g. BT-2026-14923" },
];

export default function SearchForm({
  initialMode = "address",
  initialQ = "",
  compact = false,
  initialSelection = null,
  suggestOnMount = false,
}: {
  initialMode?: SearchMode;
  initialQ?: string;
  compact?: boolean;
  initialSelection?: { label: string; token: string } | null;
  suggestOnMount?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [q, setQ] = useState(initialQ);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<{ label: string; token: string } | null>(
    initialSelection && initialSelection.label === initialQ.trim() ? initialSelection : null,
  );
  const current = MODES.find((m) => m.id === mode)!;
  const canSearch = isAddressSearchEnabled({ mode, text: q, selected });

  function go(next: string, token?: string) {
    const text = next.trim();
    if (!text) return;
    setQ(text);
    setPending(true);
    const params = new URLSearchParams({ mode, q: text });
    if (mode === "address" && token) params.set("sel", token);
    router.push(`/search?${params}`);
    setTimeout(() => setPending(false), 1500);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    go(q, mode === "address" ? selected?.token : undefined);
  }

  function onAddressChange(text: string) {
    setQ(text);
    setSelected((cur) => (cur && cur.label === text.trim() ? cur : null));
  }

  function onAddressSelect(suggestion: AddressSuggestion) {
    if (!suggestion.token) return;
    setQ(suggestion.label);
    setSelected({ label: suggestion.label, token: suggestion.token });
  }

  return (
    <form onSubmit={submit} className={`no-print w-full ${compact ? "" : "max-w-2xl mx-auto"}`} role="search">
      <div className="flex gap-1 mb-2" role="tablist" aria-label="Search by">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${mode === m.id ? (compact ? "bg-brand-600 text-white" : "bg-white text-neutral-950") : compact ? "text-slate-600 hover:bg-slate-200" : "text-neutral-300 hover:bg-white/10"}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <label htmlFor="q" className="sr-only">{current.label}</label>
        {mode === "address" ? (
          <AddressSuggestInput id="q" value={q} onChange={onAddressChange} onSelect={onAddressSelect} placeholder={current.placeholder} suggestOnMount={suggestOnMount} />
        ) : (
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={current.placeholder} autoComplete="off"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        )}
        <button type="submit" disabled={pending || !canSearch} aria-disabled={pending || !canSearch}
          title={mode === "address" && !canSearch ? "Choose an address from the suggestions" : undefined}
          className="rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed px-6 py-3 font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {pending ? "Searching…" : "Search permits"}
        </button>
      </div>
    </form>
  );
}
