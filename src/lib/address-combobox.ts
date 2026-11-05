/** Search stays disabled in address mode until this exact text was picked from the list. */
export function isAddressSearchEnabled(input: {
  mode: "address" | "parcel" | "permit";
  text: string;
  selected: { label: string; token: string } | null;
}): boolean {
  const text = input.text.trim();
  if (!text) return false;
  if (input.mode !== "address") return true;
  return !!input.selected?.token && input.selected.label === text;
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
