export function fmtDate(d?: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return y && m && day ? `${m}/${day}/${y}` : d;
}
export function fmtLabel(s?: string | null) {
  if (!s) return "—";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
export function fmtMoney(n?: number | null) {
  return n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
export function bestDate(p: { dateIssued: string | null; dateFiled: string | null }) {
  return p.dateIssued ?? p.dateFiled;
}
export function statusColor(s?: string | null) {
  switch ((s ?? "").toLowerCase()) {
    case "final": return "bg-emerald-100 text-emerald-800";
    case "issued": return "bg-neutral-200 text-neutral-800";
    case "in_progress": case "filed": return "bg-amber-100 text-amber-800";
    case "expired": case "cancelled": case "revoked": return "bg-rose-100 text-rose-800";
    default: return "bg-slate-100 text-slate-700";
  }
}

/** Permit Issue Date: issued date, else the record/filed date. */
export const issueDate = (p: { dateIssued: string | null; dateFiled: string | null }) => p.dateIssued ?? p.dateFiled;
/** Permit Final Date (finaled / completed). */
export const finalDate = (p: { dateCompleted: string | null }) => p.dateCompleted;

const SOURCE_LABELS: Record<string, string> = {
  PermitStack: "PermitStack · statewide Florida",
  "Polk County Accela": "Polk County Accela · Polk County only",
  "Property Appraiser": "Polk County Property Appraiser · Polk County only",
  "Polk County Property Appraiser": "Polk County Property Appraiser · Polk County only",
};

/** User-facing source line. PermitStack is statewide; county portals are Polk-only. */
export function sourceAttribution(p: { source?: string; alsoIn?: string[] }): string {
  const label = (source?: string) => (source ? SOURCE_LABELS[source] ?? source : "");
  return [label(p.source), ...(p.alsoIn ?? []).map((s) => label(s))].filter(Boolean).join(" + ");
}
