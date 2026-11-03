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
    case "issued": return "bg-sky-100 text-sky-800";
    case "in_progress": case "filed": return "bg-amber-100 text-amber-800";
    case "expired": case "cancelled": case "revoked": return "bg-rose-100 text-rose-800";
    default: return "bg-slate-100 text-slate-700";
  }
}
