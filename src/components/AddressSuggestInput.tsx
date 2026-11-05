"use client";
import { useEffect, useId, useRef, useState } from "react";
import { reduceComboboxKey } from "@/lib/address-combobox";
import type { AddressSuggestResponse, AddressSuggestion } from "@/lib/address-suggest";

const DEBOUNCE_MS = 400;

export default function AddressSuggestInput({
  id,
  value,
  onChange,
  onPick,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Standardized label chosen from the list, or submitted as typed. */
  onPick: (label: string) => void;
  placeholder: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<AddressSuggestResponse | null>(null);
  const [edited, setEdited] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const suggestions = payload?.suggestions ?? [];
  const showList = open && edited && value.trim().length >= 4;

  useEffect(() => {
    if (!edited || value.trim().length < 4) {
      setPayload(null);
      setLoading(false);
      setActive(-1);
      return;
    }
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      fetch(`/api/address-suggest?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<AddressSuggestResponse>)
        .then((body) => {
          if (controller.signal.aborted) return;
          setPayload(body);
          setOpen(true);
          setActive(-1);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setPayload({ query: value.trim(), suggestions: [], attribution: "© OpenStreetMap contributors", status: "unavailable" });
          setOpen(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, edited]);

  function choose(suggestion: AddressSuggestion) {
    setOpen(false);
    setActive(-1);
    onChange(suggestion.label);
    onPick(suggestion.label);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const action = reduceComboboxKey({ open: showList, active, count: suggestions.length }, e.key);
    if (action.preventDefault) e.preventDefault();
    if (action.type === "move") {
      setOpen(true);
      setActive(action.state.active);
    } else if (action.type === "close") {
      setOpen(false);
      setActive(-1);
    } else if (action.type === "select") {
      const suggestion = suggestions[action.index];
      if (suggestion) choose(suggestion);
    }
  }

  const statusText = !showList
    ? ""
    : loading
      ? "Looking up Florida addresses"
      : payload?.status === "unavailable" || payload?.status === "throttled"
        ? "Suggestions are busy. You can still search what you typed."
        : suggestions.length === 0
          ? "No Florida address suggestions. You can still search what you typed."
          : `${suggestions.length} address suggestions`;

  return (
    <div className="relative flex-1">
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-opt-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setEdited(true);
          setOpen(true);
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
      />
      <div className="sr-only" aria-live="polite">{statusText}</div>
      {showList && (
        <ul id={listId} role="listbox" aria-label="Florida address suggestions" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-left text-sm shadow-lg">
          {loading && suggestions.length === 0 && <li className="px-3 py-2 text-slate-500">Looking up Florida addresses…</li>}
          {!loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-slate-500">{payload?.status === "unavailable" || payload?.status === "throttled" ? "Suggestions are busy right now. You can still search what you typed." : "No Florida address suggestions. You can still search what you typed."}</li>
          )}
          {suggestions.map((s, i) => (
            <li
              id={`${listId}-opt-${i}`}
              key={s.label}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
              className={`cursor-pointer px-3 py-2.5 ${i === active ? "bg-brand-600 text-white" : "text-neutral-900 hover:bg-brand-50"}`}
            >
              {s.label}
            </li>
          ))}
          <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">{payload?.attribution ?? "© OpenStreetMap contributors"}</li>
        </ul>
      )}
    </div>
  );
}
