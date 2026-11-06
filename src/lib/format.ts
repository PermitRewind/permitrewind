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
    case "final": case "finaled": return "bg-emerald-100 text-emerald-800";
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
  "City of Davenport": "City of Davenport · city only",
};

function titleCaseShout(city: string): string {
  if (city !== city.toUpperCase()) return city;
  return city.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_match, sep: string, letter: string) => sep + letter.toUpperCase());
}

/**
 * City to show for a result set. The query city wins. When that field is
 * blank, a city shared by every permit (ignoring case) is used, so a search
 * whose geocoder omitted locality still shows one.
 */
export function resultsDisplayCity(
  queryCity: string | null | undefined,
  permits: { city?: string | null }[],
): string | null {
  const typed = queryCity?.trim();
  if (typed) return typed;
  const names = permits.map((permit) => permit.city?.trim()).filter((city): city is string => !!city);
  if (!names.length) return null;
  const key = names[0].toLowerCase();
  if (!names.every((city) => city.toLowerCase() === key)) return null;
  return titleCaseShout(names[0]);
}

/** Street plus the display city, without repeating a city already in the street line. */
export function resultsPlaceLabel(
  query: { q: string; city?: string | null },
  permits: { city?: string | null }[],
): string {
  const city = resultsDisplayCity(query.city, permits);
  if (!city) return query.q;
  if (query.q.toLowerCase().includes(city.toLowerCase())) return query.q;
  return `${query.q}, ${city}`;
}

/** Stacked place lines. Empty unit fields are omitted rather than shown as blanks. */
export function permitLocationLines(p: {
  address?: string | null;
  unitType?: string | null;
  unitNumber?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
}): string[] {
  const lines: string[] = [];
  if (p.address) lines.push(p.address);
  const unit = [p.unitType, p.unitNumber].filter(Boolean).join(" ");
  if (unit) lines.push(unit);
  const stateZip = [p.state, p.zip].filter(Boolean).join(" ");
  const cityLine = [p.city, stateZip].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (p.county) lines.push(p.county.toLowerCase().includes("county") ? p.county : `${p.county} County`);
  return lines;
}

export function sourceAttribution(p: { source?: string; alsoIn?: string[] }): string {
  const label = (source?: string) => (source ? SOURCE_LABELS[source] ?? source : "");
  return [label(p.source), ...(p.alsoIn ?? []).map((s) => label(s))].filter(Boolean).join(" + ");
}
