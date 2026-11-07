import { foldAddressCase, isCompleteStreetTypeToken, isIncompleteStreetTypeToken, sameAddressCase } from "./address-normalize";

/** Search stays disabled in address mode until this text was picked from the list. Letter case does not count. */
export function isAddressSearchEnabled(input: {
  mode: "address" | "parcel" | "permit";
  text: string;
  selected: { label: string; token: string } | null;
}): boolean {
  const text = input.text.trim();
  if (!text) return false;
  if (input.mode !== "address") return true;
  return !!input.selected?.token && sameAddressCase(input.selected.label, text);
}

export interface ComboState {
  open: boolean;
  active: number;
  count: number;
}

export type ComboAction =
  | { type: "move"; state: ComboState; preventDefault: true }
  | { type: "select"; index: number; preventDefault: true }
  | { type: "close"; preventDefault: true }
  | { type: "submit"; preventDefault: false }
  | { type: "none"; preventDefault: false };

/** Keyboard behavior for the address suggestion list. */
export function reduceComboboxKey(state: ComboState, key: string): ComboAction {
  const { open, active, count } = state;
  if (key === "ArrowDown" || key === "ArrowUp") {
    if (count === 0) return { type: "none", preventDefault: false };
    const next = key === "ArrowDown"
      ? (!open || active < 0 ? 0 : (active + 1) % count)
      : (!open || active < 0 ? count - 1 : (active - 1 + count) % count);
    return { type: "move", state: { open: true, active: next, count }, preventDefault: true };
  }
  if (key === "Home" && open && count > 0) {
    return { type: "move", state: { open: true, active: 0, count }, preventDefault: true };
  }
  if (key === "End" && open && count > 0) {
    return { type: "move", state: { open: true, active: count - 1, count }, preventDefault: true };
  }
  if (key === "Escape" && open) return { type: "close", preventDefault: true };
  if (key === "Enter" && open && active >= 0 && active < count) {
    return { type: "select", index: active, preventDefault: true };
  }
  if (key === "Enter") return { type: "submit", preventDefault: false };
  return { type: "none", preventDefault: false };
}

function normSuggestQuery(value: string): string {
  return foldAddressCase(value).replace(/\s+/g, " ");
}

/**
 * The new text is the previous text plus one street-type token.
 * "Dr" is finished. "D" and "Stre" are not.
 */
export function addedStreetTypeKind(previousQuery: string, nextQuery: string): "incomplete" | "complete" | null {
  const prev = normSuggestQuery(previousQuery);
  const next = normSuggestQuery(nextQuery);
  if (!prev || next.length <= prev.length || !next.startsWith(prev)) return null;
  const rest = next.slice(prev.length);
  if (!/^\s+\S+$/.test(rest)) return null;
  const token = rest.trim();
  if (isCompleteStreetTypeToken(token)) return "complete";
  if (isIncompleteStreetTypeToken(token)) return "incomplete";
  return null;
}

function isSuggestExtension(previousQuery: string, nextQuery: string): boolean {
  const prev = normSuggestQuery(previousQuery);
  const next = normSuggestQuery(nextQuery);
  return !!prev && next.startsWith(prev) && next !== prev;
}

/**
 * Keep the last good rows when the next text is the same letters in another
 * case, when the next keystrokes are an unfinished street type, or when the
 * map is throttled on a longer version of the same line. A finished type that
 * comes back empty replaces the list.
 */
export function mergeAddressSuggestResponse<T extends { query: string; suggestions: readonly unknown[]; status: string }>(
  previous: T | null,
  next: T,
): T {
  if (next.suggestions.length > 0 || !previous?.suggestions.length) return next;
  if (normSuggestQuery(previous.query) === normSuggestQuery(next.query)) {
    return {
      ...next,
      query: previous.query,
      suggestions: previous.suggestions,
      status: "ok" as T["status"],
    };
  }
  const kind = addedStreetTypeKind(previous.query, next.query);
  const keepIncomplete = kind === "incomplete" && (next.status === "empty" || next.status === "throttled" || next.status === "unavailable");
  const keepBusy = isSuggestExtension(previous.query, next.query) && (next.status === "throttled" || next.status === "unavailable");
  if (!keepIncomplete && !keepBusy) return next;
  return {
    ...next,
    query: previous.query,
    suggestions: previous.suggestions,
    status: "ok" as T["status"],
  };
}
