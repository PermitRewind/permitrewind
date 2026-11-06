"use client";
import { useEffect, useId, useRef, useState } from "react";
import { reduceComboboxKey } from "@/lib/address-combobox";
import { ADDRESS_SUGGEST_DEBOUNCE_MS, ADDRESS_SUGGEST_MIN_CHARS, highlightAddressLabel } from "@/lib/address-normalize";
import type { AddressSuggestResponse, AddressSuggestion } from "@/lib/address-suggest";

export default function AddressSuggestInput({
  id,
  value,
  onChange,
  onSelect,
  placeholder,
  suggestOnMount = false,
  hintClassName = "text-slate-500",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** A dropdown row was actually chosen. Does not run the search by itself. */
  onSelect: (suggestion: AddressSuggestion) => void;
  placeholder: string;
  /** Deep links open suggestions so the address can be picked. */
  suggestOnMount?: boolean;
  hintClassName?: string;
}) {
  const listId = useId();
  const hintId = `${id}-hint`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<AddressSuggestResponse | null>(null);
  const [edited, setEdited] = useState(suggestOnMount && value.trim().length >= ADDRESS_SUGGEST_MIN_CHARS);
  const abortRef = useRef<AbortController | null>(null);
  const suggestions = payload?.suggestions ?? [];
  const showList = open && edited && value.trim().length >= ADDRESS_SUGGEST_MIN_CHARS;

  useEffect(() => {
    if (!edited || value.trim().length < ADDRESS_SUGGEST_MIN_CHARS) {
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
    }, ADDRESS_SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
      abortRef.current?.abort();
    };
  }, [value, edited]);

  function choose(suggestion: AddressSuggestion) {
    if (!suggestion.token) return;
    setOpen(false);
    setActive(-1);
    onChange(suggestion.label);
    onSelect(suggestion);
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
        ? "Suggestions are busy. Check the spelling or try a nearby cross street."
        : suggestions.length === 0
          ? "No Florida address suggestions. Check the spelling or try a nearby cross street."
          : `${suggestions.length} address suggestions`;

  return (
    <div className="flex-1">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-describedby={hintId}
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
            <li className="px-3 py-2 text-slate-500">{payload?.status === "unavailable" || payload?.status === "throttled" ? "Suggestions are busy right now. Check the spelling or try a nearby cross street." : "No Florida address suggestions. Check the spelling or try a nearby cross street, then choose one from the list."}</li>
          )}
          {suggestions.map((s, i) => (
            <li
              id={`${listId}-opt-${i}`}
              key={`${s.label}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s)}
              className={`cursor-pointer px-3 py-2.5 ${i === active ? "bg-brand-600 text-white" : "text-neutral-900 hover:bg-brand-50"}`}
            >
              {highlightAddressLabel(s.label, value).map((part, index) => part.match ? (
                <mark key={index} className={i === active ? "rounded-sm bg-white/25 px-0.5 text-inherit" : "rounded-sm bg-amber-200 px-0.5 text-inherit"}>{part.text}</mark>
              ) : (
                <span key={index}>{part.text}</span>
              ))}
            </li>
          ))}
          <li className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">{payload?.attribution ?? "© OpenStreetMap contributors"}</li>
        </ul>
        )}
      </div>
      <p id={hintId} className={`mt-1 text-xs ${hintClassName}`}>Abbreviations like NE, St, Ave work fine. Polk County results are prioritized.</p>
    </div>
  );
}
