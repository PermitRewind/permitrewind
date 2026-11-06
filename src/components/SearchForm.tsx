"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AddressSuggestInput from "@/components/AddressSuggestInput";
import { isAddressSearchEnabled } from "@/lib/address-combobox";
import type { AddressSuggestion } from "@/lib/address-suggest";
import { DEFAULT_COUNTY, FLORIDA_COUNTIES } from "@/lib/jurisdictions";
import type { SearchMode } from "@/lib/types";

const MODES: { id: SearchMode; label: string; placeholder: string }[] = [
  { id: "address", label: "Address", placeholder: "e.g. 123 NE Main St, Lakeland or Try “Northeast” or “NE”" },
  { id: "parcel", label: "Parcel ID", placeholder: "e.g. 24-28-15-000000-012345" },
  { id: "permit", label: "Permit #", placeholder: "e.g. BT-2026-14923" },
];

const UNIT_TYPES = ["Apt", "Unit", "Suite"];
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600";

export default function SearchForm({
  initialMode = "address",
  initialQ = "",
  compact = false,
  initialSelection = null,
  suggestOnMount = false,
  initialCity = "",
  initialState = "FL",
  initialZip = "",
  initialCounty = DEFAULT_COUNTY,
  initialUnitType = "",
  initialUnitNumber = "",
  initialBroad = false,
}: {
  initialMode?: SearchMode;
  initialQ?: string;
  compact?: boolean;
  initialSelection?: { label: string; token: string } | null;
  suggestOnMount?: boolean;
  initialCity?: string;
  initialState?: string;
  initialZip?: string;
  initialCounty?: string;
  initialUnitType?: string;
  initialUnitNumber?: string;
  initialBroad?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [q, setQ] = useState(initialQ);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<{ label: string; token: string } | null>(
    initialSelection && initialSelection.label === initialQ.trim() ? initialSelection : null,
  );
  const [city, setCity] = useState(initialCity);
  const [state, setState] = useState(initialState || "FL");
  const [zip, setZip] = useState(initialZip);
  const [county, setCounty] = useState(initialCounty || DEFAULT_COUNTY);
  const [unitType, setUnitType] = useState(initialUnitType);
  const [unitNumber, setUnitNumber] = useState(initialUnitNumber);
  const [showUnit, setShowUnit] = useState(!!(initialUnitType || initialUnitNumber));
  const [broad, setBroad] = useState(initialBroad);
  const current = MODES.find((m) => m.id === mode)!;
  const canSearch = isAddressSearchEnabled({ mode, text: q, selected });

  function go(street: string, token?: string) {
    const text = street.trim();
    if (!text) return;
    setPending(true);
    const params = new URLSearchParams({ mode, q: text });
    if (mode === "address") {
      if (city.trim()) params.set("city", city.trim());
      if (state.trim()) params.set("state", state.trim());
      if (zip.trim()) params.set("zip", zip.trim());
      if (county.trim()) params.set("county", county.trim());
      if (showUnit && unitType) params.set("unitType", unitType);
      if (showUnit && unitNumber.trim()) params.set("unit", unitNumber.trim());
      if (broad) params.set("broad", "1");
      if (token) params.set("sel", token);
    }
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
    setQ(suggestion.street);
    setSelected({ label: suggestion.street, token: suggestion.token });
    setCity(suggestion.city ?? "");
    setState(suggestion.state || "FL");
    setZip(suggestion.zip ?? "");
    setCounty(suggestion.county || DEFAULT_COUNTY);
    const hasUnit = !!(suggestion.unitType || suggestion.unitNumber);
    setShowUnit(hasUnit);
    setUnitType(hasUnit ? suggestion.unitType ?? "Apt" : "");
    setUnitNumber(hasUnit ? suggestion.unitNumber ?? "" : "");
  }

  return (
    <form onSubmit={submit} className={`no-print w-full ${compact ? "" : "max-w-3xl mx-auto"}`} role="search">
      <div className="flex gap-1 mb-2" role="tablist" aria-label="Search by">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${mode === m.id ? (compact ? "bg-brand-600 text-white" : "bg-white text-neutral-950") : compact ? "text-slate-600 hover:bg-slate-200" : "text-neutral-300 hover:bg-white/10"}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "address" ? (
        <div className="flex flex-col gap-2 text-left">
          <div>
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-slate-600">Street address</label>
            <AddressSuggestInput id="q" value={q} onChange={onAddressChange} onSelect={onAddressSelect} placeholder={current.placeholder} suggestOnMount={suggestOnMount} hintClassName={compact ? "text-slate-500" : "text-neutral-200"} />
          </div>
          {showUnit && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-slate-600">Unit type
                <select value={unitType} onChange={(e) => setUnitType(e.target.value)} className={`${field} mt-1`}>
                  {UNIT_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">Unit number
                <input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} className={`${field} mt-1`} inputMode="text" />
              </label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">City
              <input value={city} onChange={(e) => setCity(e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="text-xs font-medium text-slate-600">State
              <select value={state} onChange={(e) => setState(e.target.value)} className={`${field} mt-1`}>
                <option value="FL">FL</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">ZIP
              <input value={zip} onChange={(e) => setZip(e.target.value)} className={`${field} mt-1`} inputMode="numeric" maxLength={10} />
            </label>
            <label className="text-xs font-medium text-slate-600">County
              <select value={county} onChange={(e) => setCounty(e.target.value)} className={`${field} mt-1`}>
                {FLORIDA_COUNTIES.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={broad} onChange={(e) => setBroad(e.target.checked)} />
            Include other cities
          </label>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <label htmlFor="q" className="sr-only">{current.label}</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={current.placeholder} autoComplete="off"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <button type="submit" disabled={pending || !canSearch} aria-disabled={pending || !canSearch}
          title={mode === "address" && !canSearch ? "Choose an address from the suggestions" : undefined}
          className="w-full sm:w-auto rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed px-6 py-3 font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {pending ? "Searching…" : "Search permits"}
        </button>
      </div>
    </form>
  );
}
